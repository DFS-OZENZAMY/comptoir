// Ticket et facture numériques : lien secret, page publique, droits, sécurité.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

test('ticket numérique : lien stable, page complète, non indexée, sans code injecté', async () => {
  const app = await startApp();
  const shop = app.client(); await shop.signup({ store_name: 'Quincaillerie Atlas', country: 'MA' });
  await shop.put('/api/store/settings', { address: '12 rue des Artisans, Casablanca', legal_info: 'ICE 001234567000089' });
  const p = (await shop.post('/api/store/products', { name: 'Vis <script>alert(1)</script>', price_ht: 10, tva_rate: 20, stock: 50 })).data;
  const sale = (await shop.post('/api/store/pos/checkout', { mode: 'ticket', lines: [{ product_id: p.id, label: 'Vis <script>alert(1)</script>', qty: 3, unit_price_ht: 10, tva_rate: 20 }], payments: [{ method: 'espèces', amount: 36 }] })).data;
  const a = await shop.post(`/api/store/share/${sale.id}`);
  assert.equal(a.status, 200); assert.match(a.data.url, /\/r\/[A-Za-z0-9_-]{22}$/);
  assert.equal((await shop.post(`/api/store/share/${sale.id}`)).data.url, a.data.url, 'même lien à chaque fois');
  const res = await app.handle(new Request(a.data.url));
  const page = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-robots-tag'), /noindex/); assert.match(res.headers.get('cache-control'), /no-store/);
  for (const t of ['Quincaillerie Atlas', sale.number, '36,00', 'Espèces', 'TVA 20 %', 'ICE 001234567000089', 'Ticket envoyé avec Comptoir']) assert.ok(page.includes(t), `la page contient « ${t} »`);
  assert.ok(!page.includes('<script>alert(1)</script>') && page.includes('&lt;script&gt;'), 'le nom piégé est affiché comme du texte');
  assert.equal((await app.handle(new Request(a.data.url.replace(/.{4}$/, 'AAAA')))).status, 404, 'faux lien');
});

test('partage : caissier autorisé, autre commerce refusé', async () => {
  const app = await startApp();
  const shop = app.client(); await shop.signup({ store_name: 'Atlas' });
  const p = (await shop.post('/api/store/products', { name: 'Vis', price_ht: 10, stock: 50 })).data;
  const roles = Object.fromEntries((await shop.get('/api/store/roles')).data.roles.map((r) => [r.name, r.id]));
  const added = (await shop.post('/api/store/team', { name: 'Nadia', email: 'nadia@atlas.ma', role_id: roles.Caissier })).data;
  const cashier = app.client(); await cashier.post('/api/auth/login', { email: 'nadia@atlas.ma', password: added.temp_password });
  const sale = (await cashier.post('/api/store/pos/checkout', { mode: 'ticket', lines: [{ product_id: p.id, label: 'Vis', qty: 1, unit_price_ht: 10, tva_rate: 20 }], payments: [{ method: 'espèces', amount: 12 }] })).data;
  assert.equal((await cashier.post(`/api/store/share/${sale.id}`)).status, 200, 'le caissier envoie son ticket');
  const other = app.client(); await other.signup({ store_name: 'Autre commerce' });
  assert.equal((await other.post(`/api/store/share/${sale.id}`)).status, 404, 'un autre commerce ne voit pas ce document');
});

test('l’heure du ticket est celle du pays du commerce', async () => {
  const app = await startApp();
  const shop = app.client(); await shop.signup({ store_name: 'Atlas', country: 'MA' });
  const p = (await shop.post('/api/store/products', { name: 'Vis', price_ht: 10, stock: 50 })).data;
  const sale = (await shop.post('/api/store/pos/checkout', { mode: 'ticket', lines: [{ product_id: p.id, label: 'Vis', qty: 1, unit_price_ht: 10, tva_rate: 20 }], payments: [{ method: 'espèces', amount: 12 }] })).data;
  await app.env.DB.prepare("UPDATE documents SET created_at = '2026-10-12 09:37:00' WHERE id = ?").bind(sale.id).run();
  const page = await (await app.handle(new Request((await shop.post(`/api/store/share/${sale.id}`)).data.url))).text();
  assert.ok(page.includes('10:37'), 'Casablanca : UTC+1');
});
