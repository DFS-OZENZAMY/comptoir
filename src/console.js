// Console du propriétaire de la plateforme : vue d'ensemble, commerces, usage, abonnements.
import { HttpError, json, r2, num, str, today, addDays, isDate, nowIso, readBody, hashPassword, tempPassword } from './lib.js';
import { PLANS, PAID_PLANS, BUSINESS_TYPES, COUNTRIES } from './catalog.js';
import { logEvent } from './db.js';

const SALES = "((d.type = 'facture' AND d.status != 'annulée' AND COALESCE(d.source_type, '') != 'ticket') OR (d.type = 'ticket' AND d.status = 'payé'))";
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);

function health(s) {
  if (s.status === 'suspended') return 'suspendu';
  if (s.plan === 'essai' && s.trial_ends_at && s.trial_ends_at < today()) return 'essai terminé';
  if (s.created_at >= ago(7)) return 'nouveau';
  if (s.last_active_at && s.last_active_at >= ago(7)) return 'actif';
  if (s.last_active_at && s.last_active_at >= ago(21)) return 'à risque';
  return 'inactif';
}

async function overview(db) {
  const month = today().slice(0, 7);
  const stores = (await db.prepare('SELECT id, plan, status, trial_ends_at, created_at, last_active_at FROM stores').all()).results;
  const counts = { total: stores.length, active_7d: 0, active_30d: 0, trial: 0, trial_expired: 0, paying: 0, suspended: 0, new_month: 0 };
  let mrr = 0;
  const byPlan = {};
  for (const s of stores) {
    byPlan[s.plan] = (byPlan[s.plan] || 0) + 1;
    if (s.last_active_at >= ago(7)) counts.active_7d++;
    if (s.last_active_at >= ago(30)) counts.active_30d++;
    if (s.status === 'suspended') counts.suspended++;
    if (s.created_at.slice(0, 7) === month) counts.new_month++;
    if (s.plan === 'essai') { if (s.trial_ends_at >= today()) counts.trial++; else counts.trial_expired++; }
    if (PAID_PLANS.includes(s.plan) && s.status === 'active') { counts.paying++; mrr += PLANS[s.plan].price; }
  }
  const gmvRows = (await db.prepare(`SELECT COALESCE(st.value, '€') AS currency, SUM(d.total_ttc) AS v, COUNT(*) AS n, COUNT(DISTINCT d.store_id) AS stores
      FROM documents d LEFT JOIN settings st ON st.store_id = d.store_id AND st.key = 'currency'
      WHERE ${SALES} AND substr(d.date, 1, 7) = ? GROUP BY currency ORDER BY v DESC`).bind(month).all()).results;
  const signups = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) signups.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const sm = (await db.prepare(`SELECT substr(created_at, 1, 7) AS m, COUNT(*) AS n FROM stores WHERE created_at >= ? GROUP BY m`).bind(signups[0] + '-01').all()).results;
  const activity = (await db.prepare(`SELECT day, SUM(actions) AS actions, SUM(tickets) AS tickets, SUM(sales_amount) AS sales,
      SUM(catalog_views) AS views, SUM(logins) AS logins, COUNT(DISTINCT CASE WHEN actions + logins > 0 THEN store_id END) AS stores
      FROM daily_stats WHERE day >= ? GROUP BY day ORDER BY day`).bind(addDays(today(), -29)).all()).results;
  const requests = (await db.prepare(`SELECT id, name, slug, plan, plan_requested FROM stores WHERE plan_requested IS NOT NULL AND plan_requested != '' ORDER BY id DESC`).all()).results;
  const events = (await db.prepare(`SELECT e.type, e.detail, e.created_at, s.name AS store_name, s.id AS store_id FROM events e
      LEFT JOIN stores s ON s.id = e.store_id WHERE e.type IN ('signup', 'plan_request', 'plan_change', 'status_change') ORDER BY e.id DESC LIMIT 15`).all()).results;
  return {
    counts, mrr, arr: mrr * 12, by_plan: byPlan,
    gmv_month: gmvRows.map((g) => ({ currency: g.currency, amount: r2(g.v), sales: g.n, stores: g.stores })),
    sales_month: gmvRows.reduce((t, g) => t + g.n, 0),
    signups: signups.map((m) => ({ month: m, value: (sm.find((r) => r.m === m) || {}).n || 0 })),
    activity, requests, events,
  };
}

async function listStores(db) {
  const since = addDays(today(), -29);
  const rows = (await db.prepare(`SELECT s.*,
      (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.store_id = s.id AND m.role = 'owner' LIMIT 1) AS owner_email,
      (SELECT u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.store_id = s.id AND m.role = 'owner' LIMIT 1) AS owner_name,
      (SELECT value FROM settings st WHERE st.store_id = s.id AND st.key = 'currency') AS currency,
      (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id) AS products,
      (SELECT COUNT(*) FROM memberships m WHERE m.store_id = s.id) AS users,
      (SELECT COALESCE(SUM(sales_amount), 0) FROM daily_stats ds WHERE ds.store_id = s.id AND ds.day >= ?) AS sales_30d,
      (SELECT COALESCE(SUM(tickets), 0) FROM daily_stats ds WHERE ds.store_id = s.id AND ds.day >= ?) AS tickets_30d,
      (SELECT COALESCE(SUM(documents), 0) FROM daily_stats ds WHERE ds.store_id = s.id AND ds.day >= ?) AS documents_30d,
      (SELECT COALESCE(SUM(actions), 0) FROM daily_stats ds WHERE ds.store_id = s.id AND ds.day >= ?) AS actions_30d,
      (SELECT COALESCE(SUM(catalog_views), 0) FROM daily_stats ds WHERE ds.store_id = s.id AND ds.day >= ?) AS views_30d,
      (SELECT COUNT(DISTINCT day) FROM daily_stats ds WHERE ds.store_id = s.id AND ds.day >= ? AND ds.actions + ds.logins > 0) AS active_days_30d
    FROM stores s ORDER BY s.created_at DESC LIMIT 1000`).bind(since, since, since, since, since, since).all()).results;
  return rows.map((s) => ({
    ...s, health: health(s), sales_30d: r2(s.sales_30d),
    type_label: (BUSINESS_TYPES[s.business_type] || BUSINESS_TYPES.autre).label,
    country_name: (COUNTRIES[s.country] || COUNTRIES.XX).name,
    plan_name: (PLANS[s.plan] || PLANS.essai).name,
  }));
}

async function storeDetail(db, id) {
  const store = await db.prepare('SELECT * FROM stores WHERE id = ?').bind(num(id)).first();
  if (!store) throw new HttpError(404, 'Commerce introuvable.');
  const sid = store.id;
  const [team, settings, stats, events, totals, features] = await Promise.all([
    db.prepare(`SELECT u.id, u.name, u.email, u.last_login_at, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.store_id = ? ORDER BY m.role DESC`).bind(sid).all(),
    db.prepare(`SELECT key, value FROM settings WHERE store_id = ? AND key IN ('currency', 'phone', 'email', 'address')`).bind(sid).all(),
    db.prepare(`SELECT * FROM daily_stats WHERE store_id = ? AND day >= ? ORDER BY day`).bind(sid, addDays(today(), -29)).all(),
    db.prepare(`SELECT e.type, e.detail, e.created_at, u.name AS user_name FROM events e LEFT JOIN users u ON u.id = e.user_id WHERE e.store_id = ? ORDER BY e.id DESC LIMIT 40`).bind(sid).all(),
    db.prepare(`SELECT
        (SELECT COUNT(*) FROM products WHERE store_id = ?) AS products,
        (SELECT COUNT(*) FROM customers WHERE store_id = ?) AS customers,
        (SELECT COUNT(*) FROM documents WHERE store_id = ? AND type = 'ticket') AS tickets,
        (SELECT COUNT(*) FROM documents WHERE store_id = ? AND type = 'facture') AS invoices,
        (SELECT COUNT(*) FROM documents WHERE store_id = ? AND type = 'devis') AS quotes,
        (SELECT COUNT(*) FROM documents WHERE store_id = ? AND type = 'commande') AS orders,
        (SELECT COALESCE(SUM(d.total_ttc), 0) FROM documents d WHERE d.store_id = ? AND ${SALES}) AS sales_total`).bind(sid, sid, sid, sid, sid, sid, sid).first(),
    db.prepare(`SELECT type, COUNT(*) AS n FROM events WHERE store_id = ? AND created_at >= ? GROUP BY type`).bind(sid, ago(30)).all(),
  ]);
  const st = {}; settings.results.forEach((r) => { st[r.key] = r.value; });
  return {
    store: { ...store, health: health(store), plan_name: (PLANS[store.plan] || PLANS.essai).name, type_label: (BUSINESS_TYPES[store.business_type] || BUSINESS_TYPES.autre).label, country_name: (COUNTRIES[store.country] || COUNTRIES.XX).name },
    contact: st, team: team.results, stats: stats.results, events: events.results, totals: { ...totals, sales_total: r2(totals.sales_total) },
    features: Object.fromEntries(features.results.map((f) => [f.type, f.n])),
  };
}

async function updateStore(db, ctx, id, b) {
  const store = await db.prepare('SELECT * FROM stores WHERE id = ?').bind(num(id)).first();
  if (!store) throw new HttpError(404, 'Commerce introuvable.');
  const plan = b.plan && PLANS[b.plan] ? b.plan : store.plan;
  const status = ['active', 'suspended'].includes(b.status) ? b.status : store.status;
  const trial = isDate(b.trial_ends_at) ? b.trial_ends_at : store.trial_ends_at;
  const notes = 'console_notes' in b ? str(b.console_notes, 3000) : store.console_notes;
  const requested = plan !== store.plan && plan === store.plan_requested ? null : (b.clear_request ? null : store.plan_requested);
  await db.prepare('UPDATE stores SET plan = ?, status = ?, trial_ends_at = ?, console_notes = ?, plan_requested = ? WHERE id = ?')
    .bind(plan, status, trial, notes, requested, store.id).run();
  if (plan !== store.plan) await logEvent(db, store.id, ctx.user.id, 'plan_change', `${PLANS[store.plan]?.name || store.plan} → ${PLANS[plan].name}`);
  if (status !== store.status) await logEvent(db, store.id, ctx.user.id, 'status_change', status === 'suspended' ? 'Suspendu' : 'Réactivé');
  if (trial !== store.trial_ends_at) await logEvent(db, store.id, ctx.user.id, 'trial_change', `Essai jusqu'au ${trial}`);
  return storeDetail(db, store.id);
}

export async function consoleRoutes(ctx, parts) {
  const { db, request } = ctx;
  const m = request.method;
  const [res, id, action] = parts;
  if (res === 'overview' && m === 'GET') return json(await overview(db));
  if (res === 'stores' && !id && m === 'GET') return json(await listStores(db));
  if (res === 'stores' && id && !action && m === 'GET') return json(await storeDetail(db, id));
  if (res === 'stores' && id && !action && m === 'POST') return json(await updateStore(db, ctx, id, await readBody(request)));
  if (res === 'users' && id && action === 'reset' && m === 'POST') {
    const user = await db.prepare('SELECT id, email FROM users WHERE id = ?').bind(num(id)).first();
    if (!user) throw new HttpError(404, 'Utilisateur introuvable.');
    const password = tempPassword();
    await db.batch([
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').bind(await hashPassword(password), user.id),
      db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    ]);
    return json({ ok: true, email: user.email, temp_password: password });
  }
  if (res === 'plans' && m === 'GET') return json(PLANS);
  throw new HttpError(404, 'Route inconnue.');
}
