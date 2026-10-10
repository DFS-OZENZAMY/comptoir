// Stockage des fichiers (photos des produits), interchangeable selon l'hébergement.
// Interface commune : put(clé, octets, type), get(clé) → { bytes, type } | null, delete(clé).
//   STORAGE_DRIVER=db  (défaut) : dans la base, comme avant ; aucune configuration.
//   STORAGE_DRIVER=r2  : Cloudflare R2, via la liaison FILES.
//   STORAGE_DRIVER=s3  : tout stockage compatible S3 (AWS S3, MinIO, Scaleway, OVH, Backblaze, Wasabi, R2…).
//   env.STORAGE        : un objet fourni par l'adaptateur (disque local, mémoire pour les tests…).

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (data) => hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}
const uriEncode = (s, slash = true) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%2F/g, slash ? '%2F' : '/');

// Signature AWS Version 4 (en-têtes), en JavaScript standard : fonctionne sur Workers, Node, Deno, Bun.
export async function signV4({ method, url, headers = {}, payloadHash, accessKeyId, secretAccessKey, region, service = 's3', date = new Date() }) {
  const u = new URL(url);
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const h = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), host: u.host, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash };
  const names = Object.keys(h).sort();
  const query = [...u.searchParams.entries()].map(([k, v]) => [uriEncode(k), uriEncode(v)]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
  const canonical = [method, uriEncode(decodeURIComponent(u.pathname), false), query, names.map((n) => `${n}:${h[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(canonical)].join('\n');
  let k = await hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, service, 'aws4_request']) k = await hmac(k, part);
  const signature = hex(await hmac(k, toSign));
  return { ...h, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

export function s3Storage({ endpoint, region = 'auto', bucket, accessKeyId, secretAccessKey, pathStyle }) {
  if (!bucket || !accessKeyId || !secretAccessKey) throw new Error('Stockage S3 : S3_BUCKET, S3_ACCESS_KEY_ID et S3_SECRET_ACCESS_KEY sont requis.');
  const base = endpoint ? endpoint.replace(/\/$/, '') : `https://s3.${region}.amazonaws.com`;
  const style = pathStyle ?? Boolean(endpoint);
  const urlOf = (key) => {
    const path = key.split('/').map((x) => encodeURIComponent(x)).join('/');
    if (style) return `${base}/${bucket}/${path}`;
    const u = new URL(base); u.hostname = `${bucket}.${u.hostname}`; return `${u.origin}/${path}`;
  };
  const send = async (method, key, body, type) => {
    const url = urlOf(key);
    const payloadHash = body ? await sha256(body) : await sha256('');
    const headers = await signV4({ method, url, headers: type ? { 'content-type': type } : {}, payloadHash, accessKeyId, secretAccessKey, region });
    return fetch(url, { method, headers, body });
  };
  return {
    driver: 's3',
    async put(key, bytes, type) { const r = await send('PUT', key, bytes, type); if (!r.ok) throw new Error(`Stockage S3 : écriture refusée (${r.status}).`); },
    async get(key) {
      const r = await send('GET', key);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Stockage S3 : lecture refusée (${r.status}).`);
      return { bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get('content-type') || 'application/octet-stream' };
    },
    async delete(key) { const r = await send('DELETE', key); if (!r.ok && r.status !== 404) throw new Error(`Stockage S3 : suppression refusée (${r.status}).`); },
  };
}

export function r2Storage(bucket) {
  return {
    driver: 'r2',
    async put(key, bytes, type) { await bucket.put(key, bytes, { httpMetadata: { contentType: type } }); },
    async get(key) { const o = await bucket.get(key); return o ? { bytes: new Uint8Array(await o.arrayBuffer()), type: o.httpMetadata?.contentType || 'application/octet-stream' } : null; },
    async delete(key) { await bucket.delete(key); },
  };
}

export function memoryStorage() {
  const m = new Map();
  return { driver: 'memory', async put(k, b, t) { m.set(k, { bytes: new Uint8Array(b), type: t }); }, async get(k) { return m.get(k) || null; }, async delete(k) { m.delete(k); }, size: () => m.size };
}

// Le stockage externe configuré, ou null : les fichiers restent alors dans la base.
const cache = new WeakMap();
export function getStorage(env) {
  if (!env) return null;
  if (env.STORAGE) return env.STORAGE;
  if (cache.has(env)) return cache.get(env);
  const driver = (env.STORAGE_DRIVER || (env.FILES ? 'r2' : 'db')).toLowerCase();
  let s = null;
  if (driver === 'r2') { if (!env.FILES) throw new Error('STORAGE_DRIVER=r2 : la liaison R2 « FILES » est absente.'); s = r2Storage(env.FILES); }
  else if (driver === 's3') {
    s = s3Storage({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION || (env.S3_ENDPOINT ? 'auto' : 'us-east-1'), bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, pathStyle: env.S3_PATH_STYLE ? env.S3_PATH_STYLE === 'true' : undefined });
  }
  cache.set(env, s);
  return s;
}

/* ------------------------------------------------------------------ */
/* Photos des produits : la table « images » sert d'index ; les octets */
/* sont dans le stockage externe s'il y en a un, sinon dans la base.   */
/* ------------------------------------------------------------------ */
const toBase64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromBase64 = (b64) => { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function saveProductImage(env, db, storeId, productId, type, bytes) {
  const storage = getStorage(env);
  const prev = await db.prepare('SELECT storage_key FROM images WHERE product_id = ? AND store_id = ?').bind(productId, storeId).first();
  let key = null, data = '';
  if (storage) { key = `images/${storeId}/${productId}-${Date.now().toString(36)}.${EXT[type] || 'bin'}`; await storage.put(key, bytes, type); }
  else data = toBase64(bytes);
  await db.batch([
    db.prepare('INSERT OR REPLACE INTO images (product_id, store_id, mime, data, storage_key) VALUES (?, ?, ?, ?, ?)').bind(productId, storeId, type, data, key),
    db.prepare('UPDATE products SET image_v = COALESCE(image_v, 0) + 1 WHERE id = ? AND store_id = ?').bind(productId, storeId),
  ]);
  if (prev?.storage_key && storage && prev.storage_key !== key) await storage.delete(prev.storage_key).catch(() => {});
}

export async function deleteProductImage(env, db, storeId, productId) {
  const prev = await db.prepare('SELECT storage_key FROM images WHERE product_id = ? AND store_id = ?').bind(productId, storeId).first();
  await db.prepare('DELETE FROM images WHERE product_id = ? AND store_id = ?').bind(productId, storeId).run();
  const storage = getStorage(env);
  if (prev?.storage_key && storage) await storage.delete(prev.storage_key).catch(() => {});
}

export async function readProductImage(env, db, productId) {
  const img = await db.prepare('SELECT mime, data, storage_key FROM images WHERE product_id = ?').bind(productId).first();
  if (!img) return null;
  if (img.storage_key) { const s = getStorage(env); const o = s ? await s.get(img.storage_key) : null; return o ? { bytes: o.bytes, type: img.mime || o.type } : null; }
  return { bytes: fromBase64(img.data || ''), type: img.mime };
}
export { toBase64, fromBase64 };
