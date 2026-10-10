// Console du propriétaire de la plateforme : pilotage, monitoring, commerces, revenus, système.
import { HttpError, json, r2, num, str, today, addDays, isDate, readBody, hashPassword, tempPassword } from './lib.js';
import { PLANS, PAID_PLANS, BUSINESS_TYPES, COUNTRIES, planEur, pricing } from './catalog.js';
import { logEvent } from './db.js';

const SALES = "((d.type = 'facture' AND d.status != 'annulée' AND COALESCE(d.source_type, '') != 'ticket') OR (d.type = 'ticket' AND d.status = 'payé'))";
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);
const all = async (stmt) => (await stmt.all()).results;
const median = (arr) => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const lastDays = (n) => { const out = []; for (let i = n - 1; i >= 0; i--) out.push(addDays(today(), -i)); return out; };

export function health(s) {
  if (s.status === 'suspended') return 'suspendu';
  if (s.plan === 'essai' && s.trial_ends_at && s.trial_ends_at < today()) return 'essai terminé';
  if (s.created_at >= ago(7)) return 'nouveau';
  if (s.last_active_at && s.last_active_at >= ago(7)) return 'actif';
  if (s.last_active_at && s.last_active_at >= ago(21)) return 'à risque';
  return 'inactif';
}
const label = (s) => ({
  type_label: (BUSINESS_TYPES[s.business_type] || BUSINESS_TYPES.autre).label,
  country_name: (COUNTRIES[s.country] || COUNTRIES.XX).name,
  plan_name: (PLANS[s.plan] || PLANS.essai).name,
});

/* ------------------------------------------------------------------ */
/* Instantané quotidien (courbes d'évolution) et nettoyage            */
/* ------------------------------------------------------------------ */

async function platformCounts(db) {
  const stores = await all(db.prepare('SELECT id, plan, status, trial_ends_at, created_at, last_active_at, country FROM stores'));
  const c = { stores: stores.length, active_7d: 0, active_30d: 0, paying: 0, trial: 0, trial_expired: 0, suspended: 0, mrr: 0, new_month: 0, health: {} };
  for (const s of stores) {
    const h = health(s); c.health[h] = (c.health[h] || 0) + 1;
    if (s.last_active_at >= ago(7)) c.active_7d++;
    if (s.last_active_at >= ago(30)) c.active_30d++;
    if (s.status === 'suspended') c.suspended++;
    if (s.created_at.slice(0, 7) === today().slice(0, 7)) c.new_month++;
    if (s.plan === 'essai') { if (s.trial_ends_at >= today()) c.trial++; else c.trial_expired++; }
    if (PAID_PLANS.includes(s.plan) && s.status === 'active') { c.paying++; c.mrr += planEur(s.plan, s.country); }
  }
  return c;
}

export async function takeSnapshot(db) {
  const c = await platformCounts(db);
  const [u, p, sales] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM users').first(),
    db.prepare('SELECT COUNT(*) AS n FROM products').first(),
    db.prepare(`SELECT COUNT(*) AS n FROM documents d WHERE ${SALES} AND d.date = ?`).bind(today()).first(),
  ]);
  await db.prepare(`INSERT OR REPLACE INTO platform_daily (day, stores, active_7d, active_30d, paying, trial, suspended, mrr, users, products, sales)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(today(), c.stores, c.active_7d, c.active_30d, c.paying, c.trial, c.suspended, c.mrr, u.n, p.n, sales.n).run();
  return c;
}

export async function cleanup(db) {
  await db.batch([
    db.prepare('DELETE FROM api_stats WHERE hour < ?').bind(addDays(today(), -31)),
    db.prepare('DELETE FROM error_log WHERE created_at < ?').bind(ago(90)),
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(ago(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* Vue d'ensemble                                                      */
/* ------------------------------------------------------------------ */

async function adoption(db) {
  const n = async (sql) => (await db.prepare(sql).first()).n;
  const active = await n("SELECT COUNT(*) AS n FROM stores WHERE status = 'active'");
  const rows = await Promise.all([
    ['Caisse', "SELECT COUNT(DISTINCT store_id) AS n FROM documents WHERE type = 'ticket'"],
    ['Factures', "SELECT COUNT(DISTINCT store_id) AS n FROM documents WHERE type = 'facture'"],
    ['Devis', "SELECT COUNT(DISTINCT store_id) AS n FROM documents WHERE type = 'devis'"],
    ['Commandes', "SELECT COUNT(DISTINCT store_id) AS n FROM documents WHERE type = 'commande'"],
    ['Fichier clients', 'SELECT COUNT(DISTINCT store_id) AS n FROM customers'],
    ['Produits propres', "SELECT COUNT(DISTINCT store_id) AS n FROM products WHERE ref NOT LIKE 'EX-%'"],
    ['Photos produits', 'SELECT COUNT(DISTINCT store_id) AS n FROM images'],
    ['Codes-barres', "SELECT COUNT(DISTINCT store_id) AS n FROM products WHERE barcode != ''"],
    ['Mouvements de stock', "SELECT COUNT(DISTINCT store_id) AS n FROM stock_movements WHERE type IN ('entrée', 'inventaire', 'sortie')"],
    ['Équipe', 'SELECT COUNT(*) AS n FROM (SELECT store_id FROM memberships GROUP BY store_id HAVING COUNT(*) > 1)'],
    ['Alertes par e-mail', "SELECT COUNT(*) AS n FROM settings WHERE key = 'alert_digest' AND value = '1'"],
    ['Vitrine consultée (30 j)', `SELECT COUNT(DISTINCT store_id) AS n FROM daily_stats WHERE catalog_views > 0 AND day >= '${addDays(today(), -29)}'`],
  ].map(async ([name, sql]) => ({ name, stores: await n(sql) })));
  return { active, features: rows.map((r) => ({ ...r, rate: active ? Math.round((r.stores / active) * 100) : 0 })) };
}

async function funnel(db) {
  const n = async (sql) => (await db.prepare(sql).first()).n;
  const [signed, configured, sold, regular, paying] = await Promise.all([
    n('SELECT COUNT(*) AS n FROM stores'),
    n(`SELECT COUNT(*) AS n FROM stores s WHERE EXISTS (SELECT 1 FROM products p WHERE p.store_id = s.id AND p.ref NOT LIKE 'EX-%')
        OR EXISTS (SELECT 1 FROM settings st WHERE st.store_id = s.id AND st.key = 'address' AND st.value != '')`),
    n("SELECT COUNT(DISTINCT store_id) AS n FROM documents WHERE type IN ('ticket', 'facture')"),
    n(`SELECT COUNT(*) AS n FROM (SELECT store_id FROM daily_stats WHERE day >= '${addDays(today(), -29)}' AND actions + logins > 0 GROUP BY store_id HAVING COUNT(*) >= 8)`),
    n(`SELECT COUNT(*) AS n FROM stores WHERE status = 'active' AND plan IN (${PAID_PLANS.map((p) => `'${p}'`).join(',')})`),
  ]);
  const firsts = await all(db.prepare(`SELECT s.created_at, MIN(d.created_at) AS first FROM stores s
    JOIN documents d ON d.store_id = s.id AND d.type IN ('ticket', 'facture') GROUP BY s.id`));
  const hours = firsts.map((f) => (new Date(f.first.replace(' ', 'T') + 'Z') - new Date(f.created_at.replace(' ', 'T') + 'Z')) / 3600000).filter((h) => h >= 0);
  return {
    steps: [
      { name: 'Inscrits', value: signed },
      { name: 'Ont configuré leur commerce', hint: 'produits ou adresse renseignés', value: configured },
      { name: 'Ont fait une vente', value: sold },
      { name: 'Utilisateurs réguliers', hint: '8 jours actifs ou plus sur 30', value: regular },
      { name: 'Abonnés payants', value: paying },
    ],
    median_hours_to_first_sale: hours.length ? r2(median(hours)) : null,
  };
}

async function todo(db, env) {
  const items = [];
  const reqs = await all(db.prepare("SELECT id, name, plan, plan_requested FROM stores WHERE plan_requested IS NOT NULL AND plan_requested != ''"));
  reqs.forEach((s) => items.push({ kind: 'request', priority: 1, store_id: s.id, store: s.name, title: `Demande de formule ${PLANS[s.plan_requested]?.name || s.plan_requested}`, detail: `Actuellement : ${PLANS[s.plan]?.name || s.plan}` }));
  const ending = await all(db.prepare("SELECT id, name, trial_ends_at FROM stores WHERE plan = 'essai' AND status = 'active' AND trial_ends_at BETWEEN ? AND ? ORDER BY trial_ends_at").bind(today(), addDays(today(), 3)));
  ending.forEach((s) => items.push({ kind: 'trial_ending', priority: 2, store_id: s.id, store: s.name, title: "Fin d'essai imminente", detail: `Se termine le ${s.trial_ends_at.split('-').reverse().join('/')}` }));
  const expired = await all(db.prepare("SELECT id, name, trial_ends_at FROM stores WHERE plan = 'essai' AND status = 'active' AND trial_ends_at < ? AND trial_ends_at >= ? ORDER BY trial_ends_at DESC").bind(today(), addDays(today(), -14)));
  expired.forEach((s) => items.push({ kind: 'trial_expired', priority: 2, store_id: s.id, store: s.name, title: 'Essai terminé sans abonnement', detail: `Depuis le ${s.trial_ends_at.split('-').reverse().join('/')} : relancer` }));
  const risk = await all(db.prepare(`SELECT id, name, plan, last_active_at FROM stores WHERE status = 'active' AND plan IN (${PAID_PLANS.map((p) => `'${p}'`).join(',')}) AND (last_active_at IS NULL OR last_active_at < ?)`).bind(ago(7)));
  risk.forEach((s) => items.push({ kind: 'churn_risk', priority: 1, store_id: s.id, store: s.name, title: 'Client payant inactif', detail: `Formule ${PLANS[s.plan]?.name}, aucune activité depuis 7 jours` }));
  const stuck = await all(db.prepare(`SELECT s.id, s.name, s.created_at FROM stores s WHERE s.status = 'active' AND s.created_at BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.store_id = s.id AND d.type IN ('ticket', 'facture'))`).bind(ago(10), ago(2)));
  stuck.forEach((s) => items.push({ kind: 'onboarding', priority: 3, store_id: s.id, store: s.name, title: 'Pas encore de première vente', detail: 'Inscrit depuis plus de 2 jours : proposer un accompagnement' }));
  const errors = await db.prepare('SELECT COUNT(*) AS n FROM error_log WHERE created_at >= ?').bind(ago(1)).first();
  if (errors.n) items.push({ kind: 'errors', priority: 1, title: `${errors.n} erreur${errors.n > 1 ? 's' : ''} serveur sur 24 h`, detail: 'Voir le détail dans Système', link: '#/systeme' });
  const cron = await db.prepare("SELECT value FROM platform_meta WHERE key = 'last_cron'").first();
  const lastCron = cron ? JSON.parse(cron.value) : null;
  if (lastCron && new Date(lastCron.at) < new Date(Date.now() - 30 * 3600000)) items.push({ kind: 'cron', priority: 1, title: "La tâche du matin ne s'est pas exécutée", detail: `Dernière exécution : ${lastCron.at.slice(0, 16).replace('T', ' ')}`, link: '#/systeme' });
  if (!env.RESEND_API_KEY) items.push({ kind: 'config', priority: 4, title: "Envoi d'e-mails non configuré", detail: 'Les commerçants ne reçoivent pas leurs alertes du matin', link: '#/systeme' });
  return items.sort((a, b) => a.priority - b.priority);
}

async function overview(db, env) {
  // L'instantané du jour n'est réécrit qu'au plus toutes les 15 minutes (ouverture de la console plus rapide).
  const last = await db.prepare("SELECT value FROM platform_meta WHERE key = 'snapshot_at'").first();
  let c;
  if (!last || Date.now() - Number(last.value) > 15 * 60000) {
    c = await takeSnapshot(db);
    await db.prepare("INSERT OR REPLACE INTO platform_meta (key, value) VALUES ('snapshot_at', ?)").bind(String(Date.now())).run();
  } else c = await platformCounts(db);
  const history = await all(db.prepare('SELECT * FROM platform_daily WHERE day >= ? ORDER BY day').bind(addDays(today(), -89)));
  const week = history.find((h) => h.day === addDays(today(), -7));
  const trend = (k) => (week ? c[k === 'stores' ? 'stores' : k] - week[k] : null);
  const month = today().slice(0, 7);
  const prevMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const gmv = await all(db.prepare(`SELECT COALESCE(st.value, '€') AS currency, substr(d.date, 1, 7) AS m, SUM(d.total_ttc) AS v, COUNT(*) AS n, COUNT(DISTINCT d.store_id) AS stores
      FROM documents d LEFT JOIN settings st ON st.store_id = d.store_id AND st.key = 'currency'
      WHERE ${SALES} AND substr(d.date, 1, 7) IN (?, ?) GROUP BY currency, m`).bind(month, prevMonth));
  const currencies = [...new Set(gmv.map((g) => g.currency))];
  const signupsMonths = []; for (let i = 11; i >= 0; i--) signupsMonths.push(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const sm = await all(db.prepare('SELECT substr(created_at, 1, 7) AS m, COUNT(*) AS n FROM stores WHERE created_at >= ? GROUP BY m').bind(signupsMonths[0] + '-01'));
  const days = lastDays(30);
  const act = await all(db.prepare(`SELECT day, COUNT(DISTINCT CASE WHEN actions + logins > 0 THEN store_id END) AS stores, SUM(tickets) AS tickets, SUM(catalog_views) AS views
      FROM daily_stats WHERE day >= ? GROUP BY day`).bind(days[0]));
  const byDay = Object.fromEntries(act.map((a) => [a.day, a]));
  const byPlan = await all(db.prepare('SELECT plan, COUNT(*) AS n FROM stores GROUP BY plan'));
  const byType = await all(db.prepare('SELECT business_type, COUNT(*) AS n FROM stores GROUP BY business_type ORDER BY n DESC'));
  const byCountry = await all(db.prepare('SELECT country, COUNT(*) AS n FROM stores GROUP BY country ORDER BY n DESC'));
  const events = await all(db.prepare(`SELECT e.type, e.detail, e.created_at, s.name AS store_name, s.id AS store_id FROM events e
      LEFT JOIN stores s ON s.id = e.store_id WHERE e.type IN ('signup', 'plan_request', 'plan_change', 'status_change') ORDER BY e.id DESC LIMIT 8`));
  const sys = await db.prepare('SELECT COALESCE(SUM(requests), 0) AS r, COALESCE(SUM(errors), 0) AS e, COALESCE(SUM(total_ms), 0) AS ms FROM api_stats WHERE hour >= ?').bind(new Date(Date.now() - 86400000).toISOString().slice(0, 13)).first();
  const [fun, adopt, todos] = await Promise.all([funnel(db), adoption(db), todo(db, env)]);
  return {
    counts: c, mrr: c.mrr, arr: c.mrr * 12,
    trends: { stores: trend('stores'), paying: trend('paying'), mrr: week ? c.mrr - week.mrr : null, active_7d: week ? c.active_7d - week.active_7d : null },
    history: history.map((h) => ({ day: h.day, stores: h.stores, paying: h.paying, mrr: h.mrr, active_7d: h.active_7d })),
    gmv: currencies.map((cur) => {
      const now = gmv.find((g) => g.currency === cur && g.m === month) || {};
      const prev = gmv.find((g) => g.currency === cur && g.m === prevMonth) || {};
      return { currency: cur, amount: r2(now.v || 0), sales: now.n || 0, stores: now.stores || 0, previous: r2(prev.v || 0) };
    }).sort((a, b) => b.sales - a.sales),
    signups: signupsMonths.map((m) => ({ month: m, value: (sm.find((r) => r.m === m) || {}).n || 0 })),
    activity: days.map((d) => ({ day: d, stores: byDay[d]?.stores || 0, tickets: byDay[d]?.tickets || 0, views: byDay[d]?.views || 0 })),
    by_plan: Object.fromEntries(byPlan.map((p) => [p.plan, p.n])),
    by_type: byType.map((t) => ({ label: (BUSINESS_TYPES[t.business_type] || BUSINESS_TYPES.autre).label, n: t.n })),
    by_country: byCountry.map((t) => ({ label: (COUNTRIES[t.country] || COUNTRIES.XX).name, n: t.n })),
    funnel: fun, adoption: adopt, todo: todos, events,
    system: { requests_24h: sys.r, errors_24h: sys.e, avg_ms: sys.r ? Math.round(sys.ms / sys.r) : 0 },
  };
}

/* ------------------------------------------------------------------ */
/* Commerces                                                           */
/* ------------------------------------------------------------------ */

async function listStores(db) {
  const since = addDays(today(), -29);
  const rows = await all(db.prepare(`SELECT s.*,
      (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.store_id = s.id AND m.role = 'owner' LIMIT 1) AS owner_email,
      (SELECT u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.store_id = s.id AND m.role = 'owner' LIMIT 1) AS owner_name,
      (SELECT value FROM settings st WHERE st.store_id = s.id AND st.key = 'currency') AS currency,
      (SELECT value FROM settings st WHERE st.store_id = s.id AND st.key = 'phone') AS phone,
      (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id) AS products,
      (SELECT COUNT(*) FROM memberships m WHERE m.store_id = s.id) AS users,
      (SELECT MAX(created_at) FROM documents d WHERE d.store_id = s.id AND d.type IN ('ticket', 'facture')) AS last_sale_at
    FROM stores s ORDER BY s.created_at DESC LIMIT 2000`));
  const stats = await all(db.prepare(`SELECT store_id, day, actions + logins AS a, tickets, sales_amount, catalog_views, documents FROM daily_stats WHERE day >= ?`).bind(since));
  const days = lastDays(30);
  const map = {};
  for (const r of stats) {
    const m = map[r.store_id] ||= { spark: Object.fromEntries(days.map((d) => [d, 0])), sales: 0, tickets: 0, views: 0, docs: 0, activeDays: 0 };
    m.spark[r.day] = r.a; m.sales += r.sales_amount; m.tickets += r.tickets; m.views += r.catalog_views; m.docs += r.documents; if (r.a > 0) m.activeDays++;
  }
  return rows.map((s) => {
    const m = map[s.id] || { spark: Object.fromEntries(days.map((d) => [d, 0])), sales: 0, tickets: 0, views: 0, docs: 0, activeDays: 0 };
    return {
      id: s.id, slug: s.slug, name: s.name, plan: s.plan, status: s.status, trial_ends_at: s.trial_ends_at, plan_requested: s.plan_requested,
      created_at: s.created_at, last_active_at: s.last_active_at, last_sale_at: s.last_sale_at, owner_name: s.owner_name, owner_email: s.owner_email,
      phone: s.phone, currency: s.currency || '€', products: s.products, users: s.users, business_type: s.business_type, country: s.country,
      ...label(s), health: health(s),
      sales_30d: r2(m.sales), tickets_30d: m.tickets, views_30d: m.views, documents_30d: m.docs, active_days_30d: m.activeDays,
      spark: days.map((d) => m.spark[d]),
      mrr: PAID_PLANS.includes(s.plan) && s.status === 'active' ? planEur(s.plan, s.country) : 0,
      price_label: PAID_PLANS.includes(s.plan) ? pricing(s.country).format(pricing(s.country).price(s.plan)) : '',
    };
  });
}

async function storeDetail(db, id) {
  const store = await db.prepare('SELECT * FROM stores WHERE id = ?').bind(num(id)).first();
  if (!store) throw new HttpError(404, 'Commerce introuvable.');
  const sid = store.id;
  const n = async (sql, ...a) => (await db.prepare(sql).bind(sid, ...a).first()).n;
  const [team, settings, stats, events, sessions] = await Promise.all([
    all(db.prepare(`SELECT u.id, u.name, u.email, u.last_login_at, u.created_at, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.store_id = ? ORDER BY m.role DESC`).bind(sid)),
    all(db.prepare(`SELECT key, value FROM settings WHERE store_id = ?`).bind(sid)),
    all(db.prepare(`SELECT * FROM daily_stats WHERE store_id = ? AND day >= ? ORDER BY day`).bind(sid, addDays(today(), -29))),
    all(db.prepare(`SELECT e.type, e.detail, e.created_at, u.name AS user_name FROM events e LEFT JOIN users u ON u.id = e.user_id WHERE e.store_id = ? ORDER BY e.id DESC LIMIT 60`).bind(sid)),
    db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE store_id = ? AND expires_at > ?').bind(sid, ago(0)).first(),
  ]);
  const [products, ownProducts, images, barcodes, customers, tickets, invoices, quotes, orders, moves, unpaid, salesTotal, firstSale, lastSale, stockOut] = await Promise.all([
    n('SELECT COUNT(*) AS n FROM products WHERE store_id = ?'),
    n("SELECT COUNT(*) AS n FROM products WHERE store_id = ? AND ref NOT LIKE 'EX-%'"),
    n('SELECT COUNT(*) AS n FROM images WHERE store_id = ?'),
    n("SELECT COUNT(*) AS n FROM products WHERE store_id = ? AND barcode != ''"),
    n('SELECT COUNT(*) AS n FROM customers WHERE store_id = ?'),
    n("SELECT COUNT(*) AS n FROM documents WHERE store_id = ? AND type = 'ticket'"),
    n("SELECT COUNT(*) AS n FROM documents WHERE store_id = ? AND type = 'facture'"),
    n("SELECT COUNT(*) AS n FROM documents WHERE store_id = ? AND type = 'devis'"),
    n("SELECT COUNT(*) AS n FROM documents WHERE store_id = ? AND type = 'commande'"),
    n("SELECT COUNT(*) AS n FROM stock_movements WHERE store_id = ? AND document_id IS NULL"),
    db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total_ttc - amount_paid), 0) AS v FROM documents WHERE store_id = ? AND type = 'facture' AND status = 'émise'").bind(sid).first(),
    db.prepare(`SELECT COALESCE(SUM(d.total_ttc), 0) AS v FROM documents d WHERE d.store_id = ? AND ${SALES}`).bind(sid).first(),
    db.prepare("SELECT MIN(created_at) AS t FROM documents WHERE store_id = ? AND type IN ('ticket', 'facture')").bind(sid).first(),
    db.prepare("SELECT MAX(created_at) AS t FROM documents WHERE store_id = ? AND type IN ('ticket', 'facture')").bind(sid).first(),
    n('SELECT COUNT(*) AS n FROM products WHERE store_id = ? AND track_stock = 1 AND stock <= 0'),
  ]);
  const st = Object.fromEntries(settings.map((r) => [r.key, r.value]));
  const days = lastDays(30);
  const byDay = Object.fromEntries(stats.map((x) => [x.day, x]));
  const features = [
    ['Caisse', tickets > 0, `${tickets} ticket${tickets > 1 ? 's' : ''}`],
    ['Factures', invoices > 0, `${invoices} facture${invoices > 1 ? 's' : ''}`],
    ['Devis', quotes > 0, `${quotes} devis`],
    ['Commandes', orders > 0, `${orders} commande${orders > 1 ? 's' : ''}`],
    ['Produits propres', ownProducts > 0, `${ownProducts} sur ${products}`],
    ['Photos', images > 0, `${images} photo${images > 1 ? 's' : ''}`],
    ['Codes-barres', barcodes > 0, `${barcodes} produit${barcodes > 1 ? 's' : ''}`],
    ['Fichier clients', customers > 0, `${customers} client${customers > 1 ? 's' : ''}`],
    ['Gestion du stock', moves > 0, `${moves} mouvement${moves > 1 ? 's' : ''} manuel${moves > 1 ? 's' : ''}`],
    ['Équipe', team.length > 1, `${team.length} utilisateur${team.length > 1 ? 's' : ''}`],
    ['Alertes e-mail', st.alert_digest === '1', st.alert_digest === '1' ? 'activées' : 'désactivées'],
    ['Vitrine personnalisée', !!(st.address && st.phone), st.catalog_public === '0' ? 'vitrine masquée' : 'vitrine publique'],
  ].map(([name, used, detail]) => ({ name, used, detail }));
  return {
    store: { ...store, ...label(store), health: health(store) },
    contact: { currency: st.currency || '€', phone: st.phone, email: st.email, address: st.address, accent: st.accent },
    team, events, active_sessions: sessions.n, features,
    adoption_score: Math.round((features.filter((f) => f.used).length / features.length) * 100),
    totals: {
      products, customers, tickets, invoices, quotes, orders, images, stock_out: stockOut,
      unpaid_count: unpaid.n, unpaid_amount: r2(unpaid.v), sales_total: r2(salesTotal.v),
      first_sale_at: firstSale.t, last_sale_at: lastSale.t,
    },
    daily: days.map((d) => ({ day: d, actions: (byDay[d]?.actions || 0) + (byDay[d]?.logins || 0), tickets: byDay[d]?.tickets || 0, sales: r2(byDay[d]?.sales_amount || 0), views: byDay[d]?.catalog_views || 0 })),
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
  if (trial !== store.trial_ends_at) await logEvent(db, store.id, ctx.user.id, 'trial_change', `Essai jusqu'au ${trial.split('-').reverse().join('/')}`);
  return storeDetail(db, store.id);
}

/* ------------------------------------------------------------------ */
/* Activité, revenus, système, journal, utilisateurs                   */
/* ------------------------------------------------------------------ */

async function activityMap(db) {
  const days = lastDays(30);
  const stores = await all(db.prepare("SELECT id, name, plan, status, trial_ends_at, created_at, last_active_at FROM stores"));
  const stats = await all(db.prepare('SELECT store_id, day, actions + logins AS a, tickets FROM daily_stats WHERE day >= ?').bind(days[0]));
  const map = {};
  for (const r of stats) (map[r.store_id] ||= {})[r.day] = r.a + r.tickets;
  const rows = stores.map((s) => {
    const values = days.map((d) => (map[s.id] || {})[d] || 0);
    return { id: s.id, name: s.name, health: health(s), plan: s.plan, created: s.created_at.slice(0, 10), values, total: values.reduce((a, b) => a + b, 0), active_days: values.filter((v) => v > 0).length };
  }).sort((a, b) => b.active_days - a.active_days || b.total - a.total);
  return { days, stores: rows };
}

async function revenue(db) {
  const c = await platformCounts(db);
  const history = await all(db.prepare('SELECT day, mrr, paying, trial, stores FROM platform_daily WHERE day >= ? ORDER BY day').bind(addDays(today(), -179)));
  const paying = await all(db.prepare(`SELECT s.id, s.name, s.plan, s.created_at, s.last_active_at, s.country,
      (SELECT MAX(e.created_at) FROM events e WHERE e.store_id = s.id AND e.type = 'plan_change') AS since
      FROM stores s WHERE s.status = 'active' AND s.plan IN (${PAID_PLANS.map((p) => `'${p}'`).join(',')}) ORDER BY s.name`));
  const trials = await all(db.prepare("SELECT id, name, trial_ends_at, last_active_at, created_at FROM stores WHERE plan = 'essai' AND status = 'active' ORDER BY trial_ends_at"));
  const ended = await db.prepare("SELECT COUNT(*) AS n FROM stores WHERE trial_ends_at < ?").bind(today()).first();
  const converted = await db.prepare(`SELECT COUNT(*) AS n FROM stores WHERE trial_ends_at < ? AND plan IN (${PAID_PLANS.map((p) => `'${p}'`).join(',')})`).bind(today()).first();
  const churned = await db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'status_change' AND detail = 'Suspendu' AND created_at >= ?").bind(ago(30)).first();
  const byPlan = PAID_PLANS.map((k) => {
    const list = paying.filter((p) => p.plan === k);
    return { key: k, name: PLANS[k].name, price: PLANS[k].price, stores: list.length, mrr: Math.round(list.reduce((a, p) => a + planEur(k, p.country), 0) * 100) / 100 };
  });
  return {
    mrr: c.mrr, arr: c.mrr * 12, paying: c.paying, arpa: c.paying ? r2(c.mrr / c.paying) : 0,
    trial_conversion: ended.n ? Math.round((converted.n / ended.n) * 100) : null, trials_ended: ended.n, trials_converted: converted.n,
    churned_30d: churned.n, by_plan: byPlan, history,
    paying_stores: paying.map((p) => ({ ...p, plan_name: PLANS[p.plan].name, price: planEur(p.plan, p.country), price_label: pricing(p.country).format(pricing(p.country).price(p.plan)) })),
    trials: trials.map((t) => ({ ...t, days_left: Math.round((new Date(t.trial_ends_at + 'T00:00:00Z') - new Date(today() + 'T00:00:00Z')) / 86400000) })),
  };
}

const TABLES = ['stores', 'users', 'memberships', 'sessions', 'products', 'images', 'customers', 'documents', 'document_lines', 'payments', 'stock_movements', 'events', 'daily_stats', 'api_stats', 'error_log'];

async function system(db, env) {
  const since48 = new Date(Date.now() - 47 * 3600000).toISOString().slice(0, 13);
  const since24 = new Date(Date.now() - 23 * 3600000).toISOString().slice(0, 13);
  const hourly = await all(db.prepare(`SELECT hour, SUM(requests) AS requests, SUM(errors) AS errors, SUM(client_errors) AS client_errors,
      SUM(total_ms) AS total_ms, MAX(max_ms) AS max_ms FROM api_stats WHERE hour >= ? GROUP BY hour ORDER BY hour`).bind(since48));
  const hours = []; for (let i = 47; i >= 0; i--) hours.push(new Date(Date.now() - i * 3600000).toISOString().slice(0, 13));
  const hmap = Object.fromEntries(hourly.map((h) => [h.hour, h]));
  const daily = await all(db.prepare(`SELECT substr(hour, 1, 10) AS day, SUM(requests) AS requests, SUM(errors) AS errors, SUM(total_ms) AS total_ms
      FROM api_stats WHERE hour >= ? GROUP BY day ORDER BY day`).bind(addDays(today(), -29)));
  const dmap = Object.fromEntries(daily.map((d) => [d.day, d]));
  const routes = await all(db.prepare(`SELECT route, SUM(requests) AS requests, SUM(errors) AS errors, SUM(client_errors) AS client_errors,
      SUM(total_ms) AS total_ms, MAX(max_ms) AS max_ms FROM api_stats WHERE hour >= ? GROUP BY route ORDER BY requests DESC`).bind(since24));
  const errors = await all(db.prepare(`SELECT e.*, s.name AS store_name FROM error_log e LEFT JOIN stores s ON s.id = e.store_id ORDER BY e.id DESC LIMIT 50`));
  const counts = await Promise.all(TABLES.map(async (t) => ({ table: t, rows: (await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).n })));
  const sizeRes = await db.prepare('SELECT 1').run();
  const sessions = await db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS u FROM sessions WHERE expires_at > ?').bind(ago(0)).first();
  const cron = await db.prepare("SELECT value FROM platform_meta WHERE key = 'last_cron'").first();
  const tot = routes.reduce((a, r) => ({ req: a.req + r.requests, err: a.err + r.errors, cli: a.cli + r.client_errors, ms: a.ms + r.total_ms }), { req: 0, err: 0, cli: 0, ms: 0 });
  return {
    last24: { requests: tot.req, errors: tot.err, client_errors: tot.cli, error_rate: tot.req ? r2((tot.err / tot.req) * 100) : 0, avg_ms: tot.req ? Math.round(tot.ms / tot.req) : 0 },
    hourly: hours.map((h) => ({ hour: h, requests: hmap[h]?.requests || 0, errors: hmap[h]?.errors || 0, avg_ms: hmap[h]?.requests ? Math.round(hmap[h].total_ms / hmap[h].requests) : 0, max_ms: hmap[h]?.max_ms || 0 })),
    daily: lastDays(30).map((d) => ({ day: d, requests: dmap[d]?.requests || 0, errors: dmap[d]?.errors || 0, avg_ms: dmap[d]?.requests ? Math.round(dmap[d].total_ms / dmap[d].requests) : 0 })),
    routes: routes.map((r) => ({ route: r.route, requests: r.requests, errors: r.errors, client_errors: r.client_errors, avg_ms: Math.round(r.total_ms / r.requests), max_ms: r.max_ms })),
    errors, tables: counts, db_size: sizeRes.meta?.size_after ?? null, db_limit: 10 * 1024 ** 3,
    sessions: { active: sessions.n, users: sessions.u },
    cron: cron ? JSON.parse(cron.value) : null,
    config: [
      { name: 'Base de données D1', ok: true, detail: 'Liaison DB active' },
      { name: 'Administrateurs de la plateforme', ok: !!env.PLATFORM_ADMIN_EMAILS, detail: env.PLATFORM_ADMIN_EMAILS ? `${String(env.PLATFORM_ADMIN_EMAILS).split(',').filter(Boolean).length} adresse(s)` : 'PLATFORM_ADMIN_EMAILS manquant' },
      { name: "Envoi d'e-mails (Resend)", ok: !!env.RESEND_API_KEY, detail: env.RESEND_API_KEY ? 'Clé présente' : 'RESEND_API_KEY manquant : pas d’alertes du matin' },
      { name: "Expéditeur des e-mails", ok: !!env.MAIL_FROM, detail: env.MAIL_FROM || 'Adresse de test Resend utilisée' },
      { name: 'Adresse publique', ok: !!env.APP_URL, detail: env.APP_URL || 'APP_URL manquant : liens des e-mails sans adresse' },
    ],
  };
}

async function eventsList(db, url) {
  const type = url.searchParams.get('type'), store = num(url.searchParams.get('store')), before = num(url.searchParams.get('before'));
  const where = [], args = [];
  if (type) { where.push('e.type = ?'); args.push(type); }
  if (store) { where.push('e.store_id = ?'); args.push(store); }
  if (before) { where.push('e.id < ?'); args.push(before); }
  const rows = await all(db.prepare(`SELECT e.*, s.name AS store_name, u.name AS user_name FROM events e
      LEFT JOIN stores s ON s.id = e.store_id LEFT JOIN users u ON u.id = e.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.id DESC LIMIT 100`).bind(...args));
  const types = await all(db.prepare('SELECT type, COUNT(*) AS n FROM events GROUP BY type ORDER BY n DESC'));
  return { events: rows, types, next: rows.length === 100 ? rows[rows.length - 1].id : null };
}

async function usersList(db, env) {
  const admins = String(env.PLATFORM_ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim());
  const rows = await all(db.prepare(`SELECT u.id, u.name, u.email, u.created_at, u.last_login_at, u.must_change_password,
      m.role, s.id AS store_id, s.name AS store_name,
      (SELECT COUNT(*) FROM sessions se WHERE se.user_id = u.id AND se.expires_at > ?) AS sessions
      FROM users u LEFT JOIN memberships m ON m.user_id = u.id LEFT JOIN stores s ON s.id = m.store_id ORDER BY u.created_at DESC LIMIT 3000`).bind(ago(0)));
  return rows.map((u) => ({ ...u, platform_admin: admins.includes(u.email.toLowerCase()) }));
}

function storesCsv(rows) {
  const cols = [['Commerce', 'name'], ['Adresse vitrine', 'slug'], ['Type', 'type_label'], ['Pays', 'country_name'], ['Propriétaire', 'owner_name'], ['E-mail', 'owner_email'],
    ['Téléphone', 'phone'], ['Formule', 'plan_name'], ['Fin essai', 'trial_ends_at'], ['Statut', 'status'], ['Santé', 'health'], ['Inscrit le', 'created_at'],
    ['Dernière activité', 'last_active_at'], ['Dernière vente', 'last_sale_at'], ['Jours actifs 30j', 'active_days_30d'], ['Ventes 30j', 'sales_30d'], ['Devise', 'currency'],
    ['Tickets 30j', 'tickets_30d'], ['Produits', 'products'], ['Utilisateurs', 'users'], ['Vues vitrine 30j', 'views_30d'], ['MRR', 'mrr']];
  const esc = (v) => { const s = v == null ? '' : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '\ufeff' + [cols.map((c) => c[0]).join(';'), ...rows.map((r) => cols.map((c) => esc(r[c[1]])).join(';'))].join('\r\n');
}

export async function consoleRoutes(ctx, parts) {
  const { db, request, env, url } = ctx;
  const m = request.method;
  const [res, id, action] = parts;
  if (res === 'overview' && m === 'GET') return json(await overview(db, env));
  if (res === 'todo' && m === 'GET') return json(await todo(db, env));
  if (res === 'activity' && m === 'GET') return json(await activityMap(db));
  if (res === 'revenue' && m === 'GET') return json(await revenue(db));
  if (res === 'system' && m === 'GET') return json(await system(db, env));
  if (res === 'events' && m === 'GET') return json(await eventsList(db, url));
  if (res === 'users' && !id && m === 'GET') return json(await usersList(db, env));
  if (res === 'export' && id === 'stores.csv' && m === 'GET') {
    return new Response(storesCsv(await listStores(db)), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="comptoir-commerces-${today()}.csv"`, 'cache-control': 'no-store' } });
  }
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
  if (res === 'users' && id && action === 'logout' && m === 'POST') {
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(num(id)).run();
    return json({ ok: true });
  }
  if (res === 'plans' && m === 'GET') return json(PLANS);
  throw new HttpError(404, 'Route inconnue.');
}
