// Notifications push : chiffrement (exemple officiel RFC 8291), abonnements, droits, alertes de stock,
// anti-doublon, nettoyage des appareils disparus, alertes de plateforme, résumé du matin.
// Le service de notification est simulé : chaque message est déchiffré comme le ferait l'appareil.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { encryptPayload, b64u, isPushEndpoint } from '../src/platform/webpush.js';
import { dailyPushes } from '../src/features/push.js';

test('chiffrement : identique à l’exemple officiel de la RFC 8291', async () => {
  const body = await encryptPayload('When I grow up, I want to be a watermelon',
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg',
    { asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8', asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', salt: 'DGv6ra1nlYgDCS1FRnbzlw' });
  assert.equal(b64u.enc(body), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  assert.ok(isPushEndpoint('https://fcm.googleapis.com/fcm/send/x') && isPushEndpoint('https://web.push.apple.com/x'));
  assert.ok(!isPushEndpoint('https://evil.example.com/x') && !isPushEndpoint('http://fcm.googleapis.com/x'));
});

/* ---------------- Un faux appareil, et un faux service de notification ---------------- */
const enc = new TextEncoder();
async function hkdf(salt, ikm, info, len) { const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8)); }
async function newDevice(n) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)); const auth = crypto.getRandomValues(new Uint8Array(16));
  return { kp, pub, auth, sub: { endpoint: `https://fcm.googleapis.com/fcm/send/appareil-${n}`, keys: { p256dh: b64u.enc(pub), auth: b64u.enc(auth) } } };
}
// Déchiffrement côté appareil (RFC 8291) : prouve que le message est lisible par lui seul.
async function readPush(device, body) {
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), cipher = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, device.kp.privateKey, 256));
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...device.pub, ...asPub]);
  const ikm = await hkdf(device.auth, shared, info, 32);
  const key = await crypto.subtle.importKey('raw', await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12) }, key, cipher));
  return JSON.parse(new TextDecoder().decode(plain.slice(0, plain.lastIndexOf(2))));
}
let inbox = [], devices = {}, gone = new Set();
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://fcm.googleapis.com/')) throw new Error(`Accès réseau inattendu : ${u}`);
  assert.match(init.headers.authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assert.equal(init.headers['content-encoding'], 'aes128gcm');
  if (gone.has(u)) return new Response(null, { status: 410 });
  const device = devices[u];
  inbox.push({ to: u, message: await readPush(device, new Uint8Array(init.body)), urgency: init.headers.urgency, topic: init.headers.topic });
  return new Response(null, { status: 201 });
};

let app, owner, ownerDevice;
before(async () => {
  app = await startApp({ PLATFORM_ADMIN_EMAILS: 'admin@test.dev' });
  owner = app.client(); await owner.signup({ store_name: 'Quincaillerie Atlas', country: 'MA' });
  ownerDevice = await newDevice('proprietaire'); devices[ownerDevice.sub.endpoint] = ownerDevice;
});
beforeEach(() => { inbox = []; });
const flush = () => app.settle();

test('abonnement d’un appareil, préférences et notification d’essai lisible par l’appareil seul', async () => {
  const key = (await owner.get('/api/store/push/key')).data;
  assert.match(key.publicKey, /^[\w-]{87}$/);
  assert.deepEqual(key.categories.map((c) => c.key), ['stock', 'paiements', 'abonnement', 'support'], 'pas de catégorie « plateforme » pour un commerçant');
  assert.equal((await owner.post('/api/store/push/subscriptions', { subscription: ownerDevice.sub })).status, 201);
  assert.equal((await owner.post('/api/store/push/subscriptions', { subscription: { ...ownerDevice.sub, endpoint: 'https://evil.example.com/x' } })).status, 400, 'service inconnu refusé');
  assert.equal((await owner.post('/api/store/push/test', { endpoint: ownerDevice.sub.endpoint })).status, 200);
  assert.equal(inbox.length, 1); assert.equal(inbox[0].message.body, 'Les notifications fonctionnent sur cet appareil.');
  const list = (await owner.get('/api/store/push/subscriptions')).data;
  assert.equal(list.length, 1); assert.equal(list[0].prefs.stock, true);
});

test('alerte de stock : au seuil puis en rupture, sans doublon', async () => {
  const p = (await owner.post('/api/store/products', { name: 'Vis à bois 4x40', price_ht: 10, tva_rate: 20, stock: 8, stock_min: 5 })).data;
  const sell = (qty) => owner.post('/api/store/pos/checkout', { mode: 'ticket', lines: [{ product_id: p.id, label: 'Vis', qty, unit_price_ht: 10, tva_rate: 20 }], payments: [{ method: 'espèces', amount: 12 * qty }] });
  await sell(1); await flush();
  assert.equal(inbox.length, 0, 'stock 7 : au-dessus du seuil, aucune alerte');
  await sell(3); await flush();
  assert.equal(inbox.length, 1); assert.equal(inbox[0].message.title, 'Stock bas : Vis à bois 4x40'); assert.match(inbox[0].message.body, /Il en reste 4 pièces \(seuil : 5\)/);
  assert.equal(inbox[0].message.url, '/app/#/alertes');
  await sell(1); await flush();
  assert.equal(inbox.length, 1, 'même alerte le même jour : pas de doublon');
  await sell(3); await flush();
  assert.equal(inbox.length, 2); assert.equal(inbox[1].message.title, 'Rupture : Vis à bois 4x40');
});

test('droits : un caissier ne reçoit pas les alertes de stock', async () => {
  const roles = Object.fromEntries((await owner.get('/api/store/roles')).data.roles.map((r) => [r.name, r.id]));
  const added = (await owner.post('/api/store/team', { name: 'Nadia', email: 'nadia@test.dev', role_id: roles.Caissier })).data;
  const cashier = app.client(); await cashier.post('/api/auth/login', { email: 'nadia@test.dev', password: added.temp_password });
  assert.deepEqual((await cashier.get('/api/store/push/key')).data.categories.map((c) => c.key), ['support'], 'un caissier ne reçoit que les messages du support');
  const dev = await newDevice('caissier'); devices[dev.sub.endpoint] = dev;
  await cashier.post('/api/store/push/subscriptions', { subscription: dev.sub, prefs: { stock: true } });
  const p = (await owner.post('/api/store/products', { name: 'Cadenas', price_ht: 10, stock: 1, stock_min: 2 })).data;
  await owner.post('/api/store/stock', { product_id: p.id, type: 'sortie', qty: 1, reason: 'casse' }); await flush();
  assert.ok(inbox.length >= 1, 'le propriétaire est prévenu');
  assert.ok(inbox.every((i) => i.to !== dev.sub.endpoint), 'le caissier ne l’est pas');
});

test('appareil désinstallé : abonnement supprimé automatiquement', async () => {
  const dev = await newDevice('ancien'); devices[dev.sub.endpoint] = dev;
  await owner.post('/api/store/push/subscriptions', { subscription: dev.sub });
  gone.add(dev.sub.endpoint);
  await owner.post('/api/store/push/test', { endpoint: dev.sub.endpoint }).catch(() => {});
  assert.ok(!(await owner.get('/api/store/push/subscriptions')).data.some((d) => d.endpoint === dev.sub.endpoint));
});

test('plateforme : l’administrateur est prévenu des inscriptions et des demandes de formule', async () => {
  const admin = app.client(); await admin.signup({ email: 'admin@test.dev', store_name: 'Plateforme' });
  assert.ok((await admin.get('/api/store/push/key')).data.categories.some((c) => c.key === 'plateforme'));
  const dev = await newDevice('admin'); devices[dev.sub.endpoint] = dev;
  await admin.post('/api/store/push/subscriptions', { subscription: dev.sub });
  const shop = app.client(); await shop.signup({ store_name: 'Épicerie Baraka' }); await flush();
  const forAdmin = inbox.filter((i) => i.to === dev.sub.endpoint);
  assert.equal(forAdmin[0]?.message.title, 'Nouvelle inscription'); assert.match(forAdmin[0].message.body, /Épicerie Baraka/);
  await shop.post('/api/store/subscription', { plan: 'pro' }); await flush();
  assert.ok(inbox.some((i) => i.to === dev.sub.endpoint && i.message.title === 'Demande de formule'));
  assert.ok(!inbox.some((i) => i.to === ownerDevice.sub.endpoint && /inscription|formule/i.test(i.message.title)), 'un commerçant ne reçoit pas les alertes de la plateforme');
});

test('résumé du matin : stock à réapprovisionner et fin d’essai', async () => {
  const t = new Date(); t.setUTCDate(t.getUTCDate() + 2);
  await app.env.DB.prepare("UPDATE stores SET trial_ends_at = ? WHERE name = 'Quincaillerie Atlas'").bind(t.toISOString().slice(0, 10)).run();
  const r = await dailyPushes(app.env);
  const mine = inbox.filter((i) => i.to === ownerDevice.sub.endpoint).map((i) => i.message.title);
  assert.ok(mine.includes('À réapprovisionner') && mine.includes('Votre essai se termine bientôt'), mine.join(' | '));
  assert.ok(r.sent >= 2);
  inbox = []; await dailyPushes(app.env);
  assert.equal(inbox.filter((i) => i.to === ownerDevice.sub.endpoint).length, 0, 'une seule fois par jour');
});

test('messagerie : chaque message notifié, en priorité haute, dans les deux sens', async () => {
  const admin = app.client(); await admin.post('/api/auth/login', { email: 'admin@test.dev', password: 'motdepasse1' });
  assert.deepEqual((await admin.get('/api/console/push/key')).data.categories.map((c) => c.key), ['messages', 'plateforme'], 'catégories de l’équipe support dans la console');
  const desk = await newDevice('console-support'); devices[desk.sub.endpoint] = desk;
  assert.equal((await admin.post('/api/console/push/subscriptions', { subscription: desk.sub })).status, 201);
  assert.ok((await admin.get('/api/console/push/subscriptions')).data.some((d) => d.endpoint === desk.sub.endpoint));
  inbox = [];
  await owner.post('/api/store/support/messages', { body: 'Premier message' });
  await owner.post('/api/store/support/messages', { body: 'Deuxième message' }); await flush();
  const toSupport = inbox.filter((i) => i.to === desk.sub.endpoint);
  assert.deepEqual(toSupport.map((i) => i.message.title), ['Quincaillerie Atlas', 'Quincaillerie Atlas · 2 nouveaux messages'], 'chaque message, sans anti-doublon');
  assert.match(toSupport[1].message.body, /: Deuxième message$/);
  assert.ok(toSupport.every((i) => i.urgency === 'high' && /^chat\d+$/.test(i.topic) && i.message.kind === 'chat'), 'priorité haute et sujet par conversation');
  assert.match(toSupport[0].message.url, /^\/console\/#\/messagerie\/\d+$/);
  const tid = (await admin.get('/api/console/support/threads')).data.threads[0].id;
  await admin.post(`/api/console/support/threads/${tid}/messages`, { body: 'Réponse une' });
  await admin.post(`/api/console/support/threads/${tid}/messages`, { body: 'Réponse deux' }); await flush();
  const toShop = inbox.filter((i) => i.to === ownerDevice.sub.endpoint && i.message.kind === 'chat');
  assert.deepEqual(toShop.map((i) => i.message.title), ['Support Comptoir', 'Support Comptoir · 2 nouveaux messages']);
  assert.ok(toShop.every((i) => i.urgency === 'high' && i.message.url === '/app/#/support'));
});
