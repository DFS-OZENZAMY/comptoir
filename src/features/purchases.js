// Achats et fournisseurs : fiches fournisseurs, bons de commande (brouillon → envoyé → partiel → reçu, ou annulé),
// préparation depuis les alertes de stock, envoi par lien, réception totale ou partielle (stock par boutique,
// coût moyen pondéré, mouvements tracés), rapport par fournisseur et par mois.
import { HttpError, json, str, num, r2, today, addDays, isDate, isEmail } from '../core/lib.js';
import { writeLocation, stockDelta } from './access.js';

const STATUSES = ['brouillon', 'envoyé', 'partiel', 'reçu', 'annulé'];
const OPEN = ['brouillon', 'envoyé', 'partiel'];
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const token = () => { const b = crypto.getRandomValues(new Uint8Array(16)); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

/* ------------------------------------------------------------------ */
/* Fournisseurs                                                        */
/* ------------------------------------------------------------------ */
function supplierFields(b) {
  const name = str(b.name, 160);
  if (!name) throw new HttpError(400, 'Le nom du fournisseur est obligatoire.');
  const email = str(b.email, 160);
  if (email && !isEmail(email)) throw new HttpError(400, 'Adresse e-mail du fournisseur invalide.');
  return { name, contact: str(b.contact, 120), phone: str(b.phone, 40), email, address: str(b.address, 400), lead_days: Math.max(0, Math.min(365, Math.round(num(b.lead_days)))), notes: str(b.notes, 2000) };
}
export async function ownedSupplier(db, sid, id) {
  if (id === null || id === undefined || id === '' || id === 0) return null;
  const s = await db.prepare('SELECT id FROM suppliers WHERE id = ? AND store_id = ? AND archived = 0').bind(num(id), sid).first();
  if (!s) throw new HttpError(400, 'Fournisseur introuvable.');
  return s.id;
}

export async function supplierRoutes(ctx, id, m, body) {
  const { db } = ctx; const sid = ctx.store.id;
  if (!id && m === 'GET') {
    const rows = (await db.prepare(`SELECT s.*,
        (SELECT COUNT(*) FROM products p WHERE p.store_id = s.store_id AND p.supplier_id = s.id) AS products,
        (SELECT COUNT(*) FROM purchase_orders o WHERE o.store_id = s.store_id AND o.supplier_id = s.id AND o.status IN ('envoyé', 'partiel')) AS open_orders,
        (SELECT MAX(created_at) FROM purchase_orders o WHERE o.store_id = s.store_id AND o.supplier_id = s.id) AS last_order_at
      FROM suppliers s WHERE s.store_id = ? AND s.archived = 0 ORDER BY s.name COLLATE NOCASE`).bind(sid).all()).results;
    return json(rows);
  }
  ctx.need('purchases.manage');
  if (!id && m === 'POST') {
    const f = supplierFields(await body());
    const r = await db.prepare('INSERT INTO suppliers (store_id, name, contact, phone, email, address, lead_days, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(sid, f.name, f.contact, f.phone, f.email, f.address, f.lead_days, f.notes).run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  const s = await db.prepare('SELECT id FROM suppliers WHERE id = ? AND store_id = ?').bind(num(id), sid).first();
  if (!s) throw new HttpError(404, 'Fournisseur introuvable.');
  if (m === 'PUT') {
    const f = supplierFields(await body());
    await db.prepare('UPDATE suppliers SET name = ?, contact = ?, phone = ?, email = ?, address = ?, lead_days = ?, notes = ? WHERE id = ? AND store_id = ?')
      .bind(f.name, f.contact, f.phone, f.email, f.address, f.lead_days, f.notes, s.id, sid).run();
    return json({ ok: true });
  }
  if (m === 'DELETE') {
    // Déjà utilisé dans des bons de commande : archivé (l'historique reste lisible) ; sinon supprimé.
    const used = await db.prepare('SELECT 1 FROM purchase_orders WHERE store_id = ? AND supplier_id = ? LIMIT 1').bind(sid, s.id).first();
    await db.batch([
      db.prepare('UPDATE products SET supplier_id = NULL WHERE store_id = ? AND supplier_id = ?').bind(sid, s.id),
      used ? db.prepare('UPDATE suppliers SET archived = 1 WHERE id = ? AND store_id = ?').bind(s.id, sid) : db.prepare('DELETE FROM suppliers WHERE id = ? AND store_id = ?').bind(s.id, sid),
    ]);
    return json({ ok: true, archived: !!used });
  }
  throw new HttpError(404, 'Route inconnue.');
}

/* ------------------------------------------------------------------ */
/* Bons de commande                                                    */
/* ------------------------------------------------------------------ */
async function nextNumber(db, sid) {
  const prefix = `BC-${today().slice(0, 4)}-`;
  const last = await db.prepare('SELECT number FROM purchase_orders WHERE store_id = ? AND number LIKE ? ORDER BY number DESC LIMIT 1').bind(sid, prefix + '%').first();
  return prefix + String((last ? parseInt(last.number.slice(prefix.length), 10) : 0) + 1).padStart(4, '0');
}

async function cleanLines(db, sid, lines) {
  if (!Array.isArray(lines) || !lines.length) throw new HttpError(400, 'Ajoutez au moins un produit au bon de commande.');
  if (lines.length > 500) throw new HttpError(400, 'Un bon de commande contient au plus 500 lignes.');
  const ids = [...new Set(lines.map((l) => num(l.product_id)).filter(Boolean))];
  const products = ids.length ? (await db.prepare(`SELECT id, name, purchase_price FROM products WHERE store_id = ? AND id IN (${ids.map(() => '?').join(',')})`).bind(sid, ...ids).all()).results : [];
  return lines.map((l, i) => {
    const p = products.find((x) => x.id === num(l.product_id));
    if (l.product_id && !p) throw new HttpError(400, 'Un produit du bon de commande est introuvable.');
    const qty = r3(num(l.qty));
    if (!(qty > 0)) throw new HttpError(400, `Quantité invalide pour « ${str(l.label) || p?.name || 'la ligne ' + (i + 1)} ».`);
    const cost = l.unit_cost === undefined || l.unit_cost === '' ? (p?.purchase_price || 0) : num(l.unit_cost, NaN);
    if (!(cost >= 0)) throw new HttpError(400, 'Prix d’achat invalide.');
    return { product_id: p ? p.id : null, label: str(l.label, 200) || p?.name || '', qty, unit_cost: r2(cost), position: i };
  });
}

async function loadOrder(db, sid, id) {
  const o = await db.prepare(`SELECT o.*, s.name AS supplier_name, s.contact AS supplier_contact, s.phone AS supplier_phone, s.email AS supplier_email, s.lead_days,
      l.name AS location_name FROM purchase_orders o LEFT JOIN suppliers s ON s.id = o.supplier_id LEFT JOIN locations l ON l.id = o.location_id
      WHERE o.id = ? AND o.store_id = ?`).bind(num(id), sid).first();
  if (!o) throw new HttpError(404, 'Bon de commande introuvable.');
  o.lines = (await db.prepare(`SELECT pl.*, p.barcode, p.ref, p.unit, p.stock, p.track_stock FROM purchase_lines pl LEFT JOIN products p ON p.id = pl.product_id
      WHERE pl.order_id = ? ORDER BY pl.position, pl.id`).bind(o.id).all()).results;
  o.receptions = (await db.prepare('SELECT r.*, u.name AS user_name FROM purchase_receptions r LEFT JOIN users u ON u.id = r.created_by WHERE r.order_id = ? ORDER BY r.id').bind(o.id).all()).results;
  return o;
}

async function saveOrder(ctx, b, existing = null) {
  const { db } = ctx; const sid = ctx.store.id;
  const supplier_id = await ownedSupplier(db, sid, b.supplier_id);
  if (!supplier_id) throw new HttpError(400, 'Choisissez le fournisseur.');
  const lines = await cleanLines(db, sid, b.lines);
  const loc = writeLocation(ctx, b.location_id);
  const lead = (await db.prepare('SELECT lead_days FROM suppliers WHERE id = ?').bind(supplier_id).first()).lead_days || 0;
  const expected = isDate(b.expected_date) ? b.expected_date : (lead ? addDays(today(), lead) : null);
  const total = r2(lines.reduce((t, l) => t + l.qty * l.unit_cost, 0));
  const notes = str(b.notes, 2000);
  let orderId = existing?.id;
  if (existing) {
    await db.batch([
      db.prepare('UPDATE purchase_orders SET supplier_id = ?, location_id = ?, expected_date = ?, notes = ?, total_ht = ? WHERE id = ? AND store_id = ?').bind(supplier_id, loc.id, expected, notes, total, orderId, sid),
      db.prepare('DELETE FROM purchase_lines WHERE order_id = ?').bind(orderId),
    ]);
  } else {
    // Numérotation continue ; deux bons créés au même instant : le second prend le numéro suivant.
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await db.prepare('INSERT INTO purchase_orders (store_id, number, supplier_id, location_id, status, expected_date, notes, total_ht, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(sid, await nextNumber(db, sid), supplier_id, loc.id, 'brouillon', expected, notes, total, ctx.user.id).run();
        orderId = r.meta.last_row_id; break;
      } catch (e) {
        if (attempt < 8 && /UNIQUE/i.test(String(e.message))) { await new Promise((ok) => setTimeout(ok, 5 + Math.random() * 20 * (attempt + 1))); continue; }
        throw e;
      }
    }
  }
  await db.batch(lines.map((l) => db.prepare('INSERT INTO purchase_lines (order_id, store_id, product_id, label, qty, unit_cost, position) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(orderId, sid, l.product_id, l.label, l.qty, l.unit_cost, l.position)));
  return loadOrder(db, sid, orderId);
}

// Produits à recommander, regroupés par fournisseur : sous le seuil (ou en rupture), moins ce qui est déjà commandé.
async function suggestions(db, sid) {
  const rows = (await db.prepare(`SELECT p.id, p.name, p.stock, p.stock_min, p.unit, p.purchase_price, p.supplier_id, s.name AS supplier_name, s.lead_days,
      COALESCE((SELECT SUM(MAX(pl.qty - pl.qty_received, 0)) FROM purchase_lines pl JOIN purchase_orders o ON o.id = pl.order_id
        WHERE pl.product_id = p.id AND o.store_id = p.store_id AND o.status IN ('brouillon', 'envoyé', 'partiel') AND o.remainder_cancelled = 0), 0) AS on_order
    FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.archived = 0
    WHERE p.store_id = ? AND p.track_stock = 1 AND p.stock <= p.stock_min AND (p.stock_min > 0 OR p.stock <= 0)
    ORDER BY s.name COLLATE NOCASE, p.name COLLATE NOCASE`).bind(sid).all()).results;
  const groups = new Map();
  for (const p of rows) {
    // Objectif : revenir au double du seuil (au moins un article) ; on retire ce qui est déjà en commande.
    const target = Math.max(p.stock_min * 2, p.stock_min + 1, 1);
    const qty = Math.ceil(r3(target - p.stock - p.on_order));
    if (qty <= 0) continue;
    const key = p.supplier_name ? p.supplier_id : 0;
    if (!groups.has(key)) groups.set(key, { supplier_id: key || null, supplier_name: p.supplier_name || null, lines: [] });
    groups.get(key).lines.push({ product_id: p.id, label: p.name, stock: p.stock, stock_min: p.stock_min, on_order: p.on_order, unit: p.unit, qty, unit_cost: p.purchase_price || 0 });
  }
  return [...groups.values()];
}

// Réception (totale ou partielle) : stock de la boutique, coût moyen pondéré, mouvements tracés, statut. Tout ou rien.
async function receive(ctx, o, b) {
  const { db } = ctx; const sid = ctx.store.id;
  if (!['brouillon', 'envoyé', 'partiel'].includes(o.status)) throw new HttpError(400, 'Ce bon de commande ne peut plus être réceptionné.');
  const loc = writeLocation(ctx, b.location_id || o.location_id);
  const wanted = (Array.isArray(b.lines) ? b.lines : []).map((x) => ({ line: o.lines.find((l) => l.id === num(x.line_id)), qty: r3(num(x.qty)), cost: x.unit_cost === undefined || x.unit_cost === '' ? null : num(x.unit_cost, NaN) }))
    .filter((x) => x.line && x.qty > 0);
  if (!wanted.length) throw new HttpError(400, 'Indiquez au moins une quantité reçue.');
  const stmts = []; let total = 0;
  for (const w of wanted) {
    if (w.cost !== null && !(w.cost >= 0)) throw new HttpError(400, 'Prix d’achat invalide.');
    const cost = r2(w.cost === null ? w.line.unit_cost : w.cost);
    total += w.qty * cost;
    stmts.push(db.prepare('UPDATE purchase_lines SET qty_received = qty_received + ?, unit_cost = ? WHERE id = ?').bind(w.qty, cost, w.line.id));
    if (w.line.product_id) {
      const p = await db.prepare('SELECT stock, purchase_price, track_stock FROM products WHERE id = ? AND store_id = ?').bind(w.line.product_id, sid).first();
      if (p) {
        // Coût moyen pondéré : (stock existant × ancien coût + quantité reçue × coût de la livraison) / stock total.
        const before = Math.max(0, p.stock);
        const avg = before > 0 && p.purchase_price > 0 ? r2((before * p.purchase_price + w.qty * cost) / (before + w.qty)) : cost;
        stmts.push(db.prepare('UPDATE products SET purchase_price = ? WHERE id = ? AND store_id = ?').bind(avg, w.line.product_id, sid));
        if (p.track_stock) {
          stmts.push(...stockDelta(db, sid, loc.id, w.line.product_id, w.qty));
          stmts.push(db.prepare('INSERT INTO stock_movements (store_id, product_id, qty, type, reason, location_id) VALUES (?, ?, ?, ?, ?, ?)').bind(sid, w.line.product_id, w.qty, 'entrée', `Réception ${o.number}`, loc.id));
        }
      }
    }
  }
  const after = o.lines.map((l) => { const w = wanted.find((x) => x.line.id === l.id); return l.qty_received + (w ? w.qty : 0) >= l.qty - 1e-9; });
  const done = after.every(Boolean);
  stmts.push(db.prepare(`UPDATE purchase_orders SET status = ?, received_ht = received_ht + ?, received_at = ?, sent_at = COALESCE(sent_at, CURRENT_TIMESTAMP),
      total_ht = (SELECT ROUND(SUM(qty * unit_cost), 2) FROM purchase_lines WHERE order_id = ?) WHERE id = ? AND store_id = ?`)
    .bind(done ? 'reçu' : 'partiel', r2(total), done ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null, o.id, o.id, sid));
  stmts.push(db.prepare('INSERT INTO purchase_receptions (store_id, order_id, supplier_id, location_id, total_ht, created_by) VALUES (?, ?, ?, ?, ?, ?)').bind(sid, o.id, o.supplier_id, loc.id, r2(total), ctx.user.id));
  await db.batch(stmts);
  return loadOrder(db, sid, o.id);
}

async function report(db, sid) {
  const since = `${addDays(today(), -365).slice(0, 7)}-01`;
  const byMonth = (await db.prepare(`SELECT substr(created_at, 1, 7) AS month, ROUND(SUM(total_ht), 2) AS total, COUNT(*) AS receptions FROM purchase_receptions
      WHERE store_id = ? AND created_at >= ? GROUP BY month ORDER BY month`).bind(sid, since).all()).results;
  const bySupplier = (await db.prepare(`SELECT r.supplier_id, s.name AS supplier_name, ROUND(SUM(r.total_ht), 2) AS total, COUNT(DISTINCT r.order_id) AS orders
      FROM purchase_receptions r LEFT JOIN suppliers s ON s.id = r.supplier_id WHERE r.store_id = ? AND r.created_at >= ? GROUP BY r.supplier_id ORDER BY total DESC LIMIT 20`).bind(sid, since).all()).results;
  const pending = await db.prepare(`SELECT ROUND(COALESCE(SUM(MAX(pl.qty - pl.qty_received, 0) * pl.unit_cost), 0), 2) AS v, COUNT(DISTINCT o.id) AS n FROM purchase_lines pl
      JOIN purchase_orders o ON o.id = pl.order_id WHERE o.store_id = ? AND o.status IN ('envoyé', 'partiel') AND o.remainder_cancelled = 0`).bind(sid).first();
  const month = today().slice(0, 7);
  return { by_month: byMonth, by_supplier: bySupplier, pending_ht: pending.v || 0, pending_orders: pending.n || 0, this_month_ht: byMonth.find((x) => x.month === month)?.total || 0 };
}

export async function purchaseRoutes(ctx, parts, m, body) {
  const { db, env } = ctx; const sid = ctx.store.id;
  const [id, action] = parts;
  if (!id && m === 'GET') {
    const status = new URL(ctx.request.url).searchParams.get('statut');
    const rows = (await db.prepare(`SELECT o.id, o.number, o.status, o.expected_date, o.total_ht, o.received_ht, o.created_at, o.sent_at, o.received_at, o.remainder_cancelled,
        s.name AS supplier_name, l.name AS location_name, (SELECT COUNT(*) FROM purchase_lines pl WHERE pl.order_id = o.id) AS lines
        FROM purchase_orders o LEFT JOIN suppliers s ON s.id = o.supplier_id LEFT JOIN locations l ON l.id = o.location_id
        WHERE o.store_id = ?${STATUSES.includes(status) ? ' AND o.status = ?' : ''} ORDER BY o.id DESC LIMIT 500`).bind(sid, ...(STATUSES.includes(status) ? [status] : [])).all()).results;
    const counts = Object.fromEntries((await db.prepare('SELECT status, COUNT(*) AS n FROM purchase_orders WHERE store_id = ? GROUP BY status').bind(sid).all()).results.map((r) => [r.status, r.n]));
    return json({ orders: rows, counts });
  }
  if (id === 'suggestions' && m === 'GET') return json({ groups: await suggestions(db, sid) });
  if (id === 'report' && m === 'GET') return json(await report(db, sid));
  if (!id && m === 'POST') { ctx.need('purchases.manage'); return json(await saveOrder(ctx, await body()), 201); }
  const o = await loadOrder(db, sid, id);
  if (!action && m === 'GET') return json(o);
  ctx.need('purchases.manage');
  if (!action && m === 'PUT') {
    if (o.status !== 'brouillon') throw new HttpError(400, 'Seul un brouillon peut être modifié. Un bon envoyé reste tel que le fournisseur l’a reçu.');
    return json(await saveOrder(ctx, await body(), o));
  }
  if (!action && m === 'DELETE') {
    if (o.status !== 'brouillon') throw new HttpError(400, 'Seul un brouillon peut être supprimé ; annulez plutôt ce bon de commande.');
    await db.batch([db.prepare('DELETE FROM purchase_lines WHERE order_id = ?').bind(o.id), db.prepare('DELETE FROM purchase_orders WHERE id = ? AND store_id = ?').bind(o.id, sid)]);
    return json({ ok: true });
  }
  if (action === 'send' && m === 'POST') {
    // Envoi au fournisseur : lien secret vers le bon (WhatsApp, e-mail) ; le bon n'est plus modifiable.
    if (!OPEN.includes(o.status)) throw new HttpError(400, 'Ce bon de commande est clos.');
    if (!o.share_token) await db.prepare('UPDATE purchase_orders SET share_token = ? WHERE id = ? AND share_token IS NULL').bind(token(), o.id).run();
    if (o.status === 'brouillon') await db.prepare("UPDATE purchase_orders SET status = 'envoyé', sent_at = CURRENT_TIMESTAMP WHERE id = ?").bind(o.id).run();
    const t = (await db.prepare('SELECT share_token FROM purchase_orders WHERE id = ?').bind(o.id).first()).share_token;
    const origin = env.APP_URL ? new URL(env.APP_URL).origin : new URL(ctx.request.url).origin;
    return json({ url: `${origin}/r/${t}`, order: await loadOrder(db, sid, o.id) });
  }
  if (action === 'receive' && m === 'POST') return json(await receive(ctx, o, await body()));
  if (action === 'cancel' && m === 'POST') {
    // Rien reçu : annulé. Déjà en partie reçu : clôturé (le reste n'est plus attendu, ce qui a été reçu reste tracé).
    if (!OPEN.includes(o.status)) throw new HttpError(400, 'Ce bon de commande est déjà clos.');
    const anyReceived = o.lines.some((l) => l.qty_received > 0);
    await db.prepare(`UPDATE purchase_orders SET ${anyReceived ? "status = 'reçu', remainder_cancelled = 1, received_at = CURRENT_TIMESTAMP" : "status = 'annulé', cancelled_at = CURRENT_TIMESTAMP"} WHERE id = ?`).bind(o.id).run();
    return json(await loadOrder(db, sid, o.id));
  }
  throw new HttpError(404, 'Route inconnue.');
}
