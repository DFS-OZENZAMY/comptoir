// Voyant de l'état du système : seules les erreurs non traitées l'allument.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

test('« Marquer comme traitées » éteint le voyant ; une nouvelle erreur le rallume', async () => {
  const app = await startApp({ PLATFORM_ADMIN_EMAILS: 'admin@test.dev' });
  const admin = app.client(); await admin.signup({ email: 'admin@test.dev', store_name: 'Comptoir' });
  const addError = (msg) => app.env.DB.prepare("INSERT INTO error_log (method, route, path, status, message, created_at) VALUES ('GET', 'chat', '/api/chat/socket', 500, ?, datetime('now', '-10 minutes'))").bind(msg).run();
  await addError('D1_ERROR: UNIQUE constraint failed: platform_roles.name');
  assert.equal((await admin.get('/api/console/system')).data.errors_state.open, 1);
  assert.equal((await admin.get('/api/console/overview')).data.system.errors_open, 1);
  const ack = await admin.post('/api/console/system/ack');
  assert.equal(ack.status, 200); assert.equal(ack.data.open, 0);
  assert.equal((await admin.get('/api/console/overview')).data.system.errors_open, 0, 'voyant au vert');
  assert.equal((await admin.get('/api/console/system')).data.errors.length, 1, 'l’erreur reste consultable');
  await new Promise((r) => setTimeout(r, 1100));
  await app.env.DB.prepare("INSERT INTO error_log (method, route, path, status, message) VALUES ('GET', 'x', '/api/x', 500, 'Nouvelle erreur')").run();
  assert.equal((await admin.get('/api/console/system')).data.errors_state.open, 1, 'une nouvelle erreur rallume le voyant');
  const shop = app.client(); await shop.signup({ store_name: 'Commerçant' });
  assert.equal((await shop.post('/api/console/system/ack')).status, 403, 'réservé à l’équipe Comptoir');
});
