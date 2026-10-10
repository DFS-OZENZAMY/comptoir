// Connexion directe aux logiciels en ligne (Loyverse, Square, Shopify, WooCommerce, Odoo) :
// détection de l'outil, puis récupération du catalogue page par page, en lecture seule.
// Les clés d'accès ne sont JAMAIS enregistrées ni journalisées : elles servent le temps d'une requête.
import { HttpError, str } from './lib.js';

const UA = 'Comptoir-Import/1.0';
const SQUARE_VERSION = '2024-10-17';
const SHOPIFY_VERSION = '2025-01';
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'XOF', 'XAF', 'CLP', 'VND', 'GNF', 'RWF', 'UGX', 'KMF', 'DJF', 'BIF', 'PYG', 'XPF', 'VUV', 'MGA']);

export const PROVIDERS = {
  loyverse: { label: 'Loyverse', fields: ['token'], prices: 'ttc' },
  square: { label: 'Square', fields: ['token'], prices: 'ttc' },
  shopify: { label: 'Shopify', fields: ['shop', 'token|client'], prices: 'ttc' },
  woocommerce: { label: 'WooCommerce', fields: ['site', 'key', 'secret'], prices: 'ttc' },
  odoo: { label: 'Odoo', fields: ['site', 'db', 'login', 'key'], prices: 'ht' },
};

// Adresse saisie par le commerçant : https uniquement, jamais une adresse interne.
function safeUrl(raw) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(String(raw).trim()) ? String(raw).trim() : `https://${String(raw).trim()}`); }
  catch { throw new HttpError(400, 'Adresse invalide.'); }
  if (u.protocol !== 'https:') throw new HttpError(400, 'L’adresse doit commencer par https://.');
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || /^(localhost|.*\.local|.*\.internal|.*\.lan)$/.test(h) || /^[\d.]+$/.test(h) || h.includes(':') || u.port) {
    throw new HttpError(400, 'Cette adresse n’est pas autorisée.');
  }
  return u;
}

async function call(url, init, label) {
  let res;
  try { res = await fetch(url, { ...init, headers: { 'user-agent': UA, accept: 'application/json', ...(init?.headers || {}) }, signal: AbortSignal.timeout(25000) }); }
  catch { throw new HttpError(502, `${label} ne répond pas. Vérifiez l’adresse et réessayez.`); }
  if (res.status === 401 || res.status === 403) throw new HttpError(400, `${label} refuse la clé d’accès : vérifiez-la, ainsi que son autorisation de lecture des produits.`);
  if (res.status === 404) throw new HttpError(400, `${label} : adresse introuvable. Vérifiez l’adresse de la boutique.`);
  if (res.status === 429) throw new HttpError(429, `${label} limite le nombre de demandes : patientez une minute puis reprenez.`);
  if (!res.ok) throw new HttpError(502, `${label} a renvoyé une erreur (${res.status}).`);
  const data = await res.json().catch(() => null);
  if (data === null) throw new HttpError(502, `${label} a renvoyé une réponse illisible.`);
  return { data, res };
}

const enc = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
const dec = (s) => { try { return s ? JSON.parse(decodeURIComponent(escape(atob(s)))) : null; } catch { return null; } };
const money = (amount, currency) => (amount == null ? '' : ZERO_DECIMAL.has(currency) ? Number(amount) : Number(amount) / 100);

// Feuille commune à tous les outils : l'assistant d'import la lit comme un fichier.
function sheet(locations, rows, prices) {
  const qty = locations.length === 1 ? ['Quantité'] : locations.map((l) => `Quantité ${l}`);
  return {
    headers: ['Nom', 'Variante', 'Référence', 'Code-barres', 'Catégorie', prices === 'ht' ? 'Prix de vente HT' : 'Prix de vente TTC', 'Prix d’achat', 'TVA', 'Seuil d’alerte', 'Unité', 'Description', 'Photo', ...qty],
    rows: rows.map((r) => [r.name, r.variant || '', r.ref || '', r.barcode || '', r.category || '', r.price ?? '', r.cost ?? '', r.tva ?? '', r.min ?? '', r.unit || '', r.description || '', r.photo || '', ...locations.map((l) => (r.qty && r.qty[l] !== undefined ? r.qty[l] : ''))]),
  };
}
const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 4000);

/* ------------------------------------------------------------------ */
/* Détection de l'outil                                                */
/* ------------------------------------------------------------------ */
export async function detectTool(input) {
  const v = String(input || '').trim();
  if (!v) throw new HttpError(400, 'Collez l’adresse de votre boutique ou votre clé d’accès.');
  // Par la clé d'accès : chaque éditeur a son format.
  if (/^shp(at|ca|ss)_[a-f0-9]{20,}$/i.test(v)) return { provider: 'shopify', from: 'key', values: { token: v } };
  if (/^EAAA[A-Za-z0-9_-]{20,}$/.test(v)) return { provider: 'square', from: 'key', values: { token: v } };
  if (/^ck_[a-f0-9]{30,}$/i.test(v)) return { provider: 'woocommerce', from: 'key', values: { key: v } };
  if (/^[a-f0-9]{32}$/i.test(v)) return { provider: 'loyverse', from: 'key', values: { token: v } };
  if (/^[a-f0-9]{40}$/i.test(v)) return { provider: 'odoo', from: 'key', values: { key: v } };
  // Par l'adresse : la page d'accueil de la boutique trahit l'outil qui la fait tourner.
  const u = safeUrl(v);
  const host = u.hostname.toLowerCase();
  if (host.endsWith('.myshopify.com')) return { provider: 'shopify', from: 'site', values: { shop: host } };
  if (host.endsWith('.odoo.com')) return { provider: 'odoo', from: 'site', values: { site: u.origin, db: host.split('.')[0] } };
  if (/\.(square\.site|squareup\.com)$/.test(host)) return { provider: 'square', from: 'site', values: {} };
  let html = '', headers = new Headers();
  try {
    const res = await fetch(u.origin + '/', { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    headers = res.headers;
    const reader = res.body?.getReader(); let size = 0; const parts = []; const td = new TextDecoder();
    while (reader) { const { done, value } = await reader.read(); if (done) break; size += value.length; parts.push(td.decode(value, { stream: true })); if (size > 600000) { reader.cancel(); break; } }
    html = parts.join('');
  } catch { throw new HttpError(502, 'Ce site ne répond pas : vérifiez l’adresse.'); }
  const shopMatch = html.match(/["']([a-z0-9][a-z0-9-]*\.myshopify\.com)["']/i);
  if (headers.get('x-shopid') || headers.get('powered-by') === 'Shopify' || /cdn\.shopify\.com|Shopify\.theme/.test(html)) {
    return { provider: 'shopify', from: 'site', values: shopMatch ? { shop: shopMatch[1].toLowerCase() } : {} };
  }
  if (/wp-content\/plugins\/woocommerce|woocommerce-no-js|wc-block|class="woocommerce/i.test(html)) return { provider: 'woocommerce', from: 'site', values: { site: u.origin } };
  if (/<meta name="generator" content="Odoo|\/web\/assets\/|odoo\.__session_info__/i.test(html)) return { provider: 'odoo', from: 'site', values: { site: u.origin } };
  if (/editmysite\.com|square\.site|squarecdn/i.test(html)) return { provider: 'square', from: 'site', values: {} };
  throw new HttpError(404, 'Je n’ai pas reconnu l’outil derrière ce site. Choisissez votre logiciel dans la liste, ou importez un fichier.');
}

/* ------------------------------------------------------------------ */
/* Loyverse                                                            */
/* ------------------------------------------------------------------ */
async function loyverse(creds, st) {
  const token = str(creds.token, 100); if (!token) throw new HttpError(400, 'Collez votre jeton d’accès Loyverse.');
  const H = { headers: { authorization: `Bearer ${token}` } }; const base = 'https://api.loyverse.com/v1.0';
  if (!st) {
    const [stores, cats] = await Promise.all([call(`${base}/stores`, H, 'Loyverse'), call(`${base}/categories?limit=250`, H, 'Loyverse')]);
    st = { stores: (stores.data.stores || []).map((s) => [s.id, s.name]), cats: Object.fromEntries((cats.data.categories || []).map((c) => [c.id, c.name])), cursor: null };
  }
  const q = new URLSearchParams({ limit: '100' }); if (st.cursor) q.set('cursor', st.cursor);
  const items = (await call(`${base}/items?${q}`, H, 'Loyverse')).data;
  const list = (items.items || []).filter((i) => !i.deleted_at);
  const varIds = list.flatMap((i) => (i.variants || []).map((v) => v.variant_id));
  const levels = {};
  for (let k = 0; k < varIds.length; k += 200) {
    const inv = (await call(`${base}/inventory?limit=250&variant_ids=${varIds.slice(k, k + 200).join(',')}`, H, 'Loyverse')).data;
    for (const l of inv.inventory_levels || []) levels[`${l.variant_id}|${l.store_id}`] = l.in_stock;
  }
  const storeNames = st.stores.map((s) => s[1]);
  const rows = [];
  for (const it of list) for (const v of it.variants || []) {
    const qty = {}; for (const [sid, sname] of st.stores) if (levels[`${v.variant_id}|${sid}`] !== undefined) qty[sname] = levels[`${v.variant_id}|${sid}`];
    const firstStore = (v.stores || [])[0] || {};
    rows.push({
      name: it.item_name, variant: [v.option1_value, v.option2_value, v.option3_value].filter(Boolean).join(' '), ref: v.sku, barcode: v.barcode,
      category: st.cats[it.category_id] || '', price: v.default_price ?? firstStore.price ?? '', cost: v.cost ?? v.purchase_cost ?? '',
      min: firstStore.low_stock ?? '', unit: it.sold_by_weight ? 'kg' : '', description: strip(it.description), photo: it.image_url || '', qty: it.track_stock === false ? {} : qty,
    });
  }
  st.cursor = items.cursor || null;
  return { ...sheet(storeNames.length ? storeNames : ['Stock'], rows, 'ttc'), next: st.cursor ? enc(st) : null };
}

/* ------------------------------------------------------------------ */
/* Square                                                              */
/* ------------------------------------------------------------------ */
async function square(creds, st) {
  const token = str(creds.token, 200); if (!token) throw new HttpError(400, 'Collez votre jeton d’accès Square.');
  const H = { 'square-version': SQUARE_VERSION, authorization: `Bearer ${token}`, 'content-type': 'application/json' }; const base = 'https://connect.squareup.com/v2';
  if (!st) {
    const locs = (await call(`${base}/locations`, { headers: H }, 'Square')).data.locations || [];
    const cats = {}; let c = null, n = 0;
    do { const r = (await call(`${base}/catalog/list?types=CATEGORY${c ? `&cursor=${encodeURIComponent(c)}` : ''}`, { headers: H }, 'Square')).data; for (const o of r.objects || []) cats[o.id] = o.category_data?.name; c = r.cursor; n++; } while (c && n < 5);
    st = { locs: locs.filter((l) => l.status !== 'INACTIVE').map((l) => [l.id, l.name]), cats, cursor: null };
  }
  const r = (await call(`${base}/catalog/list?types=ITEM${st.cursor ? `&cursor=${encodeURIComponent(st.cursor)}` : ''}`, { headers: H }, 'Square')).data;
  const items = (r.objects || []).filter((o) => !o.is_deleted && !o.item_data?.is_archived);
  const vars = items.flatMap((o) => (o.item_data?.variations || []).filter((v) => !v.is_deleted));
  const counts = {};
  if (vars.length) {
    let c = null, n = 0;
    do {
      const body = { catalog_object_ids: vars.map((v) => v.id).slice(0, 1000), states: ['IN_STOCK'], ...(c ? { cursor: c } : {}) };
      const inv = (await call(`${base}/inventory/counts/batch-retrieve`, { method: 'POST', headers: H, body: JSON.stringify(body) }, 'Square')).data;
      for (const x of inv.counts || []) counts[`${x.catalog_object_id}|${x.location_id}`] = Number(x.quantity);
      c = inv.cursor; n++;
    } while (c && n < 4);
  }
  const imageIds = [...new Set(items.map((o) => (o.item_data?.image_ids || [])[0]).filter(Boolean))];
  const images = {};
  if (imageIds.length) {
    const im = (await call(`${base}/catalog/batch-retrieve`, { method: 'POST', headers: H, body: JSON.stringify({ object_ids: imageIds }) }, 'Square')).data;
    for (const o of im.objects || []) images[o.id] = o.image_data?.url;
  }
  const rows = [];
  for (const o of items) {
    const d = o.item_data || {};
    const cat = st.cats[(d.categories || [])[0]?.id || d.category_id] || '';
    for (const v of (d.variations || []).filter((x) => !x.is_deleted)) {
      const vd = v.item_variation_data || {}; const qty = {};
      for (const [lid, lname] of st.locs) if (counts[`${v.id}|${lid}`] !== undefined) qty[lname] = counts[`${v.id}|${lid}`];
      rows.push({ name: d.name, variant: vd.name, ref: vd.sku, barcode: vd.upc, category: cat, price: money(vd.price_money?.amount, vd.price_money?.currency),
        description: strip(d.description_html || d.description), photo: images[(d.image_ids || [])[0]] || '', qty });
    }
  }
  st.cursor = r.cursor || null;
  return { ...sheet(st.locs.length ? st.locs.map((l) => l[1]) : ['Stock'], rows, 'ttc'), next: st.cursor ? enc(st) : null };
}

/* ------------------------------------------------------------------ */
/* Shopify (GraphQL Admin API)                                         */
/* ------------------------------------------------------------------ */
function shopHost(raw) {
  let s = String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (s && !s.includes('.')) s += '.myshopify.com';
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) throw new HttpError(400, 'Indiquez l’adresse « votre-boutique.myshopify.com » (visible dans l’administration Shopify).');
  return s;
}
async function shopifyToken(shop, creds) {
  if (creds.token) return str(creds.token, 200);
  if (!creds.client_id || !creds.client_secret) throw new HttpError(400, 'Collez le jeton d’accès (shpat_…) ou l’identifiant et le secret client de votre application Shopify.');
  // Applications créées dans le Dev Dashboard : jeton obtenu par « client credentials ».
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: str(creds.client_id, 200), client_secret: str(creds.client_secret, 200) });
  const r = await call(`https://${shop}/admin/oauth/access_token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }, 'Shopify');
  if (!r.data.access_token) throw new HttpError(400, 'Shopify n’a pas délivré de jeton : vérifiez l’identifiant et le secret client.');
  return r.data.access_token;
}
async function shopify(creds, st) {
  const shop = shopHost(creds.shop);
  const token = await shopifyToken(shop, creds);
  st = st || { cursor: null };
  const query = `query($c: String) { products(first: 25, after: $c) { pageInfo { hasNextPage endCursor } nodes { title status descriptionHtml productType category { name }
    featuredMedia { preview { image { url } } } variants(first: 25) { nodes { title sku barcode price inventoryQuantity inventoryItem { unitCost { amount } tracked } } } } } }`;
  const { data } = await call(`https://${shop}/admin/api/${SHOPIFY_VERSION}/graphql.json`, { method: 'POST', headers: { 'x-shopify-access-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables: { c: st.cursor } }) }, 'Shopify');
  if (data.errors) throw new HttpError(400, `Shopify : ${String(data.errors[0]?.message || 'demande refusée').slice(0, 160)}. Vérifiez que l’application a l’autorisation « read_products ».`);
  const p = data.data.products;
  const rows = [];
  for (const n of p.nodes) {
    if (n.status === 'ARCHIVED') continue;
    for (const v of n.variants.nodes) {
      rows.push({ name: n.title, variant: v.title === 'Default Title' ? '' : v.title, ref: v.sku, barcode: v.barcode, category: n.category?.name || n.productType || '',
        price: v.price, cost: v.inventoryItem?.unitCost?.amount ?? '', description: strip(n.descriptionHtml),
        photo: n.featuredMedia?.preview?.image?.url || '', qty: v.inventoryItem?.tracked === false ? {} : { Stock: v.inventoryQuantity } });
    }
  }
  st.cursor = p.pageInfo.hasNextPage ? p.pageInfo.endCursor : null;
  return { ...sheet(['Stock'], rows, 'ttc'), next: st.cursor ? enc(st) : null };
}

/* ------------------------------------------------------------------ */
/* WooCommerce (REST API v3)                                           */
/* ------------------------------------------------------------------ */
async function woocommerce(creds, st) {
  const site = safeUrl(creds.site).origin;
  const key = str(creds.key, 100), secret = str(creds.secret, 100);
  if (!/^ck_/.test(key) || !/^cs_/.test(secret)) throw new HttpError(400, 'Collez la clé client (ck_…) et le secret client (cs_…) créés dans WooCommerce.');
  const H = { headers: { authorization: `Basic ${btoa(`${key}:${secret}`)}` } };
  st = st || { page: 1 };
  const { data, res } = await call(`${site}/wp-json/wc/v3/products?per_page=25&page=${st.page}&status=publish`, H, 'WooCommerce');
  const rows = [];
  for (const p of data) {
    const base = { category: (p.categories || [])[0]?.name || '', description: strip(p.short_description || p.description), photo: (p.images || [])[0]?.src || '' };
    if (p.type === 'variable') {
      const vars = (await call(`${site}/wp-json/wc/v3/products/${p.id}/variations?per_page=100`, H, 'WooCommerce')).data;
      for (const v of vars) rows.push({ ...base, name: p.name, variant: (v.attributes || []).map((a) => a.option).join(' '), ref: v.sku, barcode: v.global_unique_id || '',
        price: v.regular_price || v.price, min: v.low_stock_amount ?? '', photo: v.image?.src || base.photo, qty: v.manage_stock ? { Stock: v.stock_quantity } : {} });
    } else if (p.type === 'simple') {
      rows.push({ ...base, name: p.name, ref: p.sku, barcode: p.global_unique_id || '', price: p.regular_price || p.price, min: p.low_stock_amount ?? '', qty: p.manage_stock ? { Stock: p.stock_quantity } : {} });
    }
  }
  const pages = Number(res.headers.get('x-wp-totalpages') || 1);
  st.page += 1;
  return { ...sheet(['Stock'], rows, 'ttc'), next: st.page <= pages ? enc(st) : null };
}

/* ------------------------------------------------------------------ */
/* Odoo (JSON-RPC)                                                     */
/* ------------------------------------------------------------------ */
async function odoo(creds, st) {
  const site = safeUrl(creds.site).origin;
  const db = str(creds.db, 100) || (new URL(site).hostname.endsWith('.odoo.com') ? new URL(site).hostname.split('.')[0] : '');
  const login = str(creds.login, 200), key = str(creds.key, 200);
  if (!db || !login || !key) throw new HttpError(400, 'Indiquez la base de données, l’identifiant (e-mail) et la clé d’API Odoo.');
  const rpc = async (service, method, args) => {
    const { data } = await call(`${site}/jsonrpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: 1 }) }, 'Odoo');
    if (data.error) throw new HttpError(400, `Odoo : ${String(data.error.data?.message || data.error.message || 'erreur').slice(0, 160)}`);
    return data.result;
  };
  const uid = await rpc('common', 'authenticate', [db, login, key, {}]);
  if (!uid) throw new HttpError(400, 'Odoo refuse la connexion : vérifiez la base, l’identifiant et la clé d’API.');
  st = st || { offset: 0 };
  const LIMIT = 100;
  const fields = ['display_name', 'default_code', 'barcode', 'list_price', 'standard_price', 'categ_id', 'qty_available', 'uom_id', 'description_sale', 'taxes_id', 'type'];
  const list = await rpc('object', 'execute_kw', [db, uid, key, 'product.product', 'search_read', [[['sale_ok', '=', true]]], { fields, limit: LIMIT, offset: st.offset, order: 'id' }]);
  const taxIds = [...new Set(list.flatMap((p) => p.taxes_id || []))];
  const taxes = {};
  if (taxIds.length) for (const t of await rpc('object', 'execute_kw', [db, uid, key, 'account.tax', 'read', [taxIds], { fields: ['amount', 'amount_type'] }])) if (t.amount_type === 'percent') taxes[t.id] = t.amount;
  const rows = list.map((p) => ({
    name: p.display_name, ref: p.default_code || '', barcode: p.barcode || '', category: Array.isArray(p.categ_id) ? String(p.categ_id[1]).split(' / ').pop() : '',
    price: p.list_price, cost: p.standard_price, tva: (p.taxes_id || []).map((t) => taxes[t]).find((x) => x !== undefined) ?? '',
    unit: Array.isArray(p.uom_id) ? String(p.uom_id[1]).replace(/^units?$/i, '').toLowerCase() : '', description: strip(p.description_sale),
    qty: p.type === 'product' || p.type === 'consu' ? { Stock: p.qty_available } : {},
  }));
  st.offset += list.length;
  return { ...sheet(['Stock'], rows, 'ht'), next: list.length === LIMIT ? enc(st) : null };
}

const FETCHERS = { loyverse, square, shopify, woocommerce, odoo };

// Une page du catalogue : la suivante se demande avec « next » (aucune clé n'y figure).
export async function fetchCatalogPage(ctx, b) {
  ctx.need('products.edit');
  const f = FETCHERS[b.provider];
  if (!f) throw new HttpError(400, 'Outil non pris en charge.');
  const out = await f(b.credentials || {}, dec(b.next));
  return { provider: b.provider, label: PROVIDERS[b.provider].label, prices: PROVIDERS[b.provider].prices, ...out };
}

/* ------------------------------------------------------------------ */
/* Photos des produits importés                                        */
/* ------------------------------------------------------------------ */
const norm = (v) => String(v || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
export async function importImages(ctx, b) {
  ctx.need('products.edit');
  const { db } = ctx; const sid = ctx.store.id;
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 12);
  const products = (await db.prepare('SELECT id, ref, barcode, name, image_v FROM products WHERE store_id = ?').bind(sid).all()).results;
  const byB = new Map(), byR = new Map(), byN = new Map();
  for (const p of products) { if (p.barcode) byB.set(p.barcode, p); if (p.ref) byR.set(norm(p.ref), p); byN.set(norm(p.name), p); }
  const report = { saved: 0, skipped: 0, errors: [] };
  for (const it of items) {
    const p = (it.barcode && byB.get(String(it.barcode))) || (it.ref && byR.get(norm(it.ref))) || byN.get(norm(it.name));
    if (!p || (p.image_v && !b.overwrite)) { report.skipped++; continue; }
    try {
      const u = safeUrl(it.url);
      if (u.hostname === 'cdn.shopify.com' && !u.searchParams.has('width')) u.searchParams.set('width', '800');
      let res;
      try { res = await fetch(u.toString(), { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) }); }
      catch { throw new Error('photo inaccessible'); }
      const type = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!res.ok || !/^image\/(jpeg|png|webp)$/.test(type)) throw new Error('format non pris en charge');
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > 1_000_000) throw new Error('photo trop lourde (plus de 1 Mo)');
      let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      await db.batch([
        db.prepare('INSERT OR REPLACE INTO images (product_id, store_id, mime, data) VALUES (?, ?, ?, ?)').bind(p.id, sid, type, btoa(bin)),
        db.prepare('UPDATE products SET image_v = COALESCE(image_v, 0) + 1 WHERE id = ? AND store_id = ?').bind(p.id, sid),
      ]);
      report.saved++;
    } catch (e) { report.errors.push(`${it.name || it.ref} : ${e.message === 'Cette adresse n’est pas autorisée.' ? 'adresse refusée' : e.message}`); }
  }
  return report;
}
