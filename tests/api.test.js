// API métier, de bout en bout, sur une base en mémoire : comptes, isolation, produits, photos,
// caisse, droits, boutiques, fidélité, import, pages publiques, tâche du matin.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS } from '../src/core/catalog.js';
import { startApp } from './helpers.js';
import { runDailyTasks } from '../src/app.js';

let app;
before(async () => { app = await startApp(); });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const line = (p, qty = 1, over = {}) => ({ product_id: p.id, label: p.name, qty, unit_price_ht: p.price_ht, tva_rate: p.tva_rate, ...over });
const ttc = (p, qty = 1) => Math.round(p.price_ht * (1 + p.tva_rate / 100) * qty * 100) / 100;

test('santé de l’application', async () => {
  const r = await app.client().get('/api/health');
  assert.equal(r.status, 200); assert.equal(r.data.ok, true); assert.equal(r.data.storage, 'memory');
});

test('inscription, session et déconnexion', async () => {
  const c = app.client();
  const s = await c.signup({ store_name: 'Quincaillerie Premium', country: 'FR' });
  assert.equal(s.slug, 'quincaillerie-premium');
  const me = await c.get('/api/auth/me');
  assert.equal(me.data.authenticated, true); assert.equal(me.data.role, 'owner'); assert.equal(me.data.permissions.length, PERMISSIONS.length, 'le propriétaire a toutes les permissions du catalogue');
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/auth/me')).data.authenticated, false);
});

test('isolation : un commerce ne voit ni ne modifie les produits d’un autre', async () => {
  const a = app.client(); await a.signup({ store_name: 'Commerce A' });
  const b = app.client(); await b.signup({ store_name: 'Commerce B' });
  const pa = (await a.post('/api/store/products', { name: 'Secret de A', price_ht: 10 })).data;
  assert.ok(!(await b.get('/api/store/products')).data.some((p) => p.name === 'Secret de A'));
  assert.equal((await b.put(`/api/store/products/${pa.id}`, { name: 'Piraté' })).status, 404);
  assert.equal((await b.del(`/api/store/products/${pa.id}`)).status, 404);
  assert.ok((await a.get('/api/store/products')).data.some((p) => p.name === 'Secret de A'));
});

test('produit, photo dans le stockage, vente en caisse et stock', async () => {
  const c = app.client(); await c.signup({ store_name: 'Boutique photo' });
  const { id } = (await c.post('/api/store/products', { name: 'Marteau', price_ht: 20, tva_rate: 20, stock: 10 })).data;
  assert.equal((await c.put(`/api/store/products/${id}/image`, { data: PNG })).status, 200);
  const p = (await c.get('/api/store/products')).data.find((x) => x.id === id);
  assert.match(p.image, /^\/api\/images\/\d+\?v=1$/);
  assert.equal(app.env.STORAGE.size() >= 1, true, 'la photo est dans le stockage de fichiers, pas dans la base');
  const img = await c.get(p.image);
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
  const sale = await c.post('/api/store/pos/checkout', { mode: 'ticket', lines: [line(p, 3)], payments: [{ method: 'espèces', amount: ttc(p, 3) }] });
  assert.equal(sale.status, 201); assert.equal(sale.data.total_ttc, 72);
  assert.equal((await c.get('/api/store/products')).data.find((x) => x.id === id).stock, 7);
  const before = app.env.STORAGE.size();
  await c.del(`/api/store/products/${id}`);
  assert.equal(app.env.STORAGE.size(), before - 1, 'la suppression du produit supprime sa photo');
});

test('droits : un caissier encaisse mais ne voit ni les chiffres ni les réglages', async () => {
  const owner = app.client(); await owner.signup({ store_name: 'Boutique équipe' });
  const p = (await owner.get('/api/store/products')).data[0];
  const roles = Object.fromEntries((await owner.get('/api/store/roles')).data.roles.map((r) => [r.name, r.id]));
  const email = `caisse${Date.now()}@test.dev`;
  const added = await owner.post('/api/store/team', { name: 'Nadia', email, role_id: roles.Caissier });
  assert.equal(added.status, 201);
  const cashier = app.client();
  assert.equal((await cashier.post('/api/auth/login', { email, password: added.data.temp_password })).status, 200);
  assert.equal((await cashier.post('/api/store/pos/checkout', { mode: 'ticket', lines: [line(p)], payments: [{ method: 'carte', amount: ttc(p) }] })).status, 201);
  assert.equal((await cashier.post('/api/store/pos/checkout', { mode: 'ticket', discount_pct: 10, lines: [line(p)], payments: [{ method: 'carte', amount: ttc(p) * 0.9 }] })).status, 403);
  assert.equal((await cashier.post('/api/store/pos/checkout', { mode: 'ticket', lines: [line(p, 1, { unit_price_ht: p.price_ht / 2 })], payments: [{ method: 'carte', amount: ttc(p) / 2 }] })).status, 403);
  for (const path of ['/api/store/dashboard', '/api/store/team', '/api/store/locations/report']) assert.equal((await cashier.get(path)).status, 403, path);
  assert.equal((await cashier.put('/api/store/settings', { shop_name: 'X' })).status, 403);
  await owner.put(`/api/store/team/${(await owner.get('/api/store/team')).data.find((u) => u.email === email).id}`, { role_id: roles['Gérant'], locations: [] });
  assert.equal((await cashier.get('/api/store/dashboard')).status, 200, 'changement de rôle immédiat');
});

test('boutiques : transfert de stock et rapport comparatif', async () => {
  const c = app.client(); await c.signup({ store_name: 'Deux boutiques' });
  const main = (await c.get('/api/store/locations')).data.locations[0];
  const second = (await c.post('/api/store/locations', { name: 'Centre-ville' })).data;
  const p = (await c.post('/api/store/products', { name: 'Vis', price_ht: 5, stock: 20 })).data;
  const prod = () => c.get('/api/store/products', { 'x-location': 'all' }).then((r) => r.data.find((x) => x.id === p.id));
  assert.equal((await c.post('/api/store/stock/transfer', { product_id: p.id, from: main.id, to: second.id, qty: 8 })).status, 201);
  let x = await prod(); assert.equal(x.stock, 20); assert.equal(x.stock_by_location[second.id], 8);
  c.location = second.id;
  await c.post('/api/store/pos/checkout', { mode: 'ticket', lines: [line(x, 2)], payments: [{ method: 'espèces', amount: ttc(x, 2) }] });
  x = await prod(); assert.equal(x.stock_by_location[second.id], 6); assert.equal(x.stock, 18);
  c.location = 'all';
  const rep = (await c.get('/api/store/locations/report?period=30')).data;
  assert.equal(rep.locations[0].name, 'Centre-ville'); assert.equal(rep.locations[0].share, 100);
  assert.equal((await c.post('/api/store/stock/transfer', { product_id: p.id, from: main.id, to: second.id, qty: 999 })).status, 409);
});

test('fidélité : points gagnés, récompense, annulation', async () => {
  const c = app.client(); await c.signup({ store_name: 'Épicerie fidèle', country: 'MA', business_type: 'alimentation' });
  await c.put('/api/store/settings', { loyalty_enabled: '1' });
  const p = (await c.post('/api/store/products', { name: 'Huile', price_ht: 100, tva_rate: 20, stock: 50 })).data;
  const prod = (await c.get('/api/store/products')).data.find((x) => x.id === p.id);
  const cust = (await c.post('/api/store/customers', { name: 'Amina' })).data;
  const s1 = (await c.post('/api/store/pos/checkout', { mode: 'ticket', customer_id: cust.id, lines: [line(prod, 10)], payments: [{ method: 'espèces', amount: 1200 }] })).data;
  assert.equal(s1.loyalty.earned, 120, '1 point par 10 DH au Maroc');
  const pct = (50 / 120) * 100;
  const s2 = await c.post('/api/store/pos/checkout', { mode: 'ticket', customer_id: cust.id, loyalty_redeem: true, loyalty_pct: pct, lines: [line(prod)], payments: [{ method: 'carte', amount: 70 }] });
  assert.equal(s2.status, 201); assert.equal(s2.data.total_ttc, 70); assert.equal(s2.data.loyalty.used, 100);
  const before = (await c.get(`/api/store/customers/${cust.id}/loyalty`)).data.balance;
  await c.post(`/api/store/documents/${s2.data.id}/status`, { status: 'annulé' });
  assert.equal((await c.get(`/api/store/customers/${cust.id}/loyalty`)).data.balance, before + 100 - 7, 'points rendus à l’annulation');
});

test('import de produits : création, mise à jour sans doublon, erreurs par ligne', async () => {
  const c = app.client(); await c.signup({ store_name: 'Import' });
  const rows = [{ line: 2, name: 'Perceuse', ref: 'PER', barcode: '3700000000011', category: 'Outillage', price_ht: 100, stocks: {} }, { line: 3, name: '', price_ht: 1 }];
  const r1 = (await c.post('/api/store/import/products', { source: 'test', rows, options: { delete_examples: true } })).data;
  assert.equal(r1.created, 1); assert.equal(r1.categories_created, 1); assert.deepEqual(r1.errors.map((e) => e.line), [3]);
  const r2 = (await c.post('/api/store/import/products', { source: 'test', rows: [{ ...rows[0], price_ht: 90 }] })).data;
  assert.equal(r2.updated, 1); assert.equal(r2.created, 0);
  const list = (await c.get('/api/store/products')).data;
  assert.equal(list.length, 1, 'produits d’exemple retirés, aucun doublon'); assert.equal(list[0].price_ht, 90);
});

test('pages publiques : tarifs par pays, vitrine, plan du site, pages légales et aide', async () => {
  const c = app.client(); const { slug } = await c.signup({ store_name: 'Vitrine Test', country: 'SN', business_type: 'alimentation' });
  const home = await c.get('/?pays=MA');
  assert.equal(home.status, 200); assert.match(home.text, /419\s?DH/); assert.match(home.text, /"priceCurrency":"MAD"/);
  assert.match(home.headers.get('set-cookie') || '', /cp_pays=MA/);
  const v = await c.get(`/s/${slug}`);
  assert.equal(v.status, 200); assert.match(v.text, /<title>Vitrine Test : catalogue/); assert.match(v.text, /class="card"/); assert.match(v.text, /"@type":"Store"/);
  assert.equal((await c.get('/s/n-existe-pas')).status, 404);
  assert.match((await c.get('/sitemap.xml')).text, new RegExp(`/s/${slug}<`));
  for (const p of ['/cgu', '/confidentialite', '/aide', '/aide/caisse', '/logiciel-de-caisse/epicerie']) assert.equal((await c.get(p)).status, 200, p);
  assert.match((await c.get('/robots.txt')).text, /Disallow: \/app\//);
});

test('console de la plateforme réservée à l’administrateur', async () => {
  const admin = app.client(); await admin.signup({ email: 'admin@test.dev', store_name: 'Admin' });
  assert.equal((await admin.get('/api/console/overview')).status, 200);
  const other = app.client(); await other.signup({ store_name: 'Autre' });
  assert.equal((await other.get('/api/console/overview')).status, 403);
});

test('tâche du matin : une seule exécution par jour, même appelée deux fois', async () => {
  const first = await runDailyTasks(app.env);
  assert.ok(Array.isArray(first.done));
  assert.deepEqual(await runDailyTasks(app.env), { skipped: true });
});
