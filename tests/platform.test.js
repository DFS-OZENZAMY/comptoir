// Couche « plateforme » : ce qui permet à Comptoir de tourner sur n'importe quel hébergeur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rewriteHtml, HtmlRewriter } from '../src/platform/html.js';
import { requestCountry } from '../src/platform/geo.js';
import { signV4, s3Storage, memoryStorage } from '../src/platform/storage.js';
import { openDatabase, libsqlD1 } from '../src/adapters/node/d1.js';
import { createAssets, parseHeadersFile } from '../src/adapters/node/assets.js';
import { fsStorage } from '../src/adapters/node/fs-storage.js';
import { ROOT } from '../src/adapters/node/env.js';

test('réécriture HTML : sélecteurs et opérations', async () => {
  const html = '<html><head><title>Ancien</title><meta name="description" content="x"></head><body><div id="grid"><div class="a">old<div>nested</div></div></div><dd data-setting="hours">?</dd><p class="lead">L</p></body></html>';
  const out = rewriteHtml(html, [
    { selector: 'title', handlers: { element(el) { el.setInnerContent('Nouveau <titre>'); } } },
    { selector: 'meta[name="description"]', handlers: { element(el) { el.setAttribute('content', 'Desc "ok"'); } } },
    { selector: 'head', handlers: { element(el) { el.append('<link rel="canonical" href="/">', { html: true }); } } },
    { selector: '#grid', handlers: { element(el) { el.setInnerContent('<b>neuf</b>', { html: true }); } } },
    { selector: 'dd[data-setting="hours"]', handlers: { element(el) { el.setInnerContent('8 h – 20 h'); } } },
    { selector: '.lead', handlers: { element(el) { assert.equal(el.getAttribute('class'), 'lead'); el.prepend('» '); } } },
  ]);
  assert.match(out, /<title>Nouveau &lt;titre&gt;<\/title>/);
  assert.match(out, /content="Desc &quot;ok&quot;"/);
  assert.match(out, /<link rel="canonical" href="\/"><\/head>/);
  assert.match(out, /<div id="grid"><b>neuf<\/b><\/div><dd/, 'les div imbriquées sont remplacées entièrement');
  assert.match(out, /<dd data-setting="hours">8 h – 20 h<\/dd>/);
  assert.match(out, /<p class="lead">» L<\/p>/);
  const res = await new HtmlRewriter().on('title', { element(el) { el.setInnerContent('T'); } })
    .transform(new Response(html, { headers: { 'content-type': 'text/html', 'content-length': '999' } }));
  assert.equal(res.headers.get('content-length'), null);
  assert.match(await res.text(), /<title>T<\/title>/);
});

test('pays du visiteur selon l’hébergeur', () => {
  const r = (h, cf) => Object.assign(new Request('https://x.test', { headers: h }), cf ? { cf } : {});
  assert.equal(requestCountry(r({}, { country: 'ma' })), 'MA');
  assert.equal(requestCountry(r({ 'cloudfront-viewer-country': 'SN' })), 'SN');
  assert.equal(requestCountry(r({ 'x-vercel-ip-country': 'fr' })), 'FR');
  assert.equal(requestCountry(r({ 'x-country-code': 'not-a-country' })), null);
});

for (const kind of ['sqlite', 'libsql']) {
  test(`base au format D1 : ${kind}`, async (t) => {
    let db, dir;
    if (kind === 'sqlite') db = await openDatabase(':memory:');
    else {
      try { await import('@libsql/client'); } catch { t.skip('@libsql/client non installé (dépendance facultative)'); return; }
      dir = await mkdtemp(join(tmpdir(), 'comptoir-')); db = await libsqlD1(`file:${join(dir, 'test.db')}`); // en production : libsql://… (Turso)
    }
    assert.equal(db.kind, kind);
    await db.prepare('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, v REAL)').run();
    const ins = await db.prepare('INSERT INTO t (name, v) VALUES (?, ?)').bind('a', 1.5).run();
    assert.equal(ins.meta.last_row_id, 1); assert.equal(ins.meta.changes, 1);
    assert.deepEqual(await db.prepare('SELECT name, v FROM t WHERE id = ?').bind(1).first(), { name: 'a', v: 1.5 });
    assert.equal(await db.prepare('SELECT name FROM t').first('name'), 'a');
    assert.equal(await db.prepare('SELECT * FROM t WHERE id = ?').bind(99).first(), null);
    const out = await db.batch([db.prepare('INSERT INTO t (name, v) VALUES (?, ?) RETURNING id').bind('b', undefined), db.prepare('SELECT COUNT(*) AS n FROM t')]);
    assert.equal(out[0].results[0].id, 2, 'RETURNING renvoie l’identifiant dans un lot');
    assert.equal(out[1].results[0].n, 2);
    await assert.rejects(db.batch([db.prepare("INSERT INTO t (name) VALUES ('c')"), db.prepare("INSERT INTO t (name) VALUES ('a')")]));
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM t').first()).n, 2, 'un lot en échec est entièrement annulé');
    db.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });
}

test('fichiers du site : règles d’adresses et en-têtes comme sur Cloudflare', async () => {
  const assets = await createAssets(join(ROOT, 'public'));
  const get = (p, h) => assets.fetch(new Request(`https://x.test${p}`, { headers: h }));
  assert.equal((await get('/app/')).status, 200);
  assert.equal((await get('/app')).headers.get('location'), '/app/');
  assert.equal((await get('/app/offline.html')).headers.get('location'), '/app/offline');
  assert.equal((await get('/app/offline')).status, 200);
  assert.equal((await get('/assets/fonts/archivo.woff2')).headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal((await get('/app/sw.js')).headers.get('service-worker-allowed'), '/app/');
  assert.equal((await get('/../package.json')).status, 404, 'pas de sortie du dossier public');
  assert.equal((await get('/_headers')).status, 404);
  const etag = (await get('/app/app.js')).headers.get('etag');
  assert.equal((await get('/app/app.js', { 'if-none-match': etag })).status, 304);
  assert.equal(parseHeadersFile('/a/*\n  X-Test: 1\n')[0].headers[0][1], '1');
});

test('stockage : mémoire et disque', async () => {
  for (const s of [memoryStorage(), fsStorage(await mkdtemp(join(tmpdir(), 'comptoir-files-')))]) {
    await s.put('images/1/2-a.jpg', new Uint8Array([1, 2, 3]), 'image/jpeg');
    const o = await s.get('images/1/2-a.jpg');
    assert.deepEqual([...o.bytes], [1, 2, 3]); assert.equal(o.type, 'image/jpeg');
    await s.delete('images/1/2-a.jpg'); assert.equal(await s.get('images/1/2-a.jpg'), null);
  }
  await assert.rejects(fsStorage(tmpdir()).put('../evasion.jpg', new Uint8Array(1)), /invalide/);
});

test('signature AWS v4 : exemple officiel de la documentation Amazon S3', async () => {
  const h = await signV4({
    method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', headers: { range: 'bytes=0-9' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', date: new Date('2013-05-24T00:00:00Z'),
  });
  assert.match(h.authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date/);
  assert.match(h.authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
});

test('stockage S3 : adresses et requêtes signées', async () => {
  const seen = []; const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push({ url, init }); return init.method === 'GET' ? new Response(new Uint8Array([9]), { headers: { 'content-type': 'image/png' } }) : new Response(null, { status: 200 }); };
  try {
    const minio = s3Storage({ endpoint: 'https://minio.example.com', bucket: 'photos', accessKeyId: 'k', secretAccessKey: 's' });
    await minio.put('images/1/a b.png', new Uint8Array([9]), 'image/png');
    assert.equal(seen[0].url, 'https://minio.example.com/photos/images/1/a%20b.png');
    assert.match(seen[0].init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=k\/\d{8}\/auto\/s3\/aws4_request/);
    assert.deepEqual([...(await minio.get('images/1/a b.png')).bytes], [9]);
    const aws = s3Storage({ region: 'eu-west-3', bucket: 'comptoir', accessKeyId: 'k', secretAccessKey: 's' });
    await aws.delete('x.png');
    assert.equal(seen.at(-1).url, 'https://comptoir.s3.eu-west-3.amazonaws.com/x.png', 'AWS : adresse de type « bucket.s3.région »');
  } finally { globalThis.fetch = real; }
});
