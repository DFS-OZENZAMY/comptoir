// Espace d'un commerce : produits, stock, clients, documents, caisse, alertes, équipe.
// Règle absolue : chaque requête est filtrée par store_id (sid).
import {
  HttpError, json, r2, r4, num, str, today, isDate, addDays, daysBetween, escHtml, isEmail,
  readBody, hashPassword, tempPassword,
} from '../core/lib.js';
import { PLANS, PAID_PLANS, SETTING_KEYS, defaultSettings, pricing } from '../core/catalog.js';
import { importProducts } from './importer.js';
import { detectTool, fetchCatalogPage, importImages, PROVIDERS } from './connectors.js';
import { resolveAccess, scopeWhere, writeLocation, stockDelta, stockByLocation, transferStock, listLocations, saveLocation, locationReport, listRoles, saveRole, deleteRole, validRoleAndLocations, updateMember } from './access.js';
import { bump, logEvent } from '../core/db.js';
import { saveProductImage, deleteProductImage, fromBase64 } from '../platform/storage.js';
import { pushRoutes, stockAlerts, notifyPlatform } from './push.js';
import { storeSupportRoutes, postClientMessage } from './support.js';
import { storeAccess } from './auth.js';

/* ------------------------------------------------------------------ */
/* Paramètres                                                          */
/* ------------------------------------------------------------------ */

export async function getSettings(db, sid, store = null) {
  const rows = (await db.prepare('SELECT key, value FROM settings WHERE store_id = ?').bind(sid).all()).results;
  // Valeurs par défaut selon le pays du commerce (devise, fidélité) pour les réglages jamais enregistrés.
  const country = store?.country || (await db.prepare('SELECT country FROM stores WHERE id = ?').bind(sid).first())?.country;
  const out = defaultSettings({ name: store ? store.name : '', country });
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/* ------------------------------------------------------------------ */
/* Documents : devis, commandes, factures, tickets                     */
/* ------------------------------------------------------------------ */

const PREFIX = { devis: 'DEV', commande: 'CMD', facture: 'FAC', ticket: 'TIC' };
const STATUSES = {
  devis: ['brouillon', 'envoyé', 'accepté', 'refusé'],
  commande: ['nouvelle', 'confirmée', 'livrée', 'annulée'],
  facture: ['émise', 'payée', 'annulée'],
  ticket: ['payé', 'annulé'],
};
const PAYMENT_METHODS = ['espèces', 'carte', 'chèque', 'virement', 'mobile', 'autre'];

async function nextNumber(db, sid, type, date) {
  const prefix = `${PREFIX[type]}-${date.slice(0, 4)}-`;
  const last = await db.prepare('SELECT number FROM documents WHERE store_id = ? AND number LIKE ? ORDER BY number DESC LIMIT 1')
    .bind(sid, prefix + '%').first();
  const n = last ? parseInt(last.number.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(n).padStart(4, '0');
}

function cleanLines(lines) {
  return (Array.isArray(lines) ? lines : []).slice(0, 300).map((l, i) => ({
    product_id: l.product_id ? num(l.product_id) || null : null,
    // Produit créé hors ligne : résolu plus tard via client_ref (comme customer_client_ref).
    product_client_ref: clientRef(l.product_client_ref),
    label: str(l.label, 300),
    qty: num(l.qty, 1),
    unit_price_ht: r4(num(l.unit_price_ht)),
    tva_rate: num(l.tva_rate, 20),
    position: i,
  })).filter((l) => l.label && l.qty !== 0);
}

function computeTotals(lines) {
  let ht = 0, tva = 0;
  for (const l of lines) { const h = l.qty * l.unit_price_ht; ht += h; tva += (h * l.tva_rate) / 100; }
  ht = r2(ht); tva = r2(tva);
  return { total_ht: ht, total_tva: tva, total_ttc: r2(ht + tva) };
}

async function insertLines(db, sid, docId, lines) {
  if (!lines.length) return;
  // Les produits doivent appartenir au commerce.
  const ids = [...new Set(lines.map((l) => l.product_id).filter(Boolean))];
  let owned = new Set();
  if (ids.length) {
    const rows = (await db.prepare(`SELECT id FROM products WHERE store_id = ? AND id IN (${ids.map(() => '?').join(',')})`).bind(sid, ...ids).all()).results;
    owned = new Set(rows.map((r) => r.id));
  }
  await db.batch(lines.map((l) => db.prepare(`INSERT INTO document_lines (store_id, document_id, product_id, label, qty, unit_price_ht, tva_rate, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(sid, docId, owned.has(l.product_id) ? l.product_id : null, l.label, l.qty, l.unit_price_ht, l.tva_rate, l.position)));
}

async function clientSnapshot(db, sid, d, fallbackName = '') {
  const snap = {
    client_name: str(d.client_name, 160), client_email: str(d.client_email, 160),
    client_phone: str(d.client_phone, 40), client_address: str(d.client_address, 400),
  };
  let customer_id = d.customer_id ? num(d.customer_id) || null : null;
  if (customer_id) {
    const c = await db.prepare('SELECT * FROM customers WHERE id = ? AND store_id = ?').bind(customer_id, sid).first();
    if (c) {
      snap.client_name ||= c.company ? `${c.company} (${c.name})` : c.name;
      snap.client_email ||= c.email; snap.client_phone ||= c.phone; snap.client_address ||= c.address;
    } else customer_id = null;
  }
  snap.client_name ||= fallbackName;
  if (!snap.client_name) throw new HttpError(400, 'Choisissez un client ou indiquez son nom.');
  return { customer_id, ...snap };
}

async function createDocument(ctx, d) {
  const { db } = ctx; const sid = ctx.store.id;
  const type = d.type;
  if (!PREFIX[type]) throw new HttpError(400, 'Type de document inconnu.');
  const lines = cleanLines(d.lines);
  if (!lines.length) throw new HttpError(400, 'Ajoutez au moins une ligne au document.');
  const settings = await getSettings(db, sid);
  const date = isDate(d.date) ? d.date : today();
  const status = type === 'facture' ? 'émise' : type === 'ticket' ? 'payé' : STATUSES[type].includes(d.status) ? d.status : STATUSES[type][0];
  let due = isDate(d.due_date) ? d.due_date : null;
  if (!due && type === 'facture') due = addDays(date, num(settings.invoice_due_days, 30));
  if (!due && type === 'devis') due = addDays(date, 30);
  const client = await clientSnapshot(db, sid, d, type === 'ticket' ? 'Client comptoir' : '');
  const t = computeTotals(lines);
  const number = await nextNumber(db, sid, type, date);
  const location = writeLocation(ctx, d.location_id);
  const res = await db.prepare(`INSERT INTO documents (store_id, type, number, customer_id, client_name, client_email, client_phone, client_address,
      status, date, due_date, notes, total_ht, total_tva, total_ttc, source_id, source_type, origin, created_by, location_id, client_ref, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`)
    .bind(sid, type, number, client.customer_id, client.client_name, client.client_email, client.client_phone, client.client_address,
      status, date, due, str(d.notes, 3000), t.total_ht, t.total_tva, t.total_ttc,
      d.source_id || null, d.source_type || null, d.origin === 'caisse' ? 'caisse' : 'admin', ctx.user.id, location.id, d.client_ref || null, d.created_at || null)
    .run();
  const id = res.meta.last_row_id;
  await insertLines(db, sid, id, lines);
  await syncStock(db, sid, id);
  if (type !== 'ticket') {
    await bump(db, sid, 'documents');
    await logEvent(db, sid, ctx.user.id, type, `${number} : ${t.total_ttc.toFixed(2)}`);
  }
  return getDocument(db, sid, id);
}

async function getDocument(db, sid, id) {
  const doc = await db.prepare('SELECT * FROM documents WHERE id = ? AND store_id = ?').bind(num(id), sid).first();
  if (!doc) throw new HttpError(404, 'Document introuvable.');
  const [lines, children, payments] = await Promise.all([
    db.prepare('SELECT * FROM document_lines WHERE document_id = ? AND store_id = ? ORDER BY position, id').bind(doc.id, sid).all(),
    db.prepare('SELECT id, type, number, status FROM documents WHERE source_id = ? AND store_id = ? ORDER BY id').bind(doc.id, sid).all(),
    db.prepare('SELECT * FROM payments WHERE document_id = ? AND store_id = ? ORDER BY date, id').bind(doc.id, sid).all(),
  ]);
  doc.lines = lines.results; doc.children = children.results; doc.payments = payments.results;
  if (doc.customer_id) {
    const lm = (await db.prepare('SELECT points FROM loyalty_movements WHERE document_id = ? AND store_id = ?').bind(doc.id, sid).all()).results;
    if (lm.length) {
      const c = await db.prepare('SELECT loyalty_points FROM customers WHERE id = ? AND store_id = ?').bind(doc.customer_id, sid).first();
      doc.loyalty = { earned: lm.filter((m) => m.points > 0).reduce((a, m) => a + m.points, 0), used: -lm.filter((m) => m.points < 0).reduce((a, m) => a + m.points, 0), balance: c ? c.loyalty_points : 0 };
    }
  }
  if (doc.source_id) doc.source = await db.prepare('SELECT id, type, number FROM documents WHERE id = ? AND store_id = ?').bind(doc.source_id, sid).first();
  return doc;
}

function assertEditable(doc) {
  if (doc.type === 'facture') throw new HttpError(409, 'Une facture émise ne se modifie plus. Annulez-la puis créez-en une nouvelle.');
  if (doc.type === 'ticket') throw new HttpError(409, 'Un ticket de caisse ne se modifie pas. Annulez-le puis refaites la vente.');
  if (doc.stock_applied) throw new HttpError(409, 'Le stock a déjà été déduit pour cette commande : repassez-la en « confirmée » pour la modifier.');
}

async function updateDocument(ctx, id, d) {
  const { db } = ctx; const sid = ctx.store.id;
  const doc = await getDocument(db, sid, id);
  assertEditable(doc);
  const lines = cleanLines(d.lines);
  if (!lines.length) throw new HttpError(400, 'Ajoutez au moins une ligne au document.');
  const client = await clientSnapshot(db, sid, d);
  const t = computeTotals(lines);
  const status = STATUSES[doc.type].includes(d.status) ? d.status : doc.status;
  await db.batch([
    db.prepare(`UPDATE documents SET customer_id = ?, client_name = ?, client_email = ?, client_phone = ?, client_address = ?,
        status = ?, date = ?, due_date = ?, notes = ?, total_ht = ?, total_tva = ?, total_ttc = ? WHERE id = ? AND store_id = ?`)
      .bind(client.customer_id, client.client_name, client.client_email, client.client_phone, client.client_address, status,
        isDate(d.date) ? d.date : doc.date, isDate(d.due_date) ? d.due_date : null, str(d.notes, 3000),
        t.total_ht, t.total_tva, t.total_ttc, doc.id, sid),
    db.prepare('DELETE FROM document_lines WHERE document_id = ? AND store_id = ?').bind(doc.id, sid),
  ]);
  await insertLines(db, sid, doc.id, lines);
  await syncStock(db, sid, doc.id);
  return getDocument(db, sid, doc.id);
}

// Stock déduit : vente en caisse, commande livrée, facture directe. Restitué à l'annulation.
async function syncStock(db, sid, id) {
  const doc = await db.prepare('SELECT * FROM documents WHERE id = ? AND store_id = ?').bind(id, sid).first();
  if (!doc) return;
  const should = (doc.type === 'commande' && doc.status === 'livrée') ||
    (doc.type === 'facture' && !['commande', 'ticket'].includes(doc.source_type) && doc.status !== 'annulée') ||
    (doc.type === 'ticket' && doc.source_type !== 'commande' && doc.status !== 'annulé');
  if (should === !!doc.stock_applied) return;
  const lines = (await db.prepare(`SELECT l.product_id, l.qty FROM document_lines l JOIN products p ON p.id = l.product_id AND p.store_id = l.store_id
      WHERE l.document_id = ? AND l.store_id = ? AND p.track_stock = 1`).bind(id, sid).all()).results;
  const stmts = [];
  let locId = doc.location_id;
  if (!locId) locId = (await db.prepare('SELECT id FROM locations WHERE store_id = ? ORDER BY active DESC, id LIMIT 1').bind(sid).first())?.id;
  for (const l of lines) {
    const q = should ? -l.qty : l.qty;
    if (locId) stmts.push(...stockDelta(db, sid, locId, l.product_id, q));
    else stmts.push(db.prepare('UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?').bind(q, l.product_id, sid));
    stmts.push(db.prepare('INSERT INTO stock_movements (store_id, product_id, qty, type, reason, document_id, location_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(sid, l.product_id, q, should ? 'sortie' : 'retour', should ? doc.number : `Annulation ${doc.number}`, id, locId || null));
  }
  stmts.push(db.prepare('UPDATE documents SET stock_applied = ? WHERE id = ? AND store_id = ?').bind(should ? 1 : 0, id, sid));
  await db.batch(stmts);
}

async function refreshPaid(db, sid, id) {
  const doc = await db.prepare('SELECT id, total_ttc, status FROM documents WHERE id = ? AND store_id = ?').bind(id, sid).first();
  const sum = await db.prepare('SELECT COALESCE(SUM(amount), 0) AS v, MAX(date) AS last FROM payments WHERE document_id = ? AND store_id = ?').bind(id, sid).first();
  const paid = r2(sum.v);
  let status = doc.status;
  if (status !== 'annulée') status = paid >= r2(doc.total_ttc) - 0.005 ? 'payée' : 'émise';
  await db.prepare('UPDATE documents SET amount_paid = ?, status = ?, paid_at = ? WHERE id = ? AND store_id = ?')
    .bind(paid, status, status === 'payée' ? sum.last : null, id, sid).run();
}

async function addPayment(ctx, id, b) {
  const { db } = ctx; const sid = ctx.store.id;
  const doc = await getDocument(db, sid, id);
  if (doc.type !== 'facture') throw new HttpError(400, 'Les paiements se saisissent sur une facture.');
  if (doc.status === 'annulée') throw new HttpError(409, 'Cette facture est annulée.');
  const rest = r2(doc.total_ttc - (doc.amount_paid || 0));
  const amount = r2(num(b.amount));
  if (amount <= 0) throw new HttpError(400, 'Indiquez un montant supérieur à zéro.');
  if (amount > rest + 0.005) throw new HttpError(400, `Le montant dépasse le reste à payer (${rest.toFixed(2)}).`);
  const method = PAYMENT_METHODS.includes(b.method) ? b.method : 'autre';
  await db.prepare('INSERT INTO payments (store_id, document_id, amount, method, date, note) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(sid, doc.id, amount, method, isDate(b.date) ? b.date : today(), str(b.note, 300)).run();
  await refreshPaid(db, sid, doc.id);
  return getDocument(db, sid, doc.id);
}

async function setStatus(ctx, id, status) {
  const { db } = ctx; const sid = ctx.store.id;
  const doc = await getDocument(db, sid, id);
  if (!STATUSES[doc.type].includes(status)) throw new HttpError(400, 'Statut inconnu pour ce document.');
  if (doc.type === 'facture' && doc.status === 'annulée') throw new HttpError(409, 'Une facture annulée ne peut pas être réactivée.');
  if (doc.type === 'ticket') {
    if (doc.status === 'annulé') throw new HttpError(409, 'Ce ticket est déjà annulé.');
    if (status !== 'annulé') return doc;
    const invoice = doc.children.find((c) => c.type === 'facture' && c.status !== 'annulée');
    if (invoice) throw new HttpError(409, `Annulez d'abord la facture ${invoice.number} établie pour ce ticket.`);
    const refunds = doc.payments.filter((p) => p.amount > 0).map((p) =>
      db.prepare('INSERT INTO payments (store_id, document_id, amount, method, date, note) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(sid, doc.id, -p.amount, p.method, today(), `Remboursement ${doc.number}`));
    await db.batch([...refunds, db.prepare("UPDATE documents SET status = 'annulé', amount_paid = 0 WHERE id = ? AND store_id = ?").bind(doc.id, sid)]);
    await syncStock(db, sid, doc.id);
    await reverseLoyalty(db, sid, doc);
    await bump(db, sid, 'sales_amount', -doc.total_ttc);
    return getDocument(db, sid, doc.id);
  }
  if (doc.type === 'facture' && doc.source_type === 'ticket' && status !== 'annulée') throw new HttpError(409, 'Cette facture est réglée par son ticket de caisse.');
  if (doc.type === 'facture' && status === 'payée') {
    const rest = r2(doc.total_ttc - (doc.amount_paid || 0));
    if (rest > 0) return addPayment(ctx, doc.id, { amount: rest, method: 'autre', date: today(), note: 'Marquée payée' });
  }
  if (doc.type === 'facture' && status === 'émise' && doc.payments.length) {
    throw new HttpError(409, 'Des paiements sont enregistrés sur cette facture : supprimez-les pour la repasser « à payer ».');
  }
  await db.prepare('UPDATE documents SET status = ?, paid_at = ? WHERE id = ? AND store_id = ?')
    .bind(status, status === 'payée' ? (doc.paid_at || today()) : null, doc.id, sid).run();
  await syncStock(db, sid, doc.id);
  return getDocument(db, sid, doc.id);
}

async function convertDocument(ctx, id, to) {
  const { db } = ctx; const sid = ctx.store.id;
  const doc = await getDocument(db, sid, id);
  const allowed = { devis: ['commande', 'facture'], commande: ['facture'], ticket: ['facture'] };
  if (!(allowed[doc.type] || []).includes(to)) throw new HttpError(400, 'Cette conversion est impossible.');
  const existing = doc.children.find((c) => c.type === to && c.status !== 'annulée');
  if (existing) throw new HttpError(409, `Ce document a déjà été transformé : ${existing.number}.`);
  if (['annulée', 'annulé', 'refusé'].includes(doc.status)) throw new HttpError(409, 'Un document annulé ou refusé ne peut pas être transformé.');
  if (doc.type === 'commande' && doc.status !== 'livrée') {
    await db.prepare("UPDATE documents SET status = 'livrée' WHERE id = ? AND store_id = ?").bind(doc.id, sid).run();
    await syncStock(db, sid, doc.id);
  }
  if (doc.type === 'devis') await db.prepare("UPDATE documents SET status = 'accepté' WHERE id = ? AND store_id = ?").bind(doc.id, sid).run();
  const created = await createDocument(ctx, {
    type: to, customer_id: doc.customer_id, client_name: doc.client_name, client_email: doc.client_email,
    client_phone: doc.client_phone, client_address: doc.client_address, notes: doc.notes,
    lines: doc.lines, source_id: doc.id, source_type: doc.type, date: doc.type === 'ticket' ? doc.date : undefined,
    location_id: doc.location_id && ctx.locations.some((l) => l.id === doc.location_id) ? doc.location_id : undefined,
  });
  if (doc.type === 'ticket') {
    await db.prepare("UPDATE documents SET status = 'payée', amount_paid = total_ttc, paid_at = ?, due_date = NULL, notes = ? WHERE id = ? AND store_id = ?")
      .bind(doc.date, `Réglée par le ticket ${doc.number}.${doc.notes ? '\n' + doc.notes : ''}`, created.id, sid).run();
    return getDocument(db, sid, created.id);
  }
  return created;
}

async function deleteDocument(ctx, id) {
  const { db } = ctx; const sid = ctx.store.id;
  const doc = await getDocument(db, sid, id);
  if (doc.type === 'facture') throw new HttpError(409, 'Une facture ne se supprime pas : passez-la en « annulée » pour garder la trace comptable.');
  if (doc.type === 'ticket') throw new HttpError(409, 'Un ticket ne se supprime pas : annulez-le pour garder la trace en caisse.');
  if (doc.stock_applied) {
    await db.prepare("UPDATE documents SET status = 'annulée' WHERE id = ? AND store_id = ?").bind(doc.id, sid).run();
    await syncStock(db, sid, doc.id);
  }
  await db.batch([
    db.prepare('DELETE FROM document_lines WHERE document_id = ? AND store_id = ?').bind(doc.id, sid),
    db.prepare('UPDATE documents SET source_id = NULL WHERE source_id = ? AND store_id = ?').bind(doc.id, sid),
    db.prepare('DELETE FROM documents WHERE id = ? AND store_id = ?').bind(doc.id, sid),
  ]);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Caisse                                                              */
/* ------------------------------------------------------------------ */

function discountLines(lines, pct, label = null) {
  pct = Math.min(100, Math.max(0, num(pct)));
  if (!pct) return [];
  const byRate = {};
  for (const l of lines) byRate[l.tva_rate] = (byRate[l.tva_rate] || 0) + l.qty * l.unit_price_ht;
  return Object.entries(byRate).filter(([, ht]) => ht > 0).map(([rate, ht]) => ({
    product_id: null, label: label || `Remise ${pct} %`, qty: 1, unit_price_ht: -Math.round(ht * pct * 100) / 10000, tva_rate: Number(rate),
  }));
}

/* ---------------- Fidélité ---------------- */
async function loyaltyConfig(db, sid) {
  const s = await getSettings(db, sid);
  return { on: s.loyalty_enabled === '1', earn: Math.max(0.01, num(s.loyalty_earn, 1)), threshold: Math.max(1, num(s.loyalty_threshold, 100)), reward: Math.max(0, num(s.loyalty_reward, 0)), currency: s.currency };
}
function loyaltyStmts(db, sid, customerId, docId, points, reason, userId) {
  return [
    db.prepare('UPDATE customers SET loyalty_points = COALESCE(loyalty_points, 0) + ? WHERE id = ? AND store_id = ?').bind(points, customerId, sid),
    db.prepare('INSERT INTO loyalty_movements (store_id, customer_id, document_id, points, reason, created_by) VALUES (?, ?, ?, ?, ?, ?)').bind(sid, customerId, docId, points, reason, userId || null),
  ];
}
// Annulation d'un ticket : les points gagnés et dépensés sont rendus.
async function reverseLoyalty(db, sid, doc) {
  const m = await db.prepare('SELECT customer_id, SUM(points) AS pts FROM loyalty_movements WHERE document_id = ? AND store_id = ? GROUP BY customer_id').bind(doc.id, sid).all();
  const stmts = [];
  for (const r of m.results) if (r.pts) stmts.push(...loyaltyStmts(db, sid, r.customer_id, doc.id, -r.pts, `Annulation ${doc.number}`, null));
  if (stmts.length) await db.batch(stmts);
}

async function posCheckout(ctx, b) {
  const { db } = ctx; const sid = ctx.store.id;
  const mode = b.mode;
  if (!['ticket', 'credit', 'reserve'].includes(mode)) throw new HttpError(400, 'Mode de vente inconnu.');
  ctx.need('pos.sell');
  if (mode !== 'ticket') ctx.need('pos.credit');
  if (num(b.discount_pct) > 0) ctx.need('pos.discount');
  // Vente faite hors ligne puis synchronisée : déjà reçue ? On renvoie la même, sans rien recréer.
  const ref = clientRef(b.client_ref);
  if (ref) { const ex = await db.prepare('SELECT id FROM documents WHERE store_id = ? AND client_ref = ?').bind(sid, ref).first(); if (ex) return { ...(await getDocument(db, sid, ex.id)), duplicate: true }; }
  const at = occurredAt(b.occurred_at);
  if (!b.customer_id && b.customer_client_ref) {
    const c = await db.prepare('SELECT id FROM customers WHERE store_id = ? AND client_ref = ?').bind(sid, clientRef(b.customer_client_ref)).first();
    if (c) b.customer_id = c.id;
  }
  const location = writeLocation(ctx, b.location_id);
  const base = cleanLines(b.lines);
  if (!base.length) throw new HttpError(400, 'Le ticket est vide.');
  // Produits créés hors ligne : rattacher l'id serveur à partir du client_ref (déjà synchronisé avant la vente).
  for (const l of base) {
    if (!l.product_id && l.product_client_ref) {
      const p = await db.prepare('SELECT id FROM products WHERE store_id = ? AND client_ref = ?').bind(sid, l.product_client_ref).first();
      if (p) l.product_id = p.id;
    }
  }
  if (!ctx.can('pos.discount')) {
    // Sans le droit de remise, impossible de vendre un produit en dessous de son prix.
    const ids = [...new Set(base.filter((l) => l.product_id).map((l) => l.product_id))];
    if (ids.length) {
      const prices = (await db.prepare(`SELECT id, price_ht FROM products WHERE store_id = ? AND id IN (${ids.map(() => '?').join(',')})`).bind(sid, ...ids).all()).results;
      for (const l of base) {
        const p = prices.find((x) => x.id === l.product_id);
        if (p && l.unit_price_ht < p.price_ht - 0.005) throw new HttpError(403, `Vous n'avez pas l'autorisation de baisser le prix de « ${l.label} ».`);
      }
    }
  }
  // Fidélité : récompense utilisée (vérifiée ici : solde suffisant, montant plafonné à la récompense prévue).
  const loyalty = await loyaltyConfig(db, sid);
  const customerForLoyalty = b.customer_id ? await db.prepare('SELECT id, loyalty_points FROM customers WHERE id = ? AND store_id = ?').bind(num(b.customer_id), sid).first() : null;
  let rewardLines = [];
  if (b.loyalty_redeem) {
    if (!loyalty.on) throw new HttpError(400, 'Le programme de fidélité est désactivé.');
    if (!customerForLoyalty) throw new HttpError(400, 'Choisissez le client pour utiliser ses points.');
    if ((customerForLoyalty.loyalty_points || 0) < loyalty.threshold) throw new HttpError(409, `Ce client n'a pas assez de points (${customerForLoyalty.loyalty_points || 0} sur ${loyalty.threshold}).`);
    if (mode !== 'ticket') throw new HttpError(400, 'Les points se dépensent sur une vente payée.');
    const baseTotal = computeTotals(base).total_ttc;
    if (baseTotal < loyalty.reward - 0.01) throw new HttpError(409, `La récompense de ${loyalty.reward} ${loyalty.currency} s'utilise sur un achat d'au moins ce montant.`);
    const pct = num(b.loyalty_pct);
    if (!(pct > 0) || pct > 100 || (pct * baseTotal) / 100 > loyalty.reward + 0.02) throw new HttpError(400, 'Montant de la récompense fidélité incorrect.');
    rewardLines = discountLines(base, pct, `Fidélité : ${loyalty.reward} ${loyalty.currency} offerts`);
  }
  const lines = [...base, ...discountLines(base, b.discount_pct), ...rewardLines].map((l, i) => ({ ...l, position: i }));
  const total = computeTotals(lines).total_ttc;
  const client = { customer_id: b.customer_id ? num(b.customer_id) || null : null, client_name: str(b.client_name, 160), client_phone: str(b.client_phone, 40) };
  if (mode !== 'ticket' && !client.customer_id && !client.client_name) {
    throw new HttpError(400, mode === 'credit' ? 'Une vente à crédit nécessite un client.' : 'Indiquez le nom du client qui a passé la commande.');
  }
  const payments = (Array.isArray(b.payments) ? b.payments : [])
    .map((p) => ({ method: PAYMENT_METHODS.includes(p.method) ? p.method : 'autre', amount: r2(num(p.amount)), note: str(p.note, 200) }))
    .filter((p) => p.amount > 0);
  const paid = r2(payments.reduce((s, p) => s + p.amount, 0));
  if (mode === 'ticket' && Math.abs(paid - total) > 0.009) throw new HttpError(400, `Le paiement (${paid.toFixed(2)}) ne correspond pas au total (${total.toFixed(2)}).`);
  if (mode === 'credit' && paid > total + 0.009) throw new HttpError(400, "L'acompte dépasse le total.");

  let source = null;
  if (b.source_id) {
    source = await getDocument(db, sid, b.source_id);
    if (source.type !== 'commande' || !['nouvelle', 'confirmée'].includes(source.status)) throw new HttpError(409, `La commande ${source.number} n'est plus en attente.`);
    if (!client.customer_id && !client.client_name) Object.assign(client, { customer_id: source.customer_id, client_name: source.client_name, client_phone: source.client_phone });
  }
  if (mode === 'reserve') {
    const data = { type: 'commande', ...client, status: 'confirmée', origin: 'caisse', notes: str(b.notes, 2000), lines, location_id: location.id, date: at.date, client_ref: ref, created_at: at.iso };
    return source ? updateDocument(ctx, source.id, { ...data, date: source.date }) : createDocument(ctx, data);
  }
  if (source) {
    await updateDocument(ctx, source.id, { ...client, client_name: client.client_name || source.client_name, status: 'confirmée', date: source.date, notes: source.notes, lines });
    await db.prepare("UPDATE documents SET status = 'livrée' WHERE id = ? AND store_id = ?").bind(source.id, sid).run();
    await syncStock(db, sid, source.id);
  }
  let doc;
  try {
    doc = await createDocument(ctx, {
      type: mode === 'ticket' ? 'ticket' : 'facture', ...client, origin: 'caisse', notes: str(b.notes, 2000), lines,
      source_id: source ? source.id : null, source_type: source ? 'commande' : null, location_id: location.id,
      date: at.date, client_ref: ref, created_at: at.iso,
    });
  } catch (e) {
    // Deux envois simultanés de la même vente : l'index unique n'en garde qu'une.
    const ex = ref && /UNIQUE/i.test(String(e.message)) && await db.prepare('SELECT id FROM documents WHERE store_id = ? AND client_ref = ?').bind(sid, ref).first();
    if (ex) return { ...(await getDocument(db, sid, ex.id)), duplicate: true };
    throw e;
  }
  if (payments.length) {
    await db.batch(payments.map((p) => db.prepare('INSERT INTO payments (store_id, document_id, amount, method, date, note) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(sid, doc.id, p.amount, p.method, at.date, p.note)));
  }
  if (mode === 'ticket') {
    await db.prepare('UPDATE documents SET amount_paid = ?, paid_at = ? WHERE id = ? AND store_id = ?').bind(paid, at.date, doc.id, sid).run();
    await bump(db, sid, 'tickets');
    await bump(db, sid, 'sales_amount', total);
    // Fidélité : points dépensés puis points gagnés sur le montant payé.
    if (loyalty.on && customerForLoyalty) {
      const stmts = [];
      if (rewardLines.length) stmts.push(...loyaltyStmts(db, sid, customerForLoyalty.id, doc.id, -loyalty.threshold, 'Récompense utilisée', ctx.user.id));
      const earned = Math.floor(total / loyalty.earn);
      if (earned > 0) stmts.push(...loyaltyStmts(db, sid, customerForLoyalty.id, doc.id, earned, `Achat ${doc.number}`, ctx.user.id));
      if (stmts.length) await db.batch(stmts);
    }
  } else await refreshPaid(db, sid, doc.id);
  return getDocument(db, sid, doc.id);
}

async function posJournal(db, sid, date, ctx) {
  date = isDate(date) ? date : today();
  const w = scopeWhere(ctx, 'd.location_id'), w2 = scopeWhere(ctx);
  const payments = (await db.prepare(`SELECT p.*, d.number, d.type, d.client_name FROM payments p
      JOIN documents d ON d.id = p.document_id AND d.store_id = p.store_id WHERE p.store_id = ? AND p.date = ?${w.sql} ORDER BY p.id`).bind(sid, date, ...w.args).all()).results;
  const byMethod = {};
  for (const p of payments) byMethod[p.method] = r2((byMethod[p.method] || 0) + p.amount);
  const tickets = (await db.prepare(`SELECT id, number, client_name, total_ttc, status, created_at, location_id FROM documents
      WHERE store_id = ? AND type = 'ticket' AND date = ?${w2.sql} ORDER BY id DESC`).bind(sid, date, ...w2.args).all()).results;
  const credit = (await db.prepare(`SELECT id, number, client_name, total_ttc, amount_paid, status, location_id FROM documents
      WHERE store_id = ? AND type = 'facture' AND origin = 'caisse' AND date = ?${w2.sql} ORDER BY id DESC`).bind(sid, date, ...w2.args).all()).results;
  const valid = tickets.filter((t) => t.status === 'payé');
  const sum = r2(valid.reduce((s, t) => s + t.total_ttc, 0));
  return {
    date, payments, by_method: byMethod, total_collected: r2(payments.reduce((s, p) => s + p.amount, 0)),
    tickets, credit, tickets_count: valid.length, tickets_total: sum, average_ticket: valid.length ? r2(sum / valid.length) : 0,
  };
}

/* ------------------------------------------------------------------ */
/* Alertes                                                             */
/* ------------------------------------------------------------------ */

const suggestedQty = (p) => Math.max(1, Math.ceil(Math.max(p.stock_min * 2, p.stock_min + 1) - Math.max(p.stock, 0)));

export async function computeAlerts(db, sid, settings) {
  const t = today();
  const soon = addDays(t, Math.max(0, num(settings.due_soon_days, 7)));
  const unpaid = (await db.prepare(`SELECT id, number, customer_id, client_name, client_email, client_phone, date, due_date, total_ttc,
      amount_paid, reminders, last_reminder_at FROM documents
      WHERE store_id = ? AND type = 'facture' AND status = 'émise' AND due_date IS NOT NULL AND due_date <= ? ORDER BY due_date`).bind(sid, soon).all()).results
    .map((d) => ({ ...d, remaining: r2(d.total_ttc - d.amount_paid), days: daysBetween(t, d.due_date) }));
  const overdue = unpaid.filter((d) => d.due_date < t).map((d) => ({ ...d, days_late: -d.days }));
  const dueSoon = unpaid.filter((d) => d.due_date >= t);
  const products = (await db.prepare(`SELECT id, ref, name, stock, stock_min, unit, purchase_price FROM products
      WHERE store_id = ? AND track_stock = 1 AND stock <= stock_min AND (stock_min > 0 OR stock <= 0) ORDER BY stock, name COLLATE NOCASE`).bind(sid).all()).results
    .map((p) => ({ ...p, suggested: suggestedQty(p) }));
  return {
    overdue, due_soon: dueSoon, out_of_stock: products.filter((p) => p.stock <= 0), low_stock: products.filter((p) => p.stock > 0),
    totals: {
      overdue_amount: r2(overdue.reduce((s, d) => s + d.remaining, 0)),
      due_soon_amount: r2(dueSoon.reduce((s, d) => s + d.remaining, 0)),
      count: overdue.length + dueSoon.length + products.length,
    },
  };
}

export function digestEmail(a, settings, appUrl) {
  const cur = settings.currency || '€';
  const money = (n) => `${Number(n).toFixed(2).replace('.', ',')} ${cur}`;
  const fr = (d) => d.split('-').reverse().join('/');
  const section = (title, rows, head) => rows.length ? `
    <h2 style="font-size:16px;margin:24px 0 8px">${title}</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr>${head.map((h) => `<th style="text-align:left;color:#5A6774;font-weight:600;padding:6px 8px;border-bottom:1px solid #1B1D22">${h}</th>`).join('')}</tr>
      ${rows.map((r) => `<tr>${r.map((c) => `<td style="padding:7px 8px;border-bottom:1px solid #E3E6E9">${c}</td>`).join('')}</tr>`).join('')}
    </table>` : '';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1B1D22;max-width:640px">
    <div style="background:#1B1D22;color:#fff;padding:16px 20px;font-size:18px;font-weight:700">${escHtml(settings.shop_name)} : alertes du jour</div>
    <div style="padding:4px 20px 20px">
      ${section(`Factures en retard (${money(a.totals.overdue_amount)})`, a.overdue.map((d) => [escHtml(d.number), escHtml(d.client_name), `${d.days_late} j de retard`, money(d.remaining)]), ['Facture', 'Client', 'Retard', 'Reste dû'])}
      ${section('Échéances proches', a.due_soon.map((d) => [escHtml(d.number), escHtml(d.client_name), fr(d.due_date), money(d.remaining)]), ['Facture', 'Client', 'Échéance', 'Reste dû'])}
      ${section('Ruptures de stock', a.out_of_stock.map((p) => [escHtml(p.name), escHtml(p.ref), String(p.stock), `${p.suggested} ${escHtml(p.unit)}`]), ['Produit', 'Réf.', 'Stock', 'À commander'])}
      ${section('Stock sous le seuil', a.low_stock.map((p) => [escHtml(p.name), escHtml(p.ref), `${p.stock} / ${p.stock_min}`, `${p.suggested} ${escHtml(p.unit)}`]), ['Produit', 'Réf.', 'Stock / seuil', 'À commander'])}
      ${a.totals.count ? '' : "<p style=\"margin-top:20px\">Aucune alerte aujourd'hui : stock et paiements sont à jour.</p>"}
      ${appUrl ? `<p style="margin-top:24px"><a href="${escHtml(appUrl)}/app/#/alertes" style="background:#E4572E;color:#fff;padding:10px 16px;text-decoration:none;font-weight:700;display:inline-block">Ouvrir les alertes</a></p>` : ''}
    </div></div>`;
  const parts = [];
  if (a.overdue.length) parts.push(`${a.overdue.length} facture${a.overdue.length > 1 ? 's' : ''} en retard`);
  if (a.out_of_stock.length) parts.push(`${a.out_of_stock.length} rupture${a.out_of_stock.length > 1 ? 's' : ''}`);
  if (a.low_stock.length) parts.push(`${a.low_stock.length} stock${a.low_stock.length > 1 ? 's' : ''} bas`);
  if (a.due_soon.length) parts.push(`${a.due_soon.length} échéance${a.due_soon.length > 1 ? 's' : ''} proche${a.due_soon.length > 1 ? 's' : ''}`);
  return { subject: `${settings.shop_name} : ${parts.join(', ') || 'aucune alerte'}`, html };
}

export async function sendEmail(env, to, subject, html) {
  if (!env.RESEND_API_KEY) throw new HttpError(503, "L'envoi d'e-mails n'est pas encore activé sur la plateforme.");
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM || 'Comptoir <onboarding@resend.dev>', to: [to], subject, html }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new HttpError(502, `L'e-mail n'a pas pu partir : ${err.message || res.status}.`);
  }
}

/* ------------------------------------------------------------------ */
/* Produits, stock, clients                                            */
/* ------------------------------------------------------------------ */

const availability = (p) => (!p.track_stock ? 'in' : p.stock <= 0 ? 'out' : p.stock <= p.stock_min ? 'low' : 'in');
export const imageUrl = (p) => (p.image_v ? `/api/images/${p.id}?v=${p.image_v}` : null);

function productFields(b) {
  const name = str(b.name, 200);
  if (!name) throw new HttpError(400, 'Le nom du produit est obligatoire.');
  return {
    ref: str(b.ref, 60), barcode: str(b.barcode, 64), name, description: str(b.description, 3000),
    price_ht: r4(Math.max(0, num(b.price_ht))), purchase_price: r2(Math.max(0, num(b.purchase_price))),
    tva_rate: num(b.tva_rate, 20), stock_min: Math.max(0, num(b.stock_min)),
    unit: str(b.unit, 30) || 'pièce', visible: b.visible === false || b.visible === 0 ? 0 : 1,
    track_stock: b.track_stock === false || b.track_stock === 0 ? 0 : 1,
  };
}

async function ownedCategory(db, sid, id) {
  if (!id) return null;
  const c = await db.prepare('SELECT id FROM categories WHERE id = ? AND store_id = ?').bind(num(id), sid).first();
  return c ? c.id : null;
}

async function createProduct(ctx, b) {
  const { db } = ctx; const sid = ctx.store.id;
  const ref = clientRef(b.client_ref);
  if (ref) {
    const ex = await db.prepare('SELECT id FROM products WHERE store_id = ? AND client_ref = ?').bind(sid, ref).first();
    if (ex) return { id: ex.id, duplicate: true };
  }
  const limit = (PLANS[ctx.store.plan] || PLANS.essai).products;
  if (limit !== null) {
    const n = await db.prepare('SELECT COUNT(*) AS n FROM products WHERE store_id = ?').bind(sid).first();
    if (n.n >= limit) throw new HttpError(402, `Votre formule est limitée à ${limit} produits. Passez à la formule supérieure pour en ajouter.`);
  }
  const f = productFields(b);
  const category_id = await ownedCategory(db, sid, b.category_id);
  const stock = f.track_stock ? Math.max(0, num(b.stock)) : 0;
  const r = await db.prepare(`INSERT INTO products (store_id, ref, barcode, name, description, category_id, price_ht, purchase_price, tva_rate, stock, stock_min, unit, visible, track_stock, client_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(sid, f.ref, f.barcode, f.name, f.description, category_id, f.price_ht, f.purchase_price, f.tva_rate, stock, f.stock_min, f.unit, f.visible, f.track_stock, ref).run();
  const id = r.meta.last_row_id;
  const loc = ctx.location || ctx.locations[0];
  if (loc) await db.prepare('INSERT OR IGNORE INTO location_stock (store_id, location_id, product_id, qty) VALUES (?, ?, ?, ?)').bind(sid, loc.id, id, stock).run();
  if (stock > 0) await db.prepare("INSERT INTO stock_movements (store_id, product_id, qty, type, reason, location_id) VALUES (?, ?, ?, 'entrée', 'Stock initial', ?)").bind(sid, id, stock, loc ? loc.id : null).run();
  await logEvent(db, sid, ctx.user.id, 'product', f.name);
  return { id };
}

async function updateProduct(ctx, id, b) {
  const { db } = ctx; const sid = ctx.store.id;
  const f = productFields(b);
  const category_id = await ownedCategory(db, sid, b.category_id);
  const r = await db.prepare(`UPDATE products SET ref = ?, barcode = ?, name = ?, description = ?, category_id = ?, price_ht = ?, purchase_price = ?,
      tva_rate = ?, stock_min = ?, unit = ?, visible = ?, track_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?`)
    .bind(f.ref, f.barcode, f.name, f.description, category_id, f.price_ht, f.purchase_price, f.tva_rate, f.stock_min, f.unit, f.visible, f.track_stock, num(id), sid).run();
  if (!r.meta.changes) throw new HttpError(404, 'Produit introuvable.');
  return { ok: true };
}

async function setProductImage(ctx, id, b) {
  const { db } = ctx; const sid = ctx.store.id;
  const m = String(b.data || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new HttpError(400, 'Format d’image non pris en charge (JPEG, PNG ou WebP).');
  if (m[2].length > 1_400_000) throw new HttpError(413, "L'image est trop lourde (1 Mo maximum après compression).");
  const p = await db.prepare('SELECT id FROM products WHERE id = ? AND store_id = ?').bind(num(id), sid).first();
  if (!p) throw new HttpError(404, 'Produit introuvable.');
  await saveProductImage(ctx.env, db, sid, p.id, m[1], fromBase64(m[2]));
  return { ok: true };
}

async function addStockMovement(ctx, b) {
  const { db } = ctx; const sid = ctx.store.id;
  const ref = clientRef(b.client_ref);
  if (ref && await db.prepare('SELECT id FROM stock_movements WHERE store_id = ? AND client_ref = ?').bind(sid, ref).first()) return { ok: true, duplicate: true };
  const at = occurredAt(b.occurred_at);
  const p = await db.prepare('SELECT id, stock, track_stock FROM products WHERE id = ? AND store_id = ?').bind(num(b.product_id), sid).first();
  if (!p) throw new HttpError(404, 'Choisissez un produit.');
  if (!p.track_stock) throw new HttpError(400, "Le suivi de stock est désactivé pour ce produit.");
  const type = ['entrée', 'sortie', 'inventaire'].includes(b.type) ? b.type : null;
  if (!type) throw new HttpError(400, 'Type de mouvement inconnu.');
  const qty = num(b.qty, NaN);
  if (!Number.isFinite(qty) || qty < 0 || (type !== 'inventaire' && qty === 0)) throw new HttpError(400, 'Indiquez une quantité valide.');
  const loc = writeLocation(ctx, b.location_id);
  const here = (await db.prepare('SELECT qty FROM location_stock WHERE location_id = ? AND product_id = ?').bind(loc.id, p.id).first())?.qty || 0;
  const delta = type === 'entrée' ? qty : type === 'sortie' ? -qty : qty - here;
  const reason = str(b.reason, 200) || (type === 'inventaire' ? 'Inventaire' : type === 'entrée' ? 'Réception fournisseur' : 'Sortie manuelle');
  await db.batch([
    ...stockDelta(db, sid, loc.id, p.id, delta),
    db.prepare('INSERT INTO stock_movements (store_id, product_id, qty, type, reason, location_id, client_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))').bind(sid, p.id, delta, type, reason, loc.id, ref, at.iso),
  ]);
  return { ok: true, stock: p.stock + delta, stock_here: here + delta };
}

async function createCustomer(ctx, b) {
  const { db } = ctx; const sid = ctx.store.id;
  const f = customerFields(b);
  const ref = clientRef(b.client_ref);
  if (ref) { const ex = await db.prepare('SELECT id FROM customers WHERE store_id = ? AND client_ref = ?').bind(sid, ref).first(); if (ex) return { id: ex.id, duplicate: true }; }
  const r = await db.prepare('INSERT INTO customers (store_id, name, company, email, phone, address, notes, client_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(sid, ...f, ref).run();
  return { id: r.meta.last_row_id };
}

/* ------------------------------------------------------------------ */
/* Mode hors ligne : synchronisation des opérations faites sur l'appareil */
/* ------------------------------------------------------------------ */
// Identifiant d'opération fourni par l'appareil (UUID ou équivalent).
const clientRef = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : null);
// Date réelle de l'opération : acceptée jusqu'à 30 jours en arrière (et 5 minutes d'avance d'horloge).
function occurredAt(v) {
  const t = Date.parse(v); const now = Date.now();
  if (!v || !Number.isFinite(t) || t > now + 5 * 60000 || t < now - 30 * 86400000) return { date: today(), iso: null };
  const d = new Date(t).toISOString();
  return { date: d.slice(0, 10), iso: d.slice(0, 19).replace('T', ' ') };
}
// Rejoue dans l'ordre les opérations faites hors ligne. Chacune garde ses propres droits et sa boutique.
// Refusée (4xx) : signalée, les suivantes continuent. Panne (5xx) : arrêt, nouvel essai plus tard.
async function syncOps(ctx, b) {
  const ops = Array.isArray(b.ops) ? b.ops.slice(0, 50) : [];
  const base = { location: ctx.location, scope: ctx.scope };
  const results = [];
  for (const op of ops) {
    const ref = clientRef(op?.ref);
    if (!ref) { results.push({ ref: op?.ref ?? null, status: 'error', error: 'Opération illisible.' }); continue; }
    // Opération faite pour un autre commerce sur cet appareil : gardée de côté, envoyée à la bonne session.
    if (op.store_id && num(op.store_id) !== ctx.store.id) { results.push({ ref, status: 'later' }); continue; }
    const loc = op.location_id ? ctx.locations.find((l) => l.id === num(op.location_id)) : null;
    Object.assign(ctx, loc ? { location: loc, scope: loc.id } : base);
    const body = { ...(op.body || {}), client_ref: ref, occurred_at: op.at, location_id: loc ? loc.id : undefined };
    try {
      let result;
      if (op.type === 'sale') {
        const d = await posCheckout(ctx, body);
        result = { id: d.id, number: d.number, total_ttc: d.total_ttc, duplicate: !!d.duplicate };
        if (!d.duplicate) ctx.later?.(stockAlerts(ctx.env, ctx.store.id, (body.lines || []).map((l) => l.product_id), loc?.id));
      } else if (op.type === 'customer') { ctx.need('customers.manage'); result = await createCustomer(ctx, body); }
      else if (op.type === 'product') { ctx.need('products.edit'); result = await createProduct(ctx, body); }
      else if (op.type === 'stock') { ctx.need('stock.manage'); result = await addStockMovement(ctx, body); if (!result.duplicate) ctx.later?.(stockAlerts(ctx.env, ctx.store.id, [body.product_id], loc?.id)); }
      else if (op.type === 'support') result = await postClientMessage(ctx, body);
      else throw new HttpError(400, 'Type d’opération inconnu.');
      results.push({ ref, status: 'ok', result });
    } catch (e) {
      if (e instanceof HttpError && e.status < 500) results.push({ ref, status: 'error', code: e.status, error: e.message });
      else { console.error('Synchronisation', ref, e.message); results.push({ ref, status: 'retry', error: 'Erreur du serveur : nouvel essai automatique.' }); break; }
    }
  }
  Object.assign(ctx, base);
  return { results };
}

function customerFields(b) {
  const name = str(b.name, 160);
  if (!name) throw new HttpError(400, 'Le nom du client est obligatoire.');
  return [name, str(b.company, 160), str(b.email, 160), str(b.phone, 40), str(b.address, 400), str(b.notes, 2000)];
}

const SALES = (p = '') => `((${p}type = 'facture' AND ${p}status != 'annulée' AND COALESCE(${p}source_type, '') != 'ticket') OR (${p}type = 'ticket' AND ${p}status = 'payé'))`;

async function dashboard(db, sid, ctx) {
  const month = today().slice(0, 7);
  const W = scopeWhere(ctx).sql, WA = scopeWhere(ctx).args;
  const q = (sql, ...args) => db.prepare(sql.replace('/*L*/', W)).bind(sid, ...args, ...(sql.includes('/*L*/') ? WA : [])).first();
  const [ca, unpaid, overdue, orders, todaySales, quotes, stockValue] = await Promise.all([
    q(`SELECT COALESCE(SUM(total_ttc), 0) AS v, COUNT(*) AS n FROM documents WHERE store_id = ? AND ${SALES()} AND substr(date, 1, 7) = ?/*L*/`, month),
    q(`SELECT COALESCE(SUM(total_ttc - amount_paid), 0) AS v, COUNT(*) AS n FROM documents WHERE store_id = ? AND type = 'facture' AND status = 'émise'/*L*/`),
    q(`SELECT COUNT(*) AS n FROM documents WHERE store_id = ? AND type = 'facture' AND status = 'émise' AND due_date < ?/*L*/`, today()),
    q(`SELECT COUNT(*) AS n FROM documents WHERE store_id = ? AND type = 'commande' AND status IN ('nouvelle', 'confirmée')/*L*/`),
    q(`SELECT COALESCE(SUM(total_ttc), 0) AS v, COUNT(*) AS n FROM documents WHERE store_id = ? AND type = 'ticket' AND status = 'payé' AND date = ?/*L*/`, today()),
    q(`SELECT COUNT(*) AS n, COALESCE(SUM(total_ttc), 0) AS v FROM documents WHERE store_id = ? AND type = 'devis' AND status IN ('brouillon', 'envoyé')/*L*/`),
    ctx.scope === 'all'
      ? q(`SELECT COALESCE(SUM(stock * CASE WHEN purchase_price > 0 THEN purchase_price ELSE price_ht END), 0) AS v FROM products WHERE store_id = ? AND track_stock = 1 AND stock > 0`)
      : db.prepare(`SELECT COALESCE(SUM(ls.qty * CASE WHEN p.purchase_price > 0 THEN p.purchase_price ELSE p.price_ht END), 0) AS v FROM location_stock ls
          JOIN products p ON p.id = ls.product_id AND p.store_id = ls.store_id WHERE ls.store_id = ? AND ls.location_id = ? AND p.track_stock = 1 AND ls.qty > 0`).bind(sid, ctx.scope ?? -1).first(),
  ]);
  const months = [];
  const d = new Date();
  for (let i = 5; i >= 0; i--) months.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const rev = (await db.prepare(`SELECT substr(date, 1, 7) AS m, SUM(total_ttc) AS v FROM documents
    WHERE store_id = ? AND ${SALES()} AND date >= ?${W} GROUP BY m`).bind(sid, months[0] + '-01', ...WA).all()).results;
  const alerts = (await db.prepare(`SELECT id, ref, name, stock, stock_min, unit FROM products WHERE store_id = ? AND track_stock = 1 AND stock <= stock_min AND (stock_min > 0 OR stock <= 0) ORDER BY stock ASC, name LIMIT 12`).bind(sid).all()).results;
  const recent = (await db.prepare(`SELECT id, type, number, client_name, total_ttc, amount_paid, status, date, origin, location_id FROM documents WHERE store_id = ?${W} ORDER BY id DESC LIMIT 8`).bind(sid, ...WA).all()).results;
  const WD = scopeWhere(ctx, 'd.location_id');
  const top = (await db.prepare(`SELECT l.label, SUM(l.qty) AS qty, SUM(l.qty * l.unit_price_ht * (1 + l.tva_rate / 100)) AS amount
    FROM document_lines l JOIN documents d ON d.id = l.document_id AND d.store_id = l.store_id
    WHERE l.store_id = ? AND l.product_id IS NOT NULL AND ${SALES('d.')} AND d.date >= ?${WD.sql} GROUP BY l.product_id ORDER BY amount DESC LIMIT 5`).bind(sid, addDays(today(), -30), ...WD.args).all()).results;
  return {
    revenue_month: r2(ca.v), sales_month: ca.n, unpaid: r2(unpaid.v), unpaid_count: unpaid.n, overdue: overdue.n,
    open_orders: orders.n, today_sales: r2(todaySales.v), today_tickets: todaySales.n,
    open_quotes: quotes.n, open_quotes_value: r2(quotes.v), stock_value: r2(stockValue.v),
    months: months.map((m) => ({ month: m, value: r2((rev.find((r) => r.m === m) || {}).v || 0) })),
    alerts, recent, top: top.map((t) => ({ ...t, amount: r2(t.amount) })),
  };
}

/* ------------------------------------------------------------------ */
/* Équipe et abonnement                                                */
/* ------------------------------------------------------------------ */

async function listTeam(db, sid) {
  const rows = (await db.prepare(`SELECT u.id, u.name, u.email, u.last_login_at, u.must_change_password, m.role, m.role_id, m.locations, m.created_at, r.name AS role_name
    FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN roles r ON r.id = m.role_id AND r.store_id = m.store_id
    WHERE m.store_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, u.name`).bind(sid).all()).results;
  return rows.map((r) => { let l = []; try { l = JSON.parse(r.locations || '[]'); } catch { /* vide */ } return { ...r, locations: Array.isArray(l) ? l : [] }; });
}

async function addMember(ctx, b) {
  const { db } = ctx; const sid = ctx.store.id;
  const name = str(b.name, 120), email = str(b.email, 160).toLowerCase();
  if (!name || !isEmail(email)) throw new HttpError(400, 'Indiquez un nom et une adresse e-mail valide.');
  const limit = (PLANS[ctx.store.plan] || PLANS.essai).users;
  const n = await db.prepare('SELECT COUNT(*) AS n FROM memberships WHERE store_id = ?').bind(sid).first();
  if (limit !== null && n.n >= limit) throw new HttpError(402, `Votre formule permet ${limit} utilisateur${limit > 1 ? 's' : ''}. Passez à la formule supérieure pour agrandir l'équipe.`);
  if (await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) throw new HttpError(409, 'Cette adresse e-mail est déjà utilisée sur la plateforme.');
  const { role, locations } = await validRoleAndLocations(ctx, b);
  const password = tempPassword();
  const r = await db.prepare('INSERT INTO users (email, name, password_hash, must_change_password) VALUES (?, ?, ?, 1)').bind(email, name, await hashPassword(password)).run();
  await db.prepare("INSERT INTO memberships (user_id, store_id, role, role_id, locations) VALUES (?, ?, 'member', ?, ?)").bind(r.meta.last_row_id, sid, role.id, locations).run();
  await logEvent(db, sid, ctx.user.id, 'team', `Ajout de ${name}`);
  return { ok: true, email, temp_password: password };
}

async function memberOf(db, sid, userId) {
  const m = await db.prepare('SELECT role FROM memberships WHERE store_id = ? AND user_id = ?').bind(sid, num(userId)).first();
  if (!m) throw new HttpError(404, 'Membre introuvable.');
  return m;
}

function subscription(store, usage) {
  // Prix dans la devise du pays du commerce (par exemple 419 DH au Maroc pour la formule Pro).
  const pr = pricing(store.country);
  return {
    plan: store.plan, status: store.status, trial_ends_at: store.trial_ends_at, plan_requested: store.plan_requested, currency: pr.symbol,
    usage, plans: Object.entries(PLANS).filter(([k]) => PAID_PLANS.includes(k)).map(([key, p]) => ({ key, ...p, price: pr.price(key), price_label: pr.format(pr.price(key)) })),
  };
}

/* ------------------------------------------------------------------ */
/* Routeur de l'espace commerce                                        */
/* ------------------------------------------------------------------ */

// Permission exigée pour chaque route (le contrôle se fait ici, côté serveur, quelle que soit l'interface).
function guard(ctx, res, id, action, m, url) {
  const W = m !== 'GET';
  switch (res) {
    case 'dashboard': return ctx.need('reports.view');
    case 'import': return ctx.need('products.edit');
    case 'connect': return ctx.need('products.edit');
    case 'settings': if (W) ctx.need('settings.manage'); return;
    case 'categories': case 'products': if (W) ctx.need('products.edit'); return;
    case 'stock': return ctx.need('stock.manage');
    case 'customers': if (W) ctx.need('customers.manage'); return;
    case 'documents':
      if (!W) {
        if (id) { if (!ctx.can('pos.sell') && !ctx.can('pos.journal')) ctx.need('documents.view'); return; }
        if (url.searchParams.get('type') === 'commande' && ctx.can('pos.credit')) return;
        return ctx.need('documents.view');
      }
      if (action === 'payments' || action === 'remind') return ctx.need('payments.manage');
      return ctx.need('documents.edit');
    case 'payments': return ctx.need('payments.manage');
    case 'pos': if (id === 'journal') ctx.need('pos.journal'); return;
    case 'push': return; // chacun gère les notifications de ses propres appareils
    case 'support': return; // tout membre peut écrire au support
    case 'sync': return;    // chaque opération vérifie ses propres droits
    case 'alerts': if (id === 'test-email') return ctx.need('settings.manage'); if (id === 'email-status') return; return ctx.need('alerts.view');
    case 'team': case 'roles': return ctx.need('team.manage');
    case 'subscription': return ctx.need('billing.manage');
    case 'locations': if (id === 'report') return ctx.need('reports.view'); if (W) ctx.need('locations.manage'); return;
    default: return;
  }
}

export async function storeRoutes(ctx, parts) {
  const { db, request, url, env } = ctx;
  const sid = ctx.store.id;
  const m = request.method;
  const [res, id, action] = parts;
  const body = () => readBody(request);

  await resolveAccess(db, ctx, request);
  guard(ctx, res, id, action, m, url);
  const isWrite = m !== 'GET';
  if (isWrite && res !== 'subscription') {
    const access = storeAccess(ctx.store);
    if (!access.writable) throw new HttpError(402, access.reason);
  }
  if (isWrite) await bump(db, sid, 'actions');

  switch (res) {
    case 'dashboard':
      if (m === 'GET') return json(await dashboard(db, sid, ctx));
      break;

    case 'badges':
      // Compteurs du menu en une seule requête légère (au lieu de charger alertes et commandes complètes).
      if (m === 'GET') {
        const st = await getSettings(db, sid);
        const t = today(), soon = addDays(t, Math.max(0, num(st.due_soon_days, 7)));
        const c = await db.prepare(`SELECT
            (SELECT COUNT(*) FROM documents WHERE store_id = ?1 AND type = 'facture' AND status = 'émise' AND due_date < ?2) AS overdue,
            (SELECT COUNT(*) FROM documents WHERE store_id = ?1 AND type = 'facture' AND status = 'émise' AND due_date BETWEEN ?2 AND ?3) AS due_soon,
            (SELECT COUNT(*) FROM products WHERE store_id = ?1 AND track_stock = 1 AND stock <= 0) AS out_of_stock,
            (SELECT COUNT(*) FROM products WHERE store_id = ?1 AND track_stock = 1 AND stock > 0 AND stock <= stock_min AND stock_min > 0) AS low_stock,
            (SELECT COUNT(*) FROM documents WHERE store_id = ?1 AND type = 'commande' AND status IN ('nouvelle', 'confirmée') AND (?4 = 'all' OR location_id = ?4)) AS orders`).bind(sid, t, soon, ctx.scope === 'all' ? 'all' : ctx.scope ?? -1).first();
        return json({ ...c, alerts: c.overdue + c.due_soon + c.out_of_stock + c.low_stock, urgent: c.overdue + c.out_of_stock });
      }
      break;

    case 'settings':
      if (m === 'GET') return json(await getSettings(db, sid, ctx.store));
      if (m === 'PUT') {
        const b = await body();
        const stmts = SETTING_KEYS.filter((k) => k in b).map((k) =>
          db.prepare('INSERT OR REPLACE INTO settings (store_id, key, value) VALUES (?, ?, ?)').bind(sid, k, str(b[k], 2000)));
        if (b.shop_name && str(b.shop_name, 120)) stmts.push(db.prepare('UPDATE stores SET name = ? WHERE id = ?').bind(str(b.shop_name, 120), sid));
        if (stmts.length) await db.batch(stmts);
        return json(await getSettings(db, sid, ctx.store));
      }
      break;

    case 'categories':
      if (!id && m === 'GET') {
        return json((await db.prepare(`SELECT c.id, c.name, c.position, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.store_id = c.store_id) AS products
          FROM categories c WHERE c.store_id = ? ORDER BY c.position, c.name`).bind(sid).all()).results);
      }
      if (!id && m === 'POST') {
        const name = str((await body()).name, 100);
        if (!name) throw new HttpError(400, 'Donnez un nom à la catégorie.');
        const max = await db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM categories WHERE store_id = ?').bind(sid).first();
        const r = await db.prepare('INSERT INTO categories (store_id, name, position) VALUES (?, ?, ?)').bind(sid, name, max.p).run();
        return json({ id: r.meta.last_row_id }, 201);
      }
      if (id && m === 'PUT') {
        const name = str((await body()).name, 100);
        if (!name) throw new HttpError(400, 'Donnez un nom à la catégorie.');
        await db.prepare('UPDATE categories SET name = ? WHERE id = ? AND store_id = ?').bind(name, num(id), sid).run();
        return json({ ok: true });
      }
      if (id && m === 'DELETE') {
        await db.batch([
          db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ? AND store_id = ?').bind(num(id), sid),
          db.prepare('DELETE FROM categories WHERE id = ? AND store_id = ?').bind(num(id), sid),
        ]);
        return json({ ok: true });
      }
      break;

    case 'products':
      if (!id && m === 'GET') {
        const rows = (await db.prepare(`SELECT p.*, c.name AS category_name FROM products p
          LEFT JOIN categories c ON c.id = p.category_id AND c.store_id = p.store_id WHERE p.store_id = ? ORDER BY p.name COLLATE NOCASE`).bind(sid).all()).results;
        // Stock de la boutique courante (stock_here) et détail par boutique quand il y en a plusieurs.
        const multi = ctx.locations.length > 1 || ctx.allLocationsList.filter((l) => l.active).length > 1;
        const byLoc = multi || ctx.scope !== 'all' ? await stockByLocation(db, sid) : {};
        return json(rows.map((p) => ({
          ...p, image: imageUrl(p), availability: availability(p),
          stock_here: ctx.scope === 'all' ? p.stock : (byLoc[p.id] || {})[ctx.scope] ?? 0,
          ...(multi ? { stock_by_location: byLoc[p.id] || {} } : {}),
        })));
      }
      if (!id && m === 'POST') return json(await createProduct(ctx, await body()), 201);
      if (id && action === 'image' && m === 'PUT') return json(await setProductImage(ctx, id, await body()));
      if (id && action === 'image' && m === 'DELETE') {
        await deleteProductImage(env, db, sid, num(id));
        await db.prepare('UPDATE products SET image_v = 0 WHERE id = ? AND store_id = ?').bind(num(id), sid).run();
        return json({ ok: true });
      }
      if (id && !action && m === 'PUT') return json(await updateProduct(ctx, id, await body()));
      if (id && !action && m === 'DELETE') {
        if (!(await db.prepare('SELECT 1 FROM products WHERE id = ? AND store_id = ?').bind(num(id), sid).first())) throw new HttpError(404, 'Produit introuvable.');
        await deleteProductImage(env, db, sid, num(id));
        await db.prepare('DELETE FROM products WHERE id = ? AND store_id = ?').bind(num(id), sid).run();
        return json({ ok: true });
      }
      break;

    case 'stock':
      if (m === 'GET') {
        const w = scopeWhere(ctx, 's.location_id');
        return json((await db.prepare(`SELECT s.*, p.name AS product_name, p.ref AS product_ref, p.unit AS unit FROM stock_movements s
          LEFT JOIN products p ON p.id = s.product_id AND p.store_id = s.store_id WHERE s.store_id = ?${w.sql} ORDER BY s.id DESC LIMIT 300`).bind(sid, ...w.args).all()).results);
      }
      if (id === 'transfer' && m === 'POST') { const b = await body(); const r = await transferStock(ctx, b); ctx.later?.(stockAlerts(env, sid, [b.product_id], b.from)); return json(r, 201); }
      if (!id && m === 'POST') { const b = await body(); const r = await addStockMovement(ctx, b); ctx.later?.(stockAlerts(env, sid, [b.product_id], ctx.location?.id)); return json(r, 201); }
      break;

    case 'push':
      return await pushRoutes(ctx, id, m, body);

    case 'support':
      return await storeSupportRoutes(ctx, id, m, body);

    case 'sync':
      if (!id && m === 'POST') return json(await syncOps(ctx, await body()));
      break;

    case 'import':
      if (id === 'products' && m === 'POST') return json(await importProducts(ctx, await body()));
      if (id === 'images' && m === 'POST') return json(await importImages(ctx, await body()));
      break;

    case 'connect':
      // Connexion directe à l'ancien outil : les clés reçues ne sont ni enregistrées ni journalisées.
      if (id === 'detect' && m === 'POST') { const d = await detectTool((await body()).input); return json({ ...d, label: PROVIDERS[d.provider].label }); }
      if (id === 'fetch' && m === 'POST') return json(await fetchCatalogPage(ctx, await body()));
      break;

    case 'locations':
      if (!id && m === 'GET') return json(await listLocations(ctx));
      if (id === 'report' && m === 'GET') return json(await locationReport(ctx, url.searchParams.get('period')));
      if (!id && m === 'POST') return json(await saveLocation(ctx, null, await body()), 201);
      if (id && m === 'PUT') return json(await saveLocation(ctx, id, await body()));
      break;

    case 'roles':
      if (!id && m === 'GET') return json(await listRoles(ctx));
      if (!id && m === 'POST') return json(await saveRole(ctx, null, await body()), 201);
      if (id && m === 'PUT') return json(await saveRole(ctx, id, await body()));
      if (id && m === 'DELETE') return json(await deleteRole(ctx, id));
      break;

    case 'customers':
      if (!id && m === 'GET') {
        return json((await db.prepare(`SELECT c.*,
            (SELECT COALESCE(SUM(total_ttc), 0) FROM documents d WHERE d.customer_id = c.id AND d.store_id = c.store_id AND ${SALES('d.')}) AS invoiced,
            (SELECT COUNT(*) FROM documents d WHERE d.customer_id = c.id AND d.store_id = c.store_id) AS documents,
            (SELECT COALESCE(SUM(total_ttc - amount_paid), 0) FROM documents d WHERE d.customer_id = c.id AND d.store_id = c.store_id AND d.type = 'facture' AND d.status = 'émise') AS due
          FROM customers c WHERE c.store_id = ? ORDER BY c.name COLLATE NOCASE`).bind(sid).all()).results);
      }
      if (!id && m === 'POST') return json(await createCustomer(ctx, await body()), 201);
      if (id && action === 'loyalty' && m === 'GET') {
        const c = await db.prepare('SELECT id, loyalty_points FROM customers WHERE id = ? AND store_id = ?').bind(num(id), sid).first();
        if (!c) throw new HttpError(404, 'Client introuvable.');
        const moves = (await db.prepare(`SELECT l.*, d.number FROM loyalty_movements l LEFT JOIN documents d ON d.id = l.document_id AND d.store_id = l.store_id
          WHERE l.customer_id = ? AND l.store_id = ? ORDER BY l.id DESC LIMIT 100`).bind(c.id, sid).all()).results;
        return json({ balance: c.loyalty_points || 0, movements: moves, config: await loyaltyConfig(db, sid) });
      }
      if (id && action === 'loyalty' && m === 'POST') {
        const b = await body();
        const pts = Math.round(num(b.points));
        if (!pts) throw new HttpError(400, 'Indiquez un nombre de points (positif ou négatif).');
        const c = await db.prepare('SELECT id, loyalty_points FROM customers WHERE id = ? AND store_id = ?').bind(num(id), sid).first();
        if (!c) throw new HttpError(404, 'Client introuvable.');
        if ((c.loyalty_points || 0) + pts < 0) throw new HttpError(409, 'Le solde de points ne peut pas devenir négatif.');
        await db.batch(loyaltyStmts(db, sid, c.id, null, pts, str(b.reason, 200) || 'Ajustement manuel', ctx.user.id));
        return json({ ok: true, balance: (c.loyalty_points || 0) + pts });
      }
      if (id && m === 'PUT') {
        const f = customerFields(await body());
        await db.prepare('UPDATE customers SET name = ?, company = ?, email = ?, phone = ?, address = ?, notes = ? WHERE id = ? AND store_id = ?').bind(...f, num(id), sid).run();
        return json({ ok: true });
      }
      if (id && m === 'DELETE') {
        await db.batch([
          db.prepare('UPDATE documents SET customer_id = NULL WHERE customer_id = ? AND store_id = ?').bind(num(id), sid),
          db.prepare('DELETE FROM customers WHERE id = ? AND store_id = ?').bind(num(id), sid),
        ]);
        return json({ ok: true });
      }
      break;

    case 'documents':
      if (!id && m === 'GET') {
        const type = url.searchParams.get('type');
        const w = scopeWhere(ctx);
        const stmt = PREFIX[type]
          ? db.prepare(`SELECT * FROM documents WHERE store_id = ? AND type = ?${w.sql} ORDER BY date DESC, id DESC LIMIT 2000`).bind(sid, type, ...w.args)
          : db.prepare(`SELECT * FROM documents WHERE store_id = ?${w.sql} ORDER BY date DESC, id DESC LIMIT 2000`).bind(sid, ...w.args);
        return json((await stmt.all()).results);
      }
      if (!id && m === 'POST') {
        const b = await body();
        if (b.type === 'ticket') throw new HttpError(400, 'Les tickets se créent depuis la caisse.');
        return json(await createDocument(ctx, { ...b, origin: 'admin', source_id: null, source_type: null }), 201);
      }
      if (id && !action && m === 'GET') return json(await getDocument(db, sid, id));
      if (id && !action && m === 'PUT') return json(await updateDocument(ctx, id, await body()));
      if (id && !action && m === 'DELETE') return json(await deleteDocument(ctx, id));
      if (id && action === 'status' && m === 'POST') return json(await setStatus(ctx, id, (await body()).status));
      if (id && action === 'convert' && m === 'POST') return json(await convertDocument(ctx, id, (await body()).to), 201);
      if (id && action === 'payments' && m === 'POST') return json(await addPayment(ctx, id, await body()), 201);
      if (id && action === 'remind' && m === 'POST') {
        const doc = await getDocument(db, sid, id);
        if (doc.type !== 'facture' || doc.status !== 'émise') throw new HttpError(409, 'Seule une facture à payer peut être relancée.');
        await db.prepare('UPDATE documents SET reminders = reminders + 1, last_reminder_at = ? WHERE id = ? AND store_id = ?').bind(today(), doc.id, sid).run();
        return json(await getDocument(db, sid, doc.id));
      }
      break;

    case 'payments':
      if (id && m === 'DELETE') {
        const pay = await db.prepare('SELECT document_id FROM payments WHERE id = ? AND store_id = ?').bind(num(id), sid).first();
        if (!pay) throw new HttpError(404, 'Paiement introuvable.');
        const doc = await getDocument(db, sid, pay.document_id);
        if (doc.type !== 'facture') throw new HttpError(409, 'Les paiements de caisse se corrigent en annulant le ticket.');
        await db.prepare('DELETE FROM payments WHERE id = ? AND store_id = ?').bind(num(id), sid).run();
        await refreshPaid(db, sid, pay.document_id);
        return json(await getDocument(db, sid, pay.document_id));
      }
      break;

    case 'pos':
      if (id === 'checkout' && m === 'POST') {
        const b = await body(); const r = await posCheckout(ctx, b);
        ctx.later?.(stockAlerts(env, sid, (b.lines || []).map((l) => l.product_id), ctx.location?.id));
        return json(r, 201);
      }
      if (id === 'journal' && m === 'GET') return json(await posJournal(db, sid, url.searchParams.get('date'), ctx));
      break;

    case 'alerts':
      if (!id && m === 'GET') return json(await computeAlerts(db, sid, await getSettings(db, sid, ctx.store)));
      if (id === 'test-email' && m === 'POST') {
        const settings = await getSettings(db, sid, ctx.store);
        const to = settings.alert_email || ctx.user.email;
        const { subject, html } = digestEmail(await computeAlerts(db, sid, settings), settings, url.origin);
        await sendEmail(env, to, subject, html);
        return json({ ok: true, to });
      }
      if (id === 'email-status' && m === 'GET') return json({ configured: !!env.RESEND_API_KEY });
      break;

    case 'team':
      if (!id && m === 'GET') return json(await listTeam(db, sid));
      if (!id && m === 'POST') return json(await addMember(ctx, await body()), 201);
      if (id && !action && m === 'PUT') return json(await updateMember(ctx, id, await body()));
      if (id && action === 'reset' && m === 'POST') {
        const mem = await memberOf(db, sid, id);
        if (mem.role === 'owner' && Number(id) !== ctx.user.id) throw new HttpError(403, 'Action impossible sur le propriétaire.');
        const password = tempPassword();
        await db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').bind(await hashPassword(password), num(id)).run();
        await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(num(id)).run();
        return json({ ok: true, temp_password: password });
      }
      if (id && m === 'DELETE') {
        const mem = await memberOf(db, sid, id);
        if (mem.role === 'owner') throw new HttpError(403, 'Le propriétaire ne peut pas être retiré.');
        await db.batch([
          db.prepare('DELETE FROM memberships WHERE store_id = ? AND user_id = ?').bind(sid, num(id)),
          db.prepare('DELETE FROM sessions WHERE user_id = ? AND store_id = ?').bind(num(id), sid),
        ]);
        // L'utilisateur n'appartient plus à aucun commerce : son compte est supprimé.
        const other = await db.prepare('SELECT 1 FROM memberships WHERE user_id = ?').bind(num(id)).first();
        if (!other) await db.prepare('DELETE FROM users WHERE id = ?').bind(num(id)).run();
        return json({ ok: true });
      }
      break;

    case 'subscription':
      if (m === 'GET') {
        const [p, u] = await Promise.all([
          db.prepare('SELECT COUNT(*) AS n FROM products WHERE store_id = ?').bind(sid).first(),
          db.prepare('SELECT COUNT(*) AS n FROM memberships WHERE store_id = ?').bind(sid).first(),
        ]);
        return json(subscription(ctx.store, { products: p.n, users: u.n }));
      }
      if (m === 'POST') {
        const plan = (await body()).plan;
        if (!PAID_PLANS.includes(plan)) throw new HttpError(400, 'Formule inconnue.');
        await db.prepare('UPDATE stores SET plan_requested = ? WHERE id = ?').bind(plan, sid).run();
        ctx.later?.(notifyPlatform(env, { title: 'Demande de formule', body: `${ctx.store.name} demande la formule ${PLANS[plan]?.name || plan}.`, url: '/console/#/a-traiter', tag: `formule-${sid}` }));
        await logEvent(db, sid, ctx.user.id, 'plan_request', PLANS[plan].name);
        return json({ ok: true, plan_requested: plan });
      }
      break;
  }
  throw new HttpError(404, 'Route inconnue.');
}

// E-mail d'alertes du matin pour chaque commerce qui l'a activé.
export async function runDailyDigests(env) {
  if (!env.RESEND_API_KEY) return;
  const db = env.DB;
  const rows = (await db.prepare(`SELECT s.store_id FROM settings s JOIN stores st ON st.id = s.store_id
    WHERE s.key = 'alert_digest' AND s.value = '1' AND st.status = 'active'`).all()).results;
  for (const r of rows) {
    try {
      const settings = await getSettings(db, r.store_id);
      if (!settings.alert_email) continue;
      const alerts = await computeAlerts(db, r.store_id, settings);
      if (!alerts.totals.count) continue;
      const { subject, html } = digestEmail(alerts, settings, env.APP_URL || '');
      await sendEmail(env, settings.alert_email, subject, html);
    } catch (e) { console.error('Alertes', r.store_id, e.message); }
  }
}
