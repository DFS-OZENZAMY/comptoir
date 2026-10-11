// Service worker de l'espace commerçant : application installable, utilisable hors ligne, notifications.
// Données (/api/) : toujours le serveur quand il répond ; hors ligne, l'application se sert de ses
// propres copies (IndexedDB, outbox.js) et met les opérations en file, envoyées au retour du réseau.
importScripts('/app/outbox.js');
const VERSION = 'comptoir-2026-10-12';
const SHELL = [
  '/app/', '/app/app.js', '/app/app.css', '/app/chat.js', '/app/outbox.js', '/app/offline', '/assets/fonts.css',
  '/assets/fonts/archivo.woff2', '/assets/fonts/archivo-narrow.woff2', '/assets/fonts/plex-mono-400.woff2', '/assets/fonts/plex-mono-600.woff2',
  '/assets/icon-192.png', '/assets/favicon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Réponse « hors ligne » reconnaissable par l'application (en-tête dédié) : elle passe alors sur ses copies.
const offlineJson = () => new Response(JSON.stringify({ error: 'Pas de connexion internet.' }), { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'x-comptoir-offline': '1' } });
// Réseau qui traîne : au-delà de quelques secondes, on considère qu'il n'y en a pas.
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, ko) => setTimeout(() => ko(new Error('délai dépassé')), ms))]);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Photos des produits : adresse versionnée, gardées pour la caisse hors ligne.
  if (url.pathname.startsWith('/api/images/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; })).catch(() => new Response('', { status: 504 })));
    return;
  }
  // Données : toujours le serveur ; hors ligne, une réponse que l'application sait reconnaître.
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(req).catch(offlineJson));
    return;
  }

  // Ouverture de l'application : réseau d'abord ; hors ligne (ou réseau trop lent), l'application gardée
  // sur l'appareil s'ouvre normalement. La page « hors ligne » ne sert plus que pour les autres pages.
  if (req.mode === 'navigate') {
    const isApp = url.pathname === '/app' || url.pathname.startsWith('/app/');
    e.respondWith(withTimeout(fetch(req), isApp ? 4000 : 10000).then((res) => {
      if (res.ok && isApp) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('/app/', copy)); }
      return res;
    }).catch(async () => {
      if (isApp) { const shell = await caches.match('/app/'); if (shell) return shell; }
      const r = await caches.match('/app/offline');
      return r && new Response(r.body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }));
    return;
  }

  // Polices et icônes : la copie gardée suffit (elles ne changent jamais).
  if (url.pathname.startsWith('/assets/fonts/') || /\/assets\/.+\.(png|svg|webp)$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; })));
    return;
  }

  // Code de l'application : toujours la dernière version, la copie sans réseau (ou réseau trop lent).
  if (url.pathname.startsWith('/app/') || url.pathname === '/assets/fonts.css') {
    e.respondWith(withTimeout(fetch(req), 4000).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; })
      .catch(async () => (await caches.match(req)) || (await caches.match(url.pathname)) || Response.error()));
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

/* ---------------- Synchronisation en arrière-plan ---------------- */
// Le système réveille le service worker au retour du réseau (Android, Chrome, Edge), même application fermée :
// les ventes faites hors ligne sont envoyées sans attendre que l'application soit rouverte.
self.addEventListener('sync', (e) => {
  if (e.tag !== 'comptoir-outbox') return;
  e.waitUntil(self.ComptoirOutbox.flush().then((r) => { if (r.offline) throw new Error('Toujours hors ligne : le système réessaiera.'); }));
});
