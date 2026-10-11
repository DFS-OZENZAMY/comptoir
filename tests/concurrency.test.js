// Requêtes simultanées sur une base « comme D1 » (chaque requête SQL prend quelques millisecondes) :
// c'est dans ce délai que deux requêtes se croisent en production. Aucune ne doit échouer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { openDatabase } from '../src/adapters/node/d1.js';
import { init } from '../src/core/db.js';
import { ensurePlatformRoles } from '../src/features/platform-rbac.js';

async function slowDb() {
  const real = await openDatabase(':memory:');
  const wait = () => new Promise((r) => setTimeout(r, 1 + Math.random() * 5));
  const slow = (st) => ({ ...st, sql: st.sql, params: st.params, bind: (...a) => slow(st.bind(...a)),
    first: async (c) => { await wait(); return st.first(c); }, all: async () => { await wait(); return st.all(); }, run: async () => { await wait(); return st.run(); }, raw: async () => { await wait(); return st.raw(); } });
  return { ...real, prepare: (sql) => slow(real.prepare(sql)), batch: async (list) => { await wait(); return real.batch(list.map((x) => real.prepare(x.sql).bind(...(x.params || [])))); } };
}

test('rôles de la plateforme créés par plusieurs requêtes à la fois (messagerie + API) : aucune erreur', async () => {
  for (let i = 0; i < 5; i++) {
    const db = await slowDb(); await init(db);
    const r = await Promise.allSettled([ensurePlatformRoles(db), ensurePlatformRoles(db), ensurePlatformRoles(db)]);
    assert.deepEqual(r.filter((x) => x.status === 'rejected').map((x) => x.reason.message), []);
    const n = (await db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT name) AS d FROM platform_roles').first());
    assert.equal(n.n, n.d, 'aucun rôle en double');
  }
});

test('plusieurs caisses encaissent au même instant : toutes les ventes passent, numéros continus et uniques', async () => {
  const app = await startApp({}, { DB: await slowDb() });
  const c = app.client(); await c.signup({ store_name: 'Quatre caisses' });
  const p = (await c.post('/api/store/products', { name: 'Vis', price_ht: 10, tva_rate: 20, stock: 500 })).data;
  const sale = () => c.post('/api/store/pos/checkout', { mode: 'ticket', lines: [{ product_id: p.id, label: 'Vis', qty: 1, unit_price_ht: 10, tva_rate: 20 }], payments: [{ method: 'espèces', amount: 12 }] });
  const statuses = [];
  for (let round = 0; round < 4; round++) statuses.push(...(await Promise.all([sale(), sale(), sale(), sale()])).map((r) => r.status));
  assert.deepEqual([...new Set(statuses)], [201], 'aucune vente refusée');
  const numbers = (await c.get('/api/store/documents?type=ticket')).data.map((d) => Number(d.number.split('-').pop())).sort((a, b) => a - b);
  assert.deepEqual(numbers, Array.from({ length: 16 }, (_, i) => i + 1), 'numérotation continue, sans trou ni doublon');
});

test('inscription : double clic et commerces homonymes simultanés', async () => {
  const app = await startApp({}, { DB: await slowDb() });
  const body = (email, store) => ({ name: 'Test', email, password: 'motdepasse1', store_name: store, business_type: 'quincaillerie', country: 'MA' });
  const dbl = await Promise.all([1, 2, 3].map(() => app.client().post('/api/auth/signup', body('double@clic.ma', 'Double Clic'))));
  assert.deepEqual(dbl.map((r) => r.status).sort(), [201, 409, 409]);
  assert.ok(dbl.filter((r) => r.status === 409).every((r) => /existe déjà/.test(r.data.error)), 'message clair, pas d’erreur serveur');
  const same = await Promise.all([1, 2, 3].map((i) => app.client().post('/api/auth/signup', body(`atlas${i}@t.ma`, 'Quincaillerie Atlas'))));
  assert.deepEqual(same.map((r) => r.status), [201, 201, 201]);
  assert.equal(new Set(same.map((r) => r.data.slug)).size, 3, 'trois adresses de vitrine distinctes');
});
