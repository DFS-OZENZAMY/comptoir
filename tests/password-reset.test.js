// Mot de passe oublié : lien à usage unique par e-mail, 30 minutes, même réponse pour toutes les adresses, limites, sessions fermées.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

const linkIn = (mail) => (mail.html.match(/href="([^"]+reinitialiser\?jeton=([\w-]+))"/) || [])[2];

async function setup() {
  const app = await startApp();
  app.env.MAIL_OUTBOX = [];
  const shop = app.client(); await shop.signup({ store_name: 'Épicerie Amina', email: 'amina@test.ma', password: 'ancienmotdepasse' });
  return { app, shop, outbox: app.env.MAIL_OUTBOX };
}

test('même réponse pour une adresse inconnue, e-mail seulement pour un compte existant', async () => {
  const { app, outbox } = await setup();
  const anon = app.client();
  const a = await anon.post('/api/auth/forgot', { email: 'personne@nulle-part.ma' });
  const b = await anon.post('/api/auth/forgot', { email: 'Amina@Test.ma' });
  assert.equal(a.status, 200); assert.deepEqual(a.data, b.data, 'réponses identiques');
  assert.equal(outbox.length, 1); assert.equal(outbox[0].to, 'amina@test.ma');
  assert.match(outbox[0].subject, /mot de passe/i); assert.ok(linkIn(outbox[0]), 'lien dans l’e-mail');
  assert.equal((await anon.post('/api/auth/forgot', { email: 'pas-une-adresse' })).status, 400);
});

test('lien : usage unique, sessions fermées, ancien mot de passe refusé, connexion directe', async () => {
  const { app, shop, outbox } = await setup();
  const other = app.client(); await other.post('/api/auth/login', { email: 'amina@test.ma', password: 'ancienmotdepasse' });
  const anon = app.client();
  await anon.post('/api/auth/forgot', { email: 'amina@test.ma' });
  const token = linkIn(outbox[0]);
  const check = (await anon.get(`/api/auth/reset?jeton=${token}`)).data;
  assert.equal(check.valid, true); assert.match(check.email, /^am•+@test\.ma$/, 'adresse masquée');
  assert.equal((await anon.post('/api/auth/reset', { token, password: 'court' })).status, 400);
  const ok = await anon.post('/api/auth/reset', { token, password: 'nouveaumotdepasse' });
  assert.equal(ok.status, 200);
  assert.equal((await anon.get('/api/auth/me')).data.authenticated, true, 'connecté directement');
  assert.equal((await shop.get('/api/auth/me')).data.authenticated, false, 'ancienne session fermée');
  assert.equal((await other.get('/api/auth/me')).data.authenticated, false, 'autre appareil déconnecté');
  assert.equal((await anon.post('/api/auth/reset', { token, password: 'encoreunautre' })).status, 400, 'usage unique');
  assert.equal((await app.client().post('/api/auth/login', { email: 'amina@test.ma', password: 'ancienmotdepasse' })).status, 401);
  assert.equal((await app.client().post('/api/auth/login', { email: 'amina@test.ma', password: 'nouveaumotdepasse' })).status, 200);
});

test('expiration, nouvelle demande qui annule l’ancien lien, faux lien', async () => {
  const { app, outbox } = await setup();
  const anon = app.client();
  await anon.post('/api/auth/forgot', { email: 'amina@test.ma' }); const first = linkIn(outbox[0]);
  await anon.post('/api/auth/forgot', { email: 'amina@test.ma' }); const second = linkIn(outbox[1]);
  assert.equal((await anon.get(`/api/auth/reset?jeton=${first}`)).data.valid, false, 'ancien lien annulé');
  await app.env.DB.prepare("UPDATE password_resets SET expires_at = '2000-01-01T00:00:00.000Z'").run();
  assert.equal((await anon.post('/api/auth/reset', { token: second, password: 'nouveaumotdepasse' })).status, 400, 'expiré');
  assert.equal((await anon.get('/api/auth/reset?jeton=nimportequoinimportequoi')).data.valid, false);
});

test('limites : 3 e-mails par adresse et par heure (en silence), 10 demandes par adresse IP', async () => {
  const { app, outbox } = await setup();
  const anon = app.client();
  for (let i = 0; i < 5; i++) assert.equal((await anon.post('/api/auth/forgot', { email: 'amina@test.ma' })).status, 200);
  assert.equal(outbox.length, 3, 'au plus 3 e-mails, réponse inchangée');
  for (let i = 0; i < 5; i++) await anon.post('/api/auth/forgot', { email: `x${i}@test.ma` });
  assert.equal((await anon.post('/api/auth/forgot', { email: 'y@test.ma' })).status, 429, 'trop de demandes depuis la même connexion');
});

test('réinitialisation : lève le blocage de connexion du compte', async () => {
  const { app, outbox } = await setup();
  const anon = app.client();
  for (let i = 0; i < 5; i++) await anon.post('/api/auth/login', { email: 'amina@test.ma', password: 'mauvais-mot' });
  assert.equal((await app.client().post('/api/auth/login', { email: 'amina@test.ma', password: 'ancienmotdepasse' })).status, 429, 'compte bloqué');
  await app.client().post('/api/auth/forgot', { email: 'amina@test.ma' });
  assert.equal((await app.client().post('/api/auth/reset', { token: linkIn(outbox[0]), password: 'nouveaumotdepasse' })).status, 200);
  assert.equal((await app.client().post('/api/auth/login', { email: 'amina@test.ma', password: 'nouveaumotdepasse' })).status, 200, 'débloqué');
});

test('console : lien de réinitialisation pour le support, réservé à l’équipe autorisée', async () => {
  const { app } = await setup();
  const admin = app.client(); await admin.signup({ store_name: 'Plateforme', email: 'admin@test.dev' });
  const uid = (await app.env.DB.prepare("SELECT id FROM users WHERE email = 'amina@test.ma'").first()).id;
  const sid = (await app.env.DB.prepare("SELECT store_id FROM memberships WHERE user_id = ?").bind(uid).first()).store_id;
  await app.env.DB.prepare("UPDATE stores SET country = 'MA' WHERE id = ?").bind(sid).run();
  await app.env.DB.prepare("INSERT OR REPLACE INTO settings (store_id, key, value) VALUES (?, 'phone', '06 12 34 56 78')").bind(sid).run();
  const r = await admin.post(`/api/console/users/${uid}/reset-link`);
  assert.equal(r.status, 200); assert.match(r.data.url, /\/app\/#\/reinitialiser\?jeton=[\w-]{40,}/); assert.equal(r.data.minutes, 30);
  assert.equal(r.data.phone_intl, '212612345678', 'numéro marocain au format international pour WhatsApp');
  const anon = app.client();
  assert.equal((await anon.post('/api/auth/reset', { token: r.data.url.split('jeton=')[1], password: 'choisiparamina' })).status, 200);
  const shopkeeper = app.client(); await shopkeeper.post('/api/auth/login', { email: 'amina@test.ma', password: 'choisiparamina' });
  assert.equal((await shopkeeper.post(`/api/console/users/${uid}/reset-link`)).status, 403, 'un commerçant ne peut pas');
});
