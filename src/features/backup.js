// Sauvegardes de la plateforme : export complet de la base en SQL standard, compressé (gzip),
// chiffré (AES-256-GCM), découpé en morceaux, envoyé vers une destination distincte, vérifié,
// avec rotation (jours, semaines, mois) et copie des photos stockées hors de la base.
// Portable : Cloudflare Workers et Node.js. Restauration : scripts/backup.js (voir docs/BACKUP.md).
import { HttpError } from '../core/lib.js';
import { init } from '../core/db.js';
import { s3Storage, r2Storage, getStorage } from '../platform/storage.js';

export const FORMAT = 'comptoir-backup/1';
const PART_TEXT = 8 * 1024 * 1024;        // texte SQL par morceau, avant compression
const LONG = 40000;                        // longueur au-delà de laquelle une valeur est découpée (limite D1 : 100 ko par instruction)
const enc = new TextEncoder(), dec = new TextDecoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (bytes) => hex(await crypto.subtle.digest('SHA-256', bytes));

/* ------------------------------------------------------------------ */
/* Destination des sauvegardes (toujours distincte des données)        */
/* ------------------------------------------------------------------ */
//   BACKUP_DRIVER=s3  BACKUP_S3_ENDPOINT, BACKUP_S3_REGION, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY
//   BACKUP_DRIVER=r2  liaison R2 « BACKUPS » (Cloudflare)
//   env.BACKUP_STORAGE : fourni par l'adaptateur (disque local, mémoire pour les tests)
const cache = new WeakMap();
export function getBackupStorage(env) {
  if (env.BACKUP_STORAGE) return env.BACKUP_STORAGE;
  if (cache.has(env)) return cache.get(env);
  const driver = (env.BACKUP_DRIVER || (env.BACKUPS ? 'r2' : '')).toLowerCase();
  let s = null;
  if (driver === 'r2' && env.BACKUPS) s = r2Storage(env.BACKUPS);
  else if (driver === 's3') {
    s = s3Storage({ endpoint: env.BACKUP_S3_ENDPOINT, region: env.BACKUP_S3_REGION || (env.BACKUP_S3_ENDPOINT ? 'auto' : 'us-east-1'), bucket: env.BACKUP_S3_BUCKET,
      accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY, pathStyle: env.BACKUP_S3_PATH_STYLE ? env.BACKUP_S3_PATH_STYLE === 'true' : undefined });
  }
  cache.set(env, s);
  return s;
}
export function backupConfig(env) {
  const s = getBackupStorage(env);
  return {
    configured: !!s, driver: s?.driver || null, encrypted: !!env.BACKUP_ENCRYPTION_KEY, local: s?.driver === 'fs',
    keep: { daily: Number(env.BACKUP_KEEP_DAILY || 7), weekly: Number(env.BACKUP_KEEP_WEEKLY || 4), monthly: Number(env.BACKUP_KEEP_MONTHLY || 12) },
    files: env.BACKUP_INCLUDE_FILES !== 'false',
  };
}

/* ------------------------------------------------------------------ */
/* Chiffrement : AES-256-GCM, clé dérivée de BACKUP_ENCRYPTION_KEY      */
/* ------------------------------------------------------------------ */
async function backupKey(env) {
  const secret = env.BACKUP_ENCRYPTION_KEY;
  if (!secret) return null;
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey', 'deriveBits']);
  const params = { name: 'PBKDF2', salt: enc.encode('comptoir-backup-v1'), iterations: 200000, hash: 'SHA-256' };
  const bits = await crypto.subtle.deriveBits(params, base, 256);
  const key = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { key, fingerprint: (await sha256(bits)).slice(0, 12) };
}
async function encrypt(k, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k.key, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
}
async function decrypt(k, bytes) {
  try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, k.key, bytes.subarray(12))); }
  catch { throw new HttpError(422, 'Déchiffrement impossible : la clé de chiffrement ne correspond pas, ou le fichier a été modifié.'); }
}
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
const gzip = (b) => pipe(b, new CompressionStream('gzip'));
const gunzip = (b) => pipe(b, new DecompressionStream('gzip'));

/* ------------------------------------------------------------------ */
/* Export SQL standard (SQLite, D1, libSQL)                            */
/* ------------------------------------------------------------------ */
const q = (n) => `"${String(n).replace(/"/g, '""')}"`;
const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v) || Array.isArray(v)) return `X'${hex(v instanceof ArrayBuffer ? v : Array.isArray(v) ? new Uint8Array(v) : v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength))}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
const SKIP = /^(sqlite_|_cf_|d1_)/;

// Le contenu de la base, instruction par instruction (chaque morceau produit est complet).
export async function* dumpDatabase(db, stats = { tables: {} }) {
  yield `-- ${FORMAT} : export SQL de Comptoir (${new Date().toISOString()})\n-- Restauration : voir docs/BACKUP.md\n`;
  const objects = (await db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name").all()).results.filter((o) => !SKIP.test(o.name));
  for (const t of objects.filter((o) => o.type === 'table')) {
    yield `DROP TABLE IF EXISTS ${q(t.name)};\n${t.sql};\n`;
    const info = (await db.prepare(`PRAGMA table_info(${q(t.name)})`).all()).results;
    const cols = info.map((c) => c.name), pk = info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    const colList = cols.map(q).join(', ');
    let last = null, count = 0;
    for (;;) {
      const page = (await db.prepare(`SELECT rowid AS "__rowid", ${colList} FROM ${q(t.name)}${last === null ? '' : ' WHERE rowid > ?'} ORDER BY rowid LIMIT 400`).bind(...(last === null ? [] : [last])).all()).results;
      if (!page.length) break;
      last = page[page.length - 1].__rowid;
      let batch = [];
      const flush = () => { const s = batch.length ? `INSERT INTO ${q(t.name)} (${colList}) VALUES\n${batch.join(',\n')};\n` : ''; batch = []; return s; };
      let out = '';
      for (const row of page) {
        count++;
        const long = cols.filter((c) => typeof row[c] === 'string' && row[c].length > LONG);
        if (!long.length) { batch.push(`(${cols.map((c) => lit(row[c])).join(', ')})`); if (batch.length >= 40) out += flush(); continue; }
        // Valeur très longue (photo en base…) : insérée vide, puis complétée par morceaux.
        out += flush();
        out += `INSERT INTO ${q(t.name)} (${colList}) VALUES (${cols.map((c) => (long.includes(c) ? "''" : lit(row[c]))).join(', ')});\n`;
        const where = pk.length ? pk.map((c) => `${q(c)} = ${lit(row[c])}`).join(' AND ') : `rowid = ${row.__rowid}`;
        for (const c of long) for (let i = 0; i < row[c].length; i += LONG) out += `UPDATE ${q(t.name)} SET ${q(c)} = ${q(c)} || ${lit(row[c].slice(i, i + LONG))} WHERE ${where};\n`;
      }
      out += flush();
      yield out;
    }
    stats.tables[t.name] = count;
  }
  for (const o of objects.filter((x) => x.type !== 'table')) yield `${o.sql};\n`;
  yield '-- Fin de l’export\n';
}

// Découpe un texte SQL en instructions complètes (guillemets, commentaires et « BEGIN … END » respectés).
export async function* splitStatements(chunks) {
  let buf = '', inS = false, inD = false, inLine = false, inBlock = false, depth = 0, word = '';
  for await (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i], n = chunk[i + 1];
      buf += c;
      if (inLine) { if (c === '\n') inLine = false; continue; }
      if (inBlock) { if (c === '*' && n === '/') { buf += n; i++; inBlock = false; } continue; }
      if (inS) { if (c === "'") inS = false; continue; }
      if (inD) { if (c === '"') inD = false; continue; }
      if (c === "'") { inS = true; continue; }
      if (c === '"') { inD = true; continue; }
      if (c === '-' && n === '-') { inLine = true; continue; }
      if (c === '/' && n === '*') { inBlock = true; continue; }
      if (/[A-Za-z_]/.test(c)) { word += c; continue; }
      if (word) { const w = word.toUpperCase(); if (w === 'BEGIN' && /CREATE\s+TRIGGER/i.test(buf)) depth++; if (w === 'END' && depth) depth--; word = ''; }
      if (c === ';' && !depth) { yield buf; buf = ''; }
    }
  }
  if (buf.trim()) yield buf;
}

/* ------------------------------------------------------------------ */
/* Création d'une sauvegarde                                           */
/* ------------------------------------------------------------------ */
const newId = () => new Date().toISOString().replace(/[:.]/g, '-');

// Écrit un export (n'importe quel itérable de texte SQL) sous forme de morceaux + manifeste.
export async function writeBackup(env, chunks, { trigger = 'manuel', stats = { tables: {} }, source = 'comptoir' } = {}) {
  const storage = getBackupStorage(env);
  if (!storage) throw new HttpError(503, 'Aucune destination de sauvegarde n’est configurée (voir docs/BACKUP.md).');
  const k = await backupKey(env);
  const id = newId(), started = new Date().toISOString();
  const parts = []; let buf = [], size = 0, total = 0;
  const flush = async () => {
    if (!buf.length) return;
    const plain = enc.encode(buf.join('')); buf = []; size = 0;
    const packed = await gzip(plain);
    const stored = k ? await encrypt(k, packed) : packed;
    const n = parts.length + 1;
    await storage.put(`backups/${id}/part-${String(n).padStart(4, '0')}.bin`, stored, 'application/octet-stream');
    parts.push({ n, bytes: stored.length, text_bytes: plain.length, sha256: await sha256(stored), text_sha256: await sha256(plain) });
    total += stored.length;
  };
  for await (const chunk of chunks) { buf.push(chunk); size += chunk.length; if (size >= PART_TEXT) await flush(); }
  await flush();
  const manifest = {
    format: FORMAT, id, source, trigger, created_at: started, finished_at: new Date().toISOString(), app_version: env.APP_VERSION || 'dev',
    compression: 'gzip', encryption: k ? { algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA256-200000', key_fingerprint: k.fingerprint } : null,
    parts, bytes: total, tables: stats.tables, rows: Object.values(stats.tables).reduce((a, b) => a + b, 0),
  };
  await storage.put(`backups/${id}/manifest.json`, enc.encode(JSON.stringify(manifest, null, 2)), 'application/json');
  return manifest;
}

export async function createBackup(env, { trigger = 'manuel' } = {}) {
  const db = env.DB;
  await init(db);
  await db.prepare("INSERT OR REPLACE INTO backups (id, created_at, status, trigger) VALUES (?, ?, 'en cours', ?)").bind('en-cours', new Date().toISOString(), trigger).run().catch(() => {});
  try {
    const stats = { tables: {} };
    const m = await writeBackup(env, dumpDatabase(db, stats), { trigger, stats });
    await db.batch([
      db.prepare("DELETE FROM backups WHERE id = 'en-cours'"),
      db.prepare("INSERT OR REPLACE INTO backups (id, created_at, finished_at, status, trigger, bytes, rows, parts, encrypted) VALUES (?, ?, ?, 'réussie', ?, ?, ?, ?, ?)")
        .bind(m.id, m.created_at, m.finished_at, trigger, m.bytes, m.rows, m.parts.length, m.encryption ? 1 : 0),
    ]);
    return m;
  } catch (e) {
    await db.batch([
      db.prepare("DELETE FROM backups WHERE id = 'en-cours'"),
      db.prepare("INSERT INTO backups (id, created_at, finished_at, status, trigger, error) VALUES (?, ?, ?, 'échec', ?, ?)").bind(`echec-${newId()}`, new Date().toISOString(), new Date().toISOString(), trigger, String(e.message).slice(0, 500)),
    ]).catch(() => {});
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Lecture, vérification, liste, rotation                              */
/* ------------------------------------------------------------------ */
export async function readManifest(env, id) {
  if (!/^[\w-]+$/.test(String(id))) throw new HttpError(400, 'Sauvegarde inconnue.');
  const o = await getBackupStorage(env)?.get(`backups/${id}/manifest.json`);
  if (!o) throw new HttpError(404, 'Sauvegarde introuvable.');
  return JSON.parse(dec.decode(o.bytes));
}

// Le texte SQL d'une sauvegarde, morceau par morceau, contrôlé à chaque étape.
export async function* readBackup(env, id, manifest) {
  const m = manifest || await readManifest(env, id);
  const storage = getBackupStorage(env);
  let k = null;
  if (m.encryption) {
    k = await backupKey(env);
    if (!k) throw new HttpError(422, 'Cette sauvegarde est chiffrée : indiquez BACKUP_ENCRYPTION_KEY.');
    if (k.fingerprint !== m.encryption.key_fingerprint) throw new HttpError(422, 'La clé de chiffrement ne correspond pas à celle de cette sauvegarde.');
  }
  for (const p of m.parts) {
    const o = await storage.get(`backups/${m.id}/part-${String(p.n).padStart(4, '0')}.bin`);
    if (!o) throw new HttpError(422, `Morceau ${p.n} manquant.`);
    if (await sha256(o.bytes) !== p.sha256) throw new HttpError(422, `Morceau ${p.n} altéré (empreinte différente).`);
    const plain = await gunzip(k ? await decrypt(k, o.bytes) : o.bytes);
    if (await sha256(plain) !== p.text_sha256) throw new HttpError(422, `Morceau ${p.n} : contenu différent de l’original.`);
    yield dec.decode(plain);
  }
}

export async function verifyBackup(env, id) {
  const m = await readManifest(env, id);
  let bytes = 0; for await (const t of readBackup(env, id, m)) bytes += t.length;
  await env.DB.prepare('UPDATE backups SET verified_at = ? WHERE id = ?').bind(new Date().toISOString(), id).run().catch(() => {});
  return { ok: true, id, parts: m.parts.length, text_bytes: bytes, rows: m.rows };
}

export async function listBackups(env) {
  const storage = getBackupStorage(env);
  if (!storage) return [];
  const ids = [...new Set((await storage.list('backups/')).map((k) => k.split('/')[1]).filter(Boolean))].sort().reverse();
  const out = [];
  for (const id of ids) { try { out.push(await readManifest(env, id)); } catch { /* sauvegarde incomplète : ignorée */ } }
  return out;
}

// Rotation : les N derniers jours, semaines et mois, plus les sauvegardes manuelles de moins de 30 jours.
export function selectToKeep(manifests, { daily = 7, weekly = 4, monthly = 12 } = {}, now = Date.now()) {
  const sorted = [...manifests].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const keep = new Set(sorted.slice(0, 1).map((m) => m.id));
  const week = (d) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day); return `${x.getUTCFullYear()}-${Math.ceil(((x - Date.UTC(x.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)}`; };
  for (const [n, keyOf] of [[daily, (d) => d.toISOString().slice(0, 10)], [weekly, week], [monthly, (d) => d.toISOString().slice(0, 7)]]) {
    const seen = new Set();
    for (const m of sorted) { const k = keyOf(new Date(m.created_at)); if (seen.has(k)) continue; seen.add(k); if (seen.size > n) break; keep.add(m.id); }
  }
  for (const m of sorted) if (m.trigger === 'manuel' && now - Date.parse(m.created_at) < 30 * 86400000) keep.add(m.id);
  return keep;
}
export async function applyRetention(env) {
  const storage = getBackupStorage(env);
  const all = await listBackups(env);
  const keep = selectToKeep(all, backupConfig(env).keep);
  const removed = [];
  for (const m of all) {
    if (keep.has(m.id)) continue;
    for (const k of await storage.list(`backups/${m.id}/`)) await storage.delete(k);
    await env.DB.prepare('DELETE FROM backups WHERE id = ?').bind(m.id).run().catch(() => {});
    removed.push(m.id);
  }
  return { kept: keep.size, removed };
}

/* ------------------------------------------------------------------ */
/* Photos stockées hors de la base : copie au fil de l'eau             */
/* ------------------------------------------------------------------ */
export async function backupFiles(env, limit = 200) {
  const src = getStorage(env), dst = getBackupStorage(env);
  if (!src || !dst || !backupConfig(env).files) return { copied: 0, skipped: true };
  const rows = (await env.DB.prepare(`SELECT i.storage_key FROM images i WHERE i.storage_key IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM backup_files b WHERE b.key = i.storage_key) LIMIT ?`).bind(limit).all()).results;
  let copied = 0;
  for (const { storage_key: key } of rows) {
    const o = await src.get(key); if (!o) continue;
    await dst.put(`files/${key}`, o.bytes, o.type);
    await env.DB.prepare('INSERT OR IGNORE INTO backup_files (key, copied_at) VALUES (?, ?)').bind(key, new Date().toISOString()).run();
    copied++;
  }
  return { copied, remaining: rows.length === limit };
}

// Tâche du matin : sauvegarde, vérification, rotation, copie des photos.
export async function dailyBackup(env) {
  if (!getBackupStorage(env)) return { skipped: 'non configurée' };
  const m = await createBackup(env, { trigger: 'auto' });
  await verifyBackup(env, m.id);
  const retention = await applyRetention(env);
  const files = await backupFiles(env).catch((e) => ({ error: e.message }));
  return { id: m.id, bytes: m.bytes, rows: m.rows, removed: retention.removed.length, files };
}

// État pour la console : dernière réussite, alerte si plus de 26 h.
export async function backupStatus(env) {
  const cfg = backupConfig(env);
  const rows = (await env.DB.prepare('SELECT * FROM backups ORDER BY created_at DESC LIMIT 60').all()).results;
  const lastOk = rows.find((r) => r.status === 'réussie');
  const lastFail = rows.find((r) => r.status === 'échec');
  const ageH = lastOk ? (Date.now() - Date.parse(lastOk.finished_at || lastOk.created_at)) / 3600000 : null;
  const alert = !cfg.configured ? 'Aucune destination de sauvegarde configurée.'
    : !lastOk ? 'Aucune sauvegarde réussie pour l’instant.'
    : ageH > 26 ? `Dernière sauvegarde réussie il y a ${Math.floor(ageH)} heures.`
    : lastFail && lastFail.created_at > lastOk.created_at ? `La dernière sauvegarde a échoué : ${lastFail.error}` : null;
  const pending = cfg.configured ? (await env.DB.prepare(`SELECT COUNT(*) AS n FROM images i WHERE i.storage_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM backup_files b WHERE b.key = i.storage_key)`).first()).n : 0;
  return { config: cfg, last_ok: lastOk || null, last_failure: lastFail || null, age_hours: ageH === null ? null : Math.round(ageH * 10) / 10, alert, history: rows, files_pending: pending };
}
