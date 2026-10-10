// Outils de test : l'application complète en mémoire (base SQLite :memory:, fichiers en mémoire),
// appelée directement, sans réseau ni serveur. Chaque fichier de test démarre sa propre instance.
import { createEnv } from '../src/adapters/node/env.js';
import { createHandler } from '../src/adapters/node/handler.js';

export async function startApp(vars = {}) {
  const env = await createEnv({ DATABASE_URL: ':memory:', STORAGE_DRIVER: 'memory', PLATFORM_ADMIN_EMAILS: 'admin@test.dev', DISABLE_CRON: 'true', ...vars });
  const { handle } = createHandler(env);
  return { env, handle, client: () => new Client(handle) };
}

// Un navigateur minimal : garde le cookie de session et envoie l'en-tête de boutique.
export class Client {
  constructor(handle) { this.handle = handle; this.cookie = ''; this.location = null; }
  async req(method, path, body, headers = {}) {
    const h = new Headers(headers);
    if (this.cookie) h.set('cookie', this.cookie);
    if (this.location !== null && !h.has('x-location')) h.set('x-location', String(this.location));
    if (body !== undefined) h.set('content-type', 'application/json');
    const res = await this.handle(new Request(`https://comptoir.test${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
    const set = res.headers.getSetCookie?.() || [];
    const session = set.find((c) => c.startsWith('cp_session='));
    if (session) this.cookie = session.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, data: type.includes('json') && text ? JSON.parse(text) : null };
  }
  get(p, h) { return this.req('GET', p, undefined, h); }
  post(p, b, h) { return this.req('POST', p, b ?? {}, h); }
  put(p, b, h) { return this.req('PUT', p, b ?? {}, h); }
  del(p, h) { return this.req('DELETE', p, undefined, h); }
  async signup(o = {}) {
    const r = await this.post('/api/auth/signup', { name: 'Test', email: `t${Math.random().toString(36).slice(2, 8)}@test.dev`, password: 'motdepasse1', store_name: 'Commerce test', business_type: 'quincaillerie', country: 'FR', ...o });
    if (r.status !== 201 && r.status !== 200) throw new Error(`Inscription : ${r.status} ${r.text}`);
    return r.data;
  }
}
