// Codes-barres internes (EAN-13, préfixe GS1 20) pour les produits qui n'en ont pas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { ean13Check, internalBarcode } from '../src/features/store.js';

const validEan = (c) => /^\d{13}$/.test(c) && ean13Check(c.slice(0, 12)) === c[12];

test('génération : EAN-13 valides et uniques, codes existants jamais modifiés, conflit évité', async () => {
  const app = await startApp();
  const shop = app.client(); await shop.signup({ store_name: 'Épicerie Amina', demo: false });
  const mk = async (name, barcode) => (await shop.post('/api/store/products', { name, price_ht: 10, tva_rate: 20, stock: 5, ...(barcode ? { barcode } : {}) })).data.id;
  const a = await mk('Menthe fraîche'), b = await mk('Olives noires vrac'), withCode = await mk('Thé vert Sultan', '6111234567895');
  // Conflit : un produit porte déjà (saisi à la main) le code que b recevrait.
  await mk('Code saisi à la main', internalBarcode(b));
  const r = (await shop.post('/api/store/products/barcodes', {})).data;
  assert.equal(r.updated, 2);
  const all = (await shop.get('/api/store/products')).data;
  const code = (id) => all.find((p) => p.id === id).barcode;
  assert.equal(code(a), internalBarcode(a), 'code stable, issu de l’identifiant');
  assert.ok(code(b) !== internalBarcode(b) && validEan(code(b)) && code(b).startsWith('20'), 'autre code interne libre en cas de conflit');
  assert.equal(code(withCode), '6111234567895', 'code existant intact');
  const codes = all.map((p) => p.barcode).filter(Boolean);
  assert.equal(new Set(codes).size, codes.length, 'tous différents');
  assert.ok([code(a), code(b)].every((c) => validEan(c) && c.startsWith('20')));
  assert.equal((await shop.post('/api/store/products/barcodes', {})).data.updated, 0, 'rien à refaire');
});

test('génération ciblée et droits', async () => {
  const app = await startApp();
  const shop = app.client(); await shop.signup({ store_name: 'Atlas', demo: false });
  const ids = [];
  for (const n of ['Vis', 'Écrous', 'Rondelles']) ids.push((await shop.post('/api/store/products', { name: n, price_ht: 1, stock: 1 })).data.id);
  assert.equal((await shop.post('/api/store/products/barcodes', { ids: [ids[0]] })).data.updated, 1, 'seulement le produit demandé');
  const roles = Object.fromEntries((await shop.get('/api/store/roles')).data.roles.map((r) => [r.name, r.id]));
  const added = (await shop.post('/api/store/team', { name: 'Nadia', email: 'nadia@atlas.ma', role_id: roles.Caissier })).data;
  const cashier = app.client(); await cashier.post('/api/auth/login', { email: 'nadia@atlas.ma', password: added.temp_password });
  assert.equal((await cashier.post('/api/store/products/barcodes', {})).status, 403, 'il faut le droit de modifier les produits');
});
