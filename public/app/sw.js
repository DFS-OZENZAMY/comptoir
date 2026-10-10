// Service worker de l'espace commerçant : rend Comptoir installable et démarre plus vite.
// Règle : les données (/api/) viennent TOUJOURS du serveur, jamais d'une copie ancienne.
const VERSION = 'comptoir-2026-10-10b';
const SHELL = [
  '/app/', '/app/app.js', '/app/app.css', '/app/offline', '/assets/fonts.css',
  '/assets/fonts/archivo.woff2', '/assets/fonts/archivo-narrow.woff2', '/assets/fonts/plex-mono-400.woff2', '/assets/fonts/plex-mono-600.woff2',
  '/assets/icon-192.png', '/assets/favicon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const offlineJson = () => new Response(JSON.stringify({ error: 'Pas de connexion internet : reconnectez-vous puis réessayez.' }), { status: 503, headers: { 'content-type': 'application/json; charset=utf-8' } });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Données : réseau uniquement.
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(req).catch(offlineJson));
    return;
  }

  // Ouverture de l'application : réseau d'abord, page « hors ligne » sinon.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok && url.pathname.startsWith('/app')) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('/app/', copy)); }
      return res;
    }).catch(() => caches.match('/app/offline').then((r) => r && new Response(r.body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }))));
    return;
  }

  // Polices et icônes : la copie gardée suffit (elles ne changent jamais).
  if (url.pathname.startsWith('/assets/fonts/') || /\/assets\/.+\.(png|svg|webp)$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; })));
    return;
  }

  // Code de l'application : toujours la dernière version, la copie seulement sans réseau.
  if (url.pathname.startsWith('/app/') || url.pathname === '/assets/fonts.css') {
    e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; }).catch(() => caches.match(req)));
  }
});
