// Boutiques (points de vente) et contrôle d'accès par rôle (RBAC).
// Chaque requête d'un commerce passe par resolveAccess : permissions du membre, boutiques autorisées et boutique courante.
import { HttpError, str, num, r2, today, addDays } from '../core/lib.js';
import { PLANS, PERMISSIONS, PERMISSION_KEYS, DEFAULT_ROLES } from '../core/catalog.js';
import { logEvent } from '../core/db.js';

const parse = (v) => { try { const x = JSON.parse(v || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } };
const PERM_LABEL = Object.fromEntries(PERMISSIONS.map((p) => [p.key, p.label]));

/* ------------------------------------------------------------------ */
/* Mise en place d'un commerce : boutique principale, rôles par défaut */
/* ------------------------------------------------------------------ */

const setupDone = new Set();
export async function ensureStoreSetup(db, store) {
  if (setupDone.has(store.id)) return;
  const flag = await db.prepare("SELECT 1 FROM settings WHERE store_id = ? AND key = '_setup_v2'").bind(store.id).first();
  if (!flag) {
    const sid = store.id;
    await db.prepare("INSERT INTO locations (store_id, name, position) SELECT ?, 'Boutique principale', 0 WHERE NOT EXISTS (SELECT 1 FROM locations WHERE store_id = ?)").bind(sid, sid).run();
    const loc = await db.prepare('SELECT id FROM locations WHERE store_id = ? ORDER BY id LIMIT 1').bind(sid).first();
    const stmts = [
      // Les ventes et mouvements existants appartiennent à la boutique principale ; son stock est le stock actuel.
      db.prepare('UPDATE documents SET location_id = ? WHERE store_id = ? AND location_id IS NULL').bind(loc.id, sid),
      db.prepare('UPDATE stock_movements SET location_id = ? WHERE store_id = ? AND location_id IS NULL').bind(loc.id, sid),
      db.prepare('INSERT OR IGNORE INTO location_stock (store_id, location_id, product_id, qty) SELECT store_id, ?, id, stock FROM products WHERE store_id = ?').bind(loc.id, sid),
      ...DEFAULT_ROLES.map((r) => db.prepare('INSERT INTO roles (store_id, name, description, permissions) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM roles WHERE store_id = ? AND name = ?)')
        .bind(sid, r.name, r.description, JSON.stringify(r.permissions), sid, r.name)),
      db.prepare("INSERT OR REPLACE INTO settings (store_id, key, value) VALUES (?, '_setup_v2', '1')").bind(sid),
    ];
    await db.batch(stmts);
    // Les employés existants gardent leurs droits d'avant : rôle « Gérant ».
    const g = await db.prepare("SELECT id FROM roles WHERE store_id = ? AND name = 'Gérant'").bind(sid).first();
    if (g) await db.prepare("UPDATE memberships SET role_id = ? WHERE store_id = ? AND role != 'owner' AND role_id IS NULL").bind(g.id, sid).run();
  }
  setupDone.add(store.id);
}

export async function resolveAccess(db, ctx, request) {
  const sid = ctx.store.id;
  await ensureStoreSetup(db, ctx.store);
  const mem = await db.prepare(`SELECT m.role, m.role_id, m.locations, r.permissions, r.name AS role_name FROM memberships m
    LEFT JOIN roles r ON r.id = m.role_id AND r.store_id = m.store_id WHERE m.user_id = ? AND m.store_id = ?`).bind(ctx.user.id, sid).first();
  const owner = mem?.role === 'owner';
  const permissions = owner ? PERMISSION_KEYS.slice() : parse(mem?.permissions).filter((k) => PERMISSION_KEYS.includes(k));
  const all = (await db.prepare('SELECT * FROM locations WHERE store_id = ? ORDER BY active DESC, position, id').bind(sid).all()).results;
  const active = all.filter((l) => l.active);
  const restricted = owner ? [] : parse(mem?.locations).map(Number).filter(Boolean);
  const allowed = restricted.length ? active.filter((l) => restricted.includes(l.id)) : active;
  const allLocations = !restricted.length;
  const asked = request.headers.get('x-location');
  let scope;
  if (asked === 'all' && allLocations && allowed.length > 1) scope = 'all';
  else scope = (allowed.find((l) => l.id === Number(asked)) || allowed[0] || {}).id ?? null;
  Object.assign(ctx, {
    owner, permissions, roleName: owner ? 'Propriétaire' : mem?.role_name || 'Sans rôle',
    allLocationsList: all, locations: allowed, allLocations, scope,
    location: scope === 'all' ? null : allowed.find((l) => l.id === scope) || null,
  });
  ctx.can = (p) => permissions.includes(p);
  ctx.need = (p) => { if (!permissions.includes(p)) throw new HttpError(403, `Vous n'avez pas l'autorisation : ${PERM_LABEL[p] || p}. Demandez-la au responsable du commerce.`); };
  return ctx;
}

// Filtre SQL selon la boutique courante (« Toutes les boutiques » : aucun filtre).
export function scopeWhere(ctx, col = 'location_id') {
  if (ctx.scope === 'all') return { sql: '', args: [] };
  return { sql: ` AND ${col} = ?`, args: [ctx.scope ?? -1] };
}

// Boutique où s'applique une écriture (vente, mouvement de stock…).
export function writeLocation(ctx, requested) {
  if (requested) {
    const l = ctx.locations.find((x) => x.id === num(requested));
    if (!l) throw new HttpError(403, "Vous n'avez pas accès à cette boutique.");
    return l;
  }
  if (ctx.location) return ctx.location;
  if (ctx.locations.length === 1) return ctx.locations[0];
  throw new HttpError(400, 'Choisissez la boutique concernée.');
}

/* ------------------------------------------------------------------ */
/* Stock par boutique                                                  */
/* ------------------------------------------------------------------ */

// Instructions qui déplacent du stock dans une boutique ; le stock total du produit suit.
export function stockDelta(db, sid, locationId, productId, delta, { total = true } = {}) {
  const out = [db.prepare(`INSERT INTO location_stock (store_id, location_id, product_id, qty) VALUES (?, ?, ?, ?)
    ON CONFLICT (location_id, product_id) DO UPDATE SET qty = qty + excluded.qty`).bind(sid, locationId, productId, delta)];
  if (total) out.push(db.prepare('UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?').bind(delta, productId, sid));
  return out;
}

export async function stockByLocation(db, sid) {
  const rows = (await db.prepare('SELECT location_id, product_id, qty FROM location_stock WHERE store_id = ?').bind(sid).all()).results;
  const map = {};
  for (const r of rows) (map[r.product_id] ||= {})[r.location_id] = r.qty;
  return map;
}

export async function transferStock(ctx, b) {
  const { db } = ctx; const sid = ctx.store.id;
  ctx.need('stock.manage');
  const from = writeLocation(ctx, b.from), to = writeLocation(ctx, b.to);
  if (from.id === to.id) throw new HttpError(400, 'Choisissez deux boutiques différentes.');
  const p = await db.prepare('SELECT id, name, track_stock FROM products WHERE id = ? AND store_id = ?').bind(num(b.product_id), sid).first();
  if (!p) throw new HttpError(404, 'Choisissez un produit.');
  if (!p.track_stock) throw new HttpError(400, 'Le suivi de stock est désactivé pour ce produit.');
  const qty = num(b.qty);
  if (!(qty > 0)) throw new HttpError(400, 'Indiquez une quantité à transférer.');
  const have = await db.prepare('SELECT qty FROM location_stock WHERE location_id = ? AND product_id = ?').bind(from.id, p.id).first();
  if ((have?.qty || 0) < qty) throw new HttpError(409, `Stock insuffisant à ${from.name} : ${have?.qty || 0} disponible(s).`);
  const reason = str(b.reason, 200);
  await db.batch([
    ...stockDelta(db, sid, from.id, p.id, -qty, { total: false }),
    ...stockDelta(db, sid, to.id, p.id, qty, { total: false }),
    db.prepare("INSERT INTO stock_movements (store_id, product_id, qty, type, reason, location_id) VALUES (?, ?, ?, 'transfert', ?, ?)").bind(sid, p.id, -qty, reason || `Transfert vers ${to.name}`, from.id),
    db.prepare("INSERT INTO stock_movements (store_id, product_id, qty, type, reason, location_id) VALUES (?, ?, ?, 'transfert', ?, ?)").bind(sid, p.id, qty, reason || `Transfert depuis ${from.name}`, to.id),
  ]);
  await logEvent(db, sid, ctx.user.id, 'stock', `Transfert de ${qty} × ${p.name} : ${from.name} → ${to.name}`);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Boutiques                                                           */
/* ------------------------------------------------------------------ */

export async function listLocations(ctx) {
  const { db } = ctx; const sid = ctx.store.id;
  const list = ctx.can('locations.manage') ? ctx.allLocationsList : ctx.locations;
  const counts = (await db.prepare(`SELECT location_id, COUNT(*) AS members FROM (
      SELECT m.user_id, j.value AS location_id FROM memberships m, json_each(CASE WHEN m.locations IS NULL OR m.locations = '' THEN '[]' ELSE m.locations END) j WHERE m.store_id = ?
    ) GROUP BY location_id`).bind(sid).all()).results;
  const limit = (PLANS[ctx.store.plan] || PLANS.essai).locations;
  return {
    locations: list.map((l) => ({ ...l, restricted_members: (counts.find((c) => Number(c.location_id) === l.id) || {}).members || 0 })),
    scope: ctx.scope, all_locations: ctx.allLocations, limit, active_count: ctx.allLocationsList.filter((l) => l.active).length,
  };
}

export async function saveLocation(ctx, id, b) {
  const { db } = ctx; const sid = ctx.store.id;
  ctx.need('locations.manage');
  const name = str(b.name, 80);
  if (!name) throw new HttpError(400, 'Donnez un nom à la boutique.');
  const address = str(b.address, 300), phone = str(b.phone, 40);
  if (!id) {
    const limit = (PLANS[ctx.store.plan] || PLANS.essai).locations;
    const n = ctx.allLocationsList.filter((l) => l.active).length;
    if (limit !== null && n >= limit) throw new HttpError(402, `Votre formule permet ${limit} boutique${limit > 1 ? 's' : ''}. Passez à la formule supérieure pour en ouvrir d'autres.`);
    const r = await db.prepare('INSERT INTO locations (store_id, name, address, phone, position) VALUES (?, ?, ?, ?, ?)').bind(sid, name, address, phone, n).run();
    await logEvent(db, sid, ctx.user.id, 'location', `Nouvelle boutique : ${name}`);
    return { id: r.meta.last_row_id };
  }
  const loc = ctx.allLocationsList.find((l) => l.id === num(id));
  if (!loc) throw new HttpError(404, 'Boutique introuvable.');
  const active = b.active === undefined ? loc.active : (b.active ? 1 : 0);
  if (!active && loc.active && ctx.allLocationsList.filter((l) => l.active).length <= 1) throw new HttpError(409, 'Il faut au moins une boutique ouverte.');
  if (!active && loc.active) {
    const left = await db.prepare('SELECT COUNT(*) AS n FROM location_stock WHERE location_id = ? AND qty > 0').bind(loc.id).first();
    if (left.n) throw new HttpError(409, `Transférez d'abord le stock restant (${left.n} produit${left.n > 1 ? 's' : ''}) vers une autre boutique.`);
  }
  await db.prepare('UPDATE locations SET name = ?, address = ?, phone = ?, active = ? WHERE id = ? AND store_id = ?').bind(name, address, phone, active, loc.id, sid).run();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Rapport : quelle boutique rapporte le plus ?                        */
/* ------------------------------------------------------------------ */

const SALES = (p = '') => `((${p}type = 'facture' AND ${p}status != 'annulée' AND COALESCE(${p}source_type, '') != 'ticket') OR (${p}type = 'ticket' AND ${p}status = 'payé'))`;

function periodRange(period) {
  const t = today();
  const first = (d, k = 0) => { const x = new Date(d + 'T00:00:00Z'); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + k, 1)).toISOString().slice(0, 10); };
  const last = (d) => addDays(first(d, 1), -1);
  if (period === 'month') { const s = first(t); return { start: s, end: t, prev: [first(t, -1), addDays(first(t, -1), Math.round((new Date(t) - new Date(s)) / 86400000))], label: 'Ce mois-ci' }; }
  if (period === 'prev_month') { const s = first(t, -1); return { start: s, end: last(s), prev: [first(t, -2), last(first(t, -2))], label: 'Le mois dernier' }; }
  if (period === 'year') { const s = t.slice(0, 4) + '-01-01'; const ps = (Number(t.slice(0, 4)) - 1) + '-01-01'; return { start: s, end: t, prev: [ps, (Number(t.slice(0, 4)) - 1) + t.slice(4)], label: 'Depuis le 1er janvier' }; }
  if (period === '7') return { start: addDays(t, -6), end: t, prev: [addDays(t, -13), addDays(t, -7)], label: '7 derniers jours' };
  return { start: addDays(t, -29), end: t, prev: [addDays(t, -59), addDays(t, -30)], label: '30 derniers jours' };
}

export async function locationReport(ctx, period) {
  const { db } = ctx; const sid = ctx.store.id;
  ctx.need('reports.view');
  const r = periodRange(period);
  const locs = ctx.allLocations ? ctx.allLocationsList : ctx.locations;
  const ids = locs.map((l) => l.id);
  if (!ids.length) return { period: r, locations: [] };
  const IN = `(${ids.map(() => '?').join(',')})`;
  const agg = async (start, end) => (await db.prepare(`SELECT location_id, COALESCE(SUM(total_ttc), 0) AS ttc, COALESCE(SUM(total_ht), 0) AS ht, COUNT(*) AS sales,
      SUM(CASE WHEN type = 'ticket' THEN 1 ELSE 0 END) AS tickets FROM documents
      WHERE store_id = ? AND ${SALES()} AND date BETWEEN ? AND ? AND location_id IN ${IN} GROUP BY location_id`).bind(sid, start, end, ...ids).all()).results;
  const [cur, prev, margin, unpaid, stock, months] = await Promise.all([
    agg(r.start, r.end),
    agg(r.prev[0], r.prev[1]),
    db.prepare(`SELECT d.location_id, SUM(l.qty * (l.unit_price_ht - p.purchase_price)) AS margin, SUM(l.qty * l.unit_price_ht) AS covered_ht
      FROM document_lines l JOIN documents d ON d.id = l.document_id AND d.store_id = l.store_id
      JOIN products p ON p.id = l.product_id AND p.store_id = l.store_id
      WHERE l.store_id = ? AND ${SALES('d.')} AND d.date BETWEEN ? AND ? AND p.purchase_price > 0 AND d.location_id IN ${IN} GROUP BY d.location_id`).bind(sid, r.start, r.end, ...ids).all(),
    db.prepare(`SELECT location_id, COALESCE(SUM(total_ttc - amount_paid), 0) AS v, COUNT(*) AS n FROM documents
      WHERE store_id = ? AND type = 'facture' AND status = 'émise' AND location_id IN ${IN} GROUP BY location_id`).bind(sid, ...ids).all(),
    db.prepare(`SELECT ls.location_id, COALESCE(SUM(ls.qty * CASE WHEN p.purchase_price > 0 THEN p.purchase_price ELSE p.price_ht END), 0) AS v,
      SUM(CASE WHEN p.track_stock = 1 AND ls.qty <= 0 THEN 1 ELSE 0 END) AS out_of_stock
      FROM location_stock ls JOIN products p ON p.id = ls.product_id AND p.store_id = ls.store_id
      WHERE ls.store_id = ? AND p.track_stock = 1 AND ls.location_id IN ${IN} GROUP BY ls.location_id`).bind(sid, ...ids).all(),
    db.prepare(`SELECT location_id, substr(date, 1, 7) AS m, SUM(total_ttc) AS v FROM documents
      WHERE store_id = ? AND ${SALES()} AND date >= ? AND location_id IN ${IN} GROUP BY location_id, m`).bind(sid, (() => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 5, 1)).toISOString().slice(0, 10); })(), ...ids).all(),
  ]);
  const monthKeys = []; { const d = new Date(); for (let i = 5; i >= 0; i--) monthKeys.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7)); }
  const tops = {};
  await Promise.all(ids.map(async (lid) => {
    tops[lid] = (await db.prepare(`SELECT l.label, SUM(l.qty) AS qty, SUM(l.qty * l.unit_price_ht * (1 + l.tva_rate / 100)) AS amount
      FROM document_lines l JOIN documents d ON d.id = l.document_id AND d.store_id = l.store_id
      WHERE l.store_id = ? AND d.location_id = ? AND l.product_id IS NOT NULL AND ${SALES('d.')} AND d.date BETWEEN ? AND ?
      GROUP BY l.product_id ORDER BY amount DESC LIMIT 3`).bind(sid, lid, r.start, r.end).all()).results.map((t) => ({ ...t, amount: r2(t.amount) }));
  }));
  const total = cur.reduce((s, x) => s + x.ttc, 0);
  const rows = locs.map((l) => {
    const c = cur.find((x) => x.location_id === l.id) || { ttc: 0, ht: 0, sales: 0, tickets: 0 };
    const p = prev.find((x) => x.location_id === l.id) || { ttc: 0 };
    const mg = margin.results.find((x) => x.location_id === l.id) || { margin: 0, covered_ht: 0 };
    const u = unpaid.results.find((x) => x.location_id === l.id) || { v: 0, n: 0 };
    const st = stock.results.find((x) => x.location_id === l.id) || { v: 0, out_of_stock: 0 };
    return {
      id: l.id, name: l.name, active: l.active,
      revenue: r2(c.ttc), revenue_ht: r2(c.ht), sales: c.sales, tickets: c.tickets, average: c.sales ? r2(c.ttc / c.sales) : 0,
      share: total ? Math.round((c.ttc / total) * 1000) / 10 : 0,
      previous: r2(p.ttc), evolution: p.ttc ? Math.round(((c.ttc - p.ttc) / p.ttc) * 1000) / 10 : null,
      margin: r2(mg.margin || 0), margin_rate: mg.covered_ht ? Math.round((mg.margin / mg.covered_ht) * 1000) / 10 : null,
      margin_coverage: c.ht > 0 ? Math.min(100, Math.round(((mg.covered_ht || 0) / c.ht) * 100)) : 0,
      unpaid: r2(u.v), unpaid_count: u.n, stock_value: r2(st.v), out_of_stock: st.out_of_stock || 0,
      months: monthKeys.map((m) => ({ month: m, value: r2((months.results.find((x) => x.location_id === l.id && x.m === m) || {}).v || 0) })),
      top: tops[l.id] || [],
    };
  }).sort((a, b) => b.revenue - a.revenue);
  return { period: { key: period || '30', label: r.label, start: r.start, end: r.end }, total: r2(total), locations: rows };
}

/* ------------------------------------------------------------------ */
/* Rôles et équipe                                                     */
/* ------------------------------------------------------------------ */

export async function listRoles(ctx) {
  const { db } = ctx; const sid = ctx.store.id;
  const rows = (await db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM memberships m WHERE m.role_id = r.id AND m.store_id = r.store_id) AS members
    FROM roles r WHERE r.store_id = ? ORDER BY r.id`).bind(sid).all()).results;
  return { roles: rows.map((r) => ({ ...r, permissions: parse(r.permissions) })), permissions: PERMISSIONS };
}

export async function saveRole(ctx, id, b) {
  const { db } = ctx; const sid = ctx.store.id;
  ctx.need('team.manage');
  const name = str(b.name, 60);
  if (!name) throw new HttpError(400, 'Donnez un nom au rôle.');
  const perms = [...new Set((Array.isArray(b.permissions) ? b.permissions : []).filter((p) => PERMISSION_KEYS.includes(p)))];
  const description = str(b.description, 200);
  const dup = await db.prepare('SELECT id FROM roles WHERE store_id = ? AND name = ? AND id != ?').bind(sid, name, num(id) || 0).first();
  if (dup) throw new HttpError(409, 'Un rôle porte déjà ce nom.');
  if (!id) {
    const r = await db.prepare('INSERT INTO roles (store_id, name, description, permissions) VALUES (?, ?, ?, ?)').bind(sid, name, description, JSON.stringify(perms)).run();
    await logEvent(db, sid, ctx.user.id, 'team', `Nouveau rôle : ${name}`);
    return { id: r.meta.last_row_id };
  }
  const r = await db.prepare('UPDATE roles SET name = ?, description = ?, permissions = ? WHERE id = ? AND store_id = ?').bind(name, description, JSON.stringify(perms), num(id), sid).run();
  if (!r.meta.changes) throw new HttpError(404, 'Rôle introuvable.');
  await logEvent(db, sid, ctx.user.id, 'team', `Rôle modifié : ${name}`);
  return { ok: true };
}

export async function deleteRole(ctx, id) {
  const { db } = ctx; const sid = ctx.store.id;
  ctx.need('team.manage');
  const used = await db.prepare('SELECT COUNT(*) AS n FROM memberships WHERE role_id = ? AND store_id = ?').bind(num(id), sid).first();
  if (used.n) throw new HttpError(409, `Ce rôle est attribué à ${used.n} membre${used.n > 1 ? 's' : ''} : changez d'abord leur rôle.`);
  await db.prepare('DELETE FROM roles WHERE id = ? AND store_id = ?').bind(num(id), sid).run();
  return { ok: true };
}

export async function validRoleAndLocations(ctx, b) {
  const { db } = ctx; const sid = ctx.store.id;
  // Sans rôle précisé : le rôle le plus restreint (Caissier), jamais plus de droits que nécessaire.
  const role = b.role_id
    ? await db.prepare('SELECT id, name FROM roles WHERE id = ? AND store_id = ?').bind(num(b.role_id), sid).first()
    : await db.prepare("SELECT id, name FROM roles WHERE store_id = ? ORDER BY CASE name WHEN 'Caissier' THEN 0 ELSE 1 END, id LIMIT 1").bind(sid).first();
  if (!role) throw new HttpError(400, 'Choisissez un rôle.');
  const locs = (Array.isArray(b.locations) ? b.locations : []).map(Number).filter((id) => ctx.allLocationsList.some((l) => l.id === id));
  return { role, locations: locs.length ? JSON.stringify(locs) : '' };
}

export async function updateMember(ctx, userId, b) {
  const { db } = ctx; const sid = ctx.store.id;
  ctx.need('team.manage');
  const mem = await db.prepare('SELECT role FROM memberships WHERE store_id = ? AND user_id = ?').bind(sid, num(userId)).first();
  if (!mem) throw new HttpError(404, 'Membre introuvable.');
  if (mem.role === 'owner') throw new HttpError(403, 'Le propriétaire a toujours tous les droits.');
  const { role, locations } = await validRoleAndLocations(ctx, b);
  // Les droits sont relus à chaque requête : le changement s'applique immédiatement, sans déconnexion.
  await db.prepare('UPDATE memberships SET role_id = ?, locations = ? WHERE store_id = ? AND user_id = ?').bind(role.id, locations, sid, num(userId)).run();
  await logEvent(db, sid, ctx.user.id, 'team', `Droits modifiés : ${role.name}`);
  return { ok: true };
}
