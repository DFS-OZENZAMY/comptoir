// Sauvegardes : création, chiffrement, vérification, restauration complète, rotation, console, photos.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { createEnv } from '../src/adapters/node/env.js';
import { openDatabase } from '../src/adapters/node/d1.js';
import { createBackup, verifyBackup, readBackup, listBackups, selectToKeep, splitStatements, backupFiles, backupStatus } from '../src/features/backup.js';
import { runDailyTasks } from '../src/app.js';

const KEY = 'clé-de-test-très-secrète';
let app, admin;
before(async () => {
  app = await startApp({ BACKUP_DRIVER: 'memory', BACKUP_ENCRYPTION_KEY: KEY });
  admin = app.client(); await admin.signup({ email: 'admin@test.dev', store_name: 'Plateforme' });
  const c = app.client(); await c.signup({ store_name: 'Épicerie l’Étoile', country: 'MA' });
  // Une valeur très longue, plus grande que la limite d'une instruction D1 : elle doit être découpée.
  await app.env.DB.prepare("UPDATE products SET description = ? WHERE id = (SELECT MIN(id) FROM products)").bind('é;\'"\n'.repeat(30000)).run();
});

async function restoreToMemory(env, id) {
  const db = await openDatabase(':memory:');
  for await (const text of readBackup(env, id)) await db.exec(text);
  return db;
}

test('sauvegarde chiffrée puis restauration complète identique', async () => {
  const m = await createBackup(app.env, { trigger: 'manuel' });
  assert.equal(m.encryption.algorithm, 'AES-256-GCM');
  assert.ok(m.rows > 10 && m.tables.products >= 4 && m.tables.stores === 2);
  const stored = await app.env.BACKUP_STORAGE.get(`backups/${m.id}/part-0001.bin`);
  assert.ok(!new TextDecoder().decode(stored.bytes).includes('CREATE TABLE'), 'le contenu stocké est illisible sans la clé');
  assert.equal((await verifyBackup(app.env, m.id)).ok, true);
  const db = await restoreToMemory(app.env, m.id);
  for (const [table, n] of Object.entries(m.tables)) assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).first()).n, n, table);
  const original = await app.env.DB.prepare('SELECT description FROM products ORDER BY id LIMIT 1').first('description');
  assert.equal(await db.prepare('SELECT description FROM products ORDER BY id LIMIT 1').first('description'), original, 'valeur longue reconstituée à l’identique');
  assert.equal(await db.prepare("SELECT name FROM stores WHERE name LIKE 'Épicerie%'").first('name'), 'Épicerie l’Étoile');
});

test('mauvaise clé et fichier altéré : détectés', async () => {
  const m = (await listBackups(app.env))[0];
  const other = await createEnv({ DATABASE_URL: ':memory:', STORAGE_DRIVER: 'memory', BACKUP_ENCRYPTION_KEY: 'autre-clé' }, { BACKUP_STORAGE: app.env.BACKUP_STORAGE });
  await assert.rejects(verifyBackup(other, m.id), /clé de chiffrement ne correspond pas/);
  const key = `backups/${m.id}/part-0001.bin`; const o = await app.env.BACKUP_STORAGE.get(key);
  const bad = new Uint8Array(o.bytes); bad[40] ^= 1;
  await app.env.BACKUP_STORAGE.put(key, bad, o.type);
  await assert.rejects(verifyBackup(app.env, m.id), /altéré/);
  await app.env.BACKUP_STORAGE.put(key, o.bytes, o.type);
  assert.equal((await verifyBackup(app.env, m.id)).ok, true);
});

test('sans clé : sauvegarde en clair, signalée dans la console', async () => {
  const plain = await startApp({ BACKUP_DRIVER: 'memory' });
  const m = await createBackup(plain.env);
  assert.equal(m.encryption, null);
  assert.equal((await verifyBackup(plain.env, m.id)).ok, true);
  assert.equal((await backupStatus(plain.env)).config.encrypted, false);
});

test('rotation : 7 jours, 4 semaines, 12 mois, et les manuelles récentes', () => {
  const now = Date.parse('2026-10-10T06:00:00Z');
  const list = Array.from({ length: 400 }, (_, i) => ({ id: `b${i}`, trigger: 'auto', created_at: new Date(now - i * 86400000).toISOString() }));
  list.push({ id: 'manuelle', trigger: 'manuel', created_at: new Date(now - 10 * 86400000 + 3600000).toISOString() });
  const keep = selectToKeep(list, { daily: 7, weekly: 4, monthly: 12 }, now);
  for (let i = 0; i < 7; i++) assert.ok(keep.has(`b${i}`), `jour ${i}`);
  assert.ok(keep.has('manuelle'));
  assert.ok(keep.size <= 7 + 4 + 12 + 1 && keep.size >= 18, `${keep.size} sauvegardes gardées`);
  const months = new Set(list.filter((m) => keep.has(m.id)).map((m) => m.created_at.slice(0, 7)));
  assert.ok(months.size >= 12, 'un an de mois couverts');
  assert.ok(!keep.has('b399'), 'les plus anciennes sont supprimées');
});

test('découpage d’un export SQL : textes, commentaires et déclencheurs respectés', async () => {
  const sql = `INSERT INTO t VALUES ('a;b', "c;d");\n-- commentaire ; ignoré\nINSERT INTO t VALUES ('ligne 1\nligne 2;');\n/* bloc ; */CREATE TRIGGER tr AFTER INSERT ON t BEGIN UPDATE t SET x = 1; END;\nSELECT 1;`;
  const out = []; for await (const s of splitStatements([sql.slice(0, 17), sql.slice(17)])) out.push(s.trim());
  assert.equal(out.length, 4);
  assert.match(out[1], /ligne 2;'\)/); assert.match(out[2], /END;$/);
});

test('console : liste, sauvegarde immédiate, téléchargement, accès réservé', async () => {
  const list = await admin.get('/api/console/backups');
  assert.equal(list.status, 200); assert.equal(list.data.status.config.encrypted, true); assert.ok(list.data.backups.length >= 1);
  const created = await admin.post('/api/console/backups');
  assert.equal(created.status, 201); assert.equal(created.data.verified, true);
  const res = await app.handle(new Request(`https://comptoir.test/api/console/backups/${created.data.backup.id}/download`, { headers: { cookie: admin.cookie } }));
  assert.equal(res.headers.get('content-type'), 'application/gzip');
  const text = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text();
  assert.match(text, /CREATE TABLE products/); assert.match(text, /Épicerie l’Étoile/);
  const other = app.client(); await other.signup({ store_name: 'Curieux' });
  assert.equal((await other.get('/api/console/backups')).status, 403);
  assert.equal((await other.post('/api/console/backups')).status, 403);
});

test('alerte dans la console quand aucune destination n’est configurée', async () => {
  const bare = await startApp({ BACKUP_DRIVER: 'aucune' });
  const a = bare.client(); await a.signup({ email: 'admin@test.dev', store_name: 'Admin' });
  const todo = (await a.get('/api/console/todo')).data;
  assert.ok(todo.some((t) => t.kind === 'backup' && /non configurées/.test(t.title)));
});

test('photos hors base copiées au fil de l’eau, et tâche du matin', async () => {
  const c = app.client(); await c.signup({ store_name: 'Photos' });
  const p = (await c.get('/api/store/products')).data[0];
  await c.put(`/api/store/products/${p.id}/image`, { data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' });
  assert.equal((await backupFiles(app.env)).copied, 1);
  assert.equal((await backupFiles(app.env)).copied, 0, 'déjà copiée : rien à refaire');
  assert.equal((await app.env.BACKUP_STORAGE.list('files/')).length, 1);
  const daily = await runDailyTasks(app.env);
  assert.ok(daily.done.some((d) => /^sauvegarde .* vérifiée/.test(d)), daily.done.join(' | '));
});
