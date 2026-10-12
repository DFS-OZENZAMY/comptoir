// Connexion : protection contre les essais de mots de passe en masse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

test('5 échecs bloquent le compte 15 minutes, même en parallèle ; le bon mot de passe est alors refusé aussi', async () => {
  const app = await startApp();
  const owner = app.client(); await owner.signup({ email: 'karim@atlas.ma', store_name: 'Atlas' });
  const attacker = app.client();
  const tries = await Promise.all(Array.from({ length: 12 }, () => attacker.post('/api/auth/login', { email: 'karim@atlas.ma', password: 'mauvais-mot' })));
  const codes = tries.map((r) => r.status);
  assert.ok(codes.filter((c) => c === 401).length <= 4, `au plus 4 refus simples : ${codes}`);
  assert.ok(codes.includes(429), 'blocage atteint');
  const locked = await app.client().post('/api/auth/login', { email: 'karim@atlas.ma', password: 'motdepasse1' });
  assert.equal(locked.status, 429); assert.match(locked.data.error, /Trop de tentatives.*15 minutes/);
  // Un autre compte reste accessible normalement.
  const other = app.client(); await other.signup({ email: 'awa@boutique.sn', store_name: 'Awa' });
  assert.equal((await app.client().post('/api/auth/login', { email: 'awa@boutique.sn', password: 'motdepasse1' })).status, 200);
});

test('une connexion réussie remet le compteur à zéro', async () => {
  const app = await startApp();
  await app.client().signup({ email: 'lina@mode.ma', store_name: 'Lina' });
  for (let i = 0; i < 4; i++) assert.equal((await app.client().post('/api/auth/login', { email: 'lina@mode.ma', password: 'faux' })).status, 401);
  assert.equal((await app.client().post('/api/auth/login', { email: 'lina@mode.ma', password: 'motdepasse1' })).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await app.client().post('/api/auth/login', { email: 'lina@mode.ma', password: 'faux' })).status, 401, 'compteur reparti de zéro');
});

test('une même adresse IP qui essaie beaucoup de comptes est bloquée', async () => {
  const app = await startApp();
  const ip = { 'cf-connecting-ip': '203.0.113.9' };
  let last;
  for (let i = 0; i < 31; i++) last = await app.client().req('POST', '/api/auth/login', { email: `cible${i}@exemple.com`, password: 'motdepasse1' }, ip);
  assert.equal(last.status, 429);
  assert.equal((await app.client().req('POST', '/api/auth/login', { email: 'autre@exemple.com', password: 'x' }, { 'cf-connecting-ip': '198.51.100.4' })).status, 401, 'les autres adresses ne sont pas touchées');
});
