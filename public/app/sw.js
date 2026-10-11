// Service worker de l'espace commerçant : rend Comptoir installable et démarre plus vite.
// Règle : les données (/api/) viennent TOUJOURS du serveur, jamais d'une copie ancienne.
const VERSION = 'comptoir-2026-10-11d';
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

/* ---------------- Notifications push : reçues même application fermée ---------------- */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    const target = new URL(d.url || '/app/', self.location.origin);
    // Messagerie : si la page concernée est ouverte et visible, le message y arrive déjà en direct.
    // On le lui transmet au lieu d'afficher une notification en double (sauf sur iPhone, où Apple exige
    // une notification pour chaque message reçu).
    if (d.kind === 'chat' && !/iPhone|iPad|iPod/.test(self.navigator.userAgent)) {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const visible = wins.filter((c) => c.visibilityState === 'visible' && c.focused && new URL(c.url).pathname === target.pathname);
      if (visible.length) { visible.forEach((c) => c.postMessage({ type: 'push', data: d })); return; }
    }
    await self.registration.showNotification(d.title || 'Comptoir', {
      body: d.body || '', icon: '/assets/icon-192.png', badge: '/assets/badge-96.png', lang: 'fr',
      tag: d.tag || undefined, renotify: !!d.tag, timestamp: Date.now(), data: { url: target.href },
      // Message : vibration et nouvelle alerte à chaque message, même si la notification est déjà affichée.
      ...(d.kind === 'chat' ? { vibrate: [90, 60, 90], silent: false, requireInteraction: false } : {}),
    });
  })());
});

// Toucher la notification : on reprend une fenêtre de Comptoir déjà ouverte, sinon on en ouvre une.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '/app/', self.location.origin);
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = wins.find((c) => new URL(c.url).pathname === target.pathname);
    if (same) { await same.focus(); return same.navigate ? same.navigate(target.href).catch(() => {}) : undefined; }
    return self.clients.openWindow(target.href);
  })());
});

// Le navigateur a renouvelé l'abonnement : on prévient le serveur, sans rien demander à l'utilisateur.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    const { publicKey } = await (await fetch('/api/store/push/key')).json();
    const raw = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (publicKey.length % 4)) % 4));
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
    await fetch('/api/store/push/subscriptions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
  })().catch(() => {}));
});
