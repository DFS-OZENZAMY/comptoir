// Import de produits depuis un ancien logiciel (Loyverse, Square, Shopify, WooCommerce, Odoo, EBP, Sage, Excel…).
// Le navigateur lit le fichier et fait correspondre les colonnes ; le serveur reçoit des lignes déjà normalisées,
// par lots, et les vérifie toutes : droits, limites de la formule, valeurs, boutiques.
import { HttpError, num, str, r4 } from '../core/lib.js';
import { PLANS } from '../core/catalog.js';
import { logEvent } from '../core/db.js';
import { getSettings } from './store.js';

const MAX_ROWS = 500;
const norm = (v) => String(v || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');

export async function importProducts(ctx, b) {
  const { db } = ctx; const sid = ctx.store.id;
  ctx.need('products.edit');
  const opts = b.options || {};
  const setStock = !!opts.set_stock;
  if (setStock) ctx.need('stock.manage');
  const onExisting = opts.on_existing === 'skip' ? 'skip' : 'update';
  const source = str(b.source, 40) || 'fichier';
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) throw new HttpError(400, 'Aucune ligne à importer.');
  if (rows.length > MAX_ROWS) throw new HttpError(400, `${MAX_ROWS} lignes au plus par envoi.`);

  const settings = await getSettings(db, sid);
  const tvaDefault = num(settings.tva_default, 20);
  const validLoc = new Map(ctx.locations.map((l) => [l.id, l]));
  const defaultLoc = ctx.location || ctx.locations[0];

  // Produits d'exemple (EX-…) retirés au premier lot, s'ils n'ont jamais été vendus.
  if (opts.delete_examples) {
    await db.prepare(`DELETE FROM products WHERE store_id = ? AND ref LIKE 'EX-%'
      AND NOT EXISTS (SELECT 1 FROM document_lines l WHERE l.product_id = products.id AND l.store_id = products.store_id)`).bind(sid).run();
  }

  const existing = (await db.prepare('SELECT id, ref, barcode, name, stock FROM products WHERE store_id = ?').bind(sid).all()).results;
  const byBarcode = new Map(), byRef = new Map(), byName = new Map();
  for (const p of existing) {
    if (p.barcode) byBarcode.set(p.barcode, p);
    if (p.ref) byRef.set(norm(p.ref), p);
    byName.set(norm(p.name), p);
  }
  const cats = (await db.prepare('SELECT id, name FROM categories WHERE store_id = ?').bind(sid).all()).results;
  const catByName = new Map(cats.map((c) => [norm(c.name), c.id]));
  const limit = (PLANS[ctx.store.plan] || PLANS.essai).products;
  let count = existing.length;

  const report = { created: 0, updated: 0, skipped: 0, categories_created: 0, errors: [] };
  const inserts = [], updates = [], stockAfter = [];

  // Catégories manquantes : créées d'abord, en un lot.
  const newCats = [...new Set(rows.map((r) => str(r.category, 80)).filter((c) => c && !catByName.has(norm(c))))];
  if (newCats.length) {
    const maxPos = (await db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM categories WHERE store_id = ?').bind(sid).first()).p;
    const res = await db.batch(newCats.map((c, i) => db.prepare('INSERT INTO categories (store_id, name, position) VALUES (?, ?, ?) RETURNING id').bind(sid, c, maxPos + i + 1)));
    newCats.forEach((c, i) => catByName.set(norm(c), res[i].results[0].id));
    report.categories_created = newCats.length;
  }

  for (const raw of rows) {
    const line = num(raw.line) || null;
    const name = str(raw.name, 200);
    if (!name) { report.errors.push({ line, message: 'Nom du produit manquant' }); continue; }
    const price = num(raw.price_ht, NaN);
    if (raw.price_ht !== undefined && raw.price_ht !== null && raw.price_ht !== '' && !(Number.isFinite(price) && price >= 0)) {
      report.errors.push({ line, message: `Prix invalide pour « ${name} »` }); continue;
    }
    const tva = raw.tva_rate === undefined || raw.tva_rate === null || raw.tva_rate === '' ? tvaDefault : num(raw.tva_rate, tvaDefault);
    if (tva < 0 || tva > 100) { report.errors.push({ line, message: `TVA invalide pour « ${name} »` }); continue; }
    const f = {
      name, ref: str(raw.ref, 64), barcode: str(raw.barcode, 64).replace(/\s+/g, ''), description: str(raw.description, 4000),
      category_id: raw.category ? catByName.get(norm(raw.category)) || null : null,
      price_ht: Number.isFinite(price) ? r4(price) : null, purchase_price: raw.purchase_price === '' || raw.purchase_price == null ? null : Math.max(0, r4(num(raw.purchase_price))),
      tva_rate: tva, unit: str(raw.unit, 20) || null, stock_min: raw.stock_min === '' || raw.stock_min == null ? null : Math.max(0, num(raw.stock_min)),
      track_stock: raw.track_stock === false ? 0 : 1,
    };
    // Stock par boutique : uniquement des boutiques auxquelles le membre a accès.
    const stocks = {};
    if (setStock && raw.stocks && typeof raw.stocks === 'object') {
      for (const [k, v] of Object.entries(raw.stocks)) {
        const lid = num(k); if (!validLoc.has(lid) || v === '' || v === null || v === undefined) continue;
        const q = num(v, NaN); if (Number.isFinite(q)) stocks[lid] = q;
      }
    }
    const match = (f.barcode && byBarcode.get(f.barcode)) || (f.ref && byRef.get(norm(f.ref))) || byName.get(norm(name));
    if (match && match.pending) {
      // Même produit plus haut dans le fichier : ses stocks s'ajoutent à la création en cours.
      for (const [lid, q] of Object.entries(stocks)) match.pending.stocks[lid] = (match.pending.stocks[lid] || 0) + q;
      report.skipped++; continue;
    }
    if (match) {
      if (onExisting === 'skip') { report.skipped++; continue; }
      updates.push({ id: match.id, f, stocks, line });
      continue;
    }
    if (limit !== null && count >= limit) { report.errors.push({ line, message: `Limite de ${limit} produits de votre formule atteinte` }); continue; }
    count++;
    const p = { f, stocks, line };
    inserts.push(p);
    // Les lignes suivantes du même fichier retrouvent ce produit (doublons dans le fichier).
    const ghost = { id: null, pending: p };
    if (f.barcode) byBarcode.set(f.barcode, ghost);
    if (f.ref) byRef.set(norm(f.ref), ghost);
    byName.set(norm(name), ghost);
  }

  const realUpdates = updates;

  // Création des produits, par lots, avec l'identifiant renvoyé.
  for (let i = 0; i < inserts.length; i += 80) {
    const part = inserts.slice(i, i + 80);
    const res = await db.batch(part.map(({ f, stocks }) => {
      const total = f.track_stock ? Object.values(stocks).reduce((a, q) => a + q, 0) : 0;
      return db.prepare(`INSERT INTO products (store_id, ref, barcode, name, description, category_id, price_ht, purchase_price, tva_rate, stock, stock_min, unit, visible, track_stock)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?) RETURNING id`)
        .bind(sid, f.ref, f.barcode, f.name, f.description, f.category_id, f.price_ht ?? 0, f.purchase_price ?? 0, f.tva_rate, total, f.stock_min ?? 0, f.unit || 'pièce', f.track_stock);
    }));
    part.forEach((p, k) => { p.id = res[k].results[0].id; });
    report.created += part.length;
  }
  // Stock des nouveaux produits : une ligne par boutique, et un mouvement « entrée » tracé.
  for (const p of inserts) {
    const locs = Object.keys(p.stocks).length ? p.stocks : (defaultLoc ? { [defaultLoc.id]: 0 } : {});
    for (const [lid, q] of Object.entries(locs)) {
      stockAfter.push(db.prepare('INSERT OR REPLACE INTO location_stock (store_id, location_id, product_id, qty) VALUES (?, ?, ?, ?)').bind(sid, num(lid), p.id, p.f.track_stock ? q : 0));
      if (p.f.track_stock && q) stockAfter.push(db.prepare("INSERT INTO stock_movements (store_id, product_id, qty, type, reason, location_id) VALUES (?, ?, ?, 'entrée', ?, ?)").bind(sid, p.id, q, `Import ${source}`, num(lid)));
    }
  }

  // Mise à jour des produits existants : seuls les champs présents dans le fichier changent.
  if (realUpdates.length) {
    const ids = realUpdates.map((u) => u.id);
    const current = new Map();
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const r = await db.prepare(`SELECT ls.product_id, ls.location_id, ls.qty FROM location_stock ls WHERE ls.store_id = ? AND ls.product_id IN (${chunk.map(() => '?').join(',')})`).bind(sid, ...chunk).all();
      for (const x of r.results) current.set(`${x.product_id}:${x.location_id}`, x.qty);
    }
    for (const { id, f, stocks } of realUpdates) {
      stockAfter.push(db.prepare(`UPDATE products SET name = ?, ref = CASE WHEN ? != '' THEN ? ELSE ref END, barcode = CASE WHEN ? != '' THEN ? ELSE barcode END,
          description = CASE WHEN ? != '' THEN ? ELSE description END, category_id = COALESCE(?, category_id), price_ht = COALESCE(?, price_ht),
          purchase_price = COALESCE(?, purchase_price), tva_rate = ?, stock_min = COALESCE(?, stock_min), unit = COALESCE(?, unit), updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND store_id = ?`)
        .bind(f.name, f.ref, f.ref, f.barcode, f.barcode, f.description, f.description, f.category_id, f.price_ht, f.purchase_price, f.tva_rate, f.stock_min, f.unit, id, sid));
      for (const [lid, q] of Object.entries(stocks)) {
        const before = current.get(`${id}:${lid}`) ?? 0;
        const delta = q - before;
        if (!delta) continue;
        stockAfter.push(db.prepare(`INSERT INTO location_stock (store_id, location_id, product_id, qty) VALUES (?, ?, ?, ?)
          ON CONFLICT (location_id, product_id) DO UPDATE SET qty = excluded.qty`).bind(sid, num(lid), id, q));
        stockAfter.push(db.prepare('UPDATE products SET stock = stock + ? WHERE id = ? AND store_id = ?').bind(delta, id, sid));
        stockAfter.push(db.prepare("INSERT INTO stock_movements (store_id, product_id, qty, type, reason, location_id) VALUES (?, ?, ?, 'inventaire', ?, ?)").bind(sid, id, delta, `Import ${source}`, num(lid)));
      }
      report.updated++;
    }
  }
  for (let i = 0; i < stockAfter.length; i += 90) await db.batch(stockAfter.slice(i, i + 90));
  if (report.created || report.updated) await logEvent(db, sid, ctx.user.id, 'product', `Import ${source} : ${report.created} créé(s), ${report.updated} mis à jour`);
  return report;
}
