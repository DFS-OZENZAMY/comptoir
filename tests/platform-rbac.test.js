// RBAC plateforme : rôles, permissions, accès console granulaires.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

let app, owner, analyst;

before(async () => {
  app = await startApp({ PLATFORM_ADMIN_EMAILS: 'owner@comptoir.test' });
  owner = app.client();
  await owner.signup({ name: 'Owner Admin', email: 'owner@comptoir.test', store_name: 'Boutique Owner', country: 'FR' });
});

test('super-admin (PLATFORM_ADMIN_EMAILS) a toutes les permissions console', async () => {
  const me = (await owner.get('/api/console/me')).data;
  assert.equal(me.super, true);
  assert.ok(me.permissions.includes('platform.roles.manage'));
  assert.ok(me.permissions.includes('platform.system.backups'));
});

test('rôles système seedés et invitation d’un analyste en lecture seule', async () => {
  const roles = (await owner.get('/api/console/roles')).data;
  const names = roles.map((r) => r.name);
  assert.ok(names.includes('Propriétaire'));
  assert.ok(names.includes('Analyste'));
  assert.ok(names.includes('Support'));
  const analystRole = roles.find((r) => r.name === 'Analyste');
  const invited = (await owner.post('/api/console/staff', {
    name: 'Ana Lyste', email: 'analyste@comptoir.test', role_id: analystRole.id,
  })).data;
  assert.ok(invited.temp_password);

  analyst = app.client();
  await analyst.post('/api/auth/login', { email: 'analyste@comptoir.test', password: invited.temp_password });
  const me = (await analyst.get('/api/console/me')).data;
  assert.equal(me.super, false);
  assert.equal(me.role.name, 'Analyste');
  assert.ok(me.permissions.includes('platform.revenue'));
  assert.ok(!me.permissions.includes('platform.staff.manage'));
  assert.ok(!me.permissions.includes('platform.system.backups'));

  // Lecture revenus OK
  assert.equal((await analyst.get('/api/console/revenue')).status, 200);
  // Écriture / système refusés
  assert.equal((await analyst.get('/api/console/backups')).status, 403);
  assert.equal((await analyst.post('/api/console/staff', { email: 'x@y.z', name: 'X', role_id: analystRole.id })).status, 403);
});

test('un compte hors équipe n’accède pas à la console', async () => {
  const shop = app.client();
  await shop.signup({ name: 'Commercant', email: 'shop@example.com', store_name: 'Épicerie Test', country: 'FR' });
  assert.equal((await shop.get('/api/console/overview')).status, 403);
});
