// Comptoir : point d'entrée du Worker.
//   /            site de présentation et inscription (public/index.html)
//   /app/        espace de gestion d'un commerce
//   /console/    console du propriétaire de la plateforme
//   /s/<slug>    catalogue public d'un commerce
//   /api/...     API
import { HttpError, json, num, r2, readBody } from './lib.js';
import { init, bump, recordRequest, logError, setMeta } from './db.js';
import { PLATFORM, PLANS, PAID_PLANS, BUSINESS_TYPES, COUNTRIES } from './catalog.js';
import { signup, login, logout, getContext, me, changePassword, touchStore } from './auth.js';
import { storeRoutes, getSettings, imageUrl, runDailyDigests } from './store.js';
import { resolveAccess } from './access.js';
import { consoleRoutes, takeSnapshot, cleanup } from './console.js';
import { renderLanding, renderMetier, renderHub, renderVitrine, sitemap, robots, html } from './seo.js';

async function publicCatalog(db, slug) {
  const store = await db.prepare('SELECT id, name, slug, status, business_type FROM stores WHERE slug = ?').bind(slug).first();
  if (!store || store.status !== 'active') throw new HttpError(404, 'Ce commerce est introuvable.');
  const s = await getSettings(db, store.id, store);
  if (s.catalog_public === '0') throw new HttpError(404, "Ce catalogue n'est pas public.");
  const settings = {};
  for (const k of ['shop_name', 'tagline', 'address', 'phone', 'email', 'hours', 'currency', 'accent', 'show_prices', 'show_stock']) settings[k] = s[k];
  const categories = (await db.prepare('SELECT id, name FROM categories WHERE store_id = ? ORDER BY position, name').bind(store.id).all()).results;
  const rows = (await db.prepare(`SELECT id, ref, name, description, category_id, price_ht, tva_rate, stock, stock_min, unit, image_v, track_stock
    FROM products WHERE store_id = ? AND visible = 1 ORDER BY name COLLATE NOCASE`).bind(store.id).all()).results;
  const showPrices = s.show_prices !== '0', showStock = s.show_stock !== '0';
  const products = rows.map((p) => ({
    id: p.id, ref: p.ref, name: p.name, description: p.description, category_id: p.category_id, unit: p.unit, image: imageUrl(p),
    price_ttc: showPrices ? r2(p.price_ht * (1 + p.tva_rate / 100)) : null,
    availability: !showStock ? null : !p.track_stock ? 'in' : p.stock <= 0 ? 'out' : p.stock <= p.stock_min ? 'low' : 'in',
  }));
  await bump(db, store.id, 'catalog_views');
  return { store: { name: store.name, slug: store.slug }, settings, categories, products };
}

async function serveImage(db, id) {
  const img = await db.prepare('SELECT mime, data FROM images WHERE product_id = ?').bind(num(id)).first();
  if (!img) return new Response('Image introuvable', { status: 404 });
  const bin = atob(img.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: { 'content-type': img.mime, 'cache-control': 'public, max-age=31536000, immutable' } });
}

// Nom de la fonction appelée, sans identifiants : « store/products », « public/stores »…
export function routeName(parts) {
  const [a, b] = parts;
  if (!a) return 'racine';
  if (a === 'images') return 'images';
  return b && !/^\d+$/.test(b) ? `${a}/${b}` : a;
}

async function handleApi(request, env, info) {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  info.route = routeName(parts);
  const m = request.method;
  try {
    if (!env.DB) throw new HttpError(500, 'Base de données non liée (binding DB).');
    const db = env.DB;
    await init(db);
    const [a, b, c] = parts;

    if (a === 'platform' && m === 'GET') {
      return json({
        name: PLATFORM.name, tagline: PLATFORM.tagline, trial_days: PLATFORM.trialDays,
        plans: Object.entries(PLANS).filter(([k]) => PAID_PLANS.includes(k)).map(([key, p]) => ({ key, ...p })),
        business_types: Object.entries(BUSINESS_TYPES).map(([key, t]) => ({ key, label: t.label })),
        countries: Object.entries(COUNTRIES).map(([key, x]) => ({ key, ...x })),
      });
    }
    if (a === 'images' && b && m === 'GET') return await serveImage(db, b);
    if (a === 'public' && b === 'stores' && c && m === 'GET') return json(await publicCatalog(db, c));

    if (a === 'auth') {
      if (b === 'signup' && m === 'POST') return await signup(db, env, await readBody(request));
      if (b === 'login' && m === 'POST') return await login(db, env, await readBody(request));
      if (b === 'logout' && m === 'POST') return await logout(db, request);
    }

    const ctx = await getContext(db, env, request);
    if (a === 'auth' && b === 'me' && m === 'GET') {
      if (ctx?.store) await resolveAccess(db, ctx, request);
      return json(ctx ? { authenticated: true, ...(await me(db, ctx)) } : { authenticated: false });
    }
    if (!ctx) throw new HttpError(401, 'Session expirée : reconnectez-vous.');
    info.user_id = ctx.user.id; info.store_id = ctx.store?.id;
    if (a === 'auth' && b === 'password' && m === 'POST') return json(await changePassword(db, ctx, await readBody(request)));

    if (a === 'store') {
      if (!ctx.store) throw new HttpError(403, "Ce compte n'est rattaché à aucun commerce.");
      await touchStore(db, ctx.store);
      return await storeRoutes({ ...ctx, db, env, request, url }, parts.slice(1));
    }
    if (a === 'console') {
      if (!ctx.platformAdmin) throw new HttpError(403, 'Accès réservé à l’administrateur de la plateforme.');
      return await consoleRoutes({ ...ctx, db, env, request, url }, parts.slice(1));
    }
    throw new HttpError(404, 'Route inconnue.');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) { console.error(e); info.error = e.message || String(e); }
    return json({ error: status === 500 ? 'Erreur serveur. Réessayez dans un instant.' : e.message }, status);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    // Un seul domaine pour Google : si APP_URL est réglé, les autres adresses (workers.dev…) redirigent vers lui.
    if (env.APP_URL && (request.method === 'GET' || request.method === 'HEAD') && !p.startsWith('/api/')) {
      try {
        const main = new URL(env.APP_URL);
        if (main.host !== url.host && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(url.host)) {
          return Response.redirect(main.origin + p + url.search, 301);
        }
      } catch { /* APP_URL invalide : ignoré */ }
    }
    if (p === '/api' || p.startsWith('/api/')) {
      const t0 = Date.now();
      const info = { route: 'api' };
      const res = await handleApi(request, env, info);
      const ms = Date.now() - t0;
      if (env.DB) {
        ctx.waitUntil((async () => {
          await recordRequest(env.DB, info.route, res.status, ms);
          if (res.status >= 500) {
            await logError(env.DB, { method: request.method, route: info.route, path: p, status: res.status, message: info.error || '', store_id: info.store_id, user_id: info.user_id });
          }
        })().catch(() => {}));
      }
      return res;
    }
    // Pages publiques rendues côté serveur pour le référencement
    try {
      if (p === '/robots.txt') return robots(url);
      if (p === '/sitemap.xml') return await sitemap(env, url);
      if (p === '/' || p === '/index.html') return await renderLanding(env, request, url);
      if (p === '/logiciel-de-caisse' || p === '/logiciel-de-caisse/') {
        if (p === '/logiciel-de-caisse') return Response.redirect(url.origin + '/logiciel-de-caisse/', 301);
        return html(renderHub(url.origin));
      }
      const mm = p.match(/^\/logiciel-de-caisse\/([a-z-]+)\/?$/);
      if (mm) {
        if (p.endsWith('/')) return Response.redirect(url.origin + p.slice(0, -1), 301);
        const page = renderMetier(url.origin, mm[1]);
        if (page) return html(page);
        return Response.redirect(url.origin + '/logiciel-de-caisse/', 302);
      }
      const sm = p.match(/^\/s\/([a-z0-9-]+)\/?$/);
      if (sm) {
        if (p.endsWith('/')) return Response.redirect(url.origin + p.slice(0, -1), 301);
        return await renderVitrine(env, request, url, sm[1]);
      }
    } catch (e) {
      console.error('Page publique :', e);
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await init(env.DB);
      const done = [];
      try { await takeSnapshot(env.DB); done.push('instantané'); } catch (e) { done.push('instantané en échec : ' + e.message); }
      try { await cleanup(env.DB); done.push('nettoyage'); } catch (e) { done.push('nettoyage en échec : ' + e.message); }
      try { await runDailyDigests(env); done.push('e-mails'); } catch (e) { done.push('e-mails en échec : ' + e.message); }
      await setMeta(env.DB, 'last_cron', JSON.stringify({ at: new Date().toISOString(), result: done }));
    })().catch((e) => console.error('Tâche du matin :', e.message)));
  },
};
