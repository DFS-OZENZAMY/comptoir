// Ticket et facture numériques : un lien secret par document, à envoyer au client par WhatsApp, SMS ou e-mail.
// La page /r/<jeton> montre le document comme le ticket imprimé (mentions légales comprises), sans compte.
// Jeton de 128 bits : impossible à deviner. Jamais indexé par les moteurs de recherche.
import { HttpError, json } from '../core/lib.js';
import { getSettings } from './store.js';

const SHAREABLE = ['ticket', 'facture', 'devis', 'avoir', 'commande'];
const LABEL = { ticket: 'Ticket', facture: 'Facture', devis: 'Devis', avoir: 'Avoir', commande: 'Commande' };
// Fuseau horaire du commerce, d'après son pays (l'heure affichée au client est celle de la boutique).
const TZ = { MA: 'Africa/Casablanca', DZ: 'Africa/Algiers', TN: 'Africa/Tunis', SN: 'Africa/Dakar', ML: 'Africa/Bamako', GN: 'Africa/Conakry', CI: 'Africa/Abidjan',
  BF: 'Africa/Ouagadougou', NE: 'Africa/Niamey', TG: 'Africa/Lome', BJ: 'Africa/Porto-Novo', CM: 'Africa/Douala', GA: 'Africa/Libreville', CG: 'Africa/Brazzaville',
  CD: 'Africa/Kinshasa', MG: 'Indian/Antananarivo', FR: 'Europe/Paris', BE: 'Europe/Brussels', CH: 'Europe/Zurich', LU: 'Europe/Luxembourg', CA: 'America/Toronto' };
const e = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const token = () => { const b = crypto.getRandomValues(new Uint8Array(16)); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

// POST /api/store/documents/:id/share → { url } (le même lien à chaque fois pour un document donné).
export async function shareDocument(ctx, id) {
  const { db } = ctx; const sid = ctx.store.id;
  const doc = await db.prepare('SELECT id, type, share_token FROM documents WHERE id = ? AND store_id = ?').bind(Number(id), sid).first();
  if (!doc) throw new HttpError(404, 'Document introuvable.');
  if (!SHAREABLE.includes(doc.type)) throw new HttpError(400, 'Ce document ne peut pas être partagé.');
  if (!doc.share_token) await db.prepare('UPDATE documents SET share_token = ? WHERE id = ? AND share_token IS NULL').bind(token(), doc.id).run();
  const t = (await db.prepare('SELECT share_token FROM documents WHERE id = ?').bind(doc.id).first()).share_token;
  const origin = ctx.env.APP_URL ? new URL(ctx.env.APP_URL).origin : new URL(ctx.request.url).origin;
  return json({ url: `${origin}/r/${t}` });
}

// GET /r/:jeton : la page du document.
export async function renderReceipt(env, request, t) {
  const db = env.DB;
  const notFound = () => page('Document introuvable', '<main class="card empty"><h1>Document introuvable</h1><p>Ce lien n’existe pas ou n’est plus valable. Demandez au commerce de vous le renvoyer.</p></main>', 404);
  if (!/^[A-Za-z0-9_-]{20,30}$/.test(t)) return notFound();
  const d = await db.prepare(`SELECT d.*, s.slug, s.name AS store_name, s.status AS store_status, s.country FROM documents d JOIN stores s ON s.id = d.store_id WHERE d.share_token = ?`).bind(t).first();
  if (!d) return renderPurchaseOrder(env, t, notFound);
  if (d.store_status === 'suspended') return notFound();
  const s = await getSettings(db, d.store_id);
  const lines = (await db.prepare('SELECT label, qty, unit_price_ht, tva_rate FROM document_lines WHERE document_id = ? ORDER BY position, id').bind(d.id).all()).results;
  const pays = (await db.prepare("SELECT method, amount FROM payments WHERE document_id = ? AND amount > 0 ORDER BY id").bind(d.id).all()).results;
  const cur = s.currency || '€';
  const nf = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n) => `${nf.format(n)} ${cur}`;
  const qty = (n) => String(Math.round(n * 1000) / 1000).replace('.', ',');
  const when = new Date(String(d.created_at || d.date).replace(' ', 'T') + (String(d.created_at).includes('Z') ? '' : 'Z'));
  const byRate = {};
  for (const l of lines) { const h = l.qty * l.unit_price_ht; (byRate[l.tva_rate] ||= { ht: 0, tva: 0 }); byRate[l.tva_rate].ht += h; byRate[l.tva_rate].tva += (h * l.tva_rate) / 100; }
  const shop = s.shop_name || d.store_name;
  const cancelled = ['annulé', 'annulée'].includes(d.status);
  const body = `
  <main class="card">
    <header><h1>${e(shop)}</h1><p>${[s.address, s.phone].filter(Boolean).map(e).join('<br>')}</p></header>
    <div class="meta"><strong>${e(LABEL[d.type] || 'Document')} ${e(d.number)}</strong>
      <span>${when.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ[d.country] || 'UTC' })}, ${when.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ[d.country] || 'UTC' })}</span>
      ${d.client_name && d.client_name !== 'Client comptoir' ? `<span>Client : ${e(d.client_name)}</span>` : ''}</div>
    ${cancelled ? '<p class="cancel">Document annulé</p>' : ''}
    <table class="lines"><tbody>${lines.map((l) => {
      const ttc = l.unit_price_ht * (1 + l.tva_rate / 100);
      return l.unit_price_ht < 0 ? `<tr class="disc"><td>${e(l.label)}</td><td>${money(l.qty * ttc)}</td></tr>`
        : `<tr><td>${e(l.label)}<small>${qty(l.qty)} × ${money(ttc)}</small></td><td>${money(l.qty * ttc)}</td></tr>`;
    }).join('')}</tbody></table>
    <table class="total"><tr><td>Total TTC</td><td>${money(d.total_ttc)}</td></tr></table>
    ${pays.length ? `<table class="small"><tbody>${pays.map((p) => `<tr><td>${e(p.method.charAt(0).toUpperCase() + p.method.slice(1))}</td><td>${money(p.amount)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${d.type === 'facture' && d.total_ttc - (d.amount_paid || 0) > 0.005 && !cancelled ? `<p class="due">Reste à payer : <strong>${money(d.total_ttc - (d.amount_paid || 0))}</strong>${d.due_date ? `, avant le ${new Date(d.due_date + 'T00:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'UTC' })}` : ''}</p>` : ''}
    <table class="small vat"><tbody>${Object.entries(byRate).map(([r, v]) => `<tr><td>TVA ${e(r)} % sur ${money(v.ht)}</td><td>${money(v.tva)}</td></tr>`).join('')}</tbody></table>
    <footer><p>${e(s.doc_footer || 'Merci de votre visite')}</p>${s.legal_info ? `<small>${e(s.legal_info)}</small>` : ''}</footer>
  </main>
  <nav class="actions"><button type="button" onclick="window.print()">Imprimer ou enregistrer en PDF</button>${d.slug ? `<a href="/s/${e(d.slug)}">Voir la boutique en ligne</a>` : ''}</nav>
  <p class="brand"><a href="/?utm_source=ticket&amp;utm_medium=lien">Ticket envoyé avec Comptoir</a>, la caisse des commerces de proximité</p>`;
  return page(`${LABEL[d.type] || 'Document'} ${d.number} · ${shop}`, body, 200);
}

// Bon de commande envoyé au fournisseur : ce qu'il doit livrer, où et quand.
async function renderPurchaseOrder(env, t, notFound) {
  const db = env.DB;
  const o = await db.prepare(`SELECT o.*, st.name AS store_name, st.status AS store_status, st.country, su.name AS supplier_name, su.contact AS supplier_contact,
      l.name AS location_name FROM purchase_orders o JOIN stores st ON st.id = o.store_id LEFT JOIN suppliers su ON su.id = o.supplier_id
      LEFT JOIN locations l ON l.id = o.location_id WHERE o.share_token = ?`).bind(t).first();
  if (!o || o.store_status === 'suspended') return notFound();
  const s = await getSettings(db, o.store_id);
  const lines = (await db.prepare(`SELECT pl.label, pl.qty, pl.unit_cost, p.ref, p.barcode, p.unit FROM purchase_lines pl LEFT JOIN products p ON p.id = pl.product_id
      WHERE pl.order_id = ? ORDER BY pl.position, pl.id`).bind(o.id).all()).results;
  const cur = s.currency || '€';
  const nf = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n) => `${nf.format(n)} ${cur}`;
  const qty = (n) => String(Math.round(n * 1000) / 1000).replace('.', ',');
  const unitFor = (n, unit) => { const u = String(unit || '').trim(); return Number(n) >= 2 && /^[a-zàâäéèêëîïôöûüç]{3,}$/i.test(u) && !/[sxz]$/i.test(u) && !/^(kg|ml|cl|cm|mm)$/i.test(u) ? `${u}${/au$|eu$/i.test(u) ? 'x' : 's'}` : u; };
  const multi = (await db.prepare('SELECT COUNT(*) AS n FROM locations WHERE store_id = ?').bind(o.store_id).first()).n > 1;
  const shop = s.shop_name || o.store_name;
  const when = (iso) => new Date(String(iso).replace(' ', 'T') + (String(iso).length === 10 ? 'T00:00:00Z' : 'Z')).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ[o.country] || 'UTC' });
  const closed = o.status === 'annulé';
  const body = `
  <main class="card wide">
    <header><h1>Bon de commande <span class="nw">${e(o.number)}</span></h1><p>${e(shop)}${s.address ? `<br>${e(s.address)}` : ''}${s.phone ? `<br>${e(s.phone)}` : ''}</p></header>
    <div class="meta"><strong>Fournisseur : ${e(o.supplier_name || '')}${o.supplier_contact ? ` (${e(o.supplier_contact)})` : ''}</strong>
      <span>Commandé le ${when(o.sent_at || o.created_at)}${o.expected_date ? ` · livraison souhaitée le ${when(o.expected_date)}` : ''}</span>
      ${o.location_name && multi ? `<span>Livraison : ${e(o.location_name)}</span>` : ''}</div>
    ${closed ? '<p class="cancel">Bon de commande annulé</p>' : ''}
    <table class="lines po"><thead><tr><th>Article</th><th>Qté</th><th>Prix HT</th><th>Total HT</th></tr></thead><tbody>${lines.map((l) => `<tr><td>${e(l.label)}${l.ref || l.barcode ? `<small>${[l.ref, l.barcode].filter(Boolean).map(e).join(' · ')}</small>` : ''}</td><td>${qty(l.qty)} ${e(unitFor(l.qty, l.unit))}</td><td>${money(l.unit_cost)}</td><td>${money(l.qty * l.unit_cost)}</td></tr>`).join('')}</tbody></table>
    <table class="total"><tr><td>Total HT</td><td>${money(o.total_ht)}</td></tr></table>
    ${o.notes ? `<p class="due">${e(o.notes)}</p>` : ''}
    <footer>${s.legal_info ? `<small>${e(s.legal_info)}</small>` : ''}</footer>
  </main>
  <nav class="actions"><button type="button" onclick="window.print()">Imprimer ou enregistrer en PDF</button></nav>
  <p class="brand"><a href="/?utm_source=bon-de-commande&amp;utm_medium=lien">Bon de commande envoyé avec Comptoir</a>, la caisse des commerces de proximité</p>`;
  return page(`Bon de commande ${o.number} · ${shop}`, body, 200);
}

function page(title, body, status) {
  return new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title><meta name="robots" content="noindex, nofollow"><meta name="theme-color" content="#17181C"><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<style>
:root{--ink:#17181C;--muted:#5D616A;--line:#E3E3DF;--zinc:#F4F4F1;--signal:#C9461F}
*{box-sizing:border-box}body{margin:0;padding:24px 14px 40px;background:var(--zinc);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
.card{max-width:440px;margin:0 auto;background:#fff;border:1px solid var(--line);border-radius:16px;padding:24px 22px}
header{text-align:center;border-bottom:1px dashed var(--line);padding-bottom:14px}h1{font-size:1.35rem;margin:0 0 4px}header p{margin:0;color:var(--muted);font-size:.9rem}
.meta{display:grid;gap:2px;padding:14px 0;border-bottom:1px dashed var(--line);font-size:.92rem}.meta span{color:var(--muted)}
table{width:100%;border-collapse:collapse}td{padding:6px 0;vertical-align:top}td:last-child{text-align:right;white-space:nowrap;padding-left:12px;font-variant-numeric:tabular-nums}
.lines td small{display:block;color:var(--muted);font-size:.82rem}.lines{border-bottom:1px dashed var(--line)}.disc td{color:var(--signal)}
.total td{font-size:1.25rem;font-weight:800;padding:12px 0}.small td{font-size:.86rem;color:var(--muted);padding:3px 0}.vat{border-top:1px dashed var(--line);margin-top:8px;padding-top:6px}
.cancel{margin:10px 0 0;padding:8px;border-radius:8px;background:#FBE7E4;color:#8A2A14;text-align:center;font-weight:700}
.due{margin:8px 0;padding:10px 12px;border-radius:10px;background:#FBF0D9;color:#6E4B08}
footer{text-align:center;border-top:1px dashed var(--line);margin-top:12px;padding-top:12px;color:var(--muted);font-size:.88rem}footer p{margin:0 0 4px}
.actions{max-width:440px;margin:16px auto 0;display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.actions button,.actions a{border:1px solid var(--line);background:#fff;color:var(--ink);padding:11px 16px;border-radius:999px;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
.actions button{background:var(--ink);color:#fff;border-color:var(--ink)}
.brand{text-align:center;color:var(--muted);font-size:.8rem;margin-top:22px}.brand a{color:var(--ink);font-weight:600}
.empty{text-align:center}.nw{white-space:nowrap}.card.wide{max-width:720px}.po th{text-align:left;font-size:.8rem;color:var(--muted);font-weight:600;padding:6px 0;border-bottom:1px solid var(--line)}.po th:not(:first-child),.po td:not(:first-child){text-align:right;white-space:nowrap;padding-left:12px}
@media print{body{background:#fff;padding:0}.card{border:0;max-width:none}.actions,.brand{display:none}}
</style></head><body>${body}</body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' } });
}
