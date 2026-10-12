(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const today = () => new Date().toISOString().slice(0, 10);

  const state = { settings: {}, products: [], categories: [], customers: [], me: null, platform: null };
  // Permissions du membre connecté (contrôlées aussi côté serveur à chaque action).
  const can = (p) => !!state.me?.permissions?.includes(p);
  const canAny = (list) => list.split(' ').some(can);
  // Boutique affichée : mémorisée par commerce sur cet appareil.
  const scopeKey = () => `comptoir.boutique.${state.me?.store?.id || ''}`;
  const savedScope = () => { try { return localStorage.getItem(scopeKey()) || ''; } catch { return ''; } };
  const locName = (id) => (state.me?.locations || []).find((l) => l.id === Number(id))?.name || '';
  const cur = () => state.settings.currency || '€';
  const nf = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n) => nf.format(Number(n) || 0) + ' ' + cur();
  const qtyFmt = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(Number(n) || 0);
  const dateFmt = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('fr-FR') : '');
  const dateTimeFmt = (d) => (d ? new Date(d.replace(' ', 'T') + 'Z').toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');

  const DOC = {
    devis: { label: 'Devis', one: 'devis', new: 'Nouveau devis', view: 'devis', statuses: ['brouillon', 'envoyé', 'accepté', 'refusé'] },
    commande: { label: 'Commandes', one: 'commande', new: 'Nouvelle commande', view: 'commandes', statuses: ['nouvelle', 'confirmée', 'livrée', 'annulée'] },
    facture: { label: 'Factures', one: 'facture', new: 'Nouvelle facture', view: 'factures', statuses: ['émise', 'payée', 'annulée'] },
    ticket: { label: 'Tickets', one: 'ticket', new: 'Nouvelle vente', view: 'caisse', statuses: ['payé', 'annulé'] },
  };
  const STATUS_CLASS = {
    brouillon: 's-neutral', envoyé: 's-info', accepté: 's-ok', refusé: 's-bad',
    nouvelle: 's-warn', confirmée: 's-info', livrée: 's-ok', annulée: 's-bad',
    émise: 's-info', payée: 's-ok', payé: 's-ok', annulé: 's-bad',
  };
  const STATUS_LABEL = { émise: 'à payer' };
  const badge = (s) => `<span class="badge ${STATUS_CLASS[s] || 's-neutral'}">${esc(STATUS_LABEL[s] || s)}</span>`;
  const remaining = (d) => r2((d.total_ttc || 0) - (d.amount_paid || 0));
  const docBadge = (d) => (d.type === 'facture' && d.status === 'émise' && d.amount_paid > 0)
    ? '<span class="badge s-warn">payée en partie</span>' : badge(d.status);
  const METHODS = ['espèces', 'carte', 'chèque', 'virement', 'mobile', 'autre'];
  const cap = (s) => (s === 'mobile' ? 'Paiement mobile' : s.charAt(0).toUpperCase() + s.slice(1));

  /* ---------------- API ---------------- */
  // Mémoire courte des lectures : une rubrique déjà visitée s'affiche instantanément.
  // Toute modification (vente, produit, réglage…) vide la mémoire pour ne jamais montrer de données périmées.
  const CACHE_TTL = 30000, MAX_STALE = 5 * 60000;
  const cache = new Map(), inflight = new Map();
  // Navigation : chaque changement de rubrique reçoit un numéro. Une lecture lancée pour une rubrique
  // que l'utilisateur a déjà quittée est abandonnée : l'écran affiché est toujours celui qu'il a choisi.
  let routeToken = 0;
  class Cancelled extends Error { constructor() { super('Rubrique quittée'); this.name = 'Cancelled'; } }
  async function api(path, { method = 'GET', body, fresh = false, background = false } = {}) {
    const key = `${state.scope ?? ''}|${path}`;
    const token = routeToken;
    if (method === 'GET' && !fresh) {
      const c = cache.get(key);
      if (c && Date.now() - c.t < CACHE_TTL) return c.data;
      // Données de moins de 5 minutes : affichées tout de suite, puis rafraîchies en arrière-plan.
      if (c && Date.now() - c.t < MAX_STALE && !background) { revalidate(path, key, c); return c.data; }
      if (inflight.has(key)) { const data = await inflight.get(key); if (!background && token !== routeToken) throw new Cancelled(); return data; }
    }
    const run = (async () => {
      const headers = { 'x-location': String(state.scope ?? savedScope()) };
      if (body !== undefined) headers['content-type'] = 'application/json';
      let res;
      try {
        res = await fetch('/api' + path, {
          method, credentials: 'same-origin', headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch { throw offlineError(method); }
      if (res.headers.get('x-comptoir-offline')) throw offlineError(method);
      net.set(true);
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && path.startsWith('/store')) { cache.clear(); showLogin(); throw new Error(data.error || 'Session expirée.'); }
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      if (method === 'GET') { cache.set(key, { t: Date.now(), data }); window.ComptoirOutbox?.cacheSet(key, data); } else cache.clear();
      return data;
    })();
    if (method === 'GET') { inflight.set(key, run); run.finally(() => inflight.delete(key)).catch(() => {}); }
    let data;
    try { data = await run; }
    catch (e) {
      // Hors ligne : on affiche la dernière copie connue (mémoire, puis appareil).
      if (method !== 'GET' || e.name !== 'Offline') throw e;
      const mem = cache.get(key); const stored = mem ? null : await window.ComptoirOutbox?.cacheGet(key);
      if (!mem && !stored) throw new Error('Hors ligne : cette rubrique n’a pas encore été ouverte sur cet appareil.');
      data = mem ? mem.data : stored.data;
      net.dataAt = Math.min(net.dataAt || Infinity, mem ? mem.t : stored.t);
    }
    if (method === 'GET' && !fresh && !background && token !== routeToken) throw new Cancelled();
    return data;
  }
  function offlineError(method) {
    net.set(false);
    const e = new Error(method === 'GET' ? 'Hors ligne' : 'Hors ligne : cette action sera possible une fois la connexion revenue.');
    e.name = 'Offline'; return e;
  }
  // Remplace la copie d'une lecture (mémoire et appareil) après une modification faite hors ligne.
  function keep(path, data) { const key = `${state.scope ?? ''}|${path}`; cache.set(key, { t: Date.now(), data }); window.ComptoirOutbox?.cacheSet(key, data); }
  // Rafraîchissement en arrière-plan : si les données ont changé et que l'utilisateur est toujours
  // sur la même rubrique (sans saisie en cours), l'écran est redessiné discrètement.
  function revalidate(path, key, old) {
    if (inflight.has(key)) return;
    const token = routeToken;
    api(path, { fresh: true, background: true }).then((data) => {
      if (token !== routeToken || JSON.stringify(data) === JSON.stringify(old.data)) return;
      const busy = document.activeElement && document.activeElement.closest('#view, #modal') && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (busy || $('#modal')?.open) return;   // saisie en cours ou fenêtre ouverte : on ne touche à rien
      clearTimeout(revalidate.h); revalidate.h = setTimeout(() => { if (token === routeToken) rerender(); }, 60);
    }).catch(() => {});
  }
  // Préchargement : les données d'une rubrique sont demandées dès que la souris la survole.
  const PREFETCH = {
    'tableau-de-bord': ['/store/dashboard', '/store/alerts'], alertes: ['/store/alerts', '/store/alerts/email-status'],
    ventes: ['/store/documents?type=commande'], commandes: ['/store/documents?type=commande'], devis: ['/store/documents?type=devis'],
    factures: ['/store/documents?type=facture'], stock: ['/store/stock'], parametres: ['/store/alerts/email-status'],
    reglages: ['/store/alerts/email-status'], equipe: ['/store/team', '/store/roles'], abonnement: ['/store/subscription'],
    rapports: ['/store/locations/report?period=30'], boutiques: ['/store/locations'],
  };
  function prefetch(key) {
    for (const p of PREFETCH[key] || []) { const k = `${state.scope ?? ''}|${p}`; const c = cache.get(k); if ((!c || Date.now() - c.t > CACHE_TTL / 2) && !inflight.has(k)) api(p, { fresh: true, background: true }).catch(() => {}); }
  }
  // Une rubrique est « prête » si toutes ses données sont déjà en mémoire (même un peu anciennes).
  const warm = (key) => (PREFETCH[key] || []).every((p) => { const c = cache.get(`${state.scope ?? ''}|${p}`); return c && Date.now() - c.t < MAX_STALE; });
  const onIntent = (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#/"]'); if (!a) return;
    prefetch(a.getAttribute('href').slice(2).split('?')[0]);
  };
  document.addEventListener('mouseover', onIntent, { passive: true });
  document.addEventListener('touchstart', onIntent, { passive: true });
  document.addEventListener('focusin', onIntent);

  function toast(msg, error = false) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.textContent = msg; t.classList.toggle('error', error); t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), error ? 4500 : 2400);
  }
  const fail = (e) => { if (e && e.name === 'Cancelled') return; toast(e.message, true); };

  /* ---------------- Modale ---------------- */
  const modal = $('#modal');
  function openModal(title, html, wide = false) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    modal.classList.toggle('wide', wide);
    // Une étape d'historique par fenêtre ouverte : le bouton Retour du téléphone ferme la fenêtre, sans quitter la rubrique.
    if (!modal.open) { modal.showModal(); history.pushState({ modal: true }, ''); }
    modal.scrollTop = 0;
    return $('#modalBody');
  }
  const closeModal = () => modal.open && modal.close();
  modal.addEventListener('close', () => { if (history.state && history.state.modal) history.back(); });
  window.addEventListener('popstate', () => { if (modal.open && !(history.state && history.state.modal)) modal.close(); });
  const amt = (n) => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
  const readAmt = (v) => Number(String(v ?? '').replace(/[\s\u00a0]/g, '').replace(',', '.')) || 0;
  $('#modalClose').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  function confirmAction(message) { return window.confirm(message); }

  /* ---------------- Données partagées ---------------- */
  async function loadShared() {
    const [settings, products, categories, customers] = await Promise.all([
      api('/store/settings', { fresh: true }), api('/store/products', { fresh: true }), api('/store/categories', { fresh: true }), api('/store/customers', { fresh: true }),
    ]);
    Object.assign(state, { settings, products, categories, customers });
    updateBadges();
  }
  async function refresh(...keys) {
    const map = { products: '/store/products', categories: '/store/categories', customers: '/store/customers', settings: '/store/settings' };
    const res = await Promise.all(keys.map((k) => api(map[k], { fresh: true })));
    keys.forEach((k, i) => { state[k] = res[i]; });
    updateBadges();
  }
  async function updateBadges() {
    try {
      const c = await api('/store/badges', { background: true });
      const set = (id, n) => { const el = $(id); if (el) { el.hidden = !n; el.textContent = n; } };
      set('#badgeStock', c.out_of_stock + c.low_stock);
      set('#badgeAlerts', c.alerts);
      const bm = $('#badgeAlertsM'); if (bm) { bm.hidden = !c.alerts; bm.textContent = c.alerts > 9 ? '9+' : c.alerts; }
      $('#mobileBell')?.setAttribute('aria-label', c.alerts ? `Alertes : ${c.alerts}` : 'Alertes');
      $('#badgeAlerts').classList.toggle('urgent', c.urgent > 0);
      set('#badgeOrders', c.orders);
    } catch { /* silencieux */ }
  }

  /* ---------------- Connexion et inscription ---------------- */
  // Écran de démarrage : s'efface dès que la connexion ou l'application est prête (au moins le temps de l'animation d'entrée).
  const bootStart = performance.now();
  function bootDone() {
    const b = document.getElementById('boot'); if (!b || b.dataset.done) return; b.dataset.done = '1';
    setTimeout(() => { b.classList.add('out'); setTimeout(() => b.remove(), 320); }, Math.max(0, 700 - (performance.now() - bootStart)));
  }
  function showLogin(mode) {
    bootDone();
    $('#app').hidden = true; $('#auth').hidden = false; closeModal();
    const signup = mode === 'signup' || (mode === undefined && location.hash.split('?')[0] === '#/inscription');
    $('#loginForm').hidden = signup; $('#signupForm').hidden = !signup;
    $$('[data-authtab]').forEach((b) => b.setAttribute('aria-selected', String((b.dataset.authtab === 'signup') === signup)));
    if (signup) loadPlatform();
    setTimeout(() => $(signup ? '#suName' : '#liEmail').focus(), 30);
  }
  async function loadPlatform() {
    if (state.platform) return;
    try {
      state.platform = await api('/platform');
      // Type de commerce : pastilles à choix unique (libellé court, avant « & »)
      const types = state.platform.business_types;
      $('#suTypes').innerHTML = types.map((t) => `<button type="button" role="radio" class="chip" data-trade="${t.key}" aria-checked="false" aria-pressed="false">${esc(t.label.split(' & ')[0].replace(' commerce', ''))}</button>`).join('');
      const pick = (key) => { $('#suType').value = key; $$('[data-trade]').forEach((b) => { const on = b.dataset.trade === key; b.setAttribute('aria-checked', String(on)); b.setAttribute('aria-pressed', String(on)); }); };
      $('#suTypes').addEventListener('click', (e) => { const b = e.target.closest('[data-trade]'); if (b) { pick(b.dataset.trade); $('#suTypes').classList.remove('missing'); } });
      // Aucun métier présélectionné : un mauvais choix par défaut donne de mauvais produits d'exemple.
      // Arrivée depuis une page métier du site (#/inscription?metier=alimentation) : déjà choisi.
      const askedType = new URLSearchParams(location.hash.split('?')[1] || '').get('metier');
      $('#suType').value = '';
      if (askedType && types.some((t) => t.key === askedType)) pick(askedType);
      const fmtTva = (v) => String(v).replace('.', ',');
      $('#suCountry').innerHTML = state.platform.countries.map((c) => `<option value="${c.key}">${esc(c.name)} (${esc(c.currency)}, TVA ${fmtTva(c.tva)} %)</option>`).join('');
      const guess = guessCountry(state.platform.countries.map((c) => c.key), state.platform.country_hint);
      if (guess) $('#suCountry').value = guess;
      $('#trialDays').textContent = state.platform.trial_days;
    } catch (e) { fail(e); }
  }
  // Pays probable du commerçant : choix fait sur le site, puis fuseau horaire de l'appareil (fiable même
  // derrière un VPN), puis pays détecté par le serveur, puis langue du navigateur.
  const TZ_COUNTRY = { 'Africa/Casablanca': 'MA', 'Africa/El_Aaiun': 'MA', 'Africa/Algiers': 'DZ', 'Africa/Tunis': 'TN', 'Africa/Dakar': 'SN', 'Africa/Abidjan': 'CI',
    'Africa/Douala': 'CM', 'Europe/Paris': 'FR', 'Europe/Brussels': 'BE', 'Europe/Zurich': 'CH', 'Europe/Luxembourg': 'LU', 'America/Toronto': 'CA', 'America/Montreal': 'CA' };
  function guessCountry(known, hint) {
    const ok = (c) => c && known.includes(c) ? c : null;
    const cookie = (document.cookie.match(/(?:^|;\s*)cp_pays=([A-Z]{2})/) || [])[1];
    let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* navigateur ancien */ }
    const lang = (navigator.languages || [navigator.language]).map((l) => (String(l).split('-')[1] || '').toUpperCase()).find((c) => known.includes(c));
    return ok(cookie) || ok(TZ_COUNTRY[tz]) || ok(hint) || ok(lang) || null;
  }
  $$('[data-authtab]').forEach((b) => b.addEventListener('click', () => {
    history.replaceState(null, '', b.dataset.authtab === 'signup' ? '#/inscription' : '#/');
    showLogin(b.dataset.authtab);
  }));
  async function showApp() {
    $('#auth').hidden = true; $('#app').hidden = false;
    $('#view').innerHTML = '<p class="loading">Chargement…</p>';
    try {
      state.me = await api('/auth/me', { fresh: true });
      if (!state.me.authenticated) return showLogin();
      state.scope = state.me.scope;

      if (!state.me.store) { location.href = state.me.platform_admin ? '/console/' : '/'; return; }
      await loadShared();
    } catch (e) { fail(e); }
    renderShell();
    if (location.hash.split('?')[0] === '#/inscription' || location.hash === '') location.hash = '#/tableau-de-bord'; else route();
    bootDone();
    if (state.me.user.must_change_password) passwordModal(true);
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 600));
    idle(() => ['tableau-de-bord', 'commandes', 'alertes'].forEach(prefetch));
  }
  function renderShell() {
    const me = state.me, st = me.store;
    $('#storeName').textContent = state.settings.shop_name || st.name;
    $('#storeLink').href = `/s/${st.slug}`;
    $('#storeLinkM').href = `/s/${st.slug}`;
    $('#storeNameM').textContent = state.settings.shop_name || st.name;
    $('#consoleLink').hidden = !me.platform_admin;
    $$('[data-perm]').forEach((el) => { el.hidden = !can(el.dataset.perm); });
    $$('[data-perm-any]').forEach((el) => { el.hidden = !canAny(el.dataset.permAny); });
    // Groupe du menu sans aucune rubrique autorisée : masqué entièrement.
    $$('.nav-group').forEach((g) => { g.hidden = !g.querySelector('a:not([hidden])'); });
    renderLocSwitch();
    const days = st.trial_ends_at ? Math.round((new Date(st.trial_ends_at + 'T00:00:00Z') - new Date(today() + 'T00:00:00Z')) / 86400000) : -1;
    $('#planBadge').textContent = st.plan === 'essai' ? (days > 0 ? `Essai : ${days} j restant${days > 1 ? 's' : ''}` : days === 0 ? "Dernier jour d'essai" : 'Essai terminé') : st.plan_name;
    $('#planBadge').classList.toggle('warn', st.plan === 'essai' && days <= 3);
    const banner = $('#accessBanner');
    banner.hidden = me.access.writable;
    banner.innerHTML = me.access.writable ? '' : `${esc(me.access.reason)} ${can('billing.manage') ? '<a href="#/abonnement">Voir les formules</a>' : ''}`;
    $('#userName').textContent = me.user.name;
    $('#userInitials').textContent = String(me.user.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    // Modules complémentaires (messagerie du support) : l'application leur prête l'API et l'état.
    // Mode hors ligne : opérations gardées de côté pour ce commerce remises en file, puis envoi.
    if (window.ComptoirOutbox && !net.started) {
      net.started = true;
      window.ComptoirOutbox.all().then(async (all) => { for (const o of all) if (o.status === 'later' && o.store_id === me.store.id) await window.ComptoirOutbox.put({ ...o, status: 'pending' }); await net.refresh(); syncNow(); }).catch(() => {});
    }
    if (!window.ComptoirApp) { window.ComptoirApp = { api, toast, state, enablePush, push, enqueue, net }; window.dispatchEvent(new CustomEvent('comptoir:ready', { detail: window.ComptoirApp })); }
  }
  function renderLocSwitch() {
    const locs = state.me.locations || [];
    const multi = locs.length > 1;
    const opts = (multi && state.me.all_locations ? '<option value="all">Toutes les boutiques</option>' : '') + locs.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
    for (const [wrap, sel] of [['#locWrap', '#locSwitch'], ['#locWrapM', '#locSwitchM']]) {
      $(wrap).hidden = !multi;
      $(sel).innerHTML = opts; $(sel).value = String(state.scope);
    }
    $('#locNameM').textContent = multi ? (state.scope === 'all' ? 'Toutes les boutiques' : locName(state.scope)) : '';
  }
  async function switchLocation(value) {
    state.scope = value === 'all' ? 'all' : Number(value);
    try { localStorage.setItem(scopeKey(), String(state.scope)); } catch { /* navigation privée */ }
    cache.clear();
    try {
      state.me = await api('/auth/me', { fresh: true });
      state.scope = state.me.scope;
      await refresh('products');
      renderShell(); route();
      toast(state.scope === 'all' ? 'Toutes les boutiques' : `Boutique : ${locName(state.scope)}`);
    } catch (e) { fail(e); }
  }
  $('#locSwitch').addEventListener('change', (e) => switchLocation(e.target.value));

  /* ---------------- Application installable (ordinateur et téléphone) ---------------- */
  const install = { prompt: null };
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMacSafari = () => /Macintosh/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Firefox/.test(navigator.userAgent) && !isIOS();
  const canInstall = () => !standalone() && (!!install.prompt || isIOS() || isMacSafari());
  function refreshInstall() {
    const on = canInstall();
    $('#installBtn').hidden = !on; $('#installBtnM').hidden = !on;
    $('#installCard')?.toggleAttribute('hidden', !on || installDismissed());
  }
  const installDismissed = () => { try { return localStorage.getItem('comptoir.installation.masquee') === '1'; } catch { return false; } };
  async function doInstall() {
    closeMore();
    if (install.prompt) {
      install.prompt.prompt();
      const r = await install.prompt.userChoice.catch(() => null);
      install.prompt = null; refreshInstall();
      if (r?.outcome === 'accepted') toast('Comptoir est installé');
      return;
    }
    const share = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="vertical-align:-4px"><path d="M12 3v12M8 7l4-4 4 4M5 12v7h14v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const steps = isIOS()
      ? `<ol class="install-steps"><li>Touchez le bouton <strong>Partager</strong> ${share} en bas de Safari (en haut sur iPad).</li><li>Choisissez <strong>Sur l’écran d’accueil</strong>.</li><li>Touchez <strong>Ajouter</strong>.</li></ol><p class="muted">Utilisez Safari : sur iPhone, l’installation ne se fait que depuis Safari. Vous vous connecterez une fois dans l’application, puis elle s’ouvrira directement sur votre espace.</p>`
      : `<ol class="install-steps"><li>Dans la barre de menus de Safari, ouvrez <strong>Fichier</strong>.</li><li>Choisissez <strong>Ajouter au Dock</strong>, puis <strong>Ajouter</strong>.</li></ol><p class="muted">Comptoir s’ouvrira alors dans sa propre fenêtre, depuis le Dock.</p>`;
    openModal('Installer Comptoir', steps + '<div class="modal-foot"><div class="right"><button class="btn btn-primary" id="installOk">C’est compris</button></div></div>');
    $('#installOk').addEventListener('click', closeModal);
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); install.prompt = e; refreshInstall(); });
  window.addEventListener('appinstalled', () => { install.prompt = null; refreshInstall(); toast('Comptoir est installé : retrouvez-le sur votre écran d’accueil ou votre bureau'); });
  $('#installBtn').addEventListener('click', doInstall);
  $('#installBtnM').addEventListener('click', doInstall);
  document.addEventListener('click', (e) => {
    if (e.target.closest('#installCardGo')) doInstall();
    if (e.target.closest('#installCardHide')) { try { localStorage.setItem('comptoir.installation.masquee', '1'); } catch { /* navigation privée */ } refreshInstall(); }
  });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {}));
  }
  $('#locSwitchM').addEventListener('change', (e) => { closeMore(); switchLocation(e.target.value); });
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true;
    $('#loginError').textContent = '';
    try {
      await api('/auth/login', { method: 'POST', body: { email: $('#liEmail').value, password: $('#liPassword').value } });
      $('#liPassword').value = '';
      showApp();
    } catch (ex) { $('#loginError').textContent = ex.message; } finally { btn.disabled = false; }
  });
  $('#signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true;
    const d = Object.fromEntries(new FormData(e.target));
    d.demo = $('#suDemo').checked;
    $('#signupError').textContent = '';
    if (!d.business_type) {
      btn.disabled = false;
      $('#suTypes').classList.add('missing'); $('#suTypes').scrollIntoView({ block: 'center', behavior: 'smooth' });
      $('#signupError').textContent = 'Choisissez votre type de commerce : il prépare vos catégories et vos produits d’exemple.';
      return;
    }
    try {
      await api('/auth/signup', { method: 'POST', body: d });
      location.hash = '#/tableau-de-bord';
      await showApp();
      toast('Bienvenue ! Votre espace est prêt.');
    } catch (ex) { $('#signupError').textContent = ex.message; } finally { btn.disabled = false; }
  });
  // Menu du compte (bas du menu latéral) : se ferme au clic ailleurs, avec Échap ou après un choix.
  document.addEventListener('click', (e) => { const d = document.getElementById('sideAccount'); if (!d || !d.open) return; if (!d.contains(e.target) || e.target.closest('.side-menu a, .side-menu button')) d.open = false; });
  document.addEventListener('keydown', (e) => { const d = document.getElementById('sideAccount'); if (e.key === 'Escape' && d?.open) { d.open = false; d.querySelector('summary').focus(); } });
  $('#logout').addEventListener('click', async () => {
    const waiting = window.ComptoirOutbox ? (await window.ComptoirOutbox.counts().catch(() => ({ pending: 0 }))).pending : 0;
    if (waiting && !confirm(`${waiting} opération${waiting > 1 ? 's' : ''} faite${waiting > 1 ? 's' : ''} hors ligne n’${waiting > 1 ? 'ont' : 'a'} pas encore été envoyée${waiting > 1 ? 's' : ''}. Elle${waiting > 1 ? 's' : ''} le ser${waiting > 1 ? 'ont' : 'a'} à votre prochaine connexion sur cet appareil. Se déconnecter quand même ?`)) return;
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    window.ComptoirOutbox?.clearCache();
    state.me = null; location.hash = '#/'; showLogin('login');
  });
  $('#accountBtn').addEventListener('click', () => passwordModal(false));
  document.querySelector('[data-account]').addEventListener('click', () => { closeMore(); passwordModal(false); });
  document.querySelector('[data-logout]').addEventListener('click', () => $('#logout').click());

  function passwordModal(forced) {
    const body = openModal(forced ? 'Choisissez votre mot de passe' : 'Mon compte', `
      ${forced ? '<p class="notice">Vous utilisez un mot de passe temporaire. Choisissez-en un personnel pour continuer.</p>' : `<p class="muted" style="margin-top:0">${esc(state.me.user.name)}, ${esc(state.me.user.email)}</p>`}
      <form id="pwForm" class="fields" novalidate>
        <label class="field full"><span>Mot de passe actuel</span><input name="current_password" type="password" autocomplete="current-password" required></label>
        <label class="field full"><span>Nouveau mot de passe</span><input name="new_password" type="password" autocomplete="new-password" minlength="8" required><small>8 caractères minimum.</small></label>
        <p class="form-error full" id="pwErr"></p>
      </form>
      <div class="modal-foot"><div class="right">${forced ? '' : '<button class="btn" id="pwCancel">Annuler</button>'}<button class="btn btn-primary" id="pwSave">Enregistrer</button></div></div>`);
    if (forced) $('#modalClose').hidden = true;
    $('#pwCancel', body)?.addEventListener('click', closeModal);
    $('#pwSave', body).addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        await api('/auth/password', { method: 'POST', body: Object.fromEntries(new FormData($('#pwForm'))) });
        state.me.user.must_change_password = 0; $('#modalClose').hidden = false; closeModal(); toast('Mot de passe modifié');
      } catch (ex) { $('#pwErr').textContent = ex.message; e.currentTarget.disabled = false; }
    });
  }

  /* ---------------- Routeur ---------------- */
  const VIEWS = {
    caisse: ['Caisse', viewPos],
    'tableau-de-bord': ['Accueil', viewDashboard],
    alertes: ['Alertes', viewAlerts],
    commandes: ['Ventes', () => viewDocuments('commande')],
    devis: ['Ventes', () => viewDocuments('devis')],
    factures: ['Ventes', () => viewDocuments('facture')],
    produits: ['Produits', viewProducts],
    stock: ['Produits', viewStock],
    clients: ['Clients', viewCustomers],
    parametres: ['Réglages', viewSettings],
    equipe: ['Réglages', viewTeam],
    abonnement: ['Réglages', viewSubscription],
    boutiques: ['Réglages', viewLocations],
    importer: ['Produits', viewImport],
    notifications: ['Notifications', viewNotifications],
    rapports: ['Rapports', viewReports],
  };
  // Permission nécessaire pour afficher chaque rubrique.
  const VIEW_PERM = {
    'tableau-de-bord': 'reports.view', caisse: 'pos.sell', alertes: 'alerts.view', commandes: 'documents.view', devis: 'documents.view',
    factures: 'documents.view', stock: 'stock.manage', parametres: 'settings.manage', equipe: 'team.manage', abonnement: 'billing.manage',
    boutiques: 'locations.manage', rapports: 'reports.view', importer: 'products.edit',
  };
  // Guide d'aide de chaque écran (centre d'aide public, /aide).
  const HELP_FOR = {
    'tableau-de-bord': 'bien-demarrer', caisse: 'caisse', commandes: 'devis-commandes-factures', devis: 'devis-commandes-factures',
    factures: 'devis-commandes-factures', produits: 'produits-et-stock', stock: 'produits-et-stock', clients: 'clients-et-fidelite',
    alertes: 'reglages-et-abonnement#les-alertes', rapports: 'boutiques-et-rapports', parametres: 'reglages-et-abonnement',
    boutiques: 'boutiques-et-rapports', equipe: 'equipe-et-droits', importer: 'importer-ses-produits', notifications: 'reglages-et-abonnement#les-notifications', abonnement: 'reglages-et-abonnement#l-abonnement',
  };
  const allowedView = (k) => !!VIEWS[k] && (!VIEW_PERM[k] || can(VIEW_PERM[k]));
  // Les écrans proches sont regroupés sous une seule entrée de menu, avec des onglets.
  const GROUPS = {
    ventes: [['commandes', 'Commandes'], ['devis', 'Devis'], ['factures', 'Factures']],
    produits: [['produits', 'Catalogue'], ['stock', 'Stock'], ['importer', 'Importer']],
    reglages: [['parametres', 'Mon commerce'], ['boutiques', 'Boutiques'], ['equipe', 'Équipe et rôles'], ['abonnement', 'Abonnement']],
  };
  const groupOf = (key) => Object.keys(GROUPS).find((g) => GROUPS[g].some(([k]) => k === key)) || key;
  function route() {
    let key = (location.hash.replace(/^#\//, '') || 'tableau-de-bord').split('?')[0];
    if (!state.me) return;
    // « #/support » (lien des notifications) : la messagerie s'ouvre par-dessus la rubrique en cours.
    if (key === 'support') { window.ComptoirChat?.open(); history.replaceState(null, '', '#/' + (current.key || 'tableau-de-bord')); if (current.key) return; key = 'tableau-de-bord'; }
    if (GROUPS[key]) key = (GROUPS[key].find(([k]) => allowedView(k)) || GROUPS[key][0])[0];
    if (!allowedView(key)) key = ['tableau-de-bord', 'caisse', 'produits'].find(allowedView);
    const [title, fn] = VIEWS[key];
    const group = groupOf(key);
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === group));
    $('#viewTitle').textContent = title;
    $('#helpBtn').href = '/aide/' + (HELP_FOR[key] || 'bien-demarrer');
    $('#viewActions').innerHTML = '';
    $('#subnav').innerHTML = GROUPS[group] ? GROUPS[group].filter(([k]) => allowedView(k)).map(([k, l]) => `<a href="#/${k}" class="${k === key ? 'active' : ''}">${l}</a>`).join('') : '';
    $('#subnav').hidden = !GROUPS[group];
    closeMore();
    document.title = `${title} : ${state.settings.shop_name || ''} | Comptoir`;
    window.scrollTo(0, 0);
    const token = ++routeToken;
    current.key = key;
    // Retour visuel immédiat : sans données en mémoire, un squelette remplace aussitôt l'ancienne rubrique.
    if (!warm(key) && PREFETCH[key]) $('#view').innerHTML = SKELETON;
    Promise.resolve(fn()).catch((e) => { if (token === routeToken) fail(e); });
  }
  const current = { key: null };
  const SKELETON = '<div class="skeleton" aria-busy="true" aria-label="Chargement"><span></span><span></span><span></span><span class="short"></span></div>';
  // Redessine la rubrique affichée (après un rafraîchissement en arrière-plan), sans bouger le défilement.
  function rerender() {
    const y = window.scrollY; const fn = current.key && VIEWS[current.key]?.[1];
    if (fn) Promise.resolve(fn()).then(() => window.scrollTo(0, y)).catch(() => {});
  }
  window.addEventListener('hashchange', () => { closeModal(); route(); });
  const setActions = (html) => { $('#viewActions').innerHTML = html; };

  // Menu « Plus » sur téléphone
  function closeMore() { $('#moreSheet').hidden = true; $('#moreBtn')?.setAttribute('aria-expanded', 'false'); }
  $('#moreBtn').addEventListener('click', () => {
    const open = $('#moreSheet').hidden;
    $('#moreSheet').hidden = !open; $('#moreBtn').setAttribute('aria-expanded', String(open));
  });
  $('#moreSheet').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeMore(); });

  /* ================= Accueil ================= */
  async function viewDashboard() {
    const [d, a] = await Promise.all([api('/store/dashboard'), api('/store/alerts').catch(() => null)]);
    const s = state.settings;
    const first = (state.me.user.name || '').split(' ')[0];
    const hour = new Date().getHours();
    const hello = hour < 5 || hour >= 18 ? 'Bonsoir' : 'Bonjour';
    const dateLong = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const vitrine = `${location.origin}/s/${state.me.store.slug}`;
    const steps = [
      { done: !!(s.phone && s.address), label: 'Renseigner l’adresse et le téléphone', href: '#/parametres', owner: true },
      { done: state.products.some((p) => !/^EX-\d{3}$/.test(p.ref || '')), label: 'Ajouter vos propres produits', href: '#/produits' },
      { done: d.recent.some((r) => r.type === 'ticket') || d.today_tickets > 0, label: 'Faire une première vente en caisse', href: '#/caisse' },
      { done: s.legal_info !== '', label: 'Compléter les mentions légales des factures', href: '#/parametres', owner: true },
    ].filter((x) => !x.owner || can('settings.manage'));
    const todo = steps.filter((x) => !x.done);

    // Ce qui demande une action aujourd'hui, en langage simple
    const tasks = [];
    if (a?.overdue.length) tasks.push({ tone: 'bad', title: `${a.overdue.length} facture${a.overdue.length > 1 ? 's' : ''} en retard de paiement`, detail: `${money(a.totals.overdue_amount)} à récupérer`, href: '#/alertes', action: 'Relancer' });
    if (d.open_orders) tasks.push({ tone: 'warn', title: `${d.open_orders} commande${d.open_orders > 1 ? 's' : ''} à préparer`, detail: 'Mises de côté ou prises au téléphone', href: '#/commandes', action: 'Voir' });
    if (a?.out_of_stock.length) tasks.push({ tone: 'bad', title: `${a.out_of_stock.length} produit${a.out_of_stock.length > 1 ? 's' : ''} en rupture`, detail: a.out_of_stock.slice(0, 3).map((p) => p.name).join(', '), href: '#/alertes', action: 'Recommander' });
    if (a?.low_stock.length) tasks.push({ tone: 'warn', title: `${a.low_stock.length} produit${a.low_stock.length > 1 ? 's' : ''} bientôt épuisé${a.low_stock.length > 1 ? 's' : ''}`, detail: a.low_stock.slice(0, 3).map((p) => p.name).join(', '), href: '#/alertes', action: 'Voir' });
    if (a?.due_soon.length) tasks.push({ tone: 'info', title: `${a.due_soon.length} facture${a.due_soon.length > 1 ? 's' : ''} à échéance cette semaine`, detail: `${money(a.totals.due_soon_amount)} attendus`, href: '#/alertes', action: 'Voir' });
    if (d.open_quotes) tasks.push({ tone: 'info', title: `${d.open_quotes} devis en attente de réponse`, detail: `${money(d.open_quotes_value)} en jeu`, href: '#/devis', action: 'Suivre' });

    const max = Math.max(...d.months.map((m) => m.value), 1);
    const monthName = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'short' });
    const thisMonth = today().slice(0, 7);
    $('#viewTitle').textContent = `${hello} ${first}`;
    $('#view').innerHTML = `
      <p class="home-date">${dateLong.charAt(0).toUpperCase() + dateLong.slice(1)}</p>
      <section class="home-hero">
        <a class="home-sell" href="#/caisse"><span class="home-sell-label">Nouvelle vente</span><span class="home-sell-sub">Ouvrir la caisse</span></a>
        <div class="home-today">
          <div><span>Ventes du jour</span><strong>${money(d.today_sales)}</strong><small>${d.today_tickets} ticket${d.today_tickets > 1 ? 's' : ''}</small></div>
          <div><span>Ce mois-ci</span><strong>${money(d.revenue_month)}</strong><small>${d.sales_month} vente${d.sales_month > 1 ? 's' : ''}</small></div>
          <div><span>À encaisser</span><strong>${money(d.unpaid)}</strong><small>${d.unpaid_count} facture${d.unpaid_count > 1 ? 's' : ''}</small></div>
        </div>
      </section>
      <nav class="quick-actions" aria-label="Actions rapides">
        ${can('products.edit') ? '<button type="button" data-act="new-product">Ajouter un produit</button>' : ''}
        ${can('stock.manage') ? '<button type="button" data-stock="entrée">Réceptionner du stock</button>' : ''}
        ${can('documents.edit') ? '<button type="button" data-new="devis">Faire un devis</button><button type="button" data-new="facture">Faire une facture</button>' : ''}
        <button type="button" id="shareVitrine">Partager ma vitrine</button>
      </nav>
      ${todo.length ? `<section class="panel onboarding"><div class="panel-head"><h2>Pour bien démarrer</h2><span class="muted">${steps.length - todo.length} sur ${steps.length} · <a href="/aide/bien-demarrer" target="_blank" rel="noopener">Guide complet</a></span></div>
        <ol>${steps.map((x) => `<li class="${x.done ? 'done' : ''}"><a href="${x.href}">${x.label}</a></li>`).join('')}</ol></section>` : ''}
      <section class="install-card" id="installCard" hidden>
        <div class="install-icon" aria-hidden="true"><img src="/assets/icon-192.png" alt="" width="56" height="56"></div>
        <div class="install-text"><strong>Installez Comptoir sur cet appareil</strong><span>Votre caisse s’ouvre en un geste, depuis l’écran d’accueil ou le bureau, sans passer par le site.</span></div>
        <div class="install-actions"><button type="button" class="btn btn-primary" id="installCardGo">Installer</button><button type="button" class="btn" id="installCardHide">Plus tard</button></div>
      </section>
      <section class="install-card push-card" id="pushCard" hidden>
        <div class="install-icon push-bell" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Zm4 4a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <div class="install-text"><strong>Soyez prévenu même application fermée</strong><span>Stock bas, paiements en retard, fin d’essai : une notification arrive sur ce téléphone ou cet ordinateur.</span></div>
        <div class="install-actions"><button type="button" class="btn btn-primary" id="pushCardGo">Activer</button><button type="button" class="btn" id="pushCardHide">Plus tard</button></div>
      </section>
      <div class="home-grid">
        <section class="panel">
          <div class="panel-head"><h2>À faire</h2>${tasks.length ? `<span class="muted">${tasks.length}</span>` : ''}</div>
          ${tasks.length ? `<ul class="tasks">${tasks.map((t) => `<li class="t-${t.tone}"><a href="${t.href}"><span class="task-main"><strong>${esc(t.title)}</strong><span>${esc(t.detail)}</span></span><span class="task-go">${t.action}</span></a></li>`).join('')}</ul>`
            : `<div class="empty-state"><strong>Rien d'urgent.</strong>Stock, paiements et commandes sont à jour.</div>`}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Meilleures ventes</h2><span class="muted">30 jours</span></div>
          ${d.top.length ? `<ol class="top-list">${d.top.map((t) => `<li><span>${esc(t.label)}</span><span class="muted">${qtyFmt(t.qty)} vendu${t.qty > 1 ? 's' : ''}</span><strong>${money(t.amount)}</strong></li>`).join('')}</ol>`
            : '<div class="empty-state">Vos produits les plus vendus apparaîtront ici après vos premières ventes.</div>'}
        </section>
      </div>
      <section class="panel">
        <div class="panel-head"><h2>Ventes des 6 derniers mois</h2><span class="muted">TTC</span></div>
        <div class="chart">${d.months.map((m) => `<div class="bar ${m.month === thisMonth ? 'current' : ''}"><span class="bar-val">${m.value ? new Intl.NumberFormat('fr-FR').format(Math.round(m.value)) : ''}</span><div class="bar-fill" style="height:${Math.round((m.value / max) * 150)}px"></div></div>`).join('')}</div>
        <div class="chart-labels">${d.months.map((m) => `<span>${monthName(m.month)}</span>`).join('')}</div>
      </section>`;
    refreshInstall();
    (async () => {
      let hidden = false; try { hidden = localStorage.getItem('comptoir.notifications.masquee') === '1'; } catch { /* navigation privée */ }
      if (hidden || !push.supported() || Notification.permission === 'denied') return;
      const sub = await push.current().catch(() => null);
      if (!sub && $('#pushCard')) $('#pushCard').hidden = false;
    })();
    $('#pushCardGo')?.addEventListener('click', async () => { try { await enablePush(); $('#pushCard').hidden = true; toast('Notifications activées sur cet appareil'); } catch (ex) { fail(ex); } });
    $('#pushCardHide')?.addEventListener('click', () => { try { localStorage.setItem('comptoir.notifications.masquee', '1'); } catch { /* navigation privée */ } $('#pushCard').hidden = true; });
    $('#shareVitrine').addEventListener('click', async () => {
      if (navigator.share) { try { await navigator.share({ title: s.shop_name, url: vitrine }); return; } catch { /* annulé */ } }
      try { await navigator.clipboard.writeText(vitrine); toast('Lien de la vitrine copié'); } catch { toast(vitrine); }
    });
  }

  /* ================= Caisse ================= */
  const pos = { tab: 'vente', lines: [], customer_id: '', client_name: '', client_phone: '', discount: 0, source: null, q: '', cat: '', journalDate: '' };
  const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
  const ttcOf = (ht, rate) => r2(ht * (1 + rate / 100));

  // Mêmes calculs que le serveur, pour que le total affiché soit exactement celui encaissé.
  const loyaltyCfg = () => { const s = state.settings; return { on: s.loyalty_enabled === '1', earn: Number(s.loyalty_earn) || 1, threshold: Number(s.loyalty_threshold) || 100, reward: Number(s.loyalty_reward) || 0 }; };
  function posPayload() {
    const base = pos.lines.map((l) => ({ product_id: l.product_id, label: l.label, qty: Number(l.qty) || 0, unit_price_ht: r4(l.ht), tva_rate: l.tva_rate })).filter((l) => l.qty);
    const pct = Math.min(100, Math.max(0, Number(pos.discount) || 0));
    const byRate = {};
    base.forEach((l) => { byRate[l.tva_rate] = (byRate[l.tva_rate] || 0) + l.qty * l.unit_price_ht; });
    const disc = pct ? Object.entries(byRate).filter(([, ht]) => ht > 0).map(([rate, ht]) => ({ product_id: null, label: `Remise ${pct} %`, qty: 1, unit_price_ht: -Math.round(ht * pct * 100) / 10000, tva_rate: Number(rate) })) : [];
    // Récompense fidélité : même calcul que le serveur (pourcentage équivalent appliqué par taux de TVA).
    const L = loyaltyCfg();
    const grossBase = base.reduce((s, l) => s + l.qty * l.unit_price_ht * (1 + l.tva_rate / 100), 0);
    let loyaltyPct = 0, rew = [];
    if (pos.loyalty && L.on && grossBase > 0) {
      loyaltyPct = Math.min(100, (L.reward / grossBase) * 100);
      rew = Object.entries(byRate).filter(([, ht]) => ht > 0).map(([rate, ht]) => ({ product_id: null, label: 'Fidélité', qty: 1, unit_price_ht: -Math.round(ht * loyaltyPct * 100) / 10000, tva_rate: Number(rate) }));
    }
    const all = [...base, ...disc, ...rew];
    let ht = 0, tva = 0;
    all.forEach((l) => { const h = l.qty * l.unit_price_ht; ht += h; tva += (h * l.tva_rate) / 100; });
    ht = r2(ht); tva = r2(tva);
    const gross = r2(grossBase);
    const rewardAmount = rew.length ? r2(-rew.reduce((s, l) => s + l.unit_price_ht * (1 + l.tva_rate / 100), 0)) : 0;
    return { lines: base, discountLines: disc, ht, tva, ttc: r2(ht + tva), discountAmount: r2(gross - r2(ht + tva) - rewardAmount), rewardAmount, loyaltyPct };
  }

  function posAdd(p, qty = 1) {
    const line = pos.lines.find((l) => l.product_id === p.id && !l.edited);
    if (line) line.qty = Number(line.qty) + qty;
    const here = p.stock_here ?? p.stock;
    if (!line) pos.lines.push({ product_id: p.id, label: p.name, ref: p.ref, unit: p.unit, qty, tva_rate: p.tva_rate, ht: p.price_ht, ttc: ttcOf(p.price_ht, p.tva_rate), stock: here });
    if (p.track_stock && here - qty < 0 && !pos.warned?.[p.id]) { pos.warned = { ...(pos.warned || {}), [p.id]: 1 }; toast(`Stock insuffisant pour ${p.name} (${qtyFmt(here)} en stock ici)`, true); }
    renderPosTicket();
  }

  function posReset() {
    Object.assign(pos, { lines: [], customer_id: '', client_name: '', client_phone: '', discount: 0, source: null, warned: {} });
  }

  function loadOrderInPos(d) {
    posReset();
    pos.source = { id: d.id, number: d.number };
    pos.customer_id = d.customer_id || '';
    pos.client_name = d.customer_id ? '' : d.client_name;
    pos.client_phone = d.customer_id ? '' : d.client_phone;
    pos.lines = d.lines.map((l) => {
      const p = state.products.find((x) => x.id === l.product_id);
      return { product_id: l.product_id, label: l.label, ref: p?.ref || '', unit: p?.unit || '', qty: l.qty, tva_rate: l.tva_rate, ht: l.unit_price_ht, ttc: ttcOf(l.unit_price_ht, l.tva_rate), stock: p?.stock, edited: !p };
    });
    pos.tab = 'vente';
    closeModal();
    if (location.hash === '#/caisse') route(); else location.hash = '#/caisse';
  }

  function viewPos() {
    setActions(`<div class="chips"><button class="chip" data-postab="vente" aria-pressed="${pos.tab === 'vente'}">Vente</button><button class="chip" data-postab="journal" aria-pressed="${pos.tab === 'journal'}">Journal de caisse</button></div>`);
    $$('[data-postab]').forEach((b) => b.addEventListener('click', () => { pos.tab = b.dataset.postab; route(); }));
    if (pos.tab === 'journal') return viewJournal();
    const locs = state.me.locations || [];
    if (state.scope === 'all' && locs.length > 1 && !locs.some((l) => l.id === pos.location)) pos.location = locs[0].id;
    $('#view').innerHTML = `
      ${state.scope === 'all' && locs.length > 1 ? `<div class="pos-where"><span>Encaisser dans la boutique</span><select id="posWhere">${locs.map((l) => `<option value="${l.id}" ${l.id === pos.location ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select><span class="muted">Le stock affiché est le total de toutes les boutiques.</span></div>` : ''}
      <div class="pos">
        <section class="pos-catalog">
          <div class="pos-search">
            <input id="posSearch" type="search" placeholder="Scanner ou rechercher un produit" value="${esc(pos.q)}" autocomplete="off">
            <button class="btn scan-open" id="posScan" type="button" aria-label="Scanner avec la caméra" title="Scanner avec la caméra"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7V5.5A1.5 1.5 0 0 1 5.5 4H7M17 4h1.5A1.5 1.5 0 0 1 20 5.5V7M20 17v1.5a1.5 1.5 0 0 1-1.5 1.5H17M7 20H5.5A1.5 1.5 0 0 1 4 18.5V17"/><path d="M7.5 8v8M10 8v8M12.5 8v8M15 8v5M16.5 8v8"/></svg><span>Scanner</span></button>
            <button class="btn" id="posFree" type="button">Article libre</button>
          </div>
          <div class="chips pos-cats" id="posCats"></div>
          <div class="pos-grid" id="posGrid"></div>
        </section>
        <aside class="pos-ticket" aria-label="Ticket en cours">
          <div class="pos-head"><h2>Ticket en cours</h2><span id="posCount" class="muted"></span><button class="link pos-clear" id="posClear" type="button">Vider</button></div>
          <div id="posClient"></div>
          <div class="pos-lines" id="posLines"></div>
          <div class="pos-bottom">
            <div class="pos-totals" id="posTotals"></div>
            <button class="btn btn-primary pos-pay" id="posPay" type="button"></button>
            <div class="pos-more">
              <button class="btn" id="posDiscount" type="button">Remise</button>
              <button class="btn" id="posReserve" type="button">Mettre de côté</button>
              <button class="btn" id="posCredit" type="button">À crédit</button>
            </div>
          </div>
        </aside>
      </div>
      <div class="pos-mbar" id="posMbar" hidden><span id="posMbarInfo"></span><button class="btn" id="posMbarSee" type="button">Ticket</button><button class="btn btn-primary" id="posMbarPay" type="button">Encaisser</button></div>`;
    const search = $('#posSearch');
    search.addEventListener('input', () => { pos.q = search.value; renderPosGrid(); });
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = search.value.trim().toLowerCase(); if (!q) return;
      const exact = findByCode(q);
      const list = posFiltered();
      const p = exact || (list.length === 1 ? list[0] : null);
      if (p) { posAdd(p); search.value = ''; pos.q = ''; renderPosGrid(); }
      else toast(list.length ? 'Plusieurs produits correspondent : touchez le bon.' : `Aucun produit pour « ${search.value} ».`, !list.length);
    });
    $('#posFree').addEventListener('click', freeItemModal);
    // Scanner en continu : chaque code lu ajoute l'article au ticket, la caméra reste ouverte.
    $('#posScan').hidden = !window.ComptoirScanner;
    $('#posScan').addEventListener('click', () => window.ComptoirScanner.open({
      title: 'Scanner des articles', continuous: true, hint: 'Visez le code-barres : l’article s’ajoute au ticket',
      onCode: (code) => {
        const p = findByCode(code);
        if (!p) return { ok: false, message: `Code ${code} inconnu`, actionLabel: can('products.edit') ? 'Créer ce produit' : null, action: () => productForm(null, { barcode: code }) };
        posAdd(p);
        const l = pos.lines.find((x) => x.product_id === p.id);
        return { ok: true, message: `${p.name} · ${qtyFmt(l ? l.qty : 1)} au ticket` };
      },
    }));
    $('#posPay').addEventListener('click', payModal);
    $('#posMbarPay').addEventListener('click', payModal);
    $('#posMbarSee').addEventListener('click', () => $('.pos-ticket').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    $('#posWhere')?.addEventListener('change', (e) => { pos.location = Number(e.target.value); });
    $('#posDiscount').hidden = !can('pos.discount');
    $('#posReserve').hidden = !can('pos.credit');
    $('#posCredit').hidden = !can('pos.credit');
    $('#posDiscount').addEventListener('click', discountModal);
    $('#posReserve').addEventListener('click', reserveModal);
    $('#posCredit').addEventListener('click', creditModal);
    $('#posClear').addEventListener('click', () => {
      if (pos.lines.length && !confirmAction('Vider le ticket en cours ?')) return;
      posReset(); renderPosTicket(); search.focus();
    });
    renderPosCats(); renderPosGrid(); renderPosTicket();
    setTimeout(() => search.focus(), 30);
  }

  function posFiltered() {
    const q = norm(pos.q);
    return state.products.filter((p) => (!pos.cat || String(p.category_id) === String(pos.cat)) && (!q || norm(`${p.name} ${p.ref} ${p.barcode || ''}`).includes(q)));
  }
  function renderPosCats() {
    const used = new Set(state.products.map((p) => String(p.category_id)));
    $('#posCats').innerHTML = `<button class="chip" data-poscat="" aria-pressed="${!pos.cat}">Tout</button>` +
      state.categories.filter((c) => used.has(String(c.id))).map((c) => `<button class="chip" data-poscat="${c.id}" aria-pressed="${String(pos.cat) === String(c.id)}">${esc(c.name)}</button>`).join('');
    $$('[data-poscat]').forEach((b) => b.addEventListener('click', () => { pos.cat = b.dataset.poscat; renderPosCats(); renderPosGrid(); }));
  }
  function renderPosGrid() {
    const list = posFiltered().slice(0, 120);
    $('#posGrid').innerHTML = list.map((p) => {
      const here = p.stock_here ?? p.stock;
      const cls = !p.track_stock ? 'muted' : here <= 0 ? 'stock-out' : here <= p.stock_min ? 'stock-low' : 'stock-ok';
      return `<button class="pos-tile" type="button" data-posadd="${p.id}">
        <span class="pos-tile-name">${esc(p.name)}</span>
        <span class="pos-tile-ref">${esc(p.ref)}</span>
        <span class="pos-tile-foot"><strong>${money(ttcOf(p.price_ht, p.tva_rate))}</strong><span class="${cls}">${p.track_stock ? qtyFmt(here) : ''}</span></span>
      </button>`;
    }).join('') || `<p class="muted">Aucun produit. Utilisez « Article libre » pour vendre un article hors catalogue.</p>`;
    $$('[data-posadd]').forEach((b) => b.addEventListener('click', () => {
      posAdd(state.products.find((p) => p.id === Number(b.dataset.posadd)));
      $('#posSearch').focus();
    }));
  }

  function renderPosTicket() {
    if (!$('#posLines')) return;
    const c = state.customers.find((x) => String(x.id) === String(pos.customer_id));
    $('#posClient').innerHTML = `
      ${pos.source ? `<div class="pos-source">Commande ${esc(pos.source.number)} <button class="link" id="posDetach" type="button">Détacher</button></div>` : ''}
      <div class="pos-client">
        <select id="posCustomer" aria-label="Client"><option value="">Client de passage</option>${state.customers.map((x) => `<option value="${x.id}" ${String(x.id) === String(pos.customer_id) ? 'selected' : ''}>${esc(x.name)}${x.company ? ' — ' + esc(x.company) : ''}</option>`).join('')}</select>
        <button class="btn btn-sm" id="posNewCustomer" type="button">Nouveau</button>
      </div>
      ${!c && pos.client_name ? `<p class="pos-named">Client : <strong>${esc(pos.client_name)}</strong>${pos.client_phone ? ', ' + esc(pos.client_phone) : ''}</p>` : ''}
      ${c && c.due > 0 ? `<p class="pos-due">Ce client doit déjà ${money(c.due)}.</p>` : ''}`;
    $('#posCustomer').addEventListener('change', (e) => { pos.customer_id = e.target.value; pos.client_name = ''; pos.client_phone = ''; pos.loyalty = false; renderPosTicket(); });
    $('#posNewCustomer').addEventListener('click', () => customerForm(null, (id) => { pos.customer_id = id; closeModal(); route(); }));
    $('#posDetach')?.addEventListener('click', () => { pos.source = null; renderPosTicket(); });

    $('#posLines').innerHTML = pos.lines.length ? pos.lines.map((l, i) => `
      <div class="pos-line">
        <div class="pos-line-main"><span class="pos-line-name">${esc(l.label)}</span>
          <label class="pos-line-price">${qtyFmt(l.qty)} × <input type="number" step="0.01" min="0" value="${l.ttc.toFixed(2)}" data-posprice="${i}" aria-label="Prix unitaire TTC" ${can('pos.discount') ? '' : 'readonly'}> ${esc(cur())}</label></div>
        <div class="stepper"><button type="button" data-posqty="${i}" data-d="-1" aria-label="Diminuer">−</button><input type="number" step="any" min="0" value="${l.qty}" data-posqtyin="${i}" aria-label="Quantité"><button type="button" data-posqty="${i}" data-d="1" aria-label="Augmenter">+</button></div>
        <span class="pos-line-total">${money(l.qty * l.ttc)}</span>
        <button type="button" class="icon-btn" data-posrm="${i}" aria-label="Retirer ${esc(l.label)}">✕</button>
      </div>`).join('') : `<div class="pos-empty">Scannez un article ou touchez un produit pour commencer.</div>`;
    $$('[data-posqty]').forEach((b) => b.addEventListener('click', () => {
      const l = pos.lines[b.dataset.posqty]; l.qty = Math.max(0, Number(l.qty) + Number(b.dataset.d));
      if (!l.qty) pos.lines.splice(b.dataset.posqty, 1);
      renderPosTicket();
    }));
    $$('[data-posqtyin]').forEach((i) => i.addEventListener('change', () => {
      const v = Number(i.value); if (v > 0) pos.lines[i.dataset.posqtyin].qty = v; else pos.lines.splice(i.dataset.posqtyin, 1);
      renderPosTicket();
    }));
    $$('[data-posprice]').forEach((i) => i.addEventListener('change', () => {
      const l = pos.lines[i.dataset.posprice]; const v = Math.max(0, Number(i.value) || 0);
      l.ttc = r2(v); l.ht = r4(v / (1 + l.tva_rate / 100)); l.edited = true; renderPosTicket();
    }));
    $$('[data-posrm]').forEach((b) => b.addEventListener('click', () => { pos.lines.splice(b.dataset.posrm, 1); renderPosTicket(); }));

    const t = posPayload();
    const count = pos.lines.reduce((n, l) => n + Number(l.qty), 0);
    // Fidélité du client sélectionné
    const L = loyaltyCfg();
    const cust = L.on && pos.customer_id ? state.customers.find((c) => c.id === Number(pos.customer_id)) : null;
    const pts = cust ? Number(cust.loyalty_points) || 0 : 0;
    if (pos.loyalty && (!cust || pts < L.threshold || t.ttc + t.rewardAmount < L.reward - 0.01)) { pos.loyalty = false; return renderPosTicket(); }
    const loyaltyHtml = cust ? `<div class="pos-loyalty"><span>Fidélité : <strong>${qtyFmt(pts)} point${pts > 1 ? 's' : ''}</strong>${pts < L.threshold ? ` <em>(récompense à ${L.threshold})</em>` : ''}</span>
      ${pts >= L.threshold && pos.lines.length ? (t.ttc + t.rewardAmount >= L.reward - 0.01
        ? `<button type="button" class="btn btn-sm ${pos.loyalty ? 'btn-primary' : ''}" id="posLoyalty">${pos.loyalty ? 'Récompense appliquée' : `Utiliser ${L.threshold} points (− ${money(L.reward)})`}</button>`
        : `<em>Récompense de ${money(L.reward)} utilisable dès ${money(L.reward)} d’achat</em>`) : ''}</div>` : '';
    $('#posTotals').innerHTML = `
      ${loyaltyHtml}
      ${pos.discount ? `<div><span>Remise ${pos.discount} %</span><span>− ${money(t.discountAmount)}</span></div>` : ''}
      ${t.rewardAmount ? `<div><span>Fidélité</span><span>− ${money(t.rewardAmount)}</span></div>` : ''}
      <div><span>dont TVA</span><span>${money(t.tva)}</span></div>
      <div class="grand"><span>TOTAL</span><span>${money(t.ttc)}</span></div>`;
    $('#posCount').textContent = count ? `${qtyFmt(count)} article${count > 1 ? 's' : ''}` : '';
    $('#posLoyalty')?.addEventListener('click', () => { pos.loyalty = !pos.loyalty; renderPosTicket(); });
    const empty = !pos.lines.length;
    $('#posPay').textContent = empty ? 'Encaisser' : `Encaisser ${money(t.ttc)}`;
    $('#posMbar').hidden = empty;
    $('#posMbarInfo').innerHTML = `<strong>${money(t.ttc)}</strong><span>${qtyFmt(count)} article${count > 1 ? 's' : ''}</span>`;
    ['posPay', 'posDiscount', 'posReserve', 'posCredit'].forEach((id) => { $('#' + id).disabled = empty; });
    $('#posDiscount').textContent = pos.discount ? `Remise ${pos.discount} %` : 'Remise';
  }

  function freeItemModal() {
    const tva = Number(state.settings.tva_default) || 20;
    const body = openModal('Article libre', `
      <form id="freeForm" class="fields" novalidate>
        <label class="field full"><span>Désignation</span><input name="label" required placeholder="Découpe de chaîne, clé reproduite…"></label>
        <label class="field"><span>Prix unitaire TTC (${esc(cur())})</span><input name="ttc" type="number" step="0.01" min="0" required></label>
        <label class="field"><span>Quantité</span><input name="qty" type="number" step="any" min="0" value="1"></label>
        <label class="field"><span>TVA (%)</span><input name="tva" type="number" step="0.1" value="${tva}"></label>
        <p class="form-error full" id="freeError"></p>
      </form>
      <div class="modal-foot"><div class="right"><button class="btn" id="freeCancel">Annuler</button><button class="btn btn-primary" id="freeAdd">Ajouter au ticket</button></div></div>`);
    $('[name=label]', body).focus();
    $('#freeCancel').addEventListener('click', closeModal);
    $('#freeAdd').addEventListener('click', () => {
      const d = Object.fromEntries(new FormData($('#freeForm')));
      if (!d.label.trim() || !(Number(d.ttc) >= 0) || d.ttc === '') { $('#freeError').textContent = 'Indiquez une désignation et un prix.'; return; }
      const rate = Number(d.tva) || 0, ttc = r2(Number(d.ttc));
      pos.lines.push({ product_id: null, label: d.label.trim(), ref: '', unit: '', qty: Number(d.qty) || 1, tva_rate: rate, ht: r4(ttc / (1 + rate / 100)), ttc, edited: true });
      closeModal(); renderPosTicket(); $('#posSearch').focus();
    });
  }

  function discountModal() {
    const body = openModal('Remise sur le ticket', `
      <div class="quick">${[0, 5, 10, 15, 20].map((v) => `<button class="btn" data-disc="${v}">${v ? v + ' %' : 'Aucune'}</button>`).join('')}</div>
      <label class="field" style="margin-top:14px"><span>Autre remise (%)</span><input id="discIn" type="number" min="0" max="100" step="0.5" value="${pos.discount || ''}"></label>
      <div class="modal-foot"><div class="right"><button class="btn" id="discCancel">Annuler</button><button class="btn btn-primary" id="discOk">Appliquer</button></div></div>`);
    const apply = (v) => { pos.discount = Math.min(100, Math.max(0, Number(v) || 0)); closeModal(); renderPosTicket(); };
    $$('[data-disc]', body).forEach((b) => b.addEventListener('click', () => apply(b.dataset.disc)));
    $('#discCancel').addEventListener('click', closeModal);
    $('#discOk').addEventListener('click', () => apply($('#discIn').value));
  }

  function posBody(mode, payments = [], notes = '') {
    const t = posPayload();
    return { mode, lines: t.lines, discount_pct: pos.discount, payments, notes, source_id: pos.source?.id || null, customer_id: pos.customer_id || null, client_name: pos.client_name, client_phone: pos.client_phone,
      location_id: state.scope === 'all' ? pos.location || null : undefined,
      loyalty_redeem: !!pos.loyalty || undefined, loyalty_pct: pos.loyalty ? t.loyaltyPct : undefined };
  }

  /* ---------------- Mode hors ligne ---------------- */
  // État du réseau, bandeau, file d'attente et synchronisation.
  const net = {
    online: navigator.onLine, dataAt: null, counts: { pending: 0, failed: 0 }, syncing: false,
    set(on) { if (on === net.online) return; net.online = on; if (on) net.dataAt = null; net.render(); if (on) syncNow(); },
    async refresh() { if (window.ComptoirOutbox) net.counts = await window.ComptoirOutbox.counts().catch(() => net.counts); net.render(); },
    render() {
      const bar = $('#netBar'); if (!bar) return;
      const { pending, failed } = net.counts;
      const n = (k, s, p) => `${k} ${k > 1 ? p : s}`;
      let html = '', tone = '';
      if (!net.online) {
        tone = 'off';
        html = `<strong>Hors ligne</strong><span>Ventes, clients et mouvements de stock sont enregistrés sur cet appareil${pending ? ` (${n(pending, 'opération en attente', 'opérations en attente')})` : ''} et seront envoyés dès le retour d’internet.</span>`;
      } else if (net.syncing && pending) { tone = 'sync'; html = `<strong>Synchronisation</strong><span>Envoi de ${n(pending, 'opération', 'opérations')} faites hors ligne…</span>`; }
      else if (pending) { tone = 'sync'; html = `<strong>${n(pending, 'opération en attente', 'opérations en attente')}</strong><span>Envoi automatique en cours.</span>`; }
      if (failed) { tone = tone || 'bad'; html += `<button type="button" class="net-link" data-sync-panel>${n(failed, 'opération refusée', 'opérations refusées')} : voir</button>`; }
      else if (pending || !net.online) html += '<button type="button" class="net-link" data-sync-panel>Détail</button>';
      bar.className = `net-bar ${tone}`; bar.hidden = !html; bar.innerHTML = html;
    },
  };
  const OP_LABEL = { sale: 'Vente', customer: 'Nouveau client', stock: 'Mouvement de stock', support: 'Message au support' };
  async function syncNow() {
    const O = window.ComptoirOutbox; if (!O || !navigator.onLine || net.syncing) return;
    await net.refresh(); if (!net.counts.pending) return;
    net.syncing = true; net.render();
    try {
      const r = await O.flush();
      if (r.sent) {
        cache.clear();
        const sales = r.byType.sale || 0;
        toast(sales ? `${sales} vente${sales > 1 ? 's' : ''} hors ligne synchronisée${sales > 1 ? 's' : ''}` : `${r.sent} opération${r.sent > 1 ? 's' : ''} synchronisée${r.sent > 1 ? 's' : ''}`);
        await refresh('products', 'customers').catch(() => {});
        if (current.key !== 'caisse' && !$('#modal').open) rerender();
      }
      if (r.failed) toast(`${r.failed} opération${r.failed > 1 ? 's' : ''} refusée${r.failed > 1 ? 's' : ''} par le serveur : voir le détail`, true);
      if (r.auth) toast('Reconnectez-vous pour envoyer les opérations faites hors ligne.', true);
    } finally { net.syncing = false; await net.refresh(); }
  }
  // Demande au système de synchroniser dès le retour du réseau, même application fermée (Android).
  function backgroundSync() { navigator.serviceWorker?.ready.then((r) => r.sync?.register('comptoir-outbox')).catch(() => {}); }
  async function enqueue(op) {
    const saved = await window.ComptoirOutbox.add({ store_id: state.me.store.id, ...op });
    backgroundSync(); await net.refresh();
    if (navigator.onLine) setTimeout(syncNow, 1500);
    return saved;
  }
  function describeOp(o) {
    const b = o.body || {};
    if (o.type === 'sale') { const t = (b.lines || []).reduce((s, l) => s + l.qty * l.unit_price_ht * (1 + l.tva_rate / 100), 0); return `${b.mode === 'reserve' ? 'Mise de côté' : b.mode === 'credit' ? 'Vente à crédit' : 'Vente'} de ${money(t)}${b.client_name ? ` · ${b.client_name}` : ''}`; }
    if (o.type === 'customer') return b.name || 'Client';
    if (o.type === 'product') return b.name || 'Produit';
    if (o.type === 'stock') return `${b.type || ''} · ${state.products.find((p) => p.id === Number(b.product_id))?.name || 'produit'} · ${b.qty}`;
    if (o.type === 'support') return String(b.body || '').slice(0, 80);
    return '';
  }
  async function syncPanel() {
    const list = await window.ComptoirOutbox.all();
    const mine = list.filter((o) => !o.store_id || o.store_id === state.me.store.id);
    const body = openModal('Opérations faites hors ligne', mine.length ? `
      <p class="muted">Elles sont gardées sur cet appareil et envoyées dans l’ordre dès que la connexion revient. Une opération refusée par le serveur (droits modifiés, produit supprimé…) attend votre décision.</p>
      <ul class="sync-list">${mine.map((o) => `<li class="${o.status}"><div><strong>${esc(OP_LABEL[o.type] || o.type)}</strong><span>${esc(describeOp(o))}</span>
        <small>${new Date(o.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · ${o.status === 'failed' ? `<b>refusée</b> : ${esc(o.error || '')}` : o.status === 'later' ? 'autre commerce' : 'en attente'}</small></div>
        ${o.status === 'failed' ? `<div class="sync-actions"><button class="btn btn-sm" data-op-retry="${o.ref}">Réessayer</button><button class="btn btn-sm" data-op-drop="${o.ref}">Supprimer</button></div>` : ''}</li>`).join('')}</ul>
      <div class="modal-foot"><div class="right">${navigator.onLine ? '<button class="btn btn-primary" id="syncGo">Envoyer maintenant</button>' : ''}<button class="btn" id="syncClose">Fermer</button></div></div>`
      : '<p>Aucune opération en attente : tout est synchronisé.</p><div class="modal-foot"><div class="right"><button class="btn" id="syncClose">Fermer</button></div></div>');
    $('#syncClose', body).addEventListener('click', closeModal);
    $('#syncGo', body)?.addEventListener('click', async () => { closeModal(); await syncNow(); });
    $$('[data-op-retry]', body).forEach((b) => b.addEventListener('click', async () => { const o = mine.find((x) => x.ref === b.dataset.opRetry); await window.ComptoirOutbox.put({ ...o, status: 'pending' }); closeModal(); syncNow(); }));
    $$('[data-op-drop]', body).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Supprimer définitivement cette opération ? Elle ne sera jamais envoyée.')) return;
      await window.ComptoirOutbox.remove(b.dataset.opDrop); await net.refresh(); closeModal(); syncPanel();
    }));
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-sync-panel]')) syncPanel(); });
  window.addEventListener('online', () => net.set(true));
  window.addEventListener('offline', () => net.set(false));
  setInterval(() => { if (net.counts.pending && navigator.onLine) syncNow(); }, 45000);
  // Synchronisation faite par le service worker (application en arrière-plan) : on met l'écran à jour.
  if (typeof BroadcastChannel === 'function') new BroadcastChannel('comptoir-sync').addEventListener('message', (e) => { if (e.data?.type === 'flushed' && e.data.summary?.sent && !net.syncing) { cache.clear(); refresh('products', 'customers').catch(() => {}); } net.refresh(); });

  // Vente : envoyée tout de suite si possible, sinon mise dans la file avec un ticket provisoire.
  // L'identifiant d'opération rend l'envoi rejouable : une vente n'est jamais enregistrée deux fois.
  async function posSubmit(body) {
    body.client_ref ||= window.ComptoirOutbox.uuid();
    if (String(body.customer_id || '').startsWith('tmp-')) { body.customer_client_ref = String(body.customer_id).slice(4); body.customer_id = null; }
    // Produits créés hors ligne (id temporaire tmp-…) : on envoie le client_ref pour que le serveur les rattache.
    for (const l of body.lines || []) {
      if (String(l.product_id || '').startsWith('tmp-')) {
        l.product_client_ref = String(l.product_id).slice(4);
        l.product_id = null;
      }
    }
    if (navigator.onLine) {
      try { return await api('/store/pos/checkout', { method: 'POST', body }); }
      catch (e) { if (e.name !== 'Offline') throw e; }
    }
    if (body.loyalty_redeem) throw new Error('La récompense fidélité demande une connexion : retirez-la pour encaisser hors ligne.');
    const location_id = body.location_id || (state.scope !== 'all' ? state.scope : null);
    const op = await enqueue({ ref: body.client_ref, type: 'sale', body, location_id });
    if (body.mode !== 'reserve') {
      for (const l of body.lines) {
        const pid = l.product_id ?? (l.product_client_ref ? `tmp-${l.product_client_ref}` : null);
        const p = state.products.find((x) => String(x.id) === String(pid));
        if (p && p.track_stock) {
          p.stock = Math.round((p.stock - l.qty) * 1000) / 1000;
          if (p.stock_by_location && location_id) p.stock_by_location[location_id] = (p.stock_by_location[location_id] || 0) - l.qty;
        }
      }
      keep('/store/products', state.products);
    }
    const ht = body.lines.reduce((s, l) => s + l.qty * l.unit_price_ht, 0), ttc = body.lines.reduce((s, l) => s + l.qty * l.unit_price_ht * (1 + l.tva_rate / 100), 0);
    const customer = state.customers.find((c) => String(c.id) === String(body.customer_id || (body.customer_client_ref ? 'tmp-' + body.customer_client_ref : '')));
    return { offline: true, id: null, number: `provisoire ${op.ref.slice(0, 6).toUpperCase()}`, lines: body.lines, payments: body.payments,
      total_ht: r2(ht), total_tva: r2(ttc - ht), total_ttc: r2(ttc), client_name: body.client_name || customer?.name || '', status: body.mode === 'ticket' ? 'payé' : 'émise', created_at: null };
  }

  function payModal() {
    const total = posPayload().ttc;
    const payments = [];
    let method = 'espèces';
    const paid = () => r2(payments.reduce((s, p) => s + p.amount, 0));
    const rest = () => r2(total - paid());
    const body = openModal('Encaissement', `
      <div class="pay-total"><span>À payer</span><strong id="payRest"></strong></div>
      <div class="pay-methods">${METHODS.filter((m) => m !== 'autre').map((m) => `<button type="button" class="pay-method" data-method="${m}">${cap(m)}</button>`).join('')}</div>
      <label class="field"><span id="payLabel">Montant</span><input id="payAmount" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done"></label>
      <div class="quick" id="payQuick"></div>
      <p class="pay-change" id="payChange"></p>
      <ul class="pay-list" id="payList"></ul>
      <p class="form-error" id="payErr"></p>
      <div class="modal-foot"><div class="right"><button class="btn" id="payCancel">Annuler</button><button class="btn btn-primary" id="payGo"></button></div></div>`);
    const amount = $('#payAmount', body);
    const refresh = () => {
      $('#payRest').textContent = money(rest());
      $$('.pay-method', body).forEach((b) => b.setAttribute('aria-pressed', b.dataset.method === method));
      $('#payLabel').textContent = method === 'espèces' ? 'Montant reçu' : 'Montant';
      const r = rest();
      const notes = [...new Set([10, 20, 50, 100, 200, 500].map((u) => Math.ceil((r + 0.001) / u) * u))].filter((v) => v > r).slice(0, 3);
      $('#payQuick').innerHTML = method === 'espèces' ? [r, ...notes].map((v) => `<button type="button" class="btn btn-sm" data-quick="${v}">${v === r ? 'Compte juste' : money(v)}</button>`).join('') : '';
      $$('[data-quick]', body).forEach((b) => b.addEventListener('click', () => { amount.value = amt(Number(b.dataset.quick)); refresh(); }));
      const v = r2(readAmt(amount.value) || 0);
      $('#payChange').innerHTML = method === 'espèces' && v > r ? `<span>À rendre</span><strong>${money(v - r)}</strong>` : '';
      $('#payGo').textContent = v >= r ? 'Valider la vente' : 'Ajouter ce paiement';
      $('#payList').innerHTML = payments.map((p, i) => `<li><span>${cap(p.method)}</span><span>${money(p.amount)} <button type="button" class="link" data-unpay="${i}">retirer</button></span></li>`).join('');
      $$('[data-unpay]', body).forEach((b) => b.addEventListener('click', () => { payments.splice(b.dataset.unpay, 1); amount.value = amt(rest()); refresh(); }));
    };
    $$('.pay-method', body).forEach((b) => b.addEventListener('click', () => { method = b.dataset.method; if (method !== 'espèces' && readAmt(amount.value) > rest()) amount.value = amt(rest()); refresh(); amount.focus(); }));
    amount.addEventListener('input', refresh);
    amount.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#payGo').click(); } });
    $('#payCancel').addEventListener('click', closeModal);
    $('#payGo').addEventListener('click', async (e) => {
      const r = rest(); const v = r2(readAmt(amount.value) || 0);
      $('#payErr').textContent = '';
      if (v <= 0) { $('#payErr').textContent = 'Indiquez le montant reçu.'; return; }
      if (v > r && method !== 'espèces') { $('#payErr').textContent = 'Seules les espèces permettent de rendre la monnaie.'; return; }
      const change = method === 'espèces' && v > r ? r2(v - r) : 0;
      payments.push({ method, amount: Math.min(v, r), note: change ? `Reçu ${money(v)}, rendu ${money(change)}` : '' });
      if (rest() > 0) { amount.value = amt(rest()); refresh(); amount.focus(); return; }
      e.currentTarget.disabled = true;
      try {
        const doc = await posSubmit(posBody('ticket', payments));
        saleDone(doc, change);
      } catch (ex) { payments.pop(); $('#payErr').textContent = ex.message; e.currentTarget.disabled = false; refresh(); }
    });
    amount.value = amt(total);
    refresh(); amount.select();
  }

  async function saleDone(doc, change = 0) {
    posReset();
    await refresh('products', 'customers').catch(() => {});
    const body = openModal('Vente enregistrée', `
      <div class="sale-done">
        <p class="sale-number">${doc.offline ? 'Ticket provisoire' : esc(doc.number)} : ${money(doc.total_ttc)}</p>
        ${doc.offline ? '<p class="sale-offline">Hors ligne : la vente est enregistrée sur cet appareil et sera envoyée dès le retour d’internet. Son numéro définitif sera attribué à ce moment-là.</p>' : ''}
        ${change ? `<p class="sale-change">À rendre <strong>${money(change)}</strong></p>` : ''}
        ${doc.loyalty ? `<p class="sale-loyalty">${doc.loyalty.used ? `${qtyFmt(doc.loyalty.used)} points utilisés. ` : ''}${doc.loyalty.earned ? `+${qtyFmt(doc.loyalty.earned)} points gagnés. ` : ''}Nouveau solde : <strong>${qtyFmt(doc.loyalty.balance)} points</strong></p>` : ''}
      </div>
      <div class="modal-foot">
        <div><button class="btn" id="sdPrint">Imprimer le ticket</button> <button class="btn" id="sdShare">Envoyer au client</button> <button class="btn" id="sdInvoice">Faire une facture</button></div>
        <div class="right"><button class="btn btn-primary" id="sdNext">Nouvelle vente</button></div>
      </div>`);
    $('#sdPrint', body).addEventListener('click', () => printTicket(doc, change));
    if (doc.offline) { $('#sdInvoice', body).hidden = true; $('#sdShare', body).hidden = true; }
    $('#sdShare', body).addEventListener('click', (e) => shareToClient(doc, e.currentTarget));
    $('#sdInvoice', body).addEventListener('click', async () => {
      try { const f = await api(`/store/documents/${doc.id}/convert`, { method: 'POST', body: { to: 'facture' } }); toast(`${f.number} créée`); showDoc(f.id); } catch (e) { fail(e); }
    });
    $('#sdNext', body).addEventListener('click', () => { closeModal(); route(); });
    $('#sdNext', body).focus();
    modal.addEventListener('close', () => { if (location.hash === '#/caisse') route(); }, { once: true });
    updateBadges();
  }

  function clientFields(required) {
    const named = pos.customer_id ? state.customers.find((c) => String(c.id) === String(pos.customer_id)) : null;
    return named
      ? `<p class="notice">Client : <strong>${esc(named.name)}</strong>${named.phone ? ', ' + esc(named.phone) : ''}</p>`
      : `<div class="fields"><label class="field"><span>Nom du client${required ? '' : ' (facultatif)'}</span><input name="client_name" value="${esc(pos.client_name)}"></label>
         <label class="field"><span>Téléphone</span><input name="client_phone" type="tel" value="${esc(pos.client_phone)}"></label></div>
         <p class="muted" style="font-size:.88rem">Astuce : choisissez un client enregistré dans le ticket pour retrouver son historique.</p>`;
  }

  function reserveModal() {
    const t = posPayload();
    const body = openModal(pos.source ? `Mettre à jour ${pos.source.number}` : 'Mettre de côté', `
      <p class="muted" style="margin-top:0">La commande (${money(t.ttc)}) est enregistrée sans encaisser. Le client paiera au retrait : retrouvez-la dans Commandes, bouton « Encaisser en caisse ».</p>
      <form id="resForm">${clientFields(true)}
        <label class="field" style="margin-top:12px"><span>Note</span><input name="notes" placeholder="Retrait prévu samedi matin, commandé par téléphone…"></label>
      </form>
      <p class="form-error" id="resErr"></p>
      <div class="modal-foot"><div class="right"><button class="btn" id="resCancel">Annuler</button><button class="btn btn-primary" id="resOk">Mettre de côté</button></div></div>`);
    $('#resCancel').addEventListener('click', closeModal);
    $('#resOk', body).addEventListener('click', async (e) => {
      const d = Object.fromEntries(new FormData($('#resForm')));
      if (!pos.customer_id && !String(d.client_name || '').trim()) { $('#resErr').textContent = 'Indiquez le nom du client.'; return; }
      if (d.client_name !== undefined) { pos.client_name = d.client_name.trim(); pos.client_phone = (d.client_phone || '').trim(); }
      e.currentTarget.disabled = true;
      try {
        const doc = await posSubmit(posBody('reserve', [], d.notes));
        posReset(); closeModal(); toast(doc.offline ? `Mise de côté enregistrée sur cet appareil : elle sera envoyée au retour d’internet` : `${doc.number} mise de côté pour ${doc.client_name}`); updateBadges(); route();
      } catch (ex) { $('#resErr').textContent = ex.message; e.currentTarget.disabled = false; }
    });
  }

  function creditModal() {
    const t = posPayload();
    const days = Number(state.settings.invoice_due_days) || 30;
    const body = openModal('Vente à crédit', `
      <p class="muted" style="margin-top:0">Une facture de ${money(t.ttc)} est créée à régler sous ${days} jours. Le stock est déduit maintenant. Elle apparaîtra dans les alertes si elle n'est pas payée à temps.</p>
      <form id="credForm">${clientFields(true)}
        <div class="fields" style="margin-top:12px">
          <label class="field"><span>Acompte versé (facultatif)</span><input name="amount" type="number" step="0.01" min="0" max="${t.ttc}"></label>
          <label class="field"><span>Mode</span><select name="method">${METHODS.map((m) => `<option value="${m}">${cap(m)}</option>`).join('')}</select></label>
        </div>
      </form>
      <p class="form-error" id="credErr"></p>
      <div class="modal-foot"><div class="right"><button class="btn" id="credCancel">Annuler</button><button class="btn btn-primary" id="credOk">Créer la facture</button></div></div>`);
    $('#credCancel').addEventListener('click', closeModal);
    $('#credOk', body).addEventListener('click', async (e) => {
      const d = Object.fromEntries(new FormData($('#credForm')));
      if (!pos.customer_id && !String(d.client_name || '').trim()) { $('#credErr').textContent = 'Une vente à crédit nécessite un client.'; return; }
      if (d.client_name !== undefined) { pos.client_name = d.client_name.trim(); pos.client_phone = (d.client_phone || '').trim(); }
      e.currentTarget.disabled = true;
      try {
        const pay = Number(d.amount) > 0 ? [{ method: d.method, amount: Number(d.amount), note: 'Acompte' }] : [];
        const doc = await posSubmit(posBody('credit', pay));
        posReset(); await refresh('products', 'customers'); updateBadges(); route();
        if (doc.offline) toast('Vente à crédit enregistrée sur cet appareil : la facture sera créée au retour d’internet'); else { toast(`${doc.number} créée`); showDoc(doc.id); }
      } catch (ex) { $('#credErr').textContent = ex.message; e.currentTarget.disabled = false; }
    });
  }

  async function viewJournal() {
    const date = pos.journalDate || today();
    const j = await api(`/store/pos/journal?date=${date}`);
    const methods = ['espèces', 'carte', 'chèque', 'virement', 'mobile', 'autre'].filter((m) => j.by_method[m] !== undefined || !['autre', 'mobile'].includes(m));
    $('#view').innerHTML = `
      <div class="toolbar">
        <label class="field" style="flex-direction:row;align-items:center;gap:10px"><span>Journée du</span><input type="date" id="jDate" value="${date}" style="width:auto"></label>
        <button class="btn" id="jPrint">Imprimer le journal</button>
      </div>
      <section class="kpis kpis-journal">
        <div class="kpi"><span class="kpi-label">Encaissé</span><span class="kpi-value">${money(j.total_collected)}</span><span class="kpi-sub">tous modes confondus</span></div>
        ${methods.map((m) => `<div class="kpi"><span class="kpi-label">${cap(m)}</span><span class="kpi-value">${money(j.by_method[m] || 0)}</span><span class="kpi-sub">${m === 'espèces' ? 'à retrouver dans le tiroir' : '&nbsp;'}</span></div>`).join('')}
        <div class="kpi"><span class="kpi-label">Tickets</span><span class="kpi-value">${j.tickets_count}</span><span class="kpi-sub">panier moyen ${money(j.average_ticket)}</span></div>
      </section>
      <div class="dash-grid">
        <section class="panel">
          <div class="panel-head"><h2>Tickets de la journée</h2><span class="muted">${money(j.tickets_total)}</span></div>
          ${j.tickets.length ? `<div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Heure</th><th>Client</th><th class="num">Total</th><th>Statut</th></tr></thead><tbody>
            ${j.tickets.map((t) => `<tr class="clickable" data-doc="${t.id}"><td class="cell-main doc-num">${esc(t.number)}</td><td class="muted">${t.created_at ? new Date(t.created_at.replace(' ', 'T') + 'Z').toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''}</td><td>${esc(t.client_name)}</td><td class="num">${money(t.total_ttc)}</td><td>${badge(t.status)}</td></tr>`).join('')}
          </tbody></table></div>` : `<div class="empty-state"><strong>Aucun ticket ce jour-là.</strong></div>`}
        </section>
        <div class="stack">
          <section class="panel">
            <div class="panel-head"><h2>Encaissements</h2></div>
            ${j.payments.length ? `<div class="table-wrap"><table><thead><tr><th>Document</th><th>Mode</th><th class="num">Montant</th></tr></thead><tbody>
              ${j.payments.map((p) => `<tr class="clickable" data-doc="${p.document_id}"><td><span class="cell-main doc-num">${esc(p.number)}</span><div class="cell-sub">${esc(p.note || p.client_name)}</div></td><td>${esc(cap(p.method))}</td><td class="num ${p.amount < 0 ? 'stock-out' : ''}">${money(p.amount)}</td></tr>`).join('')}
            </tbody></table></div>` : `<div class="empty-state"><strong>Aucun encaissement.</strong></div>`}
          </section>
          ${j.credit.length ? `<section class="panel"><div class="panel-head"><h2>Ventes à crédit</h2></div><div class="table-wrap"><table><tbody>
            ${j.credit.map((f) => `<tr class="clickable" data-doc="${f.id}"><td class="cell-main doc-num">${esc(f.number)}</td><td>${esc(f.client_name)}</td><td class="num">${money(f.total_ttc)}</td></tr>`).join('')}
          </tbody></table></div></section>` : ''}
        </div>
      </div>`;
    $('#jDate').addEventListener('change', (e) => { pos.journalDate = e.target.value; route(); });
    $('#jPrint').addEventListener('click', () => printJournal(j));
  }

  function printWindow(html) {
    const w = window.open('', '_blank');
    if (!w) return toast("Autorisez l'ouverture des fenêtres pour imprimer.", true);
    w.document.open(); w.document.write(html); w.document.close();
  }

  function printTicket(d, change = 0) {
    const s = state.settings;
    const products = d.lines.filter((l) => l.unit_price_ht >= 0);
    const discounts = d.lines.filter((l) => l.unit_price_ht < 0);
    const byRate = {};
    d.lines.forEach((l) => { const h = l.qty * l.unit_price_ht; byRate[l.tva_rate] = byRate[l.tva_rate] || { ht: 0, tva: 0 }; byRate[l.tva_rate].ht += h; byRate[l.tva_rate].tva += (h * l.tva_rate) / 100; });
    const when = d.created_at ? new Date(d.created_at.replace(' ', 'T') + 'Z') : new Date();
    printWindow(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(d.number)}</title>
      <style>@page{size:80mm auto;margin:4mm}body{font-family:"Courier New",monospace;font-size:11px;width:72mm;margin:0;color:#000}
      .c{text-align:center}.r{text-align:right}h1{font-size:15px;margin:0 0 2px;font-family:Arial,sans-serif}
      hr{border:0;border-top:1px dashed #000;margin:6px 0}table{width:100%;border-collapse:collapse}td{vertical-align:top;padding:1px 0}
      .big td{font-size:14px;font-weight:bold;padding-top:3px}</style></head><body>
      <div class="c"><h1>${esc(s.shop_name)}</h1>${esc(s.address)}<br>${esc(s.phone)}</div><hr>
      <div>Ticket ${esc(d.number)}<br>${when.toLocaleDateString('fr-FR')} ${when.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}${d.client_name && d.client_name !== 'Client comptoir' ? '<br>Client : ' + esc(d.client_name) : ''}</div><hr>
      <table>${products.map((l) => { const ttc = l.unit_price_ht * (1 + l.tva_rate / 100); return `<tr><td colspan="2">${esc(l.label)}</td></tr><tr><td>&nbsp;&nbsp;${qtyFmt(l.qty)} x ${nf.format(ttc)}</td><td class="r">${nf.format(l.qty * ttc)}</td></tr>`; }).join('')}
      ${discounts.map((l) => `<tr><td>${esc(l.label)}</td><td class="r">${nf.format(l.qty * l.unit_price_ht * (1 + l.tva_rate / 100))}</td></tr>`).join('')}
      <tr class="big"><td>TOTAL ${esc(cur())}</td><td class="r">${nf.format(d.total_ttc)}</td></tr></table><hr>
      <table>${d.payments.filter((p) => p.amount > 0).map((p) => `<tr><td>${esc(cap(p.method))}</td><td class="r">${nf.format(p.amount)}</td></tr>`).join('')}
      ${change ? `<tr><td>Rendu</td><td class="r">${nf.format(change)}</td></tr>` : ''}</table><hr>
      <table>${Object.entries(byRate).map(([r, v]) => `<tr><td>TVA ${r} % sur ${nf.format(v.ht)}</td><td class="r">${nf.format(v.tva)}</td></tr>`).join('')}</table>
      ${d.status === 'annulé' ? '<p class="c"><b>TICKET ANNULÉ</b></p>' : ''}
      ${d.loyalty && d.status !== 'annulé' ? `<hr><div>Fidélité${d.loyalty.earned ? ` : +${qtyFmt(d.loyalty.earned)} pts` : ''}${d.loyalty.used ? `, ${qtyFmt(d.loyalty.used)} pts utilisés` : ''}<br>Solde : ${qtyFmt(d.loyalty.balance)} points</div>` : ''}
      <hr><div class="c">${esc(s.doc_footer || 'Merci de votre visite')}<br><small>${esc(s.legal_info || '')}</small></div>
      <script>setTimeout(() => window.print(), 200);</script></body></html>`);
  }

  /* ---------------- Codes-barres : douchette et caméra ---------------- */
  function findByCode(code) {
    const q = String(code || '').trim().toLowerCase(); if (!q) return null;
    const same = window.ComptoirScanner ? window.ComptoirScanner.sameCode : (x, y) => String(x).toLowerCase() === String(y).toLowerCase();
    return state.products.find((p) => p.barcode && same(p.barcode, q)) || state.products.find((p) => p.ref && p.ref.toLowerCase() === q) || null;
  }
  document.addEventListener('click', (e) => {
    if (!window.ComptoirScanner) return;
    // Remplir un champ par scan (code-barres de la fiche produit)
    const into = e.target.closest('[data-scan-into]');
    if (into) {
      const form = into.closest('form'); const input = form.querySelector(`[name="${into.dataset.scanInto}"]`);
      const editing = form.dataset.productId || '';
      window.ComptoirScanner.open({ title: 'Scanner le code-barres', onCode: (code) => {
        input.value = code; input.dispatchEvent(new Event('input', { bubbles: true }));
        const dup = state.products.find((p) => p.barcode && window.ComptoirScanner.sameCode(p.barcode, code) && String(p.id) !== String(editing));
        return dup ? { ok: true, message: `Attention : ce code est déjà celui de « ${dup.name} »` } : { ok: true, message: `Code ${code}` };
      } });
      return;
    }
    // Choisir un produit par scan (mouvement de stock, transfert)
    const pick = e.target.closest('[data-scan-pick]');
    if (pick) {
      const select = pick.closest('form').querySelector(`[name="${pick.dataset.scanPick}"]`);
      window.ComptoirScanner.open({ title: 'Scanner le produit', onCode: (code) => {
        const p = findByCode(code);
        if (!p) return { ok: false, message: `Code ${code} inconnu` };
        select.value = String(p.id); select.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, message: p.name };
      } });
    }
  });

  /* ---------------- Ticket et facture numériques ---------------- */
  // Indicatif téléphonique par pays : « 06 12 34 56 78 » au Maroc devient 212612345678 pour WhatsApp.
  const DIAL = { MA: '212', DZ: '213', TN: '216', SN: '221', ML: '223', GN: '224', CI: '225', BF: '226', NE: '227', TG: '228', BJ: '229', CM: '237', GA: '241', CG: '242', CD: '243', MG: '261', FR: '33', BE: '32', CH: '41', LU: '352', CA: '1' };
  function intlPhone(raw) {
    let p = String(raw || '').replace(/[^\d+]/g, '');
    if (!p) return '';
    if (p.startsWith('+')) return p.slice(1);
    if (p.startsWith('00')) return p.slice(2);
    const cc = DIAL[state.me.store.country] || '';
    return p.startsWith('0') && cc ? cc + p.slice(1) : cc && !p.startsWith(cc) && p.length <= 10 ? cc + p : p;
  }
  async function shareToClient(d, btn) {
    if (btn) btn.disabled = true;
    let url;
    try { url = (await api(`/store/share/${d.id}`, { method: 'POST', body: {} })).url; }
    catch (ex) { if (btn) btn.disabled = false; return fail(ex); }
    if (btn) btn.disabled = false;
    const c = d.customer_id ? state.customers.find((x) => String(x.id) === String(d.customer_id)) : null;
    const phone = intlPhone(d.client_phone || c?.phone), email = d.client_email || c?.email || '';
    const kind = { ticket: 'votre ticket', facture: 'votre facture', devis: 'votre devis', avoir: 'votre avoir', commande: 'votre commande' }[d.type] || 'votre document';
    const shop = state.settings.shop_name || state.me.store.name;
    const who = d.client_name && d.client_name !== 'Client comptoir' ? ` ${d.client_name.split(' ')[0]}` : '';
    const text = `Bonjour${who}, voici ${kind} ${d.number} de ${shop} (${money(d.total_ttc)}) : ${url}`;
    const sms = `sms:${phone ? '+' + phone : ''}${/iPhone|iPad|iPod|Mac/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(text)}`;
    const body = openModal('Envoyer au client', `
      <p class="muted">Le client reçoit un lien vers ${esc(kind)}, consultable sur son téléphone et imprimable, sans créer de compte.</p>
      <div class="share-grid">
        <a class="share-btn wa" href="https://wa.me/${phone}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">WhatsApp${phone ? `<small>+${esc(phone)}</small>` : '<small>choisir le contact</small>'}</a>
        <a class="share-btn" href="${esc(sms)}">SMS${phone ? `<small>+${esc(phone)}</small>` : ''}</a>
        <a class="share-btn" href="mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`${kind.replace('votre ', '').replace(/^./, (x) => x.toUpperCase())} ${d.number} · ${shop}`)}&body=${encodeURIComponent(text)}">E-mail${email ? `<small>${esc(email)}</small>` : ''}</a>
        ${navigator.share ? '<button type="button" class="share-btn" id="shNative">Autre application…</button>' : ''}
      </div>
      <label class="share-link">Lien<input id="shUrl" readonly value="${esc(url)}"></label>
      <div class="modal-foot"><div><button class="btn" id="shCopy">Copier le lien</button> <a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Voir</a></div><div class="right"><button class="btn" id="shClose">Fermer</button></div></div>`);
    $('#shClose', body).addEventListener('click', closeModal);
    $('#shCopy', body).addEventListener('click', async () => { try { await navigator.clipboard.writeText(url); toast('Lien copié'); } catch { $('#shUrl', body).select(); document.execCommand('copy'); toast('Lien copié'); } });
    $('#shNative', body)?.addEventListener('click', () => navigator.share({ title: `${d.number} · ${shop}`, text, url }).catch(() => {}));
  }

  function printJournal(j) {
    const s = state.settings;
    printWindow(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Journal de caisse ${dateFmt(j.date)}</title>
      <style>@page{size:A4;margin:16mm}body{font-family:Arial,sans-serif;font-size:10.5pt;color:#1B2530}h1{font-size:18pt;margin:0}
      table{width:100%;border-collapse:collapse;margin:10px 0 18px}th{text-align:left;font-size:9pt;color:#5A6774;border-bottom:1px solid #1F2D3A;padding:5px}td{padding:5px;border-bottom:1px solid #E3E6E9}.r{text-align:right}</style></head><body>
      <h1>Journal de caisse</h1><p>${esc(s.shop_name)}, journée du ${dateFmt(j.date)}</p>
      <table><thead><tr><th>Mode</th><th class="r">Montant</th></tr></thead><tbody>
      ${Object.entries(j.by_method).map(([m, v]) => `<tr><td>${esc(cap(m))}</td><td class="r">${money(v)}</td></tr>`).join('')}
      <tr><td><b>Total encaissé</b></td><td class="r"><b>${money(j.total_collected)}</b></td></tr></tbody></table>
      <p>${j.tickets_count} ticket(s), total ${money(j.tickets_total)}, panier moyen ${money(j.average_ticket)}.</p>
      <table><thead><tr><th>Document</th><th>Client</th><th>Mode</th><th class="r">Montant</th></tr></thead><tbody>
      ${j.payments.map((p) => `<tr><td>${esc(p.number)}</td><td>${esc(p.client_name)}</td><td>${esc(cap(p.method))}</td><td class="r">${money(p.amount)}</td></tr>`).join('')}
      </tbody></table>
      <p style="margin-top:30px">Espèces comptées : ______________ &nbsp;&nbsp; Écart : ______________ &nbsp;&nbsp; Signature : ______________</p>
      <script>setTimeout(() => window.print(), 200);</script></body></html>`);
  }

  /* ================= Produits ================= */
  const pv = { q: '', cat: '' };
  function stockCell(p, total = false) {
    if (p.track_stock === 0) return '<span class="muted">non suivi</span>';
    const q = total ? p.stock : p.stock_here ?? p.stock;
    const cls = q <= 0 ? 'stock-out' : q <= p.stock_min ? 'stock-low' : 'stock-ok';
    return `<span class="${cls}">${qtyFmt(q)}</span> <span class="muted">${esc(p.unit)}</span>`;
  }
  // Détail du stock par boutique (fiche produit), quand le commerce en a plusieurs.
  function stockByLocHtml(p) {
    const locs = state.me.locations || [];
    if (!p.stock_by_location || locs.length < 2 || !p.track_stock) return '';
    return `<div class="loc-stock">${locs.map((l) => `<span><em>${esc(l.name)}</em><strong class="${(p.stock_by_location[l.id] || 0) <= 0 ? 'stock-out' : ''}">${qtyFmt(p.stock_by_location[l.id] || 0)}</strong></span>`).join('')}<span class="loc-stock-total"><em>Total</em><strong>${qtyFmt(p.stock)}</strong></span></div>`;
  }
  const thumb = (p) => p.image ? `<img class="thumb" src="${esc(p.image)}" alt="">` : `<span class="thumb">${esc((p.ref || p.name).replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase())}</span>`;

  function viewProducts() {
    setActions(`${can('products.edit') ? '<a class="btn" href="#/importer">Importer</a>' : ''}<button class="btn" id="manageCats">Catégories</button><button class="btn btn-primary" id="newProduct">Nouveau produit</button>`);
    $('#view').innerHTML = `
      <div class="toolbar">
        <span class="input-scan"><input type="search" id="pq" placeholder="Rechercher un produit" value="${esc(pv.q)}"><button type="button" class="scan-in" id="pqScan" aria-label="Scanner avec la caméra"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7V5.5A1.5 1.5 0 0 1 5.5 4H7M17 4h1.5A1.5 1.5 0 0 1 20 5.5V7M20 17v1.5a1.5 1.5 0 0 1-1.5 1.5H17M7 20H5.5A1.5 1.5 0 0 1 4 18.5V17"/><path d="M7.5 8v8M10 8v8M12.5 8v8M15 8v5M16.5 8v8"/></svg></button></span>
        <select id="pcat"><option value="">Toutes les catégories</option>${state.categories.map((c) => `<option value="${c.id}" ${String(pv.cat) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      </div>
      <div id="ptable"></div>`;
    $('#pq').addEventListener('input', (e) => { pv.q = e.target.value; renderProductTable(); });
    $('#pqScan').hidden = !window.ComptoirScanner;
    $('#pqScan').addEventListener('click', () => window.ComptoirScanner.open({
      title: 'Retrouver un produit',
      onCode: (code) => {
        const p = findByCode(code);
        if (!p) return { ok: false, message: `Code ${code} inconnu`, actionLabel: can('products.edit') ? 'Créer ce produit' : null, action: () => productForm(null, { barcode: code }) };
        setTimeout(() => productForm(p), 300);
        return { ok: true, message: p.name };
      },
    }));
    $('#pcat').addEventListener('change', (e) => { pv.cat = e.target.value; renderProductTable(); });
    $('#newProduct').addEventListener('click', () => productForm());
    $('#manageCats').addEventListener('click', categoriesModal);
    renderProductTable();
  }
  function renderProductTable() {
    const q = norm(pv.q);
    const list = state.products.filter((p) => (!pv.cat || String(p.category_id) === String(pv.cat)) && (!q || norm(`${p.name} ${p.ref}`).includes(q)));
    if (!state.products.length) {
      $('#ptable').innerHTML = `<div class="table-wrap"><div class="empty-state"><strong>Aucun produit.</strong>Ajoutez votre premier produit : il apparaîtra sur le site dès qu'il est enregistré.<br><a class="btn" href="#/importer">Importer</a><button class="btn btn-primary" data-act="new-product">Nouveau produit</button></div></div>`;
      return;
    }
    $('#ptable').innerHTML = `<div class="table-wrap"><table><thead><tr><th></th><th>Produit</th><th>Catégorie</th><th class="num">Prix</th><th class="num">En stock</th><th>Vitrine</th></tr></thead><tbody>
      ${list.map((p) => `<tr class="clickable" data-product="${p.id}">
        <td style="width:56px">${thumb(p)}</td>
        <td><span class="cell-main">${esc(p.name)}</span><div class="cell-sub">${esc(p.ref)}</div></td>
        <td>${esc(p.category_name || '—')}</td>
        <td class="num"><strong>${money(p.price_ht * (1 + p.tva_rate / 100))}</strong><div class="cell-sub">${esc(p.unit)}</div></td>
        <td class="num">${stockCell(p)}</td>
        <td>${p.visible ? '<span class="badge s-ok">visible</span>' : '<span class="badge s-neutral">masqué</span>'}</td>
      </tr>`).join('') || `<tr><td colspan="6" class="empty-state">Aucun produit ne correspond à cette recherche.</td></tr>`}
    </tbody></table></div>`;
  }

  function resizeImage(file, max = 900) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => reject(new Error("Cette image n'a pas pu être lue."));
      img.src = URL.createObjectURL(file);
    });
  }

  function productForm(p = null, prefill = {}) {
    const isNew = !p;
    const tvaDef = Number(state.settings.tva_default) || 20;
    p = p || { track_stock: 1, name: '', ref: '', barcode: '', description: '', category_id: '', price_ht: '', purchase_price: '', tva_rate: tvaDef, stock: '', stock_min: 0, unit: (state.me.units || [])[0] || 'pièce', visible: 1, ...prefill };
    const ttc = p.price_ht === '' ? '' : r2(p.price_ht * (1 + p.tva_rate / 100)).toFixed(2);
    let newImage = null, removeImage = false;
    const body = openModal(isNew ? 'Nouveau produit' : p.name, `
      <form id="pform" novalidate data-product-id="${p.id || ''}">
        <div class="pf-top">
          <div class="pf-photo">
            <div class="img-preview" id="imgPreview">${p.image ? `<img src="${esc(p.image)}" alt="">` : '<span>Photo</span>'}</div>
            <label class="btn btn-sm">${p.image ? 'Changer' : 'Ajouter une photo'}<input type="file" accept="image/*" capture="environment" id="imgInput" hidden></label>
            <button type="button" class="link" id="imgRemove" ${p.image ? '' : 'hidden'}>Retirer</button>
          </div>
          <div class="fields pf-main">
            <label class="field full"><span>Nom du produit</span><input name="name" value="${esc(p.name)}" required placeholder="Ex. : Perceuse sans fil 18 V"></label>
            <label class="field"><span>Prix de vente (${esc(cur())})</span><input name="price_ttc" type="number" step="0.01" min="0" inputmode="decimal" value="${ttc}" required class="big-input"><small>Prix payé par le client, TVA comprise</small></label>
            ${isNew
              ? `<label class="field"><span>Quantité en stock</span><input name="stock" type="number" step="any" min="0" inputmode="decimal" value="${p.stock}" placeholder="0" class="big-input"></label>`
              : `<div class="field"><span>En stock${(state.me.locations || []).length > 1 && state.scope !== 'all' ? ' ici' : ''}</span><div class="stock-now">${stockCell(p)} ${can('stock.manage') ? '<button type="button" class="link" id="adjustStock">Modifier</button>' : ''}</div>${stockByLocHtml(p)}</div>`}
            <label class="field full"><span>Catégorie</span><select name="category_id"><option value="">Sans catégorie</option>${state.categories.map((c) => `<option value="${c.id}" ${String(c.id) === String(p.category_id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          </div>
        </div>
        <details class="pf-more" ${isNew ? '' : 'open'}>
          <summary>Plus d'options</summary>
          <div class="fields">
            <label class="field"><span>Unité de vente</span><input name="unit" value="${esc(p.unit)}" list="units"><datalist id="units">${(state.me.units || []).map((u) => `<option>${esc(u)}</option>`).join('')}</datalist></label>
            <label class="field"><span>M'alerter quand il en reste</span><input name="stock_min" type="number" step="any" min="0" value="${p.stock_min}"></label>
            <label class="field"><span>Référence</span><input name="ref" value="${esc(p.ref)}"></label>
            <label class="field"><span>Code-barres</span><span class="input-scan"><input name="barcode" value="${esc(p.barcode || '')}" inputmode="numeric" placeholder="Scannez ou saisissez"><button type="button" class="scan-in" data-scan-into="barcode" aria-label="Scanner avec la caméra"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7V5.5A1.5 1.5 0 0 1 5.5 4H7M17 4h1.5A1.5 1.5 0 0 1 20 5.5V7M20 17v1.5a1.5 1.5 0 0 1-1.5 1.5H17M7 20H5.5A1.5 1.5 0 0 1 4 18.5V17"/><path d="M7.5 8v8M10 8v8M12.5 8v8M15 8v5M16.5 8v8"/></svg></button></span></label>
            <label class="field"><span>Prix d'achat (${esc(cur())} HT)</span><input name="purchase_price" type="number" step="0.01" min="0" value="${p.purchase_price}"><small id="marginHint"></small></label>
            <label class="field"><span>TVA (%)</span><input name="tva_rate" type="number" step="0.1" min="0" value="${p.tva_rate}"><small id="htHint"></small></label>
            <label class="field full"><span>Description</span><textarea name="description" rows="3" placeholder="Visible sur votre vitrine en ligne">${esc(p.description)}</textarea></label>
            <label class="check full"><input type="checkbox" name="visible" ${p.visible ? 'checked' : ''}> Afficher sur ma vitrine en ligne</label>
            <label class="check full"><input type="checkbox" name="track_stock" ${p.track_stock === 0 ? '' : 'checked'}> Suivre le stock <span class="muted">(décochez pour un service)</span></label>
          </div>
        </details>
        <p class="form-error" id="pError"></p>
      </form>
      <div class="modal-foot">
        ${isNew ? '' : '<button class="btn btn-danger" id="pDelete">Supprimer</button>'}
        <div class="right"><button class="btn" id="pCancel">Annuler</button><button class="btn btn-primary" id="pSave">${isNew ? 'Ajouter le produit' : 'Enregistrer'}</button></div>
      </div>`);
    const form = $('#pform', body);
    const hints = () => {
      const tva = Number(form.tva_rate.value) || 0, ht = (Number(form.price_ttc.value) || 0) / (1 + tva / 100), pa = Number(form.purchase_price.value) || 0;
      $('#htHint').textContent = ht ? `Soit ${money(ht)} hors taxes` : '';
      $('#marginHint').textContent = ht && pa ? `Marge : ${money(ht - pa)} (${Math.round(((ht - pa) / ht) * 100)} %)` : '';
    };
    form.addEventListener('input', hints); hints();
    $('#imgInput').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        newImage = await resizeImage(f); removeImage = false;
        $('#imgPreview').innerHTML = `<img src="${newImage}" alt="">`; $('#imgRemove').hidden = false;
      } catch (ex) { fail(ex); }
    });
    $('#imgRemove').addEventListener('click', () => { newImage = null; removeImage = true; $('#imgPreview').innerHTML = '<span>Photo</span>'; $('#imgRemove').hidden = true; });
    $('#pCancel').addEventListener('click', closeModal);
    $('#adjustStock')?.addEventListener('click', () => stockModal('inventaire', p.id));
    $('#pDelete')?.addEventListener('click', async () => {
      if (!confirmAction(`Supprimer « ${p.name} » ? Il disparaîtra du site. Les documents existants le conservent.`)) return;
      try { await api(`/store/products/${p.id}`, { method: 'DELETE' }); await refresh('products'); closeModal(); toast('Produit supprimé'); route(); } catch (ex) { fail(ex); }
    });
    $('#pSave').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const data = Object.fromEntries(new FormData(form));
      data.visible = form.visible.checked;
      data.track_stock = form.track_stock.checked;
      data.price_ht = (Number(data.price_ttc) || 0) / (1 + (Number(data.tva_rate) || 0) / 100);
      delete data.price_ttc;
      if (!data.name.trim()) { $('#pError').textContent = 'Le nom du produit est obligatoire.'; form.name.focus(); return; }
      btn.disabled = true;
      try {
        let id = p.id;
        if (isNew) {
          data.client_ref = window.ComptoirOutbox.uuid();
          try {
            if (!navigator.onLine) throw offlineError('POST');
            id = (await api('/store/products', { method: 'POST', body: data })).id;
          } catch (ex) {
            if (ex.name !== 'Offline') throw ex;
            // Produit créé hors ligne : visible tout de suite dans le catalogue, envoyé au retour d'internet.
            // La photo sera ajoutée une fois en ligne (elle demande un envoi de fichier).
            if (newImage) toast('Produit enregistré hors ligne. Ajoutez la photo dès que vous serez reconnecté.');
            await enqueue({ ref: data.client_ref, type: 'product', body: data });
            id = `tmp-${data.client_ref}`;
            const stock = data.track_stock ? Math.max(0, Number(data.stock) || 0) : 0;
            state.products.push({
              id, ...data, stock, stock_min: Number(data.stock_min) || 0,
              price_ht: Number(data.price_ht) || 0, purchase_price: Number(data.purchase_price) || 0,
              tva_rate: Number(data.tva_rate) || 0, category_id: data.category_id ? Number(data.category_id) : null,
              image_v: 0, pending: true,
            });
            state.products.sort((x, y) => x.name.localeCompare(y.name, 'fr'));
            keep('/store/products', state.products);
            closeModal(); toast('Produit ajouté (hors ligne)'); route();
            return;
          }
        } else await api(`/store/products/${id}`, { method: 'PUT', body: data });
        if (newImage) await api(`/store/products/${id}/image`, { method: 'PUT', body: { data: newImage } });
        else if (removeImage) await api(`/store/products/${id}/image`, { method: 'DELETE' });
        await refresh('products');
        closeModal(); toast(isNew ? 'Produit ajouté' : 'Produit enregistré'); route();
      } catch (ex) { $('#pError').textContent = ex.message; } finally { btn.disabled = false; }
    });
  }

  function categoriesModal() {
    const render = () => {
      const body = openModal('Catégories', `
        <div class="table-wrap"><table><tbody>
          ${state.categories.map((c) => `<tr><td><input value="${esc(c.name)}" data-cat-name="${c.id}" aria-label="Nom de la catégorie"></td><td class="num muted">${c.products} produit${c.products > 1 ? 's' : ''}</td><td class="num"><button class="btn btn-sm btn-danger" data-cat-del="${c.id}">Supprimer</button></td></tr>`).join('') || '<tr><td class="empty-state">Aucune catégorie.</td></tr>'}
        </tbody></table></div>
        <div class="add-line"><input id="newCat" placeholder="Nouvelle catégorie"><button class="btn btn-primary" id="addCat">Ajouter</button></div>
        <p class="muted" style="font-size:.88rem">Les modifications de nom sont enregistrées dès que vous quittez le champ.</p>`);
      $('#addCat', body).addEventListener('click', async () => {
        const name = $('#newCat').value.trim(); if (!name) return;
        try { await api('/store/categories', { method: 'POST', body: { name } }); await refresh('categories'); render(); } catch (ex) { fail(ex); }
      });
      $$('[data-cat-name]', body).forEach((i) => i.addEventListener('change', async () => {
        try { await api(`/store/categories/${i.dataset.catName}`, { method: 'PUT', body: { name: i.value } }); await refresh('categories', 'products'); toast('Catégorie renommée'); } catch (ex) { fail(ex); }
      }));
      $$('[data-cat-del]', body).forEach((b) => b.addEventListener('click', async () => {
        if (!confirmAction('Supprimer cette catégorie ? Ses produits seront conservés, sans catégorie.')) return;
        try { await api(`/store/categories/${b.dataset.catDel}`, { method: 'DELETE' }); await refresh('categories', 'products'); render(); } catch (ex) { fail(ex); }
      }));
    };
    render();
    modal.addEventListener('close', () => { if (location.hash.includes('produits')) route(); }, { once: true });
  }

  /* ================= Stock ================= */
  async function viewStock() {
    const multi = (state.me.locations || []).length > 1;
    setActions(`${multi ? '<button class="btn" id="transferBtn">Transfert entre boutiques</button>' : ''}<button class="btn" data-stock="sortie">Sortie</button><button class="btn" data-stock="inventaire">Inventaire</button><button class="btn btn-primary" data-stock="entrée">Entrée de stock</button>`);
    const moves = await api('/store/stock');
    const alerts = state.products.filter((p) => p.stock <= p.stock_min);
    const typeBadge = { 'entrée': 's-ok', sortie: 's-info', inventaire: 's-neutral', retour: 's-warn', transfert: 's-info' };
    $('#view').innerHTML = `
      <div class="stack">
        <section class="panel">
          <div class="panel-head"><h2>À réapprovisionner</h2><span class="muted">${alerts.length} produit${alerts.length > 1 ? 's' : ''}</span></div>
          ${alerts.length ? `<div class="table-wrap"><table><thead><tr><th>Produit</th><th class="num">Stock</th><th class="num">Seuil</th><th></th></tr></thead><tbody>
            ${alerts.map((p) => `<tr><td><span class="cell-main">${esc(p.name)}</span><div class="cell-sub">${esc(p.ref)}</div></td><td class="num">${stockCell(p)}</td><td class="num">${qtyFmt(p.stock_min)}</td><td class="num"><button class="btn btn-sm" data-restock="${p.id}">Réceptionner</button></td></tr>`).join('')}
          </tbody></table></div>` : `<div class="empty-state"><strong>Aucun produit sous son seuil d'alerte.</strong></div>`}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Mouvements récents</h2></div>
          ${moves.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Produit</th>${multi ? '<th>Boutique</th>' : ''}<th>Type</th><th class="num">Quantité</th><th>Motif</th></tr></thead><tbody>
            ${moves.map((m) => `<tr><td class="muted">${dateTimeFmt(m.created_at)}</td><td><span class="cell-main">${esc(m.product_name || 'Produit supprimé')}</span><div class="cell-sub">${esc(m.product_ref || '')}</div></td>${multi ? `<td>${esc(locName(m.location_id))}</td>` : ''}<td><span class="badge ${typeBadge[m.type] || 's-neutral'}">${esc(m.type)}</span></td><td class="num ${m.qty < 0 ? 'stock-out' : 'stock-ok'}">${m.qty > 0 ? '+' : ''}${qtyFmt(m.qty)}</td><td>${esc(m.reason)}</td></tr>`).join('')}
          </tbody></table></div>` : `<div class="empty-state"><strong>Aucun mouvement enregistré.</strong>Les entrées, sorties et ventes apparaîtront ici.</div>`}
        </section>
      </div>`;
    $('#transferBtn')?.addEventListener('click', () => transferModal());
  }

  // Transfert de stock d'une boutique à une autre
  function transferModal(productId = '') {
    const locs = state.me.locations || [];
    const from = state.scope !== 'all' ? state.scope : locs[0]?.id;
    const to = locs.find((l) => l.id !== from)?.id;
    const body = openModal('Transfert entre boutiques', `
      <form id="trForm" class="fields" novalidate>
        <label class="field full"><span>Produit</span><span class="input-scan"><select name="product_id" required><option value="">Choisir un produit</option>${state.products.filter((p) => p.track_stock).map((p) => `<option value="${p.id}" ${String(p.id) === String(productId) ? 'selected' : ''}>${esc(p.name)}${p.ref ? ' (' + esc(p.ref) + ')' : ''}</option>`).join('')}</select><button type="button" class="scan-in" data-scan-pick="product_id" aria-label="Scanner le produit"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7V5.5A1.5 1.5 0 0 1 5.5 4H7M17 4h1.5A1.5 1.5 0 0 1 20 5.5V7M20 17v1.5a1.5 1.5 0 0 1-1.5 1.5H17M7 20H5.5A1.5 1.5 0 0 1 4 18.5V17"/><path d="M7.5 8v8M10 8v8M12.5 8v8M15 8v5M16.5 8v8"/></svg></button></span></label>
        <label class="field"><span>Depuis</span><select name="from">${locs.map((l) => `<option value="${l.id}" ${l.id === from ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Vers</span><select name="to">${locs.map((l) => `<option value="${l.id}" ${l.id === to ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Quantité</span><input name="qty" type="number" step="any" min="0" inputmode="decimal" required></label>
        <label class="field"><span>Motif <span class="muted">(facultatif)</span></span><input name="reason" placeholder="Ex. : réassort du samedi"></label>
        <p class="field full muted" id="trHint"></p>
        <p class="form-error full" id="trErr"></p>
      </form>
      <div class="modal-foot"><div class="right"><button class="btn" id="trCancel">Annuler</button><button class="btn btn-primary" id="trSave">Transférer</button></div></div>`);
    const form = $('#trForm', body);
    const hint = () => {
      const p = state.products.find((x) => x.id === Number(form.product_id.value));
      $('#trHint').textContent = p && p.stock_by_location ? `Disponible à ${locName(form.from.value)} : ${qtyFmt(p.stock_by_location[form.from.value] || 0)} ${p.unit}` : '';
    };
    form.addEventListener('change', hint); hint();
    $('#trCancel', body).addEventListener('click', closeModal);
    $('#trSave', body).addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        await api('/store/stock/transfer', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
        await refresh('products'); closeModal(); toast('Stock transféré'); route();
      } catch (ex) { $('#trErr').textContent = ex.message; e.currentTarget.disabled = false; }
    });
  }

  function stockModal(type = 'entrée', productId = '') {
    const titles = { 'entrée': 'Entrée de stock', sortie: 'Sortie de stock', inventaire: 'Inventaire' };
    const body = openModal(titles[type], `
      <form id="sform" class="fields" novalidate>
        <label class="field full"><span>Produit</span><span class="input-scan"><select name="product_id" required><option value="">Choisir un produit</option>${state.products.map((p) => `<option value="${p.id}" ${String(p.id) === String(productId) ? 'selected' : ''}>${esc(p.name)}${p.ref ? ' (' + esc(p.ref) + ')' : ''}</option>`).join('')}</select><button type="button" class="scan-in" data-scan-pick="product_id" aria-label="Scanner le produit"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7V5.5A1.5 1.5 0 0 1 5.5 4H7M17 4h1.5A1.5 1.5 0 0 1 20 5.5V7M20 17v1.5a1.5 1.5 0 0 1-1.5 1.5H17M7 20H5.5A1.5 1.5 0 0 1 4 18.5V17"/><path d="M7.5 8v8M10 8v8M12.5 8v8M15 8v5M16.5 8v8"/></svg></button></span></label>
        ${state.scope === 'all' && (state.me.locations || []).length > 1 ? `<label class="field"><span>Boutique</span><select name="location_id">${state.me.locations.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span>Type</span><select name="type">${Object.keys(titles).map((t) => `<option value="${t}" ${t === type ? 'selected' : ''}>${cap(t)}</option>`).join('')}</select></label>
        <label class="field"><span id="qtyLabel">Quantité</span><input name="qty" type="number" step="any" min="0" required></label>
        <p class="full muted" id="stockNow"></p>
        <label class="field full"><span>Motif <span class="muted">(facultatif)</span></span><input name="reason" placeholder="Bon de livraison, casse, inventaire annuel…"></label>
        <p class="form-error full" id="sError"></p>
      </form>
      <div class="modal-foot"><div class="right"><button class="btn" id="sCancel">Annuler</button><button class="btn btn-primary" id="sSave">Enregistrer le mouvement</button></div></div>`);
    const form = $('#sform', body);
    const upd = () => {
      const p = state.products.find((x) => String(x.id) === form.product_id.value);
      $('#qtyLabel').textContent = form.type.value === 'inventaire' ? 'Quantité comptée' : 'Quantité';
      $('#stockNow').textContent = p ? `Stock actuel : ${qtyFmt(p.stock)} ${p.unit}` : '';
    };
    form.addEventListener('change', upd); upd();
    $('#sCancel').addEventListener('click', closeModal);
    $('#sSave').addEventListener('click', async (e) => {
      const data = Object.fromEntries(new FormData(form));
      if (!data.product_id) { $('#sError').textContent = 'Choisissez un produit.'; return; }
      if (data.qty === '') { $('#sError').textContent = 'Indiquez une quantité.'; return; }
      e.currentTarget.disabled = true;
      try {
        data.client_ref = window.ComptoirOutbox.uuid();
        let r;
        try { if (!navigator.onLine) throw offlineError('POST'); r = await api('/store/stock', { method: 'POST', body: data }); }
        catch (ex) {
          if (ex.name !== 'Offline') throw ex;
          const p = state.products.find((x) => x.id === Number(data.product_id)); const q = Number(data.qty) || 0;
          await enqueue({ ref: data.client_ref, type: 'stock', body: data, location_id: data.location_id || (state.scope !== 'all' ? state.scope : null) });
          if (p) { p.stock = data.type === 'entrée' ? p.stock + q : data.type === 'sortie' ? p.stock - q : q; keep('/store/products', state.products); }
          r = { stock: p ? p.stock : q, offline: true };
        }
        await refresh('products'); closeModal(); toast(r.offline ? `Hors ligne : mouvement enregistré sur cet appareil (stock ${qtyFmt(r.stock)})` : `Stock mis à jour : ${qtyFmt(r.stock)}`); route();
      } catch (ex) { $('#sError').textContent = ex.message; e.currentTarget.disabled = false; }
    });
  }

  /* ================= Clients ================= */
  const cv = { q: '' };
  function viewCustomers() {
    setActions(`<button class="btn btn-primary" id="newCustomer">Nouveau client</button>`);
    $('#view').innerHTML = `<div class="toolbar"><input type="search" id="cq" placeholder="Rechercher un client" value="${esc(cv.q)}"></div><div id="ctable"></div>`;
    $('#newCustomer').addEventListener('click', () => customerForm());
    $('#cq').addEventListener('input', (e) => { cv.q = e.target.value; renderCustomers(); });
    renderCustomers();
  }
  function renderCustomers() {
    const q = norm(cv.q);
    const list = state.customers.filter((c) => !q || norm(`${c.name} ${c.company} ${c.email} ${c.phone}`).includes(q));
    $('#ctable').innerHTML = state.customers.length ? `<div class="table-wrap"><table><thead><tr><th>Client</th><th>Contact</th><th class="num">Documents</th><th class="num">Total facturé</th><th class="num">Reste dû</th>${loyaltyCfg().on ? '<th class="num">Points</th>' : ''}</tr></thead><tbody>
      ${list.map((c) => `<tr class="clickable" data-customer="${c.id}"><td><span class="cell-main">${esc(c.name)}</span><div class="cell-sub">${esc(c.company)}</div></td><td>${esc(c.phone)}<div class="cell-sub">${esc(c.email)}</div></td><td class="num">${c.documents}</td><td class="num">${money(c.invoiced)}</td><td class="num ${c.due > 0 ? 'stock-low' : 'muted'}">${c.due > 0 ? money(c.due) : '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="empty-state">Aucun client ne correspond à cette recherche.</td></tr>'}
    </tbody></table></div>` : `<div class="table-wrap"><div class="empty-state"><strong>Aucun client.</strong>Les clients sont créés ici ou automatiquement quand une demande arrive du site.</div></div>`;
  }
  function customerForm(c = null, onSaved = null) {
    const isNew = !c;
    c = c || { name: '', company: '', email: '', phone: '', address: '', notes: '' };
    const body = openModal(isNew ? 'Nouveau client' : c.name, `
      <form id="cform" class="fields" novalidate>
        <label class="field"><span>Nom et prénom</span><input name="name" value="${esc(c.name)}" required></label>
        <label class="field"><span>Entreprise</span><input name="company" value="${esc(c.company)}"></label>
        <label class="field"><span>Téléphone</span><input name="phone" type="tel" value="${esc(c.phone)}"></label>
        <label class="field"><span>E-mail</span><input name="email" type="email" value="${esc(c.email)}"></label>
        <label class="field full"><span>Adresse</span><textarea name="address" rows="2">${esc(c.address)}</textarea></label>
        <label class="field full"><span>Notes</span><textarea name="notes" rows="2">${esc(c.notes)}</textarea></label>
        <p class="form-error full" id="cError"></p>
      </form>
      ${!isNew && loyaltyCfg().on ? `<div id="cLoyalty" class="c-loyalty"></div>` : ''}
      ${isNew ? '' : `<div id="cDocs"></div>`}
      <div class="modal-foot">
        ${isNew ? '' : '<button class="btn btn-danger" id="cDelete">Supprimer</button>'}
        <div class="right">${isNew ? '' : '<button class="btn" id="cQuote">Faire un devis</button>'}<button class="btn" id="cCancel">Annuler</button><button class="btn btn-primary" id="cSave">${isNew ? 'Ajouter le client' : 'Enregistrer'}</button></div>
      </div>`);
    const form = $('#cform', body);
    if (!isNew) {
      api('/store/documents').then((docs) => {
        const mine = docs.filter((d) => d.customer_id === c.id);
        const el = $('#cDocs'); if (!el || !mine.length) return;
        el.innerHTML = `<h3 class="section-title">Historique</h3><div class="table-wrap"><table><tbody>${mine.map((d) => `<tr class="clickable" data-doc="${d.id}"><td class="cell-main doc-num">${esc(d.number)}</td><td class="muted">${dateFmt(d.date)}</td><td class="num">${money(d.total_ttc)}</td><td>${docBadge(d)}</td>${loyaltyCfg().on ? `<td class="num">${qtyFmt(Number(c.loyalty_points) || 0)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
      }).catch(() => {});
    }
    if (!isNew && loyaltyCfg().on) {
      const loadLoyalty = () => api(`/store/customers/${c.id}/loyalty`, { fresh: true }).then((l) => {
        const el = $('#cLoyalty'); if (!el) return;
        el.innerHTML = `<div class="c-loyalty-head"><h3 class="section-title">Fidélité</h3><strong>${qtyFmt(l.balance)} points</strong>${can('customers.manage') ? '<button type="button" class="btn btn-sm" id="cAdjust">Ajuster</button>' : ''}</div>
          ${l.movements.length ? `<div class="table-wrap"><table><tbody>${l.movements.slice(0, 8).map((m) => `<tr><td class="muted">${dateTimeFmt(m.created_at)}</td><td>${esc(m.reason)}</td><td class="num ${m.points < 0 ? 'stock-out' : 'stock-ok'}">${m.points > 0 ? '+' : ''}${qtyFmt(m.points)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Aucun point pour l’instant : ils s’ajoutent à chaque achat en caisse.</p>'}`;
        $('#cAdjust')?.addEventListener('click', async () => {
          const v = window.prompt('Points à ajouter (ou à retirer avec un signe moins) :', '10');
          if (!v) return;
          const reason = window.prompt('Motif :', 'Geste commercial') || '';
          try { await api(`/store/customers/${c.id}/loyalty`, { method: 'POST', body: { points: Number(v.replace(',', '.')), reason } }); await refresh('customers'); loadLoyalty(); toast('Points mis à jour'); } catch (ex) { fail(ex); }
        });
      }).catch(() => {});
      loadLoyalty();
    }
    $('#cCancel').addEventListener('click', closeModal);
    $('#cQuote')?.addEventListener('click', () => docForm('devis', null, c.id));
    $('#cDelete')?.addEventListener('click', async () => {
      if (!confirmAction(`Supprimer ${c.name} ? Ses documents sont conservés.`)) return;
      try { await api(`/store/customers/${c.id}`, { method: 'DELETE' }); await refresh('customers'); closeModal(); toast('Client supprimé'); route(); } catch (ex) { fail(ex); }
    });
    $('#cSave').addEventListener('click', async (e) => {
      const data = Object.fromEntries(new FormData(form));
      if (!data.name.trim()) { $('#cError').textContent = 'Le nom du client est obligatoire.'; return; }
      e.currentTarget.disabled = true;
      try {
        let id = c.id;
        if (isNew) {
          data.client_ref = window.ComptoirOutbox.uuid();
          try { if (!navigator.onLine) throw offlineError('POST'); id = (await api('/store/customers', { method: 'POST', body: data })).id; }
          catch (ex) {
            if (ex.name !== 'Offline') throw ex;
            // Client créé hors ligne : utilisable tout de suite (en caisse aussi), envoyé au retour d'internet.
            await enqueue({ ref: data.client_ref, type: 'customer', body: data });
            id = `tmp-${data.client_ref}`;
            state.customers.push({ id, ...data, loyalty_points: 0, invoiced: 0, documents: 0, due: 0, pending: true });
            state.customers.sort((x, y) => x.name.localeCompare(y.name, 'fr')); keep('/store/customers', state.customers);
          }
        }
        else await api(`/store/customers/${c.id}`, { method: 'PUT', body: data });
        await refresh('customers');
        if (onSaved) return onSaved(id);
        closeModal(); toast(isNew ? 'Client ajouté' : 'Client enregistré'); route();
      } catch (ex) { $('#cError').textContent = ex.message; e.currentTarget.disabled = false; }
    });
  }

  /* ================= Documents ================= */
  const dv = { status: '', q: '' };
  let dvType = null;
  async function viewDocuments(type) {
    if (dvType !== type) { dv.status = ''; dv.q = ''; dvType = type; }
    const conf = DOC[type];
    setActions(`<button class="btn btn-primary" data-new="${type}">${conf.new}</button>`);
    const docs = await api(`/store/documents?type=${type}`);
    const counts = {}; docs.forEach((d) => { counts[d.status] = (counts[d.status] || 0) + 1; });
    const render = () => {
      const q = norm(dv.q);
      const list = docs.filter((d) => (!dv.status || d.status === dv.status) && (!q || norm(`${d.number} ${d.client_name}`).includes(q)));
      const total = list.filter((d) => d.status !== 'annulée' && d.status !== 'refusé').reduce((s, d) => s + d.total_ttc, 0);
      $('#dtable').innerHTML = docs.length ? `<div class="table-wrap"><table><thead><tr><th>Numéro</th><th>Client</th><th>Date</th>${type === 'facture' ? '<th>Échéance</th>' : ''}<th class="num">Total TTC</th>${type === 'facture' ? '<th class="num">Reste dû</th>' : ''}<th>Statut</th></tr></thead><tbody>
        ${list.map((d) => {
          const late = type === 'facture' && d.status === 'émise' && d.due_date && d.due_date < today();
          return `<tr class="clickable" data-doc="${d.id}"><td><span class="cell-main doc-num">${esc(d.number)}</span>${d.origin === 'site' ? '<span class="site-flag">site</span>' : ''}</td><td>${esc(d.client_name)}</td><td>${dateFmt(d.date)}</td>${type === 'facture' ? `<td class="${late ? 'stock-out' : ''}">${dateFmt(d.due_date)}${late ? ' (en retard)' : ''}</td>` : ''}<td class="num">${money(d.total_ttc)}</td>${type === 'facture' ? `<td class="num">${d.status === 'émise' ? money(remaining(d)) : '—'}</td>` : ''}<td>${docBadge(d)}</td></tr>`;
        }).join('') || `<tr><td colspan="7" class="empty-state">Aucun document ne correspond.</td></tr>`}
      </tbody>${list.length ? `<tfoot><tr><td colspan="${type === 'facture' ? 4 : 3}" class="muted">${list.length} document${list.length > 1 ? 's' : ''}</td><td class="num cell-main">${money(total)}</td>${type === 'facture' ? `<td class="num cell-main">${money(list.filter((d) => d.status === 'émise').reduce((s, d) => s + remaining(d), 0))}</td>` : ''}<td></td></tr></tfoot>` : ''}</table></div>`
        : `<div class="table-wrap"><div class="empty-state"><strong>Aucun ${conf.one} pour l'instant.</strong>${type === 'commande' ? 'Les commandes prises par téléphone et mises de côté depuis la caisse apparaissent ici.' : ''}<br><button class="btn btn-primary" data-new="${type}">${conf.new}</button></div></div>`;
    };
    $('#view').innerHTML = `
      <div class="toolbar">
        <div class="chips">
          <button class="chip" data-dstatus="" aria-pressed="${!dv.status}">Tous<span class="n">${docs.length}</span></button>
          ${conf.statuses.map((s) => `<button class="chip" data-dstatus="${s}" aria-pressed="${dv.status === s}">${cap(STATUS_LABEL[s] || s)}<span class="n">${counts[s] || 0}</span></button>`).join('')}
        </div>
        <input type="search" id="dq" placeholder="Numéro ou client" value="${esc(dv.q)}">
      </div>
      <div id="dtable"></div>`;
    $('#dq').addEventListener('input', (e) => { dv.q = e.target.value; render(); });
    $$('[data-dstatus]').forEach((b) => b.addEventListener('click', () => {
      dv.status = b.dataset.dstatus; $$('[data-dstatus]').forEach((x) => x.setAttribute('aria-pressed', x === b)); render();
    }));
    render();
  }

  async function showDoc(id) {
    let d;
    try { d = await api(`/store/documents/${id}`); } catch (e) { return fail(e); }
    const conf = DOC[d.type];
    const editable = d.type !== 'facture' && !d.stock_applied;
    const conversions = { devis: ['commande', 'facture'], commande: ['facture'], ticket: ['facture'] }[d.type] || [];
    const blocked = ['annulée', 'annulé', 'refusé'].includes(d.status);
    const pendingOrder = d.type === 'commande' && ['nouvelle', 'confirmée'].includes(d.status);
    const doneTypes = d.children.filter((c) => c.status !== 'annulée').map((c) => c.type);
    const late = d.type === 'facture' && d.status === 'émise' && d.due_date && d.due_date < today();
    const isOpenInvoice = d.type === 'facture' && d.status === 'émise';
    const isTicket = d.type === 'ticket';
    const paymentsHtml = (d.type === 'facture' || isTicket) && (d.payments.length || isOpenInvoice) ? `
      <h3 class="section-title">Paiements</h3>
      ${d.payments.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Mode</th><th>Note</th><th class="num">Montant</th><th></th></tr></thead><tbody>
        ${d.payments.map((p) => `<tr><td>${dateFmt(p.date)}</td><td>${esc(cap(p.method))}</td><td class="muted">${esc(p.note)}</td><td class="num">${money(p.amount)}</td><td class="num">${isTicket ? '' : `<button class="btn btn-sm btn-danger" data-delpay="${p.id}">Supprimer</button>`}</td></tr>`).join('')}
      </tbody></table></div>` : `<p class="muted" style="margin:0">Aucun paiement enregistré.</p>`}
      ${isTicket ? '' : `<div class="totals"><div><span>Déjà réglé</span><span>${money(d.amount_paid || 0)}</span></div><div class="grand"><span>Reste à payer</span><span>${money(remaining(d))}</span></div></div>`}` : '';
    const body = openModal(`${cap(conf.one)} ${d.number}`, `
      ${d.origin === 'site' && d.status === 'nouvelle' ? `<p class="notice">Demande reçue depuis le site. Confirmez la disponibilité auprès du client, puis passez la commande en « confirmée ».</p>` : ''}
      ${d.type === 'facture' && d.status !== 'annulée' ? `<p class="notice">Une facture n'est plus modifiable. En cas d'erreur, annulez-la et créez-en une nouvelle.</p>` : ''}
      <div class="doc-actions">
        <button class="btn btn-dark" id="dPrint">Imprimer / PDF</button>
        ${['ticket', 'facture', 'devis', 'avoir', 'commande'].includes(d.type) ? '<button class="btn" id="dShare">Envoyer au client</button>' : ''}
        ${d.client_email ? `<a class="btn" href="mailto:${esc(d.client_email)}?subject=${encodeURIComponent(`${cap(conf.one)} ${d.number} — ${state.settings.shop_name || ''}`)}">Écrire au client</a>` : ''}
        ${pendingOrder ? '<button class="btn btn-primary" id="dToPos">Encaisser en caisse</button>' : ''}
        ${isOpenInvoice ? '<button class="btn btn-primary" id="dPay">Encaisser un paiement</button>' : ''}
        ${isOpenInvoice ? `<button class="btn" id="dRemind">${late ? 'Relancer le client' : 'Envoyer un rappel'}</button>` : ''}
        ${editable ? '<button class="btn" id="dEdit">Modifier</button>' : ''}
        ${conversions.filter((t) => !doneTypes.includes(t)).map((t) => `<button class="btn" data-convert="${t}" ${blocked ? 'disabled' : ''}>${isTicket ? 'Faire une facture' : `Transformer en ${DOC[t].one}`}</button>`).join('')}
        ${!['facture', 'ticket'].includes(d.type) ? '<button class="btn btn-danger" id="dDelete">Supprimer</button>' : ''}
      </div>
      <div class="status-row"><span class="label">Statut</span>
        ${conf.statuses.map((s) => `<button class="chip" data-setstatus="${s}" aria-pressed="${d.status === s}" ${d.type === 'facture' && d.status === 'annulée' ? 'disabled' : ''}>${cap(STATUS_LABEL[s] || s)}</button>`).join('')}
        ${d.type === 'facture' && d.status === 'émise' && d.amount_paid > 0 ? '<span class="badge s-warn">payée en partie</span>' : ''}
      </div>
      <dl class="doc-meta">
        <div><dt>Client</dt><dd><strong>${esc(d.client_name)}</strong>${d.client_address ? '\n' + esc(d.client_address) : ''}${d.client_phone ? '\n' + esc(d.client_phone) : ''}${d.client_email ? '\n' + esc(d.client_email) : ''}</dd></div>
        <div><dt>Date</dt><dd>${dateFmt(d.date)}</dd></div>
        ${d.due_date ? `<div><dt>${d.type === 'devis' ? 'Valable jusqu’au' : 'Échéance'}</dt><dd class="${late ? 'stock-out' : ''}">${dateFmt(d.due_date)}${late ? ' (en retard)' : ''}</dd></div>` : ''}
        ${d.paid_at ? `<div><dt>Payée le</dt><dd>${dateFmt(d.paid_at)}</dd></div>` : ''}
        ${d.reminders ? `<div><dt>Relances</dt><dd>${d.reminders} (dernière le ${dateFmt(d.last_reminder_at)})</dd></div>` : ''}
        ${d.source || d.children.length ? `<div><dt>Documents liés</dt><dd>${[d.source, ...d.children].filter(Boolean).map((x) => `<button class="link" data-doc="${x.id}">${esc(x.number)}</button>`).join('\n')}</dd></div>` : ''}
        ${d.stock_applied && d.lines.some((l) => l.product_id) ? `<div><dt>Stock</dt><dd>Déduit du stock</dd></div>` : ''}
      </dl>
      <div class="table-wrap"><table><thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">PU HT</th><th class="num">TVA</th><th class="num">Total HT</th></tr></thead><tbody>
        ${d.lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="num">${qtyFmt(l.qty)}</td><td class="num">${money(l.unit_price_ht)}</td><td class="num">${l.tva_rate} %</td><td class="num">${money(l.qty * l.unit_price_ht)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="totals"><div><span>Total HT</span><span>${money(d.total_ht)}</span></div><div><span>TVA</span><span>${money(d.total_tva)}</span></div><div class="grand"><span>Total TTC</span><span>${money(d.total_ttc)}</span></div></div>
      ${paymentsHtml}
      ${d.notes ? `<h3 class="section-title">Notes</h3><p style="white-space:pre-line;margin:0">${esc(d.notes)}</p>` : ''}`, true);
    $('#dPay', body)?.addEventListener('click', () => paymentModal(d));
    $('#dRemind', body)?.addEventListener('click', () => remindClient(d));
    $$('[data-delpay]', body).forEach((b) => b.addEventListener('click', async () => {
      if (!confirmAction('Supprimer ce paiement ? La facture repassera « à payer » si elle n\'est plus soldée.')) return;
      try { await api(`/store/payments/${b.dataset.delpay}`, { method: 'DELETE' }); toast('Paiement supprimé'); showDoc(d.id); route(); } catch (e) { fail(e); }
    }));

    $('#dPrint', body).addEventListener('click', () => (isTicket ? printTicket(d) : printDoc(d)));
    $('#dShare', body)?.addEventListener('click', (e) => shareToClient(d, e.currentTarget));
    $('#dToPos', body)?.addEventListener('click', () => loadOrderInPos(d));
    $('#dEdit', body)?.addEventListener('click', () => docForm(d.type, d));
    $('#dDelete', body)?.addEventListener('click', async () => {
      if (!confirmAction(`Supprimer ${d.number} ?${d.stock_applied ? ' Le stock déduit sera restitué.' : ''}`)) return;
      try { await api(`/store/documents/${d.id}`, { method: 'DELETE' }); await refresh('products'); closeModal(); toast(`${d.number} supprimé`); route(); } catch (e) { fail(e); }
    });
    $$('[data-setstatus]', body).forEach((b) => b.addEventListener('click', async () => {
      const s = b.dataset.setstatus; if (s === d.status) return;
      if (d.type === 'ticket' && !confirmAction(`Annuler le ticket ${d.number} ? Le stock sera restitué et un remboursement sera inscrit au journal de caisse.`)) return;
      if (d.type === 'facture' && s === 'annulée' && !confirmAction(`Annuler la facture ${d.number} ? Cette action est définitive${d.stock_applied ? ' et le stock sera restitué' : ''}.`)) return;
      try { await api(`/store/documents/${d.id}/status`, { method: 'POST', body: { status: s } }); await refresh('products'); toast(`Statut : ${STATUS_LABEL[s] || s}`); showDoc(d.id); route(); } catch (e) { fail(e); }
    }));
    $$('[data-convert]', body).forEach((b) => b.addEventListener('click', async () => {
      const to = b.dataset.convert;
      const extra = d.type === 'commande' && d.status !== 'livrée' ? ' La commande sera marquée livrée et le stock déduit.' : '';
      if (!isTicket && !confirmAction(`Créer une ${DOC[to].one} à partir de ${d.number} ?${extra}`)) return;
      try {
        const n = await api(`/store/documents/${d.id}/convert`, { method: 'POST', body: { to } });
        await refresh('products'); toast(`${n.number} créé`); route(); showDoc(n.id);
      } catch (e) { fail(e); }
    }));
  }

  function paymentModal(d) {
    const rest = remaining(d);
    const body = openModal(`Encaisser ${d.number}`, `
      <p class="notice">Reste à payer : <strong>${money(rest)}</strong> sur ${money(d.total_ttc)}.</p>
      <form id="payForm" class="fields" novalidate>
        <label class="field"><span>Montant (${esc(cur())})</span><input name="amount" type="number" step="0.01" min="0.01" max="${rest}" value="${rest.toFixed(2)}" required></label>
        <label class="field"><span>Date</span><input name="date" type="date" value="${today()}"></label>
        <label class="field"><span>Mode de paiement</span><select name="method">${METHODS.map((m) => `<option value="${m}">${cap(m)}</option>`).join('')}</select></label>
        <label class="field"><span>Note <span class="muted">(facultatif)</span></span><input name="note" placeholder="N° de chèque, acompte…"></label>
        <p class="form-error full" id="payError"></p>
      </form>
      <div class="modal-foot"><div class="right"><button class="btn" id="payCancel">Annuler</button><button class="btn btn-primary" id="paySave">Enregistrer le paiement</button></div></div>`);
    $('#payCancel', body).addEventListener('click', () => showDoc(d.id));
    $('#paySave', body).addEventListener('click', async (e) => {
      const data = Object.fromEntries(new FormData($('#payForm')));
      if (!(Number(data.amount) > 0)) { $('#payError').textContent = 'Indiquez un montant supérieur à zéro.'; return; }
      e.currentTarget.disabled = true;
      try {
        const n = await api(`/store/documents/${d.id}/payments`, { method: 'POST', body: data });
        toast(n.status === 'payée' ? `${n.number} soldée` : `Paiement enregistré, reste ${money(remaining(n))}`);
        route(); showDoc(n.id);
      } catch (ex) { $('#payError').textContent = ex.message; e.currentTarget.disabled = false; }
    });
  }

  function reminderText(d) {
    const s = state.settings;
    const late = d.due_date && d.due_date < today();
    const subject = `${late ? 'Relance' : 'Rappel'} : facture ${d.number}`;
    const lines = [
      'Bonjour,',
      '',
      late
        ? `Sauf erreur de notre part, la facture ${d.number} du ${dateFmt(d.date)}, arrivée à échéance le ${dateFmt(d.due_date)}, n'est pas encore entièrement réglée.`
        : `Nous vous rappelons que la facture ${d.number} du ${dateFmt(d.date)} arrive à échéance le ${dateFmt(d.due_date)}.`,
      `Montant restant dû : ${money(remaining(d))}.`,
      '',
      late ? 'Merci de bien vouloir procéder au règlement dans les meilleurs délais.' : 'Merci de prévoir son règlement d’ici cette date.',
      s.bank_info ? `Coordonnées de paiement : ${s.bank_info}` : '',
      'Si le paiement a déjà été effectué, merci de ne pas tenir compte de ce message.',
      '',
      'Cordialement,',
      s.shop_name, s.phone,
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
    return { subject, body: lines.join('\n') };
  }

  async function remindClient(d) {
    const { subject, body } = reminderText(d);
    if (d.client_email) {
      location.href = `mailto:${encodeURIComponent(d.client_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    } else {
      try { await navigator.clipboard.writeText(body); } catch { /* presse-papiers indisponible */ }
      toast(`Pas d'e-mail pour ce client : texte de relance copié${d.client_phone ? `, téléphone ${d.client_phone}` : ''}`);
    }
    try { await api(`/store/documents/${d.id}/remind`, { method: 'POST', body: {} }); } catch (e) { fail(e); }
    if (modal.open && $('#modalTitle').textContent.includes(d.number)) showDoc(d.id);
    if (location.hash === '#/alertes') route();
  }

  async function viewAlerts() {
    const [a, mail] = await Promise.all([api('/store/alerts'), api('/store/alerts/email-status').catch(() => ({ configured: false }))]);
    const s = state.settings;
    const digestOn = s.alert_digest === '1' && s.alert_email && mail.configured;
    const lateCell = (d) => `<span class="stock-out">${d.days_late} jour${d.days_late > 1 ? 's' : ''}</span>`;
    const remindCell = (d) => d.reminders ? `${d.reminders} <span class="cell-sub">le ${dateFmt(d.last_reminder_at)}</span>` : '<span class="muted">aucune</span>';
    const docRow = (d, overdue) => `<tr>
      <td><button class="link cell-main doc-num" data-doc="${d.id}">${esc(d.number)}</button><div class="cell-sub">${esc(d.client_name)}</div></td>
      <td>${dateFmt(d.due_date)}</td>
      <td>${overdue ? lateCell(d) : (d.days === 0 ? "aujourd'hui" : `dans ${d.days} j`)}</td>
      <td class="num">${money(d.remaining)}</td>
      ${overdue ? `<td>${remindCell(d)}</td>` : ''}
      <td class="num nowrap"><button class="btn btn-sm" data-remind="${d.id}">${overdue ? 'Relancer' : 'Rappel'}</button> <button class="btn btn-sm btn-primary" data-pay="${d.id}">Encaisser</button></td>
    </tr>`;
    const stockRow = (p) => `<tr>
      <td><span class="cell-main">${esc(p.name)}</span><div class="cell-sub">${esc(p.ref)}</div></td>
      <td class="num ${p.stock <= 0 ? 'stock-out' : 'stock-low'}">${qtyFmt(p.stock)}</td>
      <td class="num">${qtyFmt(p.stock_min)}</td>
      <td class="num">${qtyFmt(p.suggested)} <span class="muted">${esc(p.unit)}</span></td>
      <td class="num"><button class="btn btn-sm" data-restock="${p.id}">Réceptionner</button></td>
    </tr>`;
    const table = (head, rows) => `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    const empty = (msg) => `<div class="empty-state"><strong>${msg}</strong></div>`;
    const reorder = [...a.out_of_stock, ...a.low_stock];
    setActions(reorder.length ? `<button class="btn" id="printReorder">Imprimer la liste à commander</button>` : '');
    $('#view').innerHTML = `
      <section class="alert-strip ${digestOn ? 'on' : ''}">
        ${digestOn
          ? `Récapitulatif envoyé chaque matin à <strong>${esc(s.alert_email)}</strong> quand il y a des alertes.`
          : `Le récapitulatif quotidien par e-mail est désactivé.`}
        <a href="#/parametres">${digestOn ? 'Modifier' : 'Configurer'}</a>
      </section>
      <section class="kpis" aria-label="Résumé des alertes">
        <div class="kpi"><span class="kpi-label">Factures en retard</span><span class="kpi-value ${a.overdue.length ? 'stock-out' : ''}">${a.overdue.length}</span><span class="kpi-sub">${money(a.totals.overdue_amount)}</span></div>
        <div class="kpi"><span class="kpi-label">Échéances sous ${esc(s.due_soon_days || 7)} jours</span><span class="kpi-value">${a.due_soon.length}</span><span class="kpi-sub">${money(a.totals.due_soon_amount)}</span></div>
        <div class="kpi"><span class="kpi-label">Ruptures de stock</span><span class="kpi-value ${a.out_of_stock.length ? 'stock-out' : ''}">${a.out_of_stock.length}</span><span class="kpi-sub">produits à 0</span></div>
        <div class="kpi"><span class="kpi-label">Stock sous le seuil</span><span class="kpi-value ${a.low_stock.length ? 'stock-low' : ''}">${a.low_stock.length}</span><span class="kpi-sub">à recommander</span></div>
      </section>
      <div class="stack">
        <section class="panel">
          <div class="panel-head"><h2>Factures en retard de paiement</h2></div>
          ${a.overdue.length ? table('<th>Facture</th><th>Échéance</th><th>Retard</th><th class="num">Reste dû</th><th>Relances</th><th></th>', a.overdue.map((d) => docRow(d, true)).join('')) : empty('Aucune facture en retard.')}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Échéances proches</h2><span class="muted">sous ${esc(s.due_soon_days || 7)} jours</span></div>
          ${a.due_soon.length ? table('<th>Facture</th><th>Échéance</th><th>Dans</th><th class="num">Reste dû</th><th></th>', a.due_soon.map((d) => docRow(d, false)).join('')) : empty('Aucune échéance dans les prochains jours.')}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Ruptures de stock</h2></div>
          ${a.out_of_stock.length ? table('<th>Produit</th><th class="num">Stock</th><th class="num">Seuil</th><th class="num">À commander</th><th></th>', a.out_of_stock.map(stockRow).join('')) : empty('Aucun produit en rupture.')}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Stock sous le seuil d'alerte</h2></div>
          ${a.low_stock.length ? table('<th>Produit</th><th class="num">Stock</th><th class="num">Seuil</th><th class="num">À commander</th><th></th>', a.low_stock.map(stockRow).join('')) : empty('Aucun produit sous son seuil.')}
        </section>
      </div>`;
    $$('[data-remind]').forEach((b) => b.addEventListener('click', async () => {
      const d = await api(`/store/documents/${b.dataset.remind}`); remindClient(d);
    }));
    $$('[data-pay]').forEach((b) => b.addEventListener('click', async () => {
      const d = await api(`/store/documents/${b.dataset.pay}`); paymentModal(d);
    }));
    $('#printReorder')?.addEventListener('click', () => printReorder(reorder));
  }

  function printReorder(list) {
    const s = state.settings;
    const total = list.reduce((t, p) => t + p.suggested * (p.purchase_price || 0), 0);
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Liste à commander</title>
      <link href="${location.origin}/assets/fonts.css" rel="stylesheet">
      <style>@page{size:A4;margin:16mm 14mm}body{font-family:Archivo,Arial,sans-serif;color:#1B2530;font-size:10.5pt}
      h1{font-stretch:75%;margin:0 0 4px}p{margin:0 0 16px;color:#5A6774}table{width:100%;border-collapse:collapse}
      th{text-align:left;font-size:9pt;color:#5A6774;border-bottom:1px solid #1F2D3A;padding:6px}td{padding:8px 6px;border-bottom:1px solid #E3E6E9}
      .num{text-align:right;font-variant-numeric:tabular-nums}.box{width:18px;height:18px;border:1px solid #1F2D3A;display:inline-block}</style></head><body>
      <h1>Liste à commander</h1><p>${esc(s.shop_name)}, le ${new Date().toLocaleDateString('fr-FR')}</p>
      <table><thead><tr><th></th><th>Produit</th><th>Réf.</th><th class="num">Stock</th><th class="num">Seuil</th><th class="num">À commander</th><th class="num">Coût estimé</th></tr></thead><tbody>
      ${list.map((p) => `<tr><td><span class="box"></span></td><td>${esc(p.name)}</td><td>${esc(p.ref)}</td><td class="num">${qtyFmt(p.stock)}</td><td class="num">${qtyFmt(p.stock_min)}</td><td class="num"><strong>${qtyFmt(p.suggested)}</strong> ${esc(p.unit)}</td><td class="num">${p.purchase_price ? money(p.suggested * p.purchase_price) : '—'}</td></tr>`).join('')}
      </tbody></table><p style="margin-top:14px;text-align:right">Coût estimé HT : <strong>${money(total)}</strong></p>
      <script>document.fonts.ready.then(() => setTimeout(() => window.print(), 150));</script></body></html>`;
    const w = window.open('', '_blank');
    if (!w) return toast("Autorisez l'ouverture des fenêtres pour imprimer.", true);
    w.document.open(); w.document.write(html); w.document.close();
  }

  function docForm(type, d = null, customerId = null, draft = null) {
    const conf = DOC[type];
    const isNew = !d;
    const tvaDef = Number(state.settings.tva_default) || 20;
    d = d || draft || { customer_id: customerId, client_name: '', client_email: '', client_phone: '', client_address: '', date: today(), due_date: '', notes: '', status: conf.statuses[0], lines: [] };
    let lines = d.lines.map((l) => ({ product_id: l.product_id, label: l.label, qty: l.qty, unit_price_ht: l.unit_price_ht, tva_rate: l.tva_rate }));
    const body = openModal(isNew ? conf.new : `Modifier ${d.number}`, `
      <form id="dform" novalidate>
        <div class="fields">
          ${isNew ? `${state.scope === 'all' && (state.me.locations || []).length > 1 ? `<label class="field"><span>Boutique</span><select name="location_id">${state.me.locations.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></label>` : ''}` : ''}
          <label class="field full"><span>Client</span>
            <select name="customer_id"><option value="">Client de passage (saisir ci-dessous)</option>${state.customers.map((c) => `<option value="${c.id}" ${String(c.id) === String(d.customer_id) ? 'selected' : ''}>${esc(c.name)}${c.company ? ' — ' + esc(c.company) : ''}</option>`).join('')}</select>
            <small><button type="button" class="link" id="quickCustomer">Créer un nouveau client</button></small>
          </label>
          <label class="field"><span>Nom affiché sur le document</span><input name="client_name" value="${esc(d.client_name)}"></label>
          <label class="field"><span>Téléphone</span><input name="client_phone" value="${esc(d.client_phone)}"></label>
          <label class="field"><span>E-mail</span><input name="client_email" value="${esc(d.client_email)}"></label>
          <label class="field"><span>Adresse</span><input name="client_address" value="${esc(d.client_address)}"></label>
          <label class="field"><span>Date</span><input name="date" type="date" value="${esc(d.date)}"></label>
          ${type !== 'commande' ? `<label class="field"><span>${type === 'devis' ? 'Valable jusqu’au' : 'Échéance de paiement'}</span><input name="due_date" type="date" value="${esc(d.due_date || '')}"><small>Laissé vide : ${type === 'devis' ? '30 jours' : (state.settings.invoice_due_days || 30) + ' jours'} après la date.</small></label>` : ''}
        </div>
        <h3 class="section-title">Lignes</h3>
        <div class="table-wrap"><table class="lines-table"><thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">PU HT</th><th class="num">TVA %</th><th class="num">Total HT</th><th></th></tr></thead><tbody id="lines"></tbody></table></div>
        <div class="add-line">
          <input id="productPick" list="productList" placeholder="Rechercher un produit à ajouter (nom ou référence)">
          <datalist id="productList">${state.products.map((p) => `<option value="${esc(p.ref ? p.ref + ' — ' + p.name : p.name)}">${money(p.price_ht)} HT, stock ${qtyFmt(p.stock)}</option>`).join('')}</datalist>
          <button type="button" class="btn" id="freeLine">Ligne libre</button>
        </div>
        <div class="totals" id="docTotals"></div>
        <label class="field" style="margin-top:16px"><span>Notes <span class="muted">(imprimées sur le document)</span></span><textarea name="notes" rows="3">${esc(d.notes)}</textarea></label>
        <p class="form-error" id="dError"></p>
      </form>
      <div class="modal-foot"><div class="right"><button class="btn" id="dCancel">Annuler</button><button class="btn btn-primary" id="dSave">${isNew ? `Créer ${type === 'commande' ? 'la' : type === 'facture' ? 'la' : 'le'} ${conf.one}` : 'Enregistrer'}</button></div></div>`, true);
    const form = $('#dform', body);

    const fillCustomer = () => {
      const c = state.customers.find((x) => String(x.id) === form.customer_id.value);
      if (!c) return;
      form.client_name.value = c.company ? `${c.company} (${c.name})` : c.name;
      form.client_email.value = c.email || ''; form.client_phone.value = c.phone || ''; form.client_address.value = c.address || '';
    };
    form.customer_id.addEventListener('change', fillCustomer);
    if (customerId) fillCustomer();

    const renderLines = () => {
      $('#lines').innerHTML = lines.map((l, i) => `<tr>
        <td><input data-l="${i}" data-k="label" value="${esc(l.label)}" aria-label="Désignation"></td>
        <td class="w-qty"><input data-l="${i}" data-k="qty" type="number" step="any" value="${l.qty}" aria-label="Quantité"></td>
        <td class="w-price"><input data-l="${i}" data-k="unit_price_ht" type="number" step="0.01" value="${l.unit_price_ht}" aria-label="Prix unitaire HT"></td>
        <td class="w-tva"><input data-l="${i}" data-k="tva_rate" type="number" step="0.1" value="${l.tva_rate}" aria-label="TVA"></td>
        <td class="num w-total" data-total="${i}">${money(l.qty * l.unit_price_ht)}</td>
        <td><button type="button" class="icon-btn" data-rm="${i}" aria-label="Retirer la ligne">✕</button></td>
      </tr>`).join('') || `<tr><td colspan="6" class="empty-state">Ajoutez un produit ci-dessous ou une ligne libre.</td></tr>`;
      renderTotals();
    };
    const renderTotals = () => {
      let ht = 0, tva = 0;
      lines.forEach((l, i) => {
        const h = (Number(l.qty) || 0) * (Number(l.unit_price_ht) || 0);
        ht += h; tva += (h * (Number(l.tva_rate) || 0)) / 100;
        const cell = $(`[data-total="${i}"]`); if (cell) cell.textContent = money(h);
      });
      $('#docTotals').innerHTML = `<div><span>Total HT</span><span>${money(r2(ht))}</span></div><div><span>TVA</span><span>${money(r2(tva))}</span></div><div class="grand"><span>Total TTC</span><span>${money(r2(ht) + r2(tva))}</span></div>`;
    };
    $('#lines').addEventListener('input', (e) => {
      const i = e.target.dataset.l; if (i === undefined) return;
      const k = e.target.dataset.k;
      lines[i][k] = k === 'label' ? e.target.value : Number(e.target.value);
      renderTotals();
    });
    $('#lines').addEventListener('click', (e) => {
      const b = e.target.closest('[data-rm]'); if (!b) return;
      lines.splice(Number(b.dataset.rm), 1); renderLines();
    });
    $('#productPick').addEventListener('change', (e) => {
      const v = e.target.value;
      const p = state.products.find((x) => (x.ref ? x.ref + ' — ' + x.name : x.name) === v);
      if (!p) return;
      const existing = lines.find((l) => l.product_id === p.id);
      if (existing) existing.qty = Number(existing.qty) + 1;
      else lines.push({ product_id: p.id, label: p.name, qty: 1, unit_price_ht: p.price_ht, tva_rate: p.tva_rate });
      if (p.stock <= 0 && type !== 'devis') toast(`Attention : ${p.name} est en rupture de stock`, true);
      e.target.value = ''; renderLines();
    });
    $('#freeLine').addEventListener('click', () => {
      lines.push({ product_id: null, label: '', qty: 1, unit_price_ht: 0, tva_rate: tvaDef }); renderLines();
      $(`[data-l="${lines.length - 1}"][data-k="label"]`).focus();
    });
    $('#quickCustomer').addEventListener('click', () => {
      const snapshot = { ...Object.fromEntries(new FormData(form)), lines };
      const merged = { ...d, ...snapshot, lines };
      customerForm(null, (newId2) => { merged.customer_id = newId2; docForm(type, isNew ? null : merged, newId2, isNew ? merged : null); });
    });
    $('#dCancel').addEventListener('click', () => (isNew ? closeModal() : showDoc(d.id)));
    $('#dSave').addEventListener('click', async (e) => {
      const data = Object.fromEntries(new FormData(form));
      const clean = lines.filter((l) => String(l.label).trim());
      if (!data.customer_id && !data.client_name.trim()) { $('#dError').textContent = 'Choisissez un client ou indiquez son nom.'; return; }
      if (!clean.length) { $('#dError').textContent = 'Ajoutez au moins une ligne avec une désignation.'; return; }
      e.currentTarget.disabled = true;
      try {
        const payload = { ...data, type, lines: clean, status: d.status };
        const saved = isNew
          ? await api('/store/documents', { method: 'POST', body: payload })
          : await api(`/store/documents/${d.id}`, { method: 'PUT', body: payload });
        await refresh('products');
        toast(isNew ? `${saved.number} créé` : `${saved.number} enregistré`);
        // Changement de rubrique sans événement « hashchange » (qui fermerait la fiche ouverte juste après)
        if (location.hash !== `#/${conf.view}`) history.pushState(null, '', `#/${conf.view}`);
        route();
        showDoc(saved.id);
      } catch (ex) { $('#dError').textContent = ex.message; e.currentTarget.disabled = false; }
    });
    renderLines();
  }

  /* ---------------- Impression ---------------- */
  function printDoc(d) {
    const s = state.settings;
    const title = { devis: 'Devis', commande: 'Bon de commande', facture: 'Facture' }[d.type];
    const byRate = {};
    d.lines.forEach((l) => { const h = l.qty * l.unit_price_ht; byRate[l.tva_rate] = (byRate[l.tva_rate] || 0) + (h * l.tva_rate) / 100; });
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)} ${esc(d.number)}</title>
      <link href="${location.origin}/assets/fonts.css" rel="stylesheet">
      <style>
        @page { size: A4; margin: 16mm 14mm; }
        * { box-sizing: border-box; }
        body { font-family: Archivo, Arial, sans-serif; color: #1B2530; font-size: 10.5pt; line-height: 1.45; margin: 0; }
        .head { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 14px; border-bottom: 3px solid #1F2D3A; }
        .shop-name { font-weight: 850; font-stretch: 62%; font-size: 26pt; line-height: .9; margin: 0 0 8px; }
        .muted { color: #5A6774; }
        .doc-title { text-align: right; }
        .doc-title h1 { margin: 0; font-size: 20pt; font-stretch: 75%; }
        .doc-title p { margin: 2px 0; }
        .parties { display: flex; justify-content: flex-end; margin: 22px 0; }
        .client { width: 46%; border: 1px solid #D3D8DD; padding: 12px 14px; white-space: pre-line; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th { text-align: left; font-size: 9pt; color: #5A6774; border-bottom: 1px solid #1F2D3A; padding: 6px; }
        td { padding: 7px 6px; border-bottom: 1px solid #E3E6E9; vertical-align: top; }
        .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .totals { width: 260px; margin: 14px 0 0 auto; }
        .totals div { display: flex; justify-content: space-between; padding: 3px 0; }
        .totals .grand { border-top: 2px solid #1F2D3A; margin-top: 4px; padding-top: 6px; font-weight: 750; font-size: 12pt; }
        .notes { margin-top: 24px; white-space: pre-line; }
        .foot { margin-top: 36px; padding-top: 10px; border-top: 1px solid #D3D8DD; font-size: 8.5pt; color: #5A6774; white-space: pre-line; }
        .sign { margin-top: 28px; display: flex; justify-content: flex-end; }
        .sign div { width: 46%; border: 1px dashed #A9B3BD; height: 80px; padding: 8px; font-size: 9pt; color: #5A6774; }
      </style></head><body>
      <div class="head">
        <div><p class="shop-name">${esc(s.shop_name)}</p><div class="muted">${esc(s.address)}<br>${esc(s.phone)}${s.email ? ' — ' + esc(s.email) : ''}</div></div>
        <div class="doc-title"><h1>${esc(title)}</h1><p><strong>${esc(d.number)}</strong></p><p>Date : ${dateFmt(d.date)}</p>
          ${d.due_date && d.type === 'facture' ? `<p>Échéance : ${dateFmt(d.due_date)}</p>` : ''}
          ${d.due_date && d.type === 'devis' ? `<p>Valable jusqu'au ${dateFmt(d.due_date)}</p>` : ''}
          ${d.status === 'payée' ? `<p><strong>Payée le ${dateFmt(d.paid_at)}</strong></p>` : ''}
          ${d.status === 'annulée' ? `<p><strong>ANNULÉE</strong></p>` : ''}
        </div>
      </div>
      <div class="parties"><div class="client"><strong>${esc(d.client_name)}</strong>${d.client_address ? '\n' + esc(d.client_address) : ''}${d.client_phone ? '\n' + esc(d.client_phone) : ''}${d.client_email ? '\n' + esc(d.client_email) : ''}</div></div>
      <table><thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">PU HT</th><th class="num">TVA</th><th class="num">Total HT</th></tr></thead><tbody>
        ${d.lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="num">${qtyFmt(l.qty)}</td><td class="num">${money(l.unit_price_ht)}</td><td class="num">${l.tva_rate} %</td><td class="num">${money(l.qty * l.unit_price_ht)}</td></tr>`).join('')}
      </tbody></table>
      <div class="totals"><div><span>Total HT</span><span>${money(d.total_ht)}</span></div>
        ${Object.entries(byRate).map(([rate, v]) => `<div><span>TVA ${rate} %</span><span>${money(r2(v))}</span></div>`).join('')}
        <div class="grand"><span>Total TTC</span><span>${money(d.total_ttc)}</span></div>
        ${d.type === 'facture' && d.amount_paid > 0 && d.status === 'émise' ? `<div><span>Déjà réglé</span><span>${money(d.amount_paid)}</span></div><div><strong>Reste à payer</strong><strong>${money(remaining(d))}</strong></div>` : ''}</div>
      ${d.notes ? `<div class="notes">${esc(d.notes)}</div>` : ''}
      ${d.type === 'devis' ? `<div class="sign"><div>Bon pour accord, date et signature</div></div>` : ''}
      <div class="foot">${d.type === 'facture' && s.bank_info ? 'Règlement : ' + esc(s.bank_info) + '\n' : ''}${esc(s.doc_footer || '')}${s.legal_info ? '\n' + esc(s.legal_info) : ''}</div>
      <script>document.fonts.ready.then(() => setTimeout(() => window.print(), 150));</script>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) return toast("Autorisez l'ouverture des fenêtres pour imprimer.", true);
    w.document.open(); w.document.write(html); w.document.close();
  }

  /* ================= Paramètres ================= */
  function viewSettings() {
    const s = state.settings;
    const url = `${location.origin}/s/${state.me.store.slug}`;
    const f = (k, label, opts = {}) => `<label class="field ${opts.full ? 'full' : ''}"><span>${label}</span>${opts.area ? `<textarea name="${k}" rows="${opts.rows || 2}">${esc(s[k])}</textarea>` : `<input name="${k}" value="${esc(s[k])}" ${opts.type ? `type="${opts.type}"` : ''}>`}${opts.hint ? `<small>${opts.hint}</small>` : ''}</label>`;
    const chk = (k, label) => `<label class="check full"><input type="checkbox" data-flag="${k}" ${s[k] !== '0' ? 'checked' : ''}> ${label}</label>`;
    $('#view').innerHTML = `
      <form class="settings-form" id="sform">
        <section class="panel"><h2>Le commerce</h2><div class="fields">
          ${f('shop_name', 'Nom du commerce')}${f('phone', 'Téléphone')}
          ${f('email', 'E-mail')}${f('hours', "Horaires d'ouverture", { hint: 'Exemple : Lun–Sam 9h–19h' })}
          ${f('address', 'Adresse', { full: true })}
        </div></section>
        <section class="panel"><h2>Vitrine en ligne</h2>
          <div class="vitrine-link"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a><button type="button" class="btn btn-sm" id="copyUrl">Copier le lien</button></div>
          <div class="fields">
            ${f('tagline', "Texte d'accueil", { full: true, area: true, rows: 3 })}
            <label class="field"><span>Couleur de la vitrine</span><input type="color" name="accent" value="${esc(s.accent || '#1B1D22')}" class="color-input"></label>
            <div></div>
            ${chk('catalog_public', 'Vitrine visible publiquement')}
            ${chk('show_prices', 'Afficher les prix')}
            ${chk('show_stock', 'Afficher la disponibilité (en stock, stock limité…)')}
          </div>
        </section>
        <section class="panel"><h2>Commandes WhatsApp</h2><div class="fields">
          ${f('whatsapp', 'Numéro WhatsApp du commerce', { type: 'tel', hint: 'Le format local suffit, par exemple 06 12 34 56 78 : l’indicatif de votre pays est ajouté automatiquement.' })}
          <div></div>
          ${chk('whatsapp_orders', 'Permettre aux clients de composer un panier sur la vitrine et de vous l’envoyer sur WhatsApp')}
        </div></section>
        <section class="panel"><h2>Programme de fidélité</h2><div class="fields">
          <label class="check full"><input type="checkbox" data-flag="loyalty_enabled" ${s.loyalty_enabled === '1' ? 'checked' : ''}> Activer le programme de fidélité (points gagnés en caisse par les clients enregistrés)</label>
          ${f('loyalty_earn', `Montant dépensé pour gagner 1 point (${esc(cur())})`, { type: 'number' })}
          ${f('loyalty_threshold', 'Points nécessaires pour une récompense', { type: 'number' })}
          ${f('loyalty_reward', `Valeur de la récompense (${esc(cur())})`, { type: 'number' })}
          <p class="full muted" id="loyaltyPreview" style="margin:0"></p>
        </div></section>
        <section class="panel"><h2>Facturation</h2><div class="fields">
          ${f('currency', 'Devise', { hint: 'Exemples : €, DH, DA, DT, FCFA, CHF, $' })}${f('tva_default', 'TVA par défaut (%)', { type: 'number' })}
          ${f('invoice_due_days', 'Délai de paiement des factures (jours)', { type: 'number' })}
          ${f('bank_info', 'Coordonnées bancaires', { hint: 'Imprimées sur les factures.' })}
          ${f('legal_info', 'Mentions légales', { full: true, area: true, hint: 'SIRET, n° de TVA, RC, ICE, NIF… imprimés en bas des documents.' })}
          ${f('doc_footer', 'Message en bas des documents', { full: true })}
        </div></section>
        <section class="panel"><h2>Alertes</h2><div class="fields">
          ${f('alert_email', 'E-mail qui reçoit les alertes', { type: 'email' })}
          ${f('due_soon_days', 'Prévenir avant échéance (jours)', { type: 'number' })}
          <label class="check full"><input type="checkbox" id="alertDigest" ${s.alert_digest === '1' ? 'checked' : ''}> Recevoir chaque matin un récapitulatif par e-mail (uniquement s'il y a des alertes)</label>
          <p class="full muted" id="mailStatus" style="margin:0"></p>
          <div class="full"><button type="button" class="btn" id="testMail">Envoyer un e-mail de test</button></div>
        </div></section>
        <button class="btn btn-primary" type="submit">Enregistrer les paramètres</button>
      </form>`;
    $('#copyUrl').addEventListener('click', async () => { try { await navigator.clipboard.writeText(url); toast('Lien copié'); } catch { toast(url); } });
    const preview = () => {
      const fm = $('#sform'); const e1 = Number(fm.loyalty_earn.value) || 0, th = Number(fm.loyalty_threshold.value) || 0, rw = Number(fm.loyalty_reward.value) || 0;
      $('#loyaltyPreview').textContent = e1 && th ? `Un client gagne 1 point tous les ${e1} ${cur()} : après ${new Intl.NumberFormat('fr-FR').format(e1 * th)} ${cur()} d’achats, il reçoit ${rw} ${cur()} de réduction, soit ${String(Math.round((rw / (e1 * th)) * 1000) / 10).replace('.', ',')} % reversés.` : '';
    };
    $('#sform').addEventListener('input', preview); preview();
    api('/store/alerts/email-status').then((r) => {
      $('#mailStatus').textContent = r.configured ? '' : "L'envoi d'e-mails n'est pas encore activé sur la plateforme : vos alertes restent visibles dans le menu Alertes.";
      $('#testMail').hidden = !r.configured;
    }).catch(() => {});
    const collect = () => {
      const d = Object.fromEntries(new FormData($('#sform')));
      d.alert_digest = $('#alertDigest').checked ? '1' : '0';
      $$('[data-flag]').forEach((c) => { d[c.dataset.flag] = c.checked ? '1' : '0'; });
      return d;
    };
    $('#testMail').addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try {
        state.settings = await api('/store/settings', { method: 'PUT', body: collect() });
        const r = await api('/store/alerts/test-email', { method: 'POST', body: {} });
        toast(`E-mail envoyé à ${r.to}`);
      } catch (ex) { fail(ex); } finally { b.disabled = false; }
    });
    $('#sform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.submitter; btn.disabled = true;
      try { state.settings = await api('/store/settings', { method: 'PUT', body: collect() }); renderShell(); toast('Paramètres enregistrés'); updateBadges(); }
      catch (ex) { fail(ex); } finally { btn.disabled = false; }
    });
  }

  /* ================= Équipe ================= */
  /* ================= Importer ses produits depuis un ancien logiciel ================= */
  const TOOLS = [
    ['loyverse', 'Loyverse', 'Back Office, <strong>Articles</strong>, liste des articles, bouton <strong>Exporter</strong> : un fichier CSV est téléchargé.'],
    ['square', 'Square', 'Tableau de bord, <strong>Articles</strong>, <strong>Bibliothèque d’articles</strong>, <strong>Actions</strong>, <strong>Exporter la bibliothèque</strong>.'],
    ['shopify', 'Shopify', 'Administration, <strong>Produits</strong>, <strong>Exporter</strong>, « Tous les produits », format <strong>CSV</strong>.'],
    ['woocommerce', 'WooCommerce', 'WordPress, <strong>Produits</strong>, <strong>Exporter</strong>, puis <strong>Générer le CSV</strong>.'],
    ['odoo', 'Odoo', '<strong>Inventaire</strong>, <strong>Produits</strong>, vue liste : cochez tous les produits, <strong>Action</strong>, <strong>Exporter</strong> (nom, référence interne, code-barres, prix de vente, coût, catégorie, quantité en stock).'],
    ['ebp', 'EBP', 'Depuis la liste des <strong>Articles</strong>, utilisez l’export de la liste au format <strong>Excel</strong> ou l’<strong>export CSV</strong> des articles.'],
    ['stockexpress', 'Stock Express', 'Dans Stock Express (ou Stock Standard), ouvrez la liste des <strong>Produits</strong> et utilisez l’<strong>export des produits vers CSV</strong>. Si vos produits sont répartis dans plusieurs dépôts, gardez une colonne de quantité par dépôt : vous pourrez associer chacune à une boutique Comptoir.'],
    ['sage', 'Sage', 'Depuis la liste des <strong>Articles</strong>, exportez la liste vers <strong>Excel</strong>, ou utilisez un export au format paramétrable (CSV).'],
    ['base', 'Fichier de base de données', 'Si votre logiciel n’a pas d’export, déposez directement sa <strong>base de données</strong> : <strong>SQLite</strong> (.db, .sqlite), <strong>Access</strong> (.mdb, .accdb), <strong>dBase</strong> (.dbf) ou une <strong>sauvegarde .zip</strong> qui en contient une. Fermez d’abord le logiciel, puis copiez le fichier. La base est lue sur votre appareil : seuls les produits sont envoyés à Comptoir.'],
    ['autre', 'Excel ou autre', 'Tout logiciel qui exporte un tableau convient : <strong>CSV</strong> ou <strong>Excel (.xlsx)</strong>. Vous pouvez aussi remplir notre modèle.'],
  ];
  const imp = { tool: null, file: null, sheet: null, source: null, map: null, stockMap: {}, onExisting: 'update', setStock: true, delExamples: true, photos: true, forced: null };
  // Connexion directe : champs demandés et marche à suivre pour obtenir la clé (lecture seule).
  const DIRECT = {
    loyverse: { label: 'Loyverse', fields: [['token', 'Jeton d’accès', 'password']],
      how: 'Dans le Back Office Loyverse, ouvrez <strong>Intégrations</strong>, puis <strong>Jetons d’accès</strong>, et créez un jeton. Collez-le ici.' },
    square: { label: 'Square', fields: [['token', 'Jeton d’accès de production', 'password']],
      how: 'Sur <strong>developer.squareup.com</strong>, connectez-vous avec votre compte Square, créez une application (gratuit), puis copiez le <strong>jeton d’accès de production</strong> dans l’onglet Credentials.' },
    shopify: { label: 'Shopify', fields: [['shop', 'Adresse de la boutique (….myshopify.com)', 'text'], ['token', 'Jeton d’accès (shpat_…), si vous en avez un', 'password'], ['client_id', 'Ou identifiant client', 'text'], ['client_secret', 'et secret client', 'password']],
      how: 'Créez une application pour votre boutique depuis l’administration Shopify (<strong>Paramètres, Applications, Développer des applications</strong>, ou le <strong>Dev Dashboard</strong>) avec l’autorisation <strong>read_products</strong>, et installez-la. Collez ensuite son jeton d’accès (shpat_…) ou son identifiant et son secret client.' },
    woocommerce: { label: 'WooCommerce', fields: [['site', 'Adresse du site', 'text'], ['key', 'Clé client (ck_…)', 'text'], ['secret', 'Secret client (cs_…)', 'password']],
      how: 'Dans WordPress : <strong>WooCommerce, Réglages, Avancé, API REST</strong>, puis <strong>Ajouter une clé</strong> avec le droit <strong>Lecture</strong>.' },
    odoo: { label: 'Odoo', fields: [['site', 'Adresse d’Odoo', 'text'], ['db', 'Base de données', 'text'], ['login', 'Identifiant (e-mail)', 'text'], ['key', 'Clé d’API', 'password']],
      how: 'Dans Odoo, ouvrez <strong>votre profil</strong>, onglet <strong>Sécurité du compte</strong>, puis <strong>Nouvelle clé d’API</strong>. Pour un Odoo en ligne (….odoo.com), la base porte en général le nom de l’adresse.' },
  };
  function directForm(provider, values = {}) {
    const d = DIRECT[provider];
    return `<div class="cn-form" data-provider="${provider}"><p class="cn-how">${d.how}</p>
      <div class="imp-map">${d.fields.map(([k, l, t]) => `<label><span>${l}</span><input name="${k}" type="${t}" autocomplete="off" spellcheck="false" value="${esc(values[k] || '')}"></label>`).join('')}</div>
      <div class="cn-actions"><button type="button" class="btn btn-primary" id="cnFetch">Récupérer mes produits depuis ${d.label}</button><span class="muted" id="cnProgress"></span></div>
      <p class="muted cn-note">Lecture seule : la clé sert uniquement pendant la récupération et n’est jamais enregistrée par Comptoir. Vous pourrez la supprimer dans ${d.label} une fois l’import terminé.</p></div>`;
  }
  const IMP_FIELDS = [
    ['name', 'Nom du produit', true], ['variant', 'Variante (taille, couleur…)'], ['ref', 'Référence'], ['barcode', 'Code-barres'], ['category', 'Catégorie'],
    ['price', 'Prix de vente', true], ['purchase', 'Prix d’achat'], ['tva', 'TVA (%)'], ['stock_min', 'Seuil d’alerte'], ['unit', 'Unité'], ['description', 'Description'],
  ];
  async function loadImporter() {
    if (window.ComptoirImport) return;
    await new Promise((ok, ko) => { const sc = document.createElement('script'); sc.src = '/app/import.js'; sc.onload = ok; sc.onerror = () => ko(new Error('Chargement impossible.')); document.head.append(sc); });
  }
  async function viewImport() {
    await loadImporter();
    const CI = window.ComptoirImport;
    setActions(`<a class="btn" id="impTemplate" href="#" download="modele-import-comptoir.csv">Télécharger le modèle</a>`);
    $('#impTemplate').href = URL.createObjectURL(new Blob([CI.TEMPLATE], { type: 'text/csv;charset=utf-8' }));
    if (!imp.sheet) {
      if (!imp.tool && state.settings.previous_tool && TOOLS.some((t) => t[0] === state.settings.previous_tool)) imp.tool = state.settings.previous_tool;
      $('#view').innerHTML = `
        <section class="panel imp-step cn-panel"><div class="panel-head"><h2>Connexion directe</h2><span class="muted">sans export, pour les outils en ligne</span></div>
          <div class="cn-detect"><input id="cnInput" type="text" autocomplete="off" spellcheck="false" placeholder="Adresse de votre boutique en ligne, ou clé d’accès de votre logiciel"><button type="button" class="btn" id="cnDetect">Détecter mon outil</button></div>
          <p class="muted cn-sub">Loyverse, Square, Shopify, WooCommerce et Odoo : Comptoir récupère directement vos produits, variantes, stock et photos.</p>
          <div id="cnBox">${imp.tool && DIRECT[imp.tool] ? directForm(imp.tool) : ''}</div>
          <p class="form-error" id="cnErr"></p></section>
        <p class="muted imp-intro">Récupérez vos produits depuis votre ancien logiciel en quelques minutes : nom, références, codes-barres, catégories, prix et stock. Rien n’est enregistré avant votre confirmation.</p>
        <section class="panel imp-step"><div class="panel-head"><h2>1. Votre ancien logiciel</h2><span class="muted">pour savoir comment exporter</span></div>
          <div class="imp-tools">${TOOLS.map(([k, l]) => `<button type="button" class="chip" data-tool="${k}" aria-pressed="${imp.tool === k}">${l}</button>`).join('')}</div>
          <p class="imp-how" id="impHow">${imp.tool ? TOOLS.find((t) => t[0] === imp.tool)[2] : 'Choisissez votre logiciel pour voir comment exporter vos produits.'}</p></section>
        <section class="panel imp-step"><div class="panel-head"><h2>2. Votre fichier</h2><span class="muted">CSV ou Excel (.xlsx)</span></div>
          <label class="imp-drop" id="impDrop"><input type="file" id="impFile" hidden>
            <strong>Déposez le fichier ici</strong><span>Export CSV ou Excel, ou fichier de base de données de votre logiciel (SQLite, Access, dBase, .stockdb, sauvegarde .zip…)</span></label>
          <p class="form-error" id="impErr"></p></section>`;
      $$('[data-tool]').forEach((b) => b.addEventListener('click', () => {
        imp.tool = b.dataset.tool; $$('[data-tool]').forEach((x) => x.setAttribute('aria-pressed', x === b)); $('#impHow').innerHTML = TOOLS.find((t) => t[0] === imp.tool)[2];
        $('#cnBox').innerHTML = DIRECT[imp.tool] ? directForm(imp.tool) : ''; bindDirect();
      }));
      // Détection : la clé ou l'adresse collée révèle l'outil.
      $('#cnDetect').addEventListener('click', async () => {
        $('#cnErr').textContent = ''; const btn = $('#cnDetect'); btn.disabled = true;
        try {
          const d = await api('/store/connect/detect', { method: 'POST', body: { input: $('#cnInput').value } });
          imp.tool = d.provider; $$('[data-tool]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.tool === d.provider));
          $('#impHow').innerHTML = TOOLS.find((t) => t[0] === d.provider)?.[2] || '';
          $('#cnBox').innerHTML = `<p class="cn-found">Outil reconnu : <strong>${esc(d.label)}</strong>${d.from === 'key' ? ' (d’après la clé)' : ' (d’après le site)'}</p>` + directForm(d.provider, d.values); bindDirect();
        } catch (e) { $('#cnErr').textContent = e.message; }
        btn.disabled = false;
      });
      $('#cnInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#cnDetect').click(); });
      function bindDirect() {
        $('#cnFetch')?.addEventListener('click', async () => {
          const box = $('.cn-form'); const provider = box.dataset.provider;
          const credentials = Object.fromEntries($$('input', box).map((i) => [i.name, i.value.trim()]).filter(([, v]) => v));
          $('#cnErr').textContent = ''; const btn = $('#cnFetch'); btn.disabled = true;
          let next = null, headers = null, rows = [], page = 0, meta = null;
          try {
            do {
              const r = await api('/store/connect/fetch', { method: 'POST', body: { provider, credentials, next } });
              meta = r; headers = headers || r.headers; rows = rows.concat(r.rows); next = r.next; page++;
              $('#cnProgress').textContent = `${rows.length} produit${rows.length > 1 ? 's' : ''} récupéré${rows.length > 1 ? 's' : ''}…`;
            } while (next && page < 400);
            if (!rows.length) throw new Error(`Aucun produit trouvé dans ${DIRECT[provider].label}.`);
            imp.sheet = { headers, rows }; imp.db = null; imp.file = `${meta.label} (connexion directe)`;
            imp.forced = { key: provider, label: `${meta.label}, connexion directe`, prices: meta.prices };
            prepareImport(); route();
          } catch (e) { $('#cnErr').textContent = e.message; btn.disabled = false; $('#cnProgress').textContent = ''; }
        });
      }
      bindDirect();
      const take = async (file) => {
        if (!file) return;
        $('#impErr').textContent = ''; $('#impDrop').classList.add('busy');
        try {
          if (file.size > 300 * 1024 * 1024) throw new Error('Fichier trop lourd (300 Mo au plus).');
          $('#impDrop strong').textContent = 'Lecture du fichier…';
          imp.sheet = await CI.readFile(file); imp.file = file.name; imp.forced = null; imp.fileObj = file; imp.encodingForced = null;
          imp.db = imp.sheet.db || null; imp.table = imp.db ? imp.db.tables[0].name : null;
          if (!imp.sheet.rows.length) throw new Error(imp.db ? 'Aucune table de produits remplie n’a été trouvée dans cette base.' : 'Le fichier ne contient aucune ligne de produit.');
          prepareImport();
          route();
        } catch (e) { imp.sheet = null; $('#impErr').innerHTML = esc(e.message) + (e.detail ? `<small class="imp-sig">${esc(e.detail)}<br>Si le problème persiste, transmettez cette signature au support Comptoir pour faire ajouter ce format.</small>` : ''); $('#impDrop strong').textContent = 'Déposez le fichier ici'; }
        $('#impDrop')?.classList.remove('busy');
      };
      $('#impFile').addEventListener('change', (e) => take(e.target.files[0]));
      const dz = $('#impDrop');
      ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
      dz.addEventListener('drop', (e) => take(e.dataTransfer.files[0]));
      return;
    }
    renderImportReview();
  }
  // Logiciel d'origine, correspondance des colonnes et colonnes de stock par boutique.
  function prepareImport() {
    const CI = window.ComptoirImport;
    imp.source = imp.forced || CI.detect(imp.sheet.headers);
    if (imp.db) imp.source = { key: 'base', label: `base ${imp.db.label}`, prices: imp.source.key === 'autre' ? 'ttc' : imp.source.prices };
    imp.map = CI.autoMap(imp.sheet.headers, imp.source);
    const locs = state.me.locations || [];
    imp.stockMap = {};
    locs.forEach((l, i) => {
      const byName = imp.map.stocks.find((c) => CI.norm(imp.sheet.headers[c]).includes(CI.norm(l.name)));
      imp.stockMap[l.id] = byName ?? (locs.length === 1 || l.id === (state.scope === 'all' ? locs[0].id : state.scope) ? imp.map.stocks[i] ?? imp.map.stocks[0] ?? -1 : imp.map.stocks[i] ?? -1);
    });
  }
  function impProducts() {
    const stockMap = imp.setStock && can('stock.manage') ? imp.stockMap : {};
    return window.ComptoirImport.toProducts(imp.sheet, imp.map, { stockMap, tvaDefault: Number(state.settings.tva_default) || 20 });
  }
  function renderImportReview() {
    const CI = window.ComptoirImport; const H = imp.sheet.headers; const m = imp.map;
    const sample = (i) => { const v = imp.sheet.rows.find((r) => String(r[i] ?? '').trim())?.[i]; return v ? ` (ex. ${String(v).slice(0, 24)})` : ''; };
    const colSelect = (field, value) => `<select data-mapf="${field}"><option value="-1">Ne pas importer</option>${H.map((h, i) => `<option value="${i}" ${i === value ? 'selected' : ''}>${esc(h || 'Colonne ' + (i + 1))}${esc(sample(i))}</option>`).join('')}</select>`;
    const items = impProducts();
    const byBarcode = new Map(), byRef = new Map(), byName = new Map();
    state.products.forEach((p) => { if (p.barcode) byBarcode.set(p.barcode, p); if (p.ref) byRef.set(CI.norm(p.ref), p); byName.set(CI.norm(p.name), p); });
    let created = 0, updated = 0; const errors = [];
    const rows = items.map((it) => {
      const exists = (it.barcode && byBarcode.get(it.barcode)) || (it.ref && byRef.get(CI.norm(it.ref))) || byName.get(CI.norm(it.name));
      const st = !it.name ? 'err' : exists ? 'upd' : 'new';
      if (st === 'err') errors.push(it); else if (st === 'upd') updated++; else created++;
      return { ...it, st };
    });
    const locs = state.me.locations || [];
    const examples = state.products.filter((p) => /^EX-\d{3}$/.test(p.ref || '')).length;
    const stockOk = can('stock.manage');
    const label = { new: '<span class="badge s-ok">nouveau</span>', upd: '<span class="badge s-info">mise à jour</span>', err: '<span class="badge s-bad">erreur</span>' };
    $('#view').innerHTML = `
      <section class="imp-file"><div><strong>${esc(imp.file)}</strong><span>Reconnu : <b>${esc(imp.source.label)}</b> · ${imp.sheet.rows.length} ligne${imp.sheet.rows.length > 1 ? 's' : ''}${imp.db ? ` · table « ${esc(imp.table)} »` : ''}</span></div><button class="btn btn-sm" id="impReset">Changer de fichier</button></section>
      ${imp.sheet.encoding && imp.fileObj ? `<section class="panel imp-enc"><div class="panel-head"><h2>Caractères</h2><span class="muted">des lettres bizarres (Ã©, Ø§…) ? changez l’encodage</span></div>
        <div class="imp-map"><label><span>Encodage du fichier</span><select id="impEnc"><option value="">Automatique (${esc(CI.ENCODINGS[imp.sheet.encoding] || imp.sheet.encoding)})</option>${Object.entries(CI.ENCODINGS).map(([k, l]) => `<option value="${k}" ${imp.encodingForced === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label></div></section>` : ''}
      ${imp.db ? `<section class="panel"><div class="panel-head"><h2>Table des produits</h2><span class="muted">base ${esc(imp.db.label)}, ${imp.db.tables.length} table${imp.db.tables.length > 1 ? 's' : ''}</span></div>
        <div class="imp-map"><label><span>Table lue</span><select id="impTable">${imp.db.tables.map((t) => `<option value="${esc(t.name)}" ${t.name === imp.table ? 'selected' : ''}>${esc(t.name)} (${t.count} ligne${t.count > 1 ? 's' : ''})</option>`).join('')}</select></label>
        <p class="muted" style="grid-column:span 2;margin:0;align-self:end">Comptoir a choisi la table qui ressemble le plus à un catalogue de produits. Les familles, marques et unités rangées dans d’autres tables sont reprises par leur nom, et le stock par dépôt est ajouté.</p></div></section>` : ''}
      <section class="panel"><div class="panel-head"><h2>Correspondance des colonnes</h2><span class="muted">vérifiez, corrigez si besoin</span></div>
        <div class="imp-map">${IMP_FIELDS.map(([f, l, req]) => `<label><span>${l}${req ? ' <em>*</em>' : ''}</span>${colSelect(f, m[f])}</label>`).join('')}
          <div class="imp-mode"><span>Les prix du fichier sont</span><label class="check"><input type="radio" name="impMode" value="ttc" ${m.price_mode === 'ttc' ? 'checked' : ''}> TTC (taxes comprises)</label><label class="check"><input type="radio" name="impMode" value="ht" ${m.price_mode === 'ht' ? 'checked' : ''}> HT (hors taxes)</label></div>
        </div></section>
      ${stockOk ? `<section class="panel"><div class="panel-head"><h2>Stock</h2><label class="check"><input type="checkbox" id="impSetStock" ${imp.setStock ? 'checked' : ''}> Importer les quantités</label></div>
        <div class="imp-map">${locs.map((l) => `<label><span>${locs.length > 1 ? 'Stock de ' + esc(l.name) : 'Quantité en stock'}</span><select data-stockloc="${l.id}" ${imp.setStock ? '' : 'disabled'}><option value="-1">Ne pas importer</option>${H.map((h, i) => `<option value="${i}" ${i === imp.stockMap[l.id] ? 'selected' : ''}>${esc(h)}${esc(sample(i))}</option>`).join('')}</select></label>`).join('')}</div></section>` : '<p class="notice">Votre rôle ne permet pas de modifier le stock : les quantités du fichier ne seront pas importées.</p>'}
      <section class="panel"><div class="panel-head"><h2>Options</h2></div><div class="imp-opts">
        <label class="check"><input type="radio" name="impExist" value="update" ${imp.onExisting === 'update' ? 'checked' : ''}> Mettre à jour les produits que j’ai déjà (même code-barres, référence ou nom)</label>
        <label class="check"><input type="radio" name="impExist" value="skip" ${imp.onExisting === 'skip' ? 'checked' : ''}> Ne pas toucher aux produits que j’ai déjà</label>
        ${examples ? `<label class="check"><input type="checkbox" id="impDelEx" ${imp.delExamples ? 'checked' : ''}> Retirer les ${examples} produits d’exemple (EX-…) jamais vendus</label>` : ''}
        ${rows.some((r) => r.photo) ? `<label class="check"><input type="checkbox" id="impPhotos" ${imp.photos ? 'checked' : ''}> Importer aussi les photos (${rows.filter((r) => r.photo).length}) : elles sont téléchargées et enregistrées dans Comptoir</label>` : ''}
      </div></section>
      <section class="panel"><div class="panel-head"><h2>Aperçu</h2><div class="imp-sum"><span class="badge s-ok">${created} à créer</span><span class="badge s-info">${updated} à mettre à jour</span>${errors.length ? `<span class="badge s-bad">${errors.length} en erreur</span>` : ''}</div></div>
        <div class="table-wrap"><table><thead><tr><th>Ligne</th><th></th><th>Produit</th><th>Référence</th><th>Code-barres</th><th>Catégorie</th><th class="num">Prix TTC</th>${stockOk && imp.setStock ? '<th class="num">Stock</th>' : ''}<th>Remarque</th></tr></thead><tbody>
          ${rows.slice(0, 40).map((r) => `<tr><td class="muted">${r.line}</td><td>${label[r.st]}</td><td class="cell-main">${esc(r.name || '—')}</td><td>${esc(r.ref)}</td><td class="mono">${esc(r.barcode)}</td><td>${esc(r.category)}</td>
            <td class="num">${r.price_ttc === null ? '<span class="muted">—</span>' : money(r.price_ttc)}</td>${stockOk && imp.setStock ? `<td class="num">${Object.values(r.stocks).length ? qtyFmt(Object.values(r.stocks).reduce((a, b) => a + b, 0)) : '<span class="muted">—</span>'}</td>` : ''}
            <td class="muted">${esc(r.warn.join(', '))}</td></tr>`).join('')}
        </tbody></table></div>
        ${rows.length > 40 ? `<p class="muted imp-more">… et ${rows.length - 40} autres lignes.</p>` : ''}
      </section>
      <div class="imp-go"><p class="form-error" id="impErr"></p><button class="btn btn-primary btn-lg" id="impGo" ${created + updated ? '' : 'disabled'}>Importer ${created + updated} produit${created + updated > 1 ? 's' : ''}</button></div>`;
    $('#impReset').addEventListener('click', () => { imp.sheet = null; imp.db = null; imp.fileObj = null; route(); });
    $('#impEnc')?.addEventListener('change', async (e) => {
      try {
        imp.encodingForced = e.target.value || null;
        const s = await CI.readFile(imp.fileObj, { encoding: imp.encodingForced || undefined });
        imp.sheet = s; imp.db = s.db || null; if (imp.db && !imp.db.tables.some((t) => t.name === imp.table)) imp.table = imp.db.tables[0].name;
        if (imp.db && imp.table !== imp.db.tables[0].name) imp.sheet = { db: imp.db, encoding: s.encoding, ...(await imp.db.sheet(imp.table)) };
        prepareImport(); renderImportReview();
      } catch (ex) { fail(ex); }
    });
    $('#impTable')?.addEventListener('change', async (e) => {
      try { imp.table = e.target.value; imp.sheet = { db: imp.db, encoding: imp.db.encoding || null, ...(await imp.db.sheet(imp.table)) }; prepareImport(); renderImportReview(); } catch (ex) { fail(ex); }
    });
    $$('[data-mapf]').forEach((s) => s.addEventListener('change', () => { m[s.dataset.mapf] = Number(s.value); renderImportReview(); }));
    $$('input[name="impMode"]').forEach((r) => r.addEventListener('change', () => { m.price_mode = r.value; renderImportReview(); }));
    $$('[data-stockloc]').forEach((s) => s.addEventListener('change', () => { imp.stockMap[s.dataset.stockloc] = Number(s.value); renderImportReview(); }));
    $('#impSetStock')?.addEventListener('change', (e) => { imp.setStock = e.target.checked; renderImportReview(); });
    $$('input[name="impExist"]').forEach((r) => r.addEventListener('change', () => { imp.onExisting = r.value; }));
    $('#impDelEx')?.addEventListener('change', (e) => { imp.delExamples = e.target.checked; });
    $('#impPhotos')?.addEventListener('change', (e) => { imp.photos = e.target.checked; });
    $('#impGo').addEventListener('click', () => runImport(rows.filter((r) => r.st !== 'err')));
  }
  async function runImport(list) {
    const total = list.length, size = 200;
    const res = { created: 0, updated: 0, skipped: 0, categories_created: 0, errors: [] };
    $('#view').innerHTML = `<section class="panel imp-progress"><h2>Import en cours…</h2><div class="imp-bar"><span id="impBar"></span></div><p class="muted" id="impTxt">0 sur ${total}</p><p class="muted">Gardez cette page ouverte jusqu’à la fin.</p></section>`;
    try {
      for (let i = 0; i < total; i += size) {
        const rows = list.slice(i, i + size).map(({ st, warn, price_ttc, photo, ...r }) => r);
        const r = await api('/store/import/products', { method: 'POST', body: { source: imp.source.label, rows, options: { on_existing: imp.onExisting, set_stock: imp.setStock && can('stock.manage'), delete_examples: imp.delExamples && i === 0 } } });
        for (const k of ['created', 'updated', 'skipped', 'categories_created']) res[k] += r[k];
        res.errors.push(...r.errors);
        const done = Math.min(total, i + size);
        $('#impBar').style.width = `${Math.round((done / total) * 100)}%`; $('#impTxt').textContent = `${done} sur ${total}`;
      }
    } catch (e) { res.errors.push({ line: null, message: e.message }); }
    // Photos : téléchargées par le serveur, par petits lots.
    const withPhoto = imp.photos ? list.filter((r) => r.photo) : [];
    res.photos = 0;
    if (withPhoto.length && res.created + res.updated) {
      $('#view .imp-progress h2').textContent = 'Récupération des photos…';
      for (let i = 0; i < withPhoto.length; i += 10) {
        try {
          const r = await api('/store/import/images', { method: 'POST', body: { items: withPhoto.slice(i, i + 10).map((x) => ({ name: x.name, ref: x.ref, barcode: x.barcode, url: x.photo })) } });
          res.photos += r.saved; if (r.errors.length) res.errors.push(...r.errors.slice(0, 3).map((m) => ({ line: null, message: `Photo : ${m}` })));
        } catch (e) { res.errors.push({ line: null, message: `Photos : ${e.message}` }); break; }
        const done = Math.min(withPhoto.length, i + 10);
        $('#impBar').style.width = `${Math.round((done / withPhoto.length) * 100)}%`; $('#impTxt').textContent = `${done} photo${done > 1 ? 's' : ''} sur ${withPhoto.length}`;
      }
    }
    await refresh('products', 'categories').catch(() => {});
    imp.sheet = null; imp.db = null; imp.forced = null;
    $('#view').innerHTML = `<section class="panel imp-done">
        <h2>${res.errors.length ? 'Import terminé, avec des remarques' : 'Import terminé'}</h2>
        <div class="imp-sum big"><span class="badge s-ok">${res.created} produit${res.created > 1 ? 's' : ''} créé${res.created > 1 ? 's' : ''}</span><span class="badge s-info">${res.updated} mis à jour</span>${res.categories_created ? `<span class="badge s-neutral">${res.categories_created} catégorie${res.categories_created > 1 ? 's' : ''} créée${res.categories_created > 1 ? 's' : ''}</span>` : ''}${res.skipped ? `<span class="badge s-neutral">${res.skipped} ignoré${res.skipped > 1 ? 's' : ''}</span>` : ''}${res.photos ? `<span class="badge s-ok">${res.photos} photo${res.photos > 1 ? 's' : ''}</span>` : ''}</div>
        ${res.errors.length ? `<ul class="imp-errors">${res.errors.slice(0, 50).map((x) => `<li>${x.line ? `Ligne ${x.line} : ` : ''}${esc(x.message)}</li>`).join('')}</ul>` : '<p class="muted">Vos produits sont prêts à être vendus en caisse et affichés sur votre vitrine.</p>'}
        <div class="imp-actions"><a class="btn btn-primary" href="#/produits">Voir mes produits</a><button class="btn" id="impAgain" type="button">Importer un autre fichier</button></div>
      </section>`;
    $('#impAgain').addEventListener('click', () => { imp.sheet = null; route(); });
  }

  /* ================= Notifications push (même application fermée) ================= */
  const push = {
    supported: () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    iosNeedsInstall: () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !(matchMedia('(display-mode: standalone)').matches || navigator.standalone),
    async registration() { return (await navigator.serviceWorker.getRegistration('/app/')) || navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }); },
    async current() { if (!push.supported()) return null; const r = await push.registration(); await navigator.serviceWorker.ready; return r.pushManager.getSubscription(); },
    key: (b64) => { const raw = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); },
  };
  async function enablePush() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Les notifications sont bloquées pour Comptoir dans ce navigateur : autorisez-les dans ses réglages, puis réessayez.' : 'Autorisation non accordée.');
    const { publicKey } = await api('/store/push/key');
    const reg = await push.registration(); await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: push.key(publicKey) });
    await api('/store/push/subscriptions', { method: 'POST', body: { subscription: sub.toJSON() } });
    return sub;
  }
  async function viewNotifications() {
    const info = await api('/store/push/key');
    const devices = await api('/store/push/subscriptions');
    const sub = await push.current().catch(() => null);
    const mine = sub && devices.find((d) => d.endpoint === sub.endpoint);
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    let state;
    if (!push.supported()) state = push.iosNeedsInstall()
      ? '<p class="notice">Sur iPhone et iPad, les notifications fonctionnent quand Comptoir est <strong>installé sur l’écran d’accueil</strong> (iOS 16.4 ou plus récent) : touchez <strong>Partager</strong>, puis <strong>Sur l’écran d’accueil</strong>, et ouvrez Comptoir depuis son icône.</p>'
      : '<p class="notice">Ce navigateur ne permet pas les notifications. Utilisez Chrome, Edge, Firefox ou Safari récent.</p>';
    else if (perm === 'denied') state = '<p class="notice">Les notifications sont <strong>bloquées</strong> pour Comptoir dans ce navigateur. Autorisez-les dans ses réglages (icône à gauche de l’adresse, ou réglages du téléphone), puis revenez ici.</p>';
    else if (!mine) state = '<div class="push-off"><p>Recevez une alerte sur cet appareil dès qu’un produit passe sous son seuil, chaque matin pour les paiements à suivre, et pour la fin de votre essai, <strong>même quand Comptoir est fermé</strong>.</p><button class="btn btn-primary" id="pushOn" type="button">Activer les notifications sur cet appareil</button></div>';
    else state = `<div class="push-on"><span class="badge s-ok">Activées sur cet appareil</span>
        <div class="push-cats">${info.categories.map((c) => `<label class="check"><input type="checkbox" data-cat="${c.key}" ${mine.prefs[c.key] !== false ? 'checked' : ''}> <span><strong>${esc(c.label)}</strong><small>${esc(c.detail)}</small></span></label>`).join('')}</div>
        <div class="push-actions"><button class="btn" id="pushTest" type="button">Envoyer une notification d’essai</button><button class="btn btn-ghost" id="pushOff" type="button">Désactiver sur cet appareil</button></div></div>`;
    const others = devices.filter((d) => !sub || d.endpoint !== sub.endpoint);
    $('#view').innerHTML = `
      <section class="panel"><div class="panel-head"><h2>Cet appareil</h2><span class="muted">les alertes arrivent même application fermée</span></div><div class="push-body">${state}</div></section>
      ${others.length ? `<section class="panel"><div class="panel-head"><h2>Vos autres appareils</h2></div><div class="table-wrap"><table><tbody>
        ${others.map((d) => `<tr><td class="cell-main">${esc(d.label || 'Appareil')}</td><td class="muted">activé le ${new Date(d.created_at).toLocaleDateString('fr-FR')}</td><td class="num"><button class="btn btn-sm" data-unsub="${d.id}" type="button">Retirer</button></td></tr>`).join('')}
      </tbody></table></div></section>` : ''}`;
    $('#pushOn')?.addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await enablePush(); toast('Notifications activées sur cet appareil'); route(); } catch (ex) { fail(ex); b.disabled = false; }
    });
    $$('[data-cat]').forEach((c) => c.addEventListener('change', async () => {
      try { await api('/store/push/subscriptions', { method: 'PUT', body: { endpoint: sub.endpoint, prefs: { [c.dataset.cat]: c.checked } } }); toast('Préférence enregistrée'); } catch (ex) { fail(ex); c.checked = !c.checked; }
    }));
    $('#pushTest')?.addEventListener('click', async () => { try { await api('/store/push/test', { method: 'POST', body: { endpoint: sub.endpoint } }); toast('Notification envoyée : elle arrive dans quelques secondes'); } catch (ex) { fail(ex); } });
    $('#pushOff')?.addEventListener('click', async () => {
      try { await api('/store/push/subscriptions', { method: 'DELETE', body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); toast('Notifications désactivées sur cet appareil'); route(); } catch (ex) { fail(ex); }
    });
    $$('[data-unsub]').forEach((b) => b.addEventListener('click', async () => {
      try { await api('/store/push/subscriptions', { method: 'DELETE', body: { id: Number(b.dataset.unsub) } }); toast('Appareil retiré'); route(); } catch (ex) { fail(ex); }
    }));
  }

  /* ================= Rapports : comparer les boutiques ================= */
  const rep = { period: '30' };
  async function viewReports() {
    const PERIODS = [['7', '7 jours'], ['30', '30 jours'], ['month', 'Ce mois-ci'], ['prev_month', 'Mois dernier'], ['year', 'Cette année']];
    setActions(`<div class="chips">${PERIODS.map(([k, l]) => `<button class="chip" data-period="${k}" aria-pressed="${rep.period === k}">${l}</button>`).join('')}</div>`);
    $$('[data-period]').forEach((b) => b.addEventListener('click', () => { rep.period = b.dataset.period; route(); }));
    const r = await api(`/store/locations/report?period=${rep.period}`);
    const L = r.locations;
    const best = L[0];
    const pct = (v) => (v === null ? '<span class="muted">n/d</span>' : `<span class="${v >= 0 ? 'stock-ok' : 'stock-out'}">${v >= 0 ? '+' : ''}${String(v).replace('.', ',')} %</span>`);
    const maxRev = Math.max(...L.map((x) => x.revenue), 1);
    const monthLabels = (L[0]?.months || []).map((m) => new Date(m.month + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'short' }));
    const maxMonth = Math.max(1, ...L.flatMap((x) => x.months.map((m) => m.value)));
    const PALETTE = ['#17181C', '#E4572E', '#2D5F8A', '#2E7D4F', '#B7791F', '#7A4FB0'];
    // Une seule boutique (la plupart des commerces) : les chiffres du quotidien, sans comparaison inutile.
    if (L.length < 2) {
      const x = L[0] || { revenue: 0, sales: 0, average: 0, evolution: null, margin: 0, margin_rate: null, margin_coverage: 0, unpaid: 0, stock_value: 0, out_of_stock: 0, months: [], top: [] };
      const evo = x.evolution === null ? '<span class="muted">pas de période précédente à comparer</span>' : `${pct(x.evolution)} <span class="muted">par rapport à la période précédente</span>`;
      const maxM = Math.max(1, ...(x.months || []).map((m) => m.value));
      $('#view').innerHTML = `
        <div class="rep-kpis">
          <div class="rep-kpi main"><span>Chiffre d'affaires TTC</span><strong>${money(x.revenue)}</strong><small>${evo}</small></div>
          <div class="rep-kpi"><span>Ventes</span><strong>${x.sales}</strong><small>${esc(r.period.label)}</small></div>
          <div class="rep-kpi"><span>Panier moyen</span><strong>${money(x.average)}</strong><small>par vente</small></div>
          <div class="rep-kpi"><span>Marge brute</span><strong>${x.margin_coverage ? money(x.margin) : '—'}</strong><small>${x.margin_coverage ? `${x.margin_rate !== null ? String(x.margin_rate).replace('.', ',') + ' %' : ''}${x.margin_coverage < 100 ? ` · sur ${x.margin_coverage} % des ventes` : ''}` : 'renseignez les prix d’achat des produits'}</small></div>
        </div>
        <div class="dash-grid">
          <section class="panel">
            <div class="panel-head"><h2>6 derniers mois</h2><span class="muted">TTC</span></div>
            <div class="month-bars">${(x.months || []).map((m) => `<div class="mb-col"><div class="mb-stack"><span title="${money(m.value)}" style="height:${Math.round((m.value / maxM) * 100)}%;background:${PALETTE[1]}"></span></div><small>${new Date(m.month + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'short' })}</small></div>`).join('')}</div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Meilleures ventes</h2><span class="muted">${esc(r.period.label)}</span></div>
            ${x.top && x.top.length ? `<ol class="tops-single">${x.top.map((t) => `<li><span>${esc(t.label)}</span><strong>${money(t.amount)}</strong></li>`).join('')}</ol>` : '<div class="empty-state">Vos produits les plus vendus apparaîtront ici après vos premières ventes.</div>'}
          </section>
        </div>
        <div class="rep-kpis small">
          <div class="rep-kpi"><span>Valeur du stock</span><strong>${money(x.stock_value || 0)}</strong><small>${x.out_of_stock ? `<span class="stock-out">${x.out_of_stock} produit${x.out_of_stock > 1 ? 's' : ''} en rupture</span>` : 'au prix d’achat'}</small></div>
          <div class="rep-kpi"><span>Reste à encaisser</span><strong class="${x.unpaid ? 'stock-low' : ''}">${money(x.unpaid || 0)}</strong><small>factures non soldées</small></div>
        </div>
        <p class="muted report-note">La marge brute compare le prix de vente HT au prix d'achat des produits.${can('locations.manage') ? ' Plusieurs points de vente ? <a href="#/boutiques">Ajoutez vos boutiques</a> pour comparer leurs chiffres.' : ''}</p>`;
      return;
    }
    $('#view').innerHTML = `
      ${L.length < 2 ? `<div class="notice">Vous avez une seule boutique. ${can('locations.manage') ? '<a href="#/boutiques">Ajoutez vos autres points de vente</a> pour comparer leurs chiffres.' : ''}</div>` : ''}
      ${best && best.revenue > 0 && L.length > 1 ? `<section class="report-hero"><span class="muted">${esc(r.period.label)}</span><h2><strong>${esc(best.name)}</strong> réalise ${String(best.share).replace('.', ',')} % du chiffre d'affaires</h2><p>${money(best.revenue)} sur ${money(r.total)} au total, toutes boutiques confondues.</p></section>` : ''}
      <section class="panel">
        <div class="panel-head"><h2>Chiffre d'affaires par boutique</h2><span class="muted">${esc(r.period.label)}, TTC</span></div>
        <div class="rank">${L.map((x, i) => `
          <div class="rank-row">
            <span class="rank-n">${i + 1}</span>
            <div class="rank-main"><strong>${esc(x.name)}</strong>${x.active ? '' : ' <span class="badge s-neutral">fermée</span>'}<div class="rank-bar"><span style="width:${Math.max(x.revenue ? 2 : 0, (x.revenue / maxRev) * 100)}%;background:${PALETTE[i % PALETTE.length]}"></span></div></div>
            <div class="rank-val"><strong>${money(x.revenue)}</strong><span>${String(x.share).replace('.', ',')} % · ${pct(x.evolution)}</span></div>
          </div>`).join('')}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Comparaison détaillée</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Boutique</th><th class="num">Chiffre d'affaires</th><th class="num">Évolution</th><th class="num">Ventes</th><th class="num">Panier moyen</th><th class="num">Marge brute</th><th class="num">Impayés</th><th class="num">Valeur du stock</th></tr></thead><tbody>
          ${L.map((x) => `<tr><td class="cell-main">${esc(x.name)}</td><td class="num"><strong>${money(x.revenue)}</strong></td><td class="num">${pct(x.evolution)}</td><td class="num">${x.sales}</td><td class="num">${money(x.average)}</td>
            <td class="num">${x.margin_coverage ? `${money(x.margin)}<div class="cell-sub">${x.margin_rate !== null ? String(x.margin_rate).replace('.', ',') + ' %' : ''}${x.margin_coverage < 100 ? `, sur ${x.margin_coverage} % des ventes` : ''}</div>` : '<span class="muted" title="Renseignez le prix d’achat des produits">prix d’achat manquants</span>'}</td>
            <td class="num ${x.unpaid ? 'stock-low' : ''}">${money(x.unpaid)}</td><td class="num">${money(x.stock_value)}${x.out_of_stock ? `<div class="cell-sub stock-out">${x.out_of_stock} en rupture</div>` : ''}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="muted report-note">La marge brute compare le prix de vente HT au prix d'achat des produits. Renseignez les prix d'achat dans les fiches produits pour qu'elle couvre toutes vos ventes.</p>
      </section>
      <div class="dash-grid">
        <section class="panel">
          <div class="panel-head"><h2>6 derniers mois</h2><span class="muted">TTC</span></div>
          <div class="month-bars">${monthLabels.map((lab, mi) => `<div class="mb-col"><div class="mb-stack">${L.map((x, i) => `<span title="${esc(x.name)} : ${money(x.months[mi].value)}" style="height:${Math.round((x.months[mi].value / maxMonth) * 150)}px;background:${PALETTE[i % PALETTE.length]}"></span>`).join('')}</div><em>${lab}</em></div>`).join('')}</div>
          <div class="legend">${L.map((x, i) => `<span><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(x.name)}</span>`).join('')}</div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Meilleures ventes par boutique</h2></div>
          <div class="tops">${L.map((x) => `<div><h3>${esc(x.name)}</h3>${x.top.length ? `<ol>${x.top.map((t) => `<li><span>${esc(t.label)}</span><strong>${money(t.amount)}</strong></li>`).join('')}</ol>` : '<p class="muted">Aucune vente sur la période.</p>'}</div>`).join('')}</div>
        </section>
      </div>`;
  }

  /* ================= Boutiques (points de vente) ================= */
  async function viewLocations() {
    const d = await api('/store/locations');
    const full = d.limit !== null && d.active_count >= d.limit;
    setActions(`<button class="btn btn-primary" id="addLoc" ${full ? 'disabled' : ''}>Ajouter une boutique</button>`);
    $('#view').innerHTML = `
      <p class="muted" style="margin-top:0">${d.active_count} boutique${d.active_count > 1 ? 's' : ''} ouverte${d.active_count > 1 ? 's' : ''}${d.limit !== null ? ` sur ${d.limit} incluse${d.limit > 1 ? 's' : ''} dans votre formule` : ''}. Chaque boutique a son propre stock, ses ventes et son journal de caisse ; le stock se déplace avec les transferts.${full && can('billing.manage') ? ' <a href="#/abonnement">Passer à la formule supérieure</a> pour en ouvrir d’autres.' : ''}</p>
      <div class="loc-cards">${d.locations.map((l) => `
        <article class="loc-card ${l.active ? '' : 'closed'}">
          <div><h3>${esc(l.name)}</h3>${l.active ? '' : '<span class="badge s-neutral">fermée</span>'}</div>
          <p>${esc(l.address) || '<span class="muted">Adresse non renseignée</span>'}${l.phone ? `<br>${esc(l.phone)}` : ''}</p>
          <p class="muted">${l.restricted_members ? `${l.restricted_members} membre${l.restricted_members > 1 ? 's' : ''} rattaché${l.restricted_members > 1 ? 's' : ''} à cette boutique` : 'Accessible à toute l’équipe autorisée'}</p>
          <div class="loc-actions"><button class="btn btn-sm" data-editloc="${l.id}">Modifier</button>${l.active ? '' : `<button class="btn btn-sm" data-reopen="${l.id}">Rouvrir</button>`}</div>
        </article>`).join('')}</div>`;
    const form = (l = {}) => {
      const body = openModal(l.id ? `Modifier ${l.name}` : 'Nouvelle boutique', `
        <form id="locForm" class="fields" novalidate>
          <label class="field full"><span>Nom de la boutique</span><input name="name" value="${esc(l.name || '')}" required placeholder="Ex. : Centre-ville"></label>
          <label class="field full"><span>Adresse</span><input name="address" value="${esc(l.address || '')}"></label>
          <label class="field"><span>Téléphone</span><input name="phone" type="tel" value="${esc(l.phone || '')}"></label>
          ${l.id && l.active ? '<label class="check full"><input type="checkbox" name="close"> Fermer cette boutique <span class="muted">(son historique est conservé ; le stock doit être transféré avant)</span></label>' : ''}
          <p class="form-error full" id="locErr"></p>
        </form>
        <div class="modal-foot"><div class="right"><button class="btn" id="locCancel">Annuler</button><button class="btn btn-primary" id="locSave">${l.id ? 'Enregistrer' : 'Créer la boutique'}</button></div></div>`);
      $('#locCancel', body).addEventListener('click', closeModal);
      $('#locSave', body).addEventListener('click', async (e) => {
        const f = $('#locForm'); const data = Object.fromEntries(new FormData(f));
        const payload = { name: data.name, address: data.address, phone: data.phone, active: l.id ? !f.close?.checked && l.active !== 0 : true };
        e.currentTarget.disabled = true;
        try {
          await api(l.id ? `/store/locations/${l.id}` : '/store/locations', { method: l.id ? 'PUT' : 'POST', body: payload });
          state.me = await api('/auth/me', { fresh: true }); state.scope = state.me.scope; renderShell();
          closeModal(); toast(l.id ? 'Boutique mise à jour' : 'Boutique créée'); route();
        } catch (ex) { $('#locErr').textContent = ex.message; e.currentTarget.disabled = false; }
      });
    };
    $('#addLoc').addEventListener('click', () => form());
    $$('[data-editloc]').forEach((b) => b.addEventListener('click', () => form(d.locations.find((l) => l.id === Number(b.dataset.editloc)))));
    $$('[data-reopen]').forEach((b) => b.addEventListener('click', async () => {
      const l = d.locations.find((x) => x.id === Number(b.dataset.reopen));
      try { await api(`/store/locations/${l.id}`, { method: 'PUT', body: { ...l, active: true } }); state.me = await api('/auth/me', { fresh: true }); renderShell(); toast('Boutique rouverte'); route(); } catch (e) { fail(e); }
    }));
  }

  /* ================= Équipe et rôles ================= */
  async function viewTeam() {
    const [team, rr] = await Promise.all([api('/store/team'), api('/store/roles')]);
    const roles = rr.roles, PERMS = rr.permissions;
    const lim = state.me.limits.users;
    const locs = state.me.locations || [];
    const allLocs = locs;
    setActions(`<button class="btn" id="addRole">Créer un rôle</button><button class="btn btn-primary" id="addMember">Ajouter un membre</button>`);
    const where = (u) => u.role === 'owner' || !u.locations.length ? (allLocs.length > 1 ? 'Toutes les boutiques' : '') : u.locations.map(locName).filter(Boolean).join(', ');
    const groups = [...new Set(PERMS.map((p) => p.group))];
    $('#view').innerHTML = `
      <p class="muted" style="margin-top:0">${team.length} membre${team.length > 1 ? 's' : ''}${lim ? ` sur ${lim} inclus dans votre formule` : ''}. Chaque membre a un rôle (ce qu'il peut faire) et un accès à une, plusieurs ou toutes les boutiques.</p>
      <section class="panel">
        <div class="panel-head"><h2>Membres</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Nom</th><th>Rôle</th>${allLocs.length > 1 ? '<th>Boutiques</th>' : ''}<th>Dernière connexion</th><th></th></tr></thead><tbody>
          ${team.map((u) => `<tr><td><span class="cell-main">${esc(u.name)}</span><div class="cell-sub">${esc(u.email)}${u.must_change_password ? ', mot de passe temporaire' : ''}</div></td>
            <td>${u.role === 'owner' ? '<span class="badge s-info">Propriétaire</span>' : `<span class="badge s-neutral">${esc(u.role_name || 'Sans rôle')}</span>`}</td>
            ${allLocs.length > 1 ? `<td>${esc(where(u))}</td>` : ''}
            <td class="muted">${u.last_login_at ? dateTimeFmt(u.last_login_at) : 'jamais'}</td>
            <td class="num nowrap">${u.role === 'owner' ? '' : `<button class="btn btn-sm" data-edit-member="${u.id}">Droits</button> <button class="btn btn-sm" data-reset="${u.id}">Mot de passe</button> <button class="btn btn-sm btn-danger" data-remove="${u.id}">Retirer</button>`}</td></tr>`).join('')}
        </tbody></table></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Rôles</h2><span class="muted">Ce que chaque rôle permet de faire</span></div>
        <div class="table-wrap"><table class="perm-matrix"><thead><tr><th>Permission</th><th class="center">Propriétaire</th>${roles.map((r) => `<th class="center"><button class="link" data-edit-role="${r.id}">${esc(r.name)}</button><div class="cell-sub">${r.members} membre${r.members > 1 ? 's' : ''}</div></th>`).join('')}</tr></thead><tbody>
          ${groups.map((g) => `<tr class="perm-group"><td colspan="${roles.length + 2}">${esc(g)}</td></tr>${PERMS.filter((p) => p.group === g).map((p) => `<tr><td>${esc(p.label)}</td><td class="center"><span class="yes" aria-label="oui">✓</span></td>${roles.map((r) => `<td class="center">${r.permissions.includes(p.key) ? '<span class="yes" aria-label="oui">✓</span>' : '<span class="no" aria-label="non">·</span>'}</td>`).join('')}</tr>`).join('')}`).join('')}
        </tbody></table></div>
      </section>`;

    const showPassword = (email, pw) => openModal('Identifiants à transmettre', `
      <p>Transmettez ces identifiants à votre collaborateur. Il devra choisir son propre mot de passe à la première connexion.</p>
      <div class="credentials"><div><span>Adresse</span><strong>${location.origin}/app/</strong></div><div><span>E-mail</span><strong>${esc(email)}</strong></div><div><span>Mot de passe temporaire</span><strong class="mono">${esc(pw)}</strong></div></div>
      <div class="modal-foot"><div class="right"><button class="btn btn-primary" id="credOk">C'est noté</button></div></div>`);
    const accessFields = (u = {}) => `
      <label class="field full"><span>Rôle</span><select name="role_id">${roles.map((r) => `<option value="${r.id}" ${r.id === u.role_id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select><small id="roleDesc"></small></label>
      ${allLocs.length > 1 ? `<fieldset class="field full loc-access"><legend>Boutiques</legend>
        <label class="check"><input type="radio" name="scope" value="all" ${!u.locations?.length ? 'checked' : ''}> Toutes les boutiques</label>
        <label class="check"><input type="radio" name="scope" value="some" ${u.locations?.length ? 'checked' : ''}> Seulement :</label>
        <div class="loc-checks">${allLocs.map((l) => `<label class="check"><input type="checkbox" name="loc" value="${l.id}" ${u.locations?.includes(l.id) ? 'checked' : ''}> ${esc(l.name)}</label>`).join('')}</div>
      </fieldset>` : ''}`;
    const readAccess = (f) => {
      const role_id = Number(f.role_id.value);
      const some = f.scope && f.scope.value === 'some';
      const locations = some ? $$('input[name="loc"]:checked', f).map((c) => Number(c.value)) : [];
      if (some && !locations.length) throw new Error('Cochez au moins une boutique.');
      return { role_id, locations };
    };
    const bindRoleDesc = (f) => { const upd = () => { const r = roles.find((x) => x.id === Number(f.role_id.value)); $('#roleDesc').textContent = r ? `${r.description} ${r.permissions.length} permission${r.permissions.length > 1 ? 's' : ''}.` : ''; }; f.role_id.addEventListener('change', upd); upd(); };

    $('#addMember').addEventListener('click', () => {
      const body = openModal('Ajouter un membre', `
        <form id="tmForm" class="fields" novalidate>
          <label class="field"><span>Nom</span><input name="name" required></label>
          <label class="field"><span>E-mail</span><input name="email" type="email" required></label>
          ${accessFields({ role_id: roles.find((r) => r.name === 'Caissier')?.id })}
          <p class="form-error full" id="tmErr"></p>
        </form>
        <div class="modal-foot"><div class="right"><button class="btn" id="tmCancel">Annuler</button><button class="btn btn-primary" id="tmSave">Créer l'accès</button></div></div>`);
      const f = $('#tmForm', body); bindRoleDesc(f);
      $('#tmCancel', body).addEventListener('click', closeModal);
      $('#tmSave', body).addEventListener('click', async (e) => {
        try {
          const acc = readAccess(f);
          e.currentTarget.disabled = true;
          const r = await api('/store/team', { method: 'POST', body: { name: f.name.value, email: f.email.value, ...acc } });
          showPassword(r.email, r.temp_password); $('#credOk').addEventListener('click', () => { closeModal(); route(); });
        } catch (ex) { $('#tmErr').textContent = ex.message; e.currentTarget.disabled = false; }
      });
    });
    $$('[data-edit-member]').forEach((b) => b.addEventListener('click', () => {
      const u = team.find((x) => x.id === Number(b.dataset.editMember));
      const body = openModal(`Droits de ${u.name}`, `
        <form id="mbForm" class="fields" novalidate>${accessFields(u)}<p class="form-error full" id="mbErr"></p></form>
        <p class="muted">Le changement s'applique immédiatement, sans que ${esc(u.name)} ait à se reconnecter.</p>
        <div class="modal-foot"><div class="right"><button class="btn" id="mbCancel">Annuler</button><button class="btn btn-primary" id="mbSave">Enregistrer</button></div></div>`);
      const f = $('#mbForm', body); bindRoleDesc(f);
      $('#mbCancel', body).addEventListener('click', closeModal);
      $('#mbSave', body).addEventListener('click', async (e) => {
        try { const acc = readAccess(f); e.currentTarget.disabled = true; await api(`/store/team/${u.id}`, { method: 'PUT', body: acc }); closeModal(); toast('Droits mis à jour'); route(); }
        catch (ex) { $('#mbErr').textContent = ex.message; e.currentTarget.disabled = false; }
      });
    }));
    const roleForm = (r = { name: '', description: '', permissions: [] }) => {
      const body = openModal(r.id ? `Rôle « ${r.name} »` : 'Nouveau rôle', `
        <form id="roleForm" novalidate>
          <div class="fields">
            <label class="field"><span>Nom du rôle</span><input name="name" value="${esc(r.name)}" required placeholder="Ex. : Responsable de boutique"></label>
            <label class="field"><span>Description</span><input name="description" value="${esc(r.description)}" placeholder="À quoi sert ce rôle"></label>
          </div>
          <div class="perm-groups">${groups.map((g) => `<fieldset><legend>${esc(g)}</legend>${PERMS.filter((p) => p.group === g).map((p) => `<label class="check"><input type="checkbox" name="perm" value="${p.key}" ${r.permissions.includes(p.key) ? 'checked' : ''}> ${esc(p.label)}</label>`).join('')}</fieldset>`).join('')}</div>
          <p class="form-error" id="roleErr"></p>
        </form>
        <div class="modal-foot">${r.id ? `<button class="btn btn-danger" id="roleDel" ${r.members ? 'disabled title="Attribué à des membres"' : ''}>Supprimer</button>` : ''}<div class="right"><button class="btn" id="roleCancel">Annuler</button><button class="btn btn-primary" id="roleSave">${r.id ? 'Enregistrer' : 'Créer le rôle'}</button></div></div>`, true);
      const f = $('#roleForm', body);
      $('#roleCancel', body).addEventListener('click', closeModal);
      $('#roleSave', body).addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        const payload = { name: f.name.value, description: f.description.value, permissions: $$('input[name="perm"]:checked', f).map((c) => c.value) };
        try { await api(r.id ? `/store/roles/${r.id}` : '/store/roles', { method: r.id ? 'PUT' : 'POST', body: payload }); closeModal(); toast(r.id ? 'Rôle mis à jour' : 'Rôle créé'); route(); }
        catch (ex) { $('#roleErr').textContent = ex.message; e.currentTarget.disabled = false; }
      });
      $('#roleDel', body)?.addEventListener('click', async () => {
        if (!confirmAction(`Supprimer le rôle « ${r.name} » ?`)) return;
        try { await api(`/store/roles/${r.id}`, { method: 'DELETE' }); closeModal(); toast('Rôle supprimé'); route(); } catch (ex) { $('#roleErr').textContent = ex.message; }
      });
    };
    $('#addRole').addEventListener('click', () => roleForm());
    $$('[data-edit-role]').forEach((b) => b.addEventListener('click', () => roleForm(roles.find((r) => r.id === Number(b.dataset.editRole)))));
    $$('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirmAction('Générer un nouveau mot de passe temporaire pour ce membre ? Il sera déconnecté.')) return;
      try { const r = await api(`/store/team/${b.dataset.reset}/reset`, { method: 'POST', body: {} }); const u = team.find((x) => x.id === Number(b.dataset.reset)); showPassword(u.email, r.temp_password); $('#credOk').addEventListener('click', closeModal); } catch (e) { fail(e); }
    }));
    $$('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirmAction("Retirer ce membre ? Il n'aura plus accès à votre commerce.")) return;
      try { await api(`/store/team/${b.dataset.remove}`, { method: 'DELETE' }); toast('Membre retiré'); route(); } catch (e) { fail(e); }
    }));
  }

  /* ================= Abonnement ================= */
  async function viewSubscription() {
    const sub = await api('/store/subscription');
    const st = state.me.store;
    const lim = (v) => (v === null ? 'illimité' : v);
    const current = sub.plans.find((p) => p.key === sub.plan);
    $('#view').innerHTML = `
      <section class="panel sub-current">
        <div><span class="kpi-label">Formule actuelle</span><strong>${esc(st.plan_name)}</strong>
          <span class="muted">${sub.plan === 'essai' ? `Essai gratuit jusqu'au ${dateFmt(sub.trial_ends_at)}` : current ? `${current.price_label} HT par mois` : ''}</span></div>
        <div><span class="kpi-label">Produits</span><strong>${sub.usage.products}</strong><span class="muted">sur ${lim(state.me.limits.products)}</span></div>
        <div><span class="kpi-label">Utilisateurs</span><strong>${sub.usage.users}</strong><span class="muted">sur ${lim(state.me.limits.users)}</span></div>
      </section>
      ${sub.plan_requested ? `<p class="notice">Demande de passage à la formule <strong>${esc(sub.plans.find((p) => p.key === sub.plan_requested)?.name || sub.plan_requested)}</strong> envoyée. Nous vous contactons pour finaliser l'abonnement.</p>` : ''}
      <div class="plans">
        ${sub.plans.map((p) => `<section class="plan ${p.key === 'pro' ? 'featured' : ''}">
          <h2>${esc(p.name)}</h2><p class="plan-price"><strong>${esc(p.price_label)}</strong> HT / mois</p>
          <p class="muted">${esc(p.description)}</p>
          <ul><li>${lim(p.products)} produits</li><li>${p.users} utilisateur${p.users > 1 ? 's' : ''}</li><li>Caisse, stock, vitrine en ligne</li><li>Devis, factures, alertes</li></ul>
          ${p.key === sub.plan ? '<span class="badge s-ok">Formule actuelle</span>' : `<button class="btn ${p.key === 'pro' ? 'btn-primary' : ''} btn-block" data-plan="${p.key}" ${sub.plan_requested === p.key ? 'disabled' : ''}>${sub.plan_requested === p.key ? 'Demande envoyée' : 'Choisir cette formule'}</button>`}
        </section>`).join('')}
      </div>`;
    $$('[data-plan]').forEach((b) => b.addEventListener('click', async () => {
      try { await api('/store/subscription', { method: 'POST', body: { plan: b.dataset.plan } }); state.me = await api('/auth/me'); toast('Demande envoyée'); route(); } catch (e) { fail(e); }
    }));
  }

  /* ---------------- Délégation globale ---------------- */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-new],[data-doc],[data-product],[data-customer],[data-stock],[data-restock],[data-act]');
    if (!el) return;
    if (el.dataset.new) docForm(el.dataset.new);
    else if (el.dataset.doc) showDoc(Number(el.dataset.doc));
    else if (el.dataset.product) productForm(state.products.find((p) => p.id === Number(el.dataset.product)));
    else if (el.dataset.customer) customerForm(state.customers.find((c) => String(c.id) === el.dataset.customer));
    else if (el.dataset.stock) stockModal(el.dataset.stock);
    else if (el.dataset.restock) stockModal('entrée', el.dataset.restock);
    else if (el.dataset.act === 'new-product') productForm();
  });

  /* ---------------- Démarrage ---------------- */
  api('/auth/me').then((r) => {
    if (r.authenticated && r.store) showApp();
    else if (r.authenticated && r.platform_admin) location.href = '/console/';
    else showLogin();
  }).catch(() => { showLogin(); $('#loginError').textContent = 'Le serveur ne répond pas. Réessayez dans un instant.'; });
})();
