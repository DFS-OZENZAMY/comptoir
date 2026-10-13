// Achats et fournisseurs : fiches, suggestions depuis les alertes, bons de commande, réception, coût moyen pondéré, droits, rapport.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

async function setup() {
  const app = await startApp();
  const shop = app.client(); await shop.signup({ store_name: 'Épicerie Amina', demo: false });
  const sup = (await shop.post('/api/store/suppliers', { name: 'Grossiste Atlas', contact: 'Hassan', phone: '0612345678', email: 'commandes@atlas.ma', lead_days: 3 })).data.id;
  const mk = async (name, stock, stock_min, purchase_price, supplier_id = sup) => (await shop.post('/api/store/products', { name, price_ht: purchase_price * 1.5, tva_rate: 20, stock, stock_min, purchase_price, supplier_id })).data.id;
  return { app, shop, sup, mk };
}

test('fournisseurs : création, validation, fournisseur par défaut, archivage s’il a servi', async () => {
  const { shop, sup, mk } = await setup();
  assert.equal((await shop.post('/api/store/suppliers', { name: 'X', email: 'pas-un-mail' })).status, 400);
  assert.equal((await shop.post('/api/store/suppliers', { name: '' })).status, 400);
  const p = await mk('Thé vert 200 g', 2, 5, 10);
  assert.equal((await shop.get('/api/store/products')).data.find((x) => x.id === p).supplier_id, sup, 'fournisseur par défaut du produit');
  const list = (await shop.get('/api/store/suppliers')).data;
  assert.equal(list[0].name, 'Grossiste Atlas'); assert.equal(list[0].products, 1);
  const tmp = (await shop.post('/api/store/suppliers', { name: 'Jamais utilisé' })).data.id;
  assert.equal((await shop.del(`/api/store/suppliers/${tmp}`)).data.archived, false, 'jamais utilisé : supprimé');
  await shop.post('/api/store/purchases', { supplier_id: sup, lines: [{ product_id: p, qty: 3 }] });
  assert.equal((await shop.del(`/api/store/suppliers/${sup}`)).data.archived, true, 'déjà dans un bon : archivé');
  assert.equal((await shop.get('/api/store/products')).data.find((x) => x.id === p).supplier_id, null);
});

test('suggestions depuis les alertes : par fournisseur, quantité pour revenir au double du seuil, moins ce qui est déjà commandé', async () => {
  const { shop, sup, mk } = await setup();
  const the = await mk('Thé vert 200 g', 2, 5, 10);           // objectif 10 → 8
  const huile = await mk('Huile d’olive 1 L', 0, 4, 40);       // objectif 8 → 8
  await mk('Sucre 1 kg', 20, 5, 6);                             // au-dessus du seuil : rien
  const sansFour = await mk('Menthe (botte)', 0, 0, 2, null);   // rupture, sans fournisseur → 1
  const g = (await shop.get('/api/store/purchases/suggestions')).data.groups;
  const atlas = g.find((x) => x.supplier_id === sup), none = g.find((x) => x.supplier_id === null);
  assert.deepEqual(atlas.lines.map((l) => [l.product_id, l.qty]).sort(), [[huile, 8], [the, 8]].sort());
  assert.deepEqual(none.lines.map((l) => [l.product_id, l.qty]), [[sansFour, 1]]);
  await shop.post('/api/store/purchases', { supplier_id: sup, lines: [{ product_id: the, qty: 5 }] });
  const after = (await shop.get('/api/store/purchases/suggestions')).data.groups.find((x) => x.supplier_id === sup);
  assert.equal(after.lines.find((l) => l.product_id === the).qty, 3, 'déjà 5 en commande : 3 de plus');
});

test('cycle complet : brouillon, envoi, réception partielle puis complète, stock et coût moyen pondéré', async () => {
  const { app, shop, sup, mk } = await setup();
  const the = await mk('Thé vert 200 g', 10, 5, 5);
  const huile = await mk('Huile d’olive 1 L', 0, 2, 40);
  let o = (await shop.post('/api/store/purchases', { supplier_id: sup, lines: [{ product_id: the, qty: 10, unit_cost: 7 }, { product_id: huile, qty: 4 }] })).data;
  assert.match(o.number, /^BC-\d{4}-0001$/); assert.equal(o.status, 'brouillon'); assert.equal(o.total_ht, 230);
  assert.ok(o.expected_date, 'livraison prévue d’après le délai du fournisseur');
  o = (await shop.put(`/api/store/purchases/${o.id}`, { supplier_id: sup, lines: [{ product_id: the, qty: 10, unit_cost: 7 }, { product_id: huile, qty: 6 }] })).data;
  assert.equal(o.total_ht, 310, 'brouillon modifiable');
  const sent = (await shop.post(`/api/store/purchases/${o.id}/send`)).data;
  assert.equal(sent.order.status, 'envoyé'); assert.match(sent.url, /\/r\/[\w-]{22}$/);
  assert.equal((await shop.put(`/api/store/purchases/${o.id}`, { supplier_id: sup, lines: [{ product_id: the, qty: 1 }] })).status, 400, 'envoyé : plus modifiable');
  const page = await (await app.handle(new Request(sent.url))).text();
  for (const t of ['Bon de commande', o.number, 'Grossiste Atlas', 'Thé vert 200 g', '310,00']) assert.ok(page.includes(t), t);
  // Réception partielle : 10 thés à 7 (stock 10 à 5 → coût moyen 6), 2 huiles sur 6
  const [lt, lh] = o.lines;
  o = (await shop.post(`/api/store/purchases/${o.id}/receive`, { lines: [{ line_id: lt.id, qty: 10 }, { line_id: lh.id, qty: 2 }] })).data;
  assert.equal(o.status, 'partiel');
  let ps = (await shop.get('/api/store/products')).data;
  assert.equal(ps.find((p) => p.id === the).stock, 20); assert.equal(ps.find((p) => p.id === the).purchase_price, 6, 'coût moyen pondéré (10×5 + 10×7) / 20');
  assert.equal(ps.find((p) => p.id === huile).stock, 2); assert.equal(ps.find((p) => p.id === huile).purchase_price, 40, 'stock nul avant : coût de la livraison');
  const mv = (await shop.get('/api/store/stock')).data;
  assert.ok((mv.movements || mv).some((m) => m.reason === `Réception ${o.number}` && m.qty === 10), 'mouvement tracé');
  // Reste des huiles, à un prix différent
  o = (await shop.post(`/api/store/purchases/${o.id}/receive`, { lines: [{ line_id: lh.id, qty: 4, unit_cost: 46 }] })).data;
  assert.equal(o.status, 'reçu');
  ps = (await shop.get('/api/store/products')).data;
  assert.equal(ps.find((p) => p.id === huile).stock, 6); assert.equal(ps.find((p) => p.id === huile).purchase_price, 44, '(2×40 + 4×46) / 6');
  assert.equal((await shop.post(`/api/store/purchases/${o.id}/receive`, { lines: [{ line_id: lh.id, qty: 1 }] })).status, 400, 'reçu : clos');
  const rep = (await shop.get('/api/store/purchases/report')).data;
  assert.equal(rep.this_month_ht, 70 + 80 + 184); assert.equal(rep.by_supplier[0].supplier_name, 'Grossiste Atlas');
});

test('annulation et clôture, suppression des seuls brouillons, numérotation continue', async () => {
  const { shop, sup, mk } = await setup();
  const p = await mk('Riz 5 kg', 0, 2, 30);
  const a = (await shop.post('/api/store/purchases', { supplier_id: sup, lines: [{ product_id: p, qty: 4 }] })).data;
  const b = (await shop.post('/api/store/purchases', { supplier_id: sup, lines: [{ product_id: p, qty: 4 }] })).data;
  assert.equal(b.number, a.number.replace(/\d{4}$/, '0002'));
  await shop.post(`/api/store/purchases/${a.id}/send`);
  assert.equal((await shop.del(`/api/store/purchases/${a.id}`)).status, 400, 'envoyé : pas de suppression');
  assert.equal((await shop.post(`/api/store/purchases/${a.id}/cancel`)).data.status, 'annulé', 'rien reçu : annulé');
  await shop.post(`/api/store/purchases/${b.id}/receive`, { lines: [{ line_id: b.lines[0].id, qty: 1 }] });
  const closed = (await shop.post(`/api/store/purchases/${b.id}/cancel`)).data;
  assert.equal(closed.status, 'reçu'); assert.equal(closed.remainder_cancelled, 1, 'en partie reçu : clôturé, reste abandonné');
  const c = (await shop.post('/api/store/purchases', { supplier_id: sup, lines: [{ product_id: p, qty: 1 }] })).data;
  assert.equal((await shop.del(`/api/store/purchases/${c.id}`)).status, 200, 'brouillon supprimé');
  assert.equal((await shop.post('/api/store/purchases', { supplier_id: sup, lines: [{ product_id: p, qty: 0 }] })).status, 400);
  assert.equal((await shop.post('/api/store/purchases', { lines: [{ product_id: p, qty: 1 }] })).status, 400, 'fournisseur obligatoire');
});

test('droits : caissier sans accès, comptable en lecture, magasinier commande et réceptionne', async () => {
  const { app, shop, sup, mk } = await setup();
  const p = await mk('Pâtes 500 g', 1, 5, 4);
  await app.env.DB.prepare("UPDATE stores SET plan = 'business'").run();   // trois membres d'équipe : au-delà de la formule d'essai
  const roles = Object.fromEntries((await shop.get('/api/store/roles')).data.roles.map((r) => [r.name, r.id]));
  const member = async (name, email, role) => {
    const r = await shop.post('/api/store/team', { name, email, role_id: roles[role] }); assert.equal(r.status, 201, JSON.stringify(r.data));
    const c = app.client(); assert.equal((await c.post('/api/auth/login', { email, password: r.data.temp_password })).status, 200); return c;
  };
  const caissier = await member('Nadia', 'nadia@a.ma', 'Caissier'), comptable = await member('Omar', 'omar@a.ma', 'Comptable'), magasinier = await member('Saïd', 'said@a.ma', 'Magasinier');
  assert.equal((await caissier.get('/api/store/purchases')).status, 403);
  assert.equal((await comptable.get('/api/store/purchases')).status, 200);
  assert.equal((await comptable.post('/api/store/purchases', { supplier_id: sup, lines: [{ product_id: p, qty: 1 }] })).status, 403);
  assert.equal((await comptable.post('/api/store/suppliers', { name: 'Nouveau' })).status, 403);
  const o = (await magasinier.post('/api/store/purchases', { supplier_id: sup, lines: [{ product_id: p, qty: 5 }] })).data;
  assert.equal((await magasinier.post(`/api/store/purchases/${o.id}/receive`, { lines: [{ line_id: o.lines[0].id, qty: 5 }] })).data.status, 'reçu');
});
