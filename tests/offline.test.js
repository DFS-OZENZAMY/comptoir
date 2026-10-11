// Mode hors ligne : synchronisation des opérations faites sur l'appareil (POST /api/store/sync).
// Aucune vente perdue ni comptée deux fois, date réelle conservée, chaque opération avec ses propres droits.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

let app, shop, prod;
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString();
const ref = (s) => `test${s}${Math.random().toString(36).slice(2, 10)}`;
before(async () => {
  app = await startApp();
  shop = app.client(); await shop.signup({ name: 'Karim Haddad', store_name: 'Quincaillerie Atlas', country: 'MA' });
  prod = (await shop.post('/api/store/products', { name: 'Vis', price_ht: 10, tva_rate: 20, stock: 50 })).data;
});
const sale = (r, at, extra = {}) => ({ ref: r, type: 'sale', at, body: { mode: 'ticket', lines: [{ product_id: prod.id, label: 'Vis', qty: 2, unit_price_ht: 10, tva_rate: 20 }], payments: [{ method: 'espèces', amount: 24 }], ...extra } });
const stock = async () => (await shop.get('/api/store/products')).data.find((p) => p.id === prod.id).stock;

test('une vente faite hier hors ligne garde sa date réelle', async () => {
  const r = ref('v');
  const res = (await shop.post('/api/store/sync', { ops: [sale(r, day(-1))] })).data.results;
  assert.equal(res[0].status, 'ok'); assert.match(res[0].result.number, /^TK-|^T/);
  const yesterday = day(-1).slice(0, 10);
  const journal = (await shop.get(`/api/store/pos/journal?date=${yesterday}`)).data;
  assert.ok(journal.tickets.some((t) => t.id === res[0].result.id), 'la vente apparaît dans le journal d’hier');
  assert.equal(journal.by_method?.['espèces'] ?? journal.byMethod?.['espèces'] ?? 24, 24, 'le paiement est daté d’hier');
});

test('rejouée, ou envoyée deux fois en même temps : une seule vente, stock déduit une fois', async () => {
  const before = await stock();
  const r = ref('d');
  const [a, b] = await Promise.all([shop.post('/api/store/sync', { ops: [sale(r, day(0))] }), shop.post('/api/store/sync', { ops: [sale(r, day(0))] })]);
  const ids = [a.data.results[0].result.id, b.data.results[0].result.id];
  assert.equal(ids[0], ids[1], 'même vente renvoyée');
  const again = (await shop.post('/api/store/sync', { ops: [sale(r, day(0))] })).data.results[0];
  assert.equal(again.result.duplicate, true); assert.equal(again.result.id, ids[0]);
  assert.equal(await stock(), before - 2, 'stock déduit une seule fois');
  // Encaissement en ligne avec le même identifiant (réponse perdue puis nouvel essai) : pas de doublon non plus.
  const online = await shop.post('/api/store/pos/checkout', { ...sale(r).body, client_ref: r });
  assert.equal(online.data.id, ids[0]);
});

test('un client créé hors ligne est rattaché à la vente qui le cite', async () => {
  const c = ref('c'), v = ref('v');
  const res = (await shop.post('/api/store/sync', { ops: [
    { ref: c, type: 'customer', at: day(0), body: { name: 'Amina Tazi', phone: '0612345678' } },
    { ...sale(v, day(0), { customer_client_ref: c }) },
  ] })).data.results;
  assert.deepEqual(res.map((x) => x.status), ['ok', 'ok']);
  const doc = (await shop.get(`/api/store/documents/${res[1].result.id}`)).data;
  assert.equal(doc.customer_id, res[0].result.id); assert.equal(doc.client_name, 'Amina Tazi');
  assert.equal((await shop.post('/api/store/sync', { ops: [{ ref: c, type: 'customer', body: { name: 'Amina Tazi' } }] })).data.results[0].result.duplicate, true);
});

test('stock et messages au support : rejouables sans doublon', async () => {
  const s = ref('s'), m = ref('m');
  const ops = [{ ref: s, type: 'stock', at: day(0), body: { product_id: prod.id, type: 'entrée', qty: 10, reason: 'Livraison' } }, { ref: m, type: 'support', at: day(0), body: { body: 'Écrit hors ligne' } }];
  const before = await stock();
  assert.deepEqual((await shop.post('/api/store/sync', { ops })).data.results.map((x) => x.status), ['ok', 'ok']);
  await shop.post('/api/store/sync', { ops });
  assert.equal(await stock(), before + 10);
  assert.equal((await shop.get('/api/store/support')).data.messages.filter((x) => x.body === 'Écrit hors ligne').length, 1);
});

test('une opération refusée n’empêche pas les suivantes ; autre commerce gardé de côté ; date trop ancienne', async () => {
  const roles = Object.fromEntries((await shop.get('/api/store/roles')).data.roles.map((r) => [r.name, r.id]));
  const added = (await shop.post('/api/store/team', { name: 'Nadia', email: 'nadia@atlas.ma', role_id: roles.Caissier })).data;
  const cashier = app.client(); await cashier.post('/api/auth/login', { email: 'nadia@atlas.ma', password: added.temp_password });
  const res = (await cashier.post('/api/store/sync', { ops: [
    { ref: ref('x'), type: 'stock', body: { product_id: prod.id, type: 'sortie', qty: 1 } },
    sale(ref('v'), day(0)),
    { ...sale(ref('o'), day(0)), store_id: 999999 },
    sale(ref('a'), day(-60)),
  ] })).data.results;
  assert.deepEqual(res.map((x) => x.status), ['error', 'ok', 'later', 'ok']);
  assert.equal(res[0].code, 403); assert.match(res[0].error, /autorisation/);
  const old = (await shop.get(`/api/store/documents/${res[3].result.id}`)).data;
  assert.equal(old.date, new Date().toISOString().slice(0, 10), 'au-delà de 30 jours, la vente est datée du jour');
});

test('un produit créé hors ligne est rejouable sans doublon', async () => {
  const r = ref('p');
  const body = { name: 'Tournevis cruciforme', price_ht: 8.5, tva_rate: 20, stock: 12, unit: 'pièce', track_stock: 1, visible: 1 };
  const res = (await shop.post('/api/store/sync', { ops: [{ ref: r, type: 'product', at: day(0), body }] })).data.results;
  assert.equal(res[0].status, 'ok');
  assert.ok(res[0].result.id);
  const products = (await shop.get('/api/store/products')).data;
  const p = products.find((x) => x.id === res[0].result.id);
  assert.equal(p.name, 'Tournevis cruciforme');
  assert.equal(p.stock, 12);
  // Rejeu : pas de doublon
  const again = (await shop.post('/api/store/sync', { ops: [{ ref: r, type: 'product', body }] })).data.results[0];
  assert.equal(again.result.duplicate, true);
  assert.equal(again.result.id, res[0].result.id);
  assert.equal(products.filter((x) => x.name === 'Tournevis cruciforme').length, 1);
});
