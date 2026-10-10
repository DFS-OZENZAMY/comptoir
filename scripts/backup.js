#!/usr/bin/env node
// Sauvegardes de Comptoir en ligne de commande (configuration : variables d'environnement ou .env).
//
//   npm run backup -- create                       sauvegarde maintenant
//   npm run backup -- list                         sauvegardes présentes dans la destination
//   npm run backup -- verify <id|latest> [--deep]  vérifie (--deep : restauration d'essai complète)
//   npm run backup -- export <id|latest> --out comptoir.sql
//   npm run backup -- restore <id|latest> --to file:./data/restauration.db [--force]
//   npm run backup -- import-dump d1.sql           range un export D1 (wrangler d1 export), chiffré
//   npm run backup -- files-restore                remet les photos sauvegardées dans le stockage principal
//   npm run backup -- retention                    applique la rotation
import { createReadStream, createWriteStream } from 'node:fs';
import { loadDotEnv, createEnv } from '../src/adapters/node/env.js';
import { openDatabase } from '../src/adapters/node/d1.js';
import { createBackup, writeBackup, splitStatements, readBackup, readManifest, verifyBackup, listBackups, applyRetention, getBackupStorage } from '../src/features/backup.js';
import { getStorage } from '../src/platform/storage.js';
import { init } from '../src/core/db.js';

loadDotEnv();
const [cmd, arg, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] ?? true : null; };
const flag = (name) => rest.includes(name) || arg === name;
const say = (...a) => console.log(...a);
const fail = (m) => { console.error(`Erreur : ${m}`); process.exit(1); };
const ko = (n) => `${(n / 1024).toFixed(0)} ko`;

async function* fileText(path) { for await (const c of createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 })) yield c; }

async function resolveId(env, id) {
  if (id && id !== 'latest') return id;
  const all = await listBackups(env);
  if (!all.length) fail('aucune sauvegarde dans la destination.');
  return all[0].id;
}

// Restaure une sauvegarde dans une base (fichier SQLite, :memory:, libSQL / Turso).
async function restoreInto(env, id, target, force) {
  const db = await openDatabase(target, process.env.RESTORE_AUTH_TOKEN);
  const existing = (await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").first()).n;
  if (existing && !force) fail(`la base de destination contient déjà ${existing} table(s). Ajoutez --force pour la remplacer.`);
  const manifest = await readManifest(env, id);
  if (db.kind === 'sqlite') await db.exec('BEGIN');
  try {
    for await (const text of readBackup(env, id, manifest)) await db.exec(text);
    if (db.kind === 'sqlite') await db.exec('COMMIT');
  } catch (e) { if (db.kind === 'sqlite') await db.exec('ROLLBACK'); throw e; }
  const diff = [];
  for (const [table, n] of Object.entries(manifest.tables || {})) {
    const got = (await db.prepare(`SELECT COUNT(*) AS n FROM "${table.replace(/"/g, '""')}"`).first()).n;
    if (got !== n) diff.push(`${table} : ${got} au lieu de ${n}`);
  }
  return { db, manifest, diff };
}

const env = await createEnv();
if (!getBackupStorage(env)) fail('aucune destination de sauvegarde (BACKUP_DRIVER). Voir docs/BACKUP.md.');

try {
  switch (cmd) {
    case 'create': {
      await init(env.DB);
      const m = await createBackup(env, { trigger: arg === '--auto' ? 'auto' : 'manuel' });
      await verifyBackup(env, m.id);
      say(`Sauvegarde ${m.id} : ${m.rows} lignes, ${m.parts.length} morceau(x), ${ko(m.bytes)}, ${m.encryption ? 'chiffrée' : 'NON chiffrée'}, vérifiée.`);
      break;
    }
    case 'list': {
      const all = await listBackups(env);
      if (!all.length) say('Aucune sauvegarde.');
      for (const m of all) say(`${m.id}  ${m.trigger.padEnd(7)} ${String(m.rows).padStart(9)} lignes  ${ko(m.bytes).padStart(10)}  ${m.encryption ? 'chiffrée' : 'claire'}  ${m.source}`);
      break;
    }
    case 'verify': {
      const id = await resolveId(env, arg);
      const v = await verifyBackup(env, id);
      say(`Sauvegarde ${id} : ${v.parts} morceau(x) intègres, déchiffrement et empreintes vérifiés.`);
      if (flag('--deep')) {
        const { diff, manifest } = await restoreInto(env, id, ':memory:', true);
        if (diff.length) fail(`restauration d'essai incomplète : ${diff.join(', ')}`);
        say(`Restauration d'essai réussie : ${Object.keys(manifest.tables).length} tables, ${manifest.rows} lignes, toutes identiques.`);
      }
      break;
    }
    case 'export': {
      const id = await resolveId(env, arg); const out = opt('--out') || `comptoir-${id}.sql`;
      const ws = createWriteStream(out);
      for await (const t of readBackup(env, id)) if (!ws.write(t)) await new Promise((r) => ws.once('drain', r));
      await new Promise((r) => ws.end(r));
      say(`Export SQL écrit dans ${out}. Restauration D1 : npx wrangler d1 execute comptoir-data --remote --file=${out}`);
      break;
    }
    case 'restore': {
      const id = await resolveId(env, arg); const to = opt('--to');
      if (!to || to === true) fail('indiquez la base de destination : --to file:./data/restauration.db (ou libsql://…).');
      const { diff, manifest } = await restoreInto(env, id, to, flag('--force'));
      if (diff.length) fail(`restauration incomplète : ${diff.join(', ')}`);
      say(`Sauvegarde ${id} restaurée dans ${to} : ${manifest.rows} lignes. Pointez DATABASE_URL vers cette base pour l'utiliser.`);
      break;
    }
    case 'import-dump': {
      if (!arg) fail('indiquez le fichier SQL (wrangler d1 export … --output=d1.sql).');
      const stats = { tables: {} };
      async function* counted() {
        let batch = [], size = 0;
        for await (const s of splitStatements(fileText(arg))) {
          const m = s.match(/^\s*INSERT\s+INTO\s+["`[]?([\w]+)/i);
          if (m) stats.tables[m[1]] = (stats.tables[m[1]] || 0) + 1;
          batch.push(s); size += s.length;
          if (size > 1 << 20) { yield batch.join('') + '\n'; batch = []; size = 0; }
        }
        if (batch.length) yield batch.join('') + '\n';
      }
      const m = await writeBackup(env, counted(), { trigger: /auto/.test(arg) ? 'auto' : 'import', stats, source: 'export D1' });
      await verifyBackup(env, m.id);
      say(`Export D1 rangé : sauvegarde ${m.id}, ${m.rows} lignes, ${ko(m.bytes)}, ${m.encryption ? 'chiffrée' : 'NON chiffrée'}, vérifiée.`);
      break;
    }
    case 'files-restore': {
      const src = getBackupStorage(env), dst = getStorage(env);
      if (!dst) fail('le stockage principal des photos est la base : rien à remettre en place.');
      let n = 0;
      for (const key of await src.list('files/')) {
        const target = key.slice('files/'.length);
        if (await dst.get(target)) continue;
        const o = await src.get(key); await dst.put(target, o.bytes, o.type); n++;
      }
      say(`${n} photo(s) remise(s) en place.`);
      break;
    }
    case 'retention': {
      const r = await applyRetention(env);
      say(`Rotation : ${r.kept} sauvegarde(s) gardée(s), ${r.removed.length} supprimée(s).`);
      break;
    }
    default:
      say('Commandes : create, list, verify <id|latest> [--deep], export <id|latest> --out fichier.sql, restore <id|latest> --to <base> [--force], import-dump fichier.sql, files-restore, retention');
  }
} catch (e) {
  fail(e.message);
}
env.DB.close?.();
