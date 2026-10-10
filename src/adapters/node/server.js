// Comptoir hors Cloudflare : serveur Node.js (22 ou plus), pour un serveur, Docker, Kubernetes,
// AWS, Google Cloud, Azure, OVH, Scaleway, Render, Railway, Fly.io…
//   node src/adapters/node/server.js      (configuration : variables d'environnement ou fichier .env)
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { loadDotEnv, createEnv } from './env.js';
import { createHandler } from './handler.js';
import { runDailyTasks } from '../../app.js';
import { init } from '../../core/db.js';

loadDotEnv();
const env = await createEnv();
await init(env.DB);
const { handle, settle } = createHandler(env);
const trustProxy = process.env.TRUST_PROXY !== 'false';

function toRequest(req) {
  const proto = trustProxy && req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']).split(',')[0] : 'http';
  const host = (trustProxy && req.headers['x-forwarded-host']) || req.headers.host || 'localhost';
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const init = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') { init.body = Readable.toWeb(req); init.duplex = 'half'; }
  return new Request(`${proto}://${host}${req.url}`, init);
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  try {
    const response = await handle(toRequest(req));
    const headers = {};
    response.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
    const cookies = response.headers.getSetCookie?.() || [];
    if (cookies.length) headers['set-cookie'] = cookies;
    res.writeHead(response.status, headers);
    if (response.body && req.method !== 'HEAD') Readable.fromWeb(response.body).pipe(res); else res.end();
  } catch (e) {
    console.error('Requête en échec :', e);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Erreur interne');
  } finally {
    if (process.env.LOG_REQUESTS === 'true') res.on('finish', () => console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started} ms`));
  }
});

const port = Number(process.env.PORT || 8080), host = process.env.HOST || '0.0.0.0';
server.listen(port, host, () => console.log(`Comptoir prêt sur http://${host === '0.0.0.0' ? 'localhost' : host}:${port} (base : ${env.DB.kind}, fichiers : ${env.STORAGE?.driver || env.STORAGE_DRIVER})`));

// Tâche du matin (statistiques, nettoyage, e-mails) : une fois par jour à CRON_HOUR_UTC.
// Plusieurs serveurs peuvent la programmer : le verrou en base garantit une seule exécution.
let timer;
function scheduleDaily() {
  if (process.env.DISABLE_CRON === 'true') return;
  const hour = Number(process.env.CRON_HOUR_UTC ?? 6);
  const next = new Date(); next.setUTCHours(hour, 0, 0, 0); if (next <= new Date()) next.setUTCDate(next.getUTCDate() + 1);
  timer = setTimeout(async () => { try { console.log('Tâche du matin :', JSON.stringify(await runDailyTasks(env))); } catch (e) { console.error('Tâche du matin en échec :', e.message); } scheduleDaily(); }, next - Date.now());
}
scheduleDaily();

// Arrêt propre (déploiement, mise à l'échelle) : on finit les requêtes et tâches en cours.
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  console.log(`${sig} reçu : arrêt propre…`); clearTimeout(timer);
  server.close(async () => { await settle(); env.DB.close?.(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
});
