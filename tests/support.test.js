// Messagerie avec le support : parcours complet, sécurité, et temps réel avec de vrais WebSockets.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { startApp } from './helpers.js';
import { attachChat } from '../src/adapters/node/websocket.js';

let app, shop, admin, other, server, port;
before(async () => {
  app = await startApp({ PLATFORM_ADMIN_EMAILS: 'sofia@comptoir.test' });
  admin = app.client(); await admin.signup({ name: 'Sofia Benali', email: 'sofia@comptoir.test', store_name: 'Comptoir' });
  shop = app.client(); await shop.signup({ name: 'Karim Haddad', store_name: 'Quincaillerie Atlas', country: 'MA' });
  other = app.client(); await other.signup({ name: 'Awa Diop', store_name: 'Boutique Awa', country: 'SN' });
  await startServer();
});
const events = () => app.env.REALTIME.events;

test('le commerçant écrit, le support reçoit, prend en charge et répond', async () => {
  assert.deepEqual((await shop.get('/api/store/support')).data.messages, []);
  const sent = await shop.post('/api/store/support/messages', { body: '  Bonjour, comment importer mes produits ?  ', context: { page: '#/importer', title: 'Produits' } });
  assert.equal(sent.status, 201); assert.equal(sent.data.body, 'Bonjour, comment importer mes produits ?'); assert.equal(sent.data.author_name, 'Karim Haddad');
  await app.settle();
  assert.ok(events().some((e) => e.event.type === 'message' && e.channels.includes('support')), 'le support est prévenu en temps réel');

  const list = (await admin.get('/api/console/support/threads')).data;
  assert.equal(list.threads.length, 1); assert.equal(list.threads[0].store_name, 'Quincaillerie Atlas'); assert.equal(list.threads[0].unread_support, 1);
  const tid = list.threads[0].id;
  const detail = (await admin.get(`/api/console/support/threads/${tid}`)).data;
  assert.equal(detail.store.owner_name, 'Karim Haddad'); assert.equal(detail.context.page, '#/importer');

  assert.equal((await admin.post(`/api/console/support/threads/${tid}/messages`, { body: 'Ouvrez Produits › Importer.' })).status, 201);
  const thread = (await shop.get('/api/store/support')).data;
  assert.deepEqual(thread.messages.map((m) => [m.author_role, m.body]), [
    ['client', 'Bonjour, comment importer mes produits ?'], ['systeme', 'Sofia a pris en charge la conversation'], ['support', 'Ouvrez Produits › Importer.'],
  ]);
  assert.equal(thread.messages[2].author_name, 'Sofia'); assert.equal(thread.thread.unread_store, 1); assert.equal(thread.thread.assigned_name, 'Sofia Benali');
});

test('accusés de lecture, résolution et réouverture', async () => {
  const tid = (await shop.get('/api/store/support')).data.thread.id;
  await shop.post('/api/store/support/read'); await app.settle();
  assert.equal((await shop.get('/api/store/support')).data.thread.unread_store, 0);
  assert.ok(events().some((e) => e.event.type === 'read' && e.event.side === 'client'), 'le support voit « Lu »');
  await admin.put(`/api/console/support/threads/${tid}`, { status: 'résolue' });
  assert.equal((await admin.get('/api/console/support/threads?filtre=resolues')).data.threads.length, 1);
  assert.match((await shop.get('/api/store/support')).data.messages.at(-1).body, /marqué la conversation comme résolue/);
  await shop.post('/api/store/support/messages', { body: 'Encore une question !' });
  assert.equal((await admin.get(`/api/console/support/threads/${tid}`)).data.thread.status, 'ouverte', 'un nouveau message rouvre la conversation');
  const counts = (await admin.get('/api/console/support/threads')).data.counts;
  assert.equal(counts.non_lues, 1); assert.equal(counts.miennes, 1);
});

test('sécurité : isolement des commerces, console réservée, messages vérifiés', async () => {
  assert.deepEqual((await other.get('/api/store/support')).data.messages, [], 'un autre commerce ne voit rien');
  assert.equal((await shop.get('/api/console/support/threads')).status, 403);
  assert.equal((await shop.post('/api/store/support/messages', { body: '   ' })).status, 400);
  assert.equal((await shop.post('/api/store/support/messages', { body: 'x'.repeat(4001) })).status, 400);
  assert.equal((await admin.get('/api/console/support/threads/999999')).status, 404);
  const roles = Object.fromEntries((await shop.get('/api/store/roles')).data.roles.map((r) => [r.name, r.id]));
  const added = (await shop.post('/api/store/team', { name: 'Nadia', email: 'nadia@atlas.ma', role_id: roles.Caissier })).data;
  const cashier = app.client(); await cashier.post('/api/auth/login', { email: 'nadia@atlas.ma', password: added.temp_password });
  assert.equal((await cashier.post('/api/store/support/messages', { body: 'Question de la caissière' })).status, 201, 'tout membre peut écrire');
  assert.ok((await cashier.get('/api/store/push/key')).data.categories.some((c) => c.key === 'support'), 'et recevoir les réponses en notification');
});

/* ---------------- Temps réel : serveur HTTP + vrais WebSockets ---------------- */
async function startServer() {
  server = createServer(async (req, res) => {
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    const init = { method: req.method, headers }; if (!['GET', 'HEAD'].includes(req.method)) { init.body = Readable.toWeb(req); init.duplex = 'half'; }
    const r = await app.handle(new Request(`http://localhost:${port}${req.url}`, init));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  });
  attachChat(server, app.env);
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); port = server.address().port;
}
after(() => server?.close());

function connect(client, as) {
  return new Promise((ok, ko) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/chat/socket${as ? '?as=' + as : ''}`, { headers: { cookie: client.cookie } });
    const inbox = []; const waiters = [];
    ws.onmessage = (e) => { const d = JSON.parse(e.data); inbox.push(d); for (const w of [...waiters]) if (w.test(d)) { waiters.splice(waiters.indexOf(w), 1); w.ok(d); } };
    ws.onopen = () => ok({ ws, inbox, next: (test, ms = 3000) => new Promise((res, rej) => { const f = inbox.find(test); if (f) return res(f); const w = { test, ok: res }; waiters.push(w); setTimeout(() => rej(new Error('Rien reçu')), ms); }) });
    ws.onerror = () => ko(new Error('Connexion refusée'));
  });
}

test('temps réel : messages en direct, « en train d’écrire », présence du support', async () => {
  const client = await connect(shop);
  const hello = await client.next((d) => d.type === 'hello'); assert.equal(hello.support, 0, 'aucun agent connecté au départ');
  const agent = await connect(admin, 'support');
  assert.equal((await client.next((d) => d.type === 'presence' && d.support === 1)).support, 1, 'le commerçant voit le support passer en ligne');

  client.ws.send(JSON.stringify({ type: 'typing' }));
  const typing = await agent.next((d) => d.type === 'typing');
  assert.equal(typing.side, 'client'); assert.equal(typing.name, 'Karim');

  await shop.post('/api/store/support/messages', { body: 'Message en direct' }); await app.settle();
  const live = await agent.next((d) => d.type === 'message' && d.message.body === 'Message en direct');
  const tid = live.thread.id;
  agent.ws.send(JSON.stringify({ type: 'typing', storeId: live.thread.store_id }));
  assert.equal((await client.next((d) => d.type === 'typing' && d.side === 'support')).name, 'Sofia');
  await admin.post(`/api/console/support/threads/${tid}/messages`, { body: 'Réponse en direct' }); await app.settle();
  assert.ok(await client.next((d) => d.type === 'message' && d.message.body === 'Réponse en direct'));

  const intruder = await connect(other);
  await shop.post('/api/store/support/messages', { body: 'Privé' }); await app.settle();
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!intruder.inbox.some((d) => d.type === 'message'), 'un autre commerce ne reçoit pas les messages');
  agent.ws.close(); assert.equal((await client.next((d) => d.type === 'presence' && d.support === 0)).support, 0, 'le support repasse hors ligne');
  client.ws.close(); intruder.ws.close();
});

test('temps réel : connexion refusée sans session, ou en « support » sans être de l’équipe', async () => {
  await assert.rejects(connect({ cookie: '' }));
  await assert.rejects(connect(shop, 'support'));
});
