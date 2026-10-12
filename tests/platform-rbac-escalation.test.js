// Équipe de la plateforme : on ne peut attribuer que des droits qu'on possède soi-même.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

test('un Administrateur ne peut pas donner le rôle Propriétaire ni créer un rôle plus puissant que le sien', async () => {
  const app = await startApp({ PLATFORM_ADMIN_EMAILS: 'owner@comptoir.test' });
  const owner = app.client(); await owner.signup({ email: 'owner@comptoir.test', store_name: 'Comptoir' });
  const roles = Object.fromEntries((await owner.get('/api/console/roles')).data.map((r) => [r.name, r]));
  // Le propriétaire invite Ali comme Administrateur (gère l'équipe, pas les rôles).
  const ali = app.client(); await ali.signup({ email: 'ali@comptoir.test', store_name: 'Boutique Ali' });
  const added = await owner.post('/api/console/staff', { email: 'ali@comptoir.test', role_id: roles['Administrateur'].id });
  assert.equal(added.status, 201, JSON.stringify(added.data));
  // Ali tente d'inviter un complice avec le rôle Propriétaire : refusé.
  const accomplice = app.client(); await accomplice.signup({ email: 'complice@exemple.com', store_name: 'Complice' });
  const esc = await ali.post('/api/console/staff', { email: 'complice@exemple.com', role_id: roles['Propriétaire'].id });
  assert.equal(esc.status, 403); assert.match(esc.data.error, /droits que vous n’avez pas/);
  // Il peut en revanche inviter avec un rôle inclus dans le sien.
  assert.equal((await ali.post('/api/console/staff', { email: 'complice@exemple.com', role_id: roles['Support'].id })).status, 201);
  // Il ne peut pas promouvoir ce membre Propriétaire ensuite.
  const uid = (await owner.get('/api/console/staff')).data.find((m) => m.email === 'complice@exemple.com').id;
  assert.equal((await ali.put(`/api/console/staff/${uid}`, { role_id: roles['Propriétaire'].id })).status, 403);
  // Le propriétaire, lui, peut tout.
  assert.equal((await owner.put(`/api/console/staff/${uid}`, { role_id: roles['Propriétaire'].id })).status, 200);
});

test('un gestionnaire de rôles ne peut pas créer un rôle avec des droits qu’il n’a pas', async () => {
  const app = await startApp({ PLATFORM_ADMIN_EMAILS: 'owner@comptoir.test' });
  const owner = app.client(); await owner.signup({ email: 'owner@comptoir.test', store_name: 'Comptoir' });
  const custom = (await owner.post('/api/console/roles', { name: 'Chef de rôles', permissions: ['platform.roles.manage', 'platform.staff.view', 'platform.overview'] })).data;
  const lina = app.client(); await lina.signup({ email: 'lina@comptoir.test', store_name: 'Lina' });
  assert.equal((await owner.post('/api/console/staff', { email: 'lina@comptoir.test', role_id: custom.id })).status, 201);
  const big = await lina.post('/api/console/roles', { name: 'Tout-puissant', permissions: ['platform.staff.manage', 'platform.overview'] });
  assert.equal(big.status, 403);
  assert.equal((await lina.post('/api/console/roles', { name: 'Lecture', permissions: ['platform.overview'] })).status, 201);
  assert.equal((await lina.put(`/api/console/roles/${custom.id}`, { permissions: ['platform.roles.manage', 'platform.staff.view', 'platform.overview', 'platform.system.backups'] })).status, 403, 'elle ne peut pas élargir son propre rôle');
});
