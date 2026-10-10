// Traitement d'une requête hors Cloudflare, dans le même ordre que Cloudflare :
// adresses listées dans run_worker_first → application ; sinon fichier du site s'il existe ; sinon application.
import app from '../../app.js';
import { workerFirstPatterns } from './env.js';

export function createHandler(env) {
  const first = workerFirstPatterns();
  const pending = new Set();
  const ctx = { waitUntil(p) { const t = Promise.resolve(p).catch((e) => console.error('Tâche de fond :', e.message)); pending.add(t); t.finally(() => pending.delete(t)); }, passThroughOnException() {} };
  async function handle(request) {
    const { pathname } = new URL(request.url);
    if (first.some((re) => re.test(pathname))) return app.fetch(request, env, ctx);
    if (request.method === 'GET' || request.method === 'HEAD') {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
    }
    return app.fetch(request, env, ctx);
  }
  return { handle, settle: () => Promise.allSettled([...pending]) };
}
