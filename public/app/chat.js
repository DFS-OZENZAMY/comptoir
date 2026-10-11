// Messagerie avec le support Comptoir, dans l'espace commerçant.
// Conception : Figma › Fondations › Composants › Messagerie (bulles, indicateur de saisie, lanceur, champ).
// Les messages passent par l'API (enregistrés en base) ; le temps réel (WebSocket) prévient de l'arrivée
// des réponses, de la saisie en cours et de la présence du support. Sans temps réel : actualisation régulière.
(() => {
  'use strict';
  const S = { open: false, thread: null, messages: [], online: 0, realtime: false, ws: null, retry: 0, typingUntil: 0, typingName: '', lastTyping: 0, pending: [], loaded: false, timer: null };
  let App;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const time = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const dayLabel = (iso) => {
    const d = new Date(iso), t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
    if (d.toDateString() === t.toDateString()) return 'Aujourd’hui';
    if (d.toDateString() === y.toDateString()) return 'Hier';
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  };
  const text = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
  const ICON = {
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18.5V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8.5L5 18.5Z"/><path d="M9 9.5h6M9 12.5h4"/></svg>',
    close: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15"/></svg>',
    back: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5"/></svg>',
    send: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4M4.5 9.5 10 4l5.5 5.5"/></svg>',
  };
  const TOPICS = ['Encaisser à la caisse', 'Importer mes produits', 'Factures et paiements', 'Mon abonnement'];

  /* ---------------- Construction ---------------- */
  function build() {
    const launcher = document.createElement('button');
    launcher.type = 'button'; launcher.className = 'chat-launcher'; launcher.id = 'chatLauncher';
    launcher.setAttribute('aria-label', 'Écrire au support Comptoir'); launcher.innerHTML = `${ICON.chat}<span class="chat-count" hidden></span>`;
    const panel = document.createElement('section');
    panel.className = 'chat-panel'; panel.id = 'chatPanel'; panel.hidden = true;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Messagerie du support Comptoir');
    panel.innerHTML = `
      <header class="chat-head">
        <button type="button" class="chat-icon chat-back" data-close aria-label="Fermer">${ICON.back}</button>
        <div class="chat-team" aria-hidden="true"><span>SC</span></div>
        <div class="chat-title"><strong>Support Comptoir</strong><span class="chat-status"><i></i><em></em></span></div>
        <button type="button" class="chat-icon chat-x" data-close aria-label="Fermer">${ICON.close}</button>
      </header>
      <div class="chat-body" aria-live="polite"><div class="chat-list"></div><div class="chat-typing" hidden><span></span><div class="chat-dots"><i></i><i></i><i></i></div></div></div>
      <form class="chat-compose" autocomplete="off">
        <textarea rows="1" maxlength="4000" placeholder="Écrivez votre message…" aria-label="Votre message"></textarea>
        <button type="submit" class="chat-send" aria-label="Envoyer" disabled>${ICON.send}</button>
      </form>`;
    document.body.append(launcher, panel);
    // Icône dans l'en-tête mobile, à gauche de la cloche des alertes
    const bell = $('#mobileBell');
    if (bell) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'mobile-chat'; b.id = 'mobileChat';
      b.setAttribute('aria-label', 'Écrire au support Comptoir'); b.innerHTML = `${ICON.chat}<span class="bell-badge" hidden></span>`;
      bell.before(b); b.addEventListener('click', () => toggle(true));
    }
    launcher.addEventListener('click', () => toggle(!S.open));
    panel.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => toggle(false)));
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
    const ta = $('textarea', panel), form = $('form', panel);
    ta.addEventListener('input', () => {
      ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 132)}px`;
      $('.chat-send', panel).disabled = !ta.value.trim();
      if (S.ws?.readyState === 1 && Date.now() - S.lastTyping > 2500 && ta.value.trim()) { S.lastTyping = Date.now(); S.ws.send('{"type":"typing"}'); }
    });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener('submit', (e) => { e.preventDefault(); const v = ta.value.trim(); if (!v) return; ta.value = ''; ta.dispatchEvent(new Event('input')); send(v); });
    $('.chat-list', panel).addEventListener('click', (e) => {
      const topic = e.target.closest('[data-topic]'); if (topic) { ta.value = `Bonjour, j’ai une question : ${topic.dataset.topic.toLowerCase()}. `; ta.dispatchEvent(new Event('input')); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
      if (e.target.closest('[data-notify]')) { App.enablePush().then(() => { S.notify = null; render(false); App.toast('Vous serez prévenu de chaque réponse du support'); }).catch((ex) => App.toast(ex.message, true)); return; }
      if (e.target.closest('[data-notify-later]')) { try { sessionStorage.setItem('comptoir.chat.notify', 'plus-tard'); } catch { /* navigation privée */ } S.notify = null; render(false); return; }
      const retry = e.target.closest('[data-retry]'); if (retry) { const p = S.pending.find((x) => x.tmp === retry.dataset.retry); if (p) { S.pending = S.pending.filter((x) => x !== p); send(p.body); } }
    });
  }

  /* ---------------- Ouverture ---------------- */
  function toggle(open) {
    S.open = open;
    const panel = $('#chatPanel');
    panel.hidden = !open; document.body.classList.toggle('chat-open', open);
    $('#chatLauncher').classList.toggle('is-open', open);
    $('#chatLauncher').innerHTML = open ? `${ICON.close}<span class="chat-count" hidden></span>` : `${ICON.chat}<span class="chat-count" hidden></span>`;
    if (open) {
      requestAnimationFrame(() => panel.classList.add('in'));
      render(true); load().then(() => { render(true); markRead(); });
      if (matchMedia('(min-width: 901px)').matches) setTimeout(() => $('textarea', panel).focus(), 60);
    } else panel.classList.remove('in');
    badge(); poll();
  }

  /* ---------------- Données ---------------- */
  async function load() {
    try {
      const r = await App.api('/store/support', { fresh: true, background: true });
      S.thread = r.thread; S.messages = r.messages; S.online = r.support_online; S.realtime = r.realtime; S.loaded = true;
    } catch { /* hors ligne : on garde ce qu'on a */ }
    badge();
  }
  async function send(body) {
    const tmp = `tmp-${Date.now()}`;
    const ref = window.ComptoirOutbox ? window.ComptoirOutbox.uuid() : null;   // envoi rejouable sans doublon
    const ctx = { page: location.hash || '#/', title: (document.getElementById('viewTitle')?.textContent || '').slice(0, 80) };
    S.pending.push({ tmp, ref, body, state: 'envoi', created_at: new Date().toISOString() }); render(true);
    try {
      if (!navigator.onLine) { const e = new Error('Hors ligne'); e.name = 'Offline'; throw e; }
      const m = await App.api('/store/support/messages', { method: 'POST', body: { body, context: ctx, client_ref: ref } });
      S.pending = S.pending.filter((p) => p.tmp !== tmp);
      if (!S.messages.some((x) => x.id === m.id)) S.messages.push(m);
      if (S.thread) S.thread.status = 'ouverte';
      render(true);
    } catch (e) {
      const p = S.pending.find((x) => x.tmp === tmp);
      // Hors ligne : le message part dans la file d'attente et sera envoyé automatiquement.
      if (e.name === 'Offline' && App.enqueue && ref) { await App.enqueue({ ref, type: 'support', body: { body, context: ctx } }); if (p) p.state = 'attente'; render(true); return; }
      if (p) p.state = 'échec'; render(true);
    }
  }
  // Messages écrits hors ligne et pas encore envoyés (même après fermeture de l'application).
  async function queued() {
    if (!window.ComptoirOutbox) return;
    const ops = (await window.ComptoirOutbox.all().catch(() => [])).filter((o) => o.type === 'support' && o.status !== 'failed' && o.store_id === App.state.me?.store?.id);
    for (const o of ops) if (!S.pending.some((p) => p.ref === o.ref)) S.pending.push({ tmp: `q-${o.ref}`, ref: o.ref, body: o.body.body, state: 'attente', created_at: o.at });
  }
  async function markRead() {
    if (!S.open || !S.thread?.unread_store) return;
    S.thread.unread_store = 0; badge();
    try { await App.api('/store/support/read', { method: 'POST', body: {} }); } catch { /* sans gravité */ }
  }

  /* ---------------- Temps réel ---------------- */
  function connect() {
    if (S.ws && S.ws.readyState <= 1) return;
    let ws;
    try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/chat/socket`); } catch { return poll(); }
    S.ws = ws;
    ws.onopen = () => { S.retry = 0; S.realtime = true; poll(); };
    ws.onmessage = (e) => {
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type === 'hello' || d.type === 'presence') { S.online = d.support; status(); }
      if (d.type === 'typing' && d.side === 'support') { S.typingName = d.name; S.typingUntil = Date.now() + 4500; typing(); }
      if (d.type === 'message') {
        S.thread = { ...(S.thread || {}), ...d.thread };
        if (!S.messages.some((m) => m.id === d.message.id)) S.messages.push(d.message);
        if (d.message.author_role === 'support') { S.typingUntil = 0; typing(); }
        render(true); markRead(); badge();
      }
      if (d.type === 'read' && d.side === 'support' && S.thread) { S.thread.support_read_at = d.at; render(false); }
    };
    ws.onclose = () => { S.ws = null; S.realtime = false; poll(); setTimeout(connect, Math.min(30000, 1000 * 2 ** S.retry++)); };
    ws.onerror = () => ws.close();
    clearInterval(S.ping); S.ping = setInterval(() => { if (ws.readyState === 1) ws.send('{"type":"ping"}'); }, 25000);
  }
  // Actualisation de secours : seulement sans temps réel (plus souvent quand le panneau est ouvert).
  function poll() {
    clearInterval(S.timer);
    if (S.ws?.readyState === 1) return;
    S.timer = setInterval(async () => { const before = S.messages.length; await load(); if (S.messages.length !== before) { render(true); markRead(); } }, S.open ? 8000 : 60000);
  }

  /* ---------------- Affichage ---------------- */
  function badge() {
    const n = S.thread?.unread_store || 0;
    for (const el of document.querySelectorAll('#chatLauncher .chat-count, #mobileChat .bell-badge')) { el.hidden = !n || S.open; el.textContent = n > 9 ? '9+' : n; }
    $('#mobileChat')?.setAttribute('aria-label', n ? `Support Comptoir : ${n} message${n > 1 ? 's' : ''} non lu${n > 1 ? 's' : ''}` : 'Écrire au support Comptoir');
  }
  function status() {
    const p = $('#chatPanel'); if (!p) return;
    const on = S.online > 0;
    p.classList.toggle('online', on);
    $('.chat-status em', p).textContent = on ? 'En ligne · répond en quelques minutes' : 'Hors ligne · réponse dès que possible, par notification';
  }
  function typing() {
    const el = $('#chatPanel .chat-typing'); if (!el) return;
    const on = Date.now() < S.typingUntil;
    el.hidden = !on; $('span', el).textContent = on ? `${S.typingName} est en train d’écrire` : '';
    if (on) { scroll(); clearTimeout(S.typingTimer); S.typingTimer = setTimeout(typing, S.typingUntil - Date.now() + 50); }
  }
  function scroll() { const b = $('#chatPanel .chat-body'); if (b) b.scrollTop = b.scrollHeight; }
  function render(toBottom) {
    const list = $('#chatPanel .chat-list'); if (!list) return;
    status();
    const me = App.state.me?.user || {};
    const first = String(me.name || '').split(' ')[0];
    let html = `<div class="chat-msg them first"><span class="chat-author">Support Comptoir</span><div class="chat-bubble">Bonjour ${esc(first)} ! Une question sur Comptoir ? L’équipe vous répond ici, en direct.</div></div>`;
    if (!S.messages.length && !S.pending.length) html += `<div class="chat-topics">${TOPICS.map((t) => `<button type="button" class="chip" data-topic="${esc(t)}">${esc(t)}</button>`).join('')}</div>`;
    let day = '', prev = null;
    const readAt = S.thread?.support_read_at || '';
    const mine = S.messages.filter((m) => m.author_role === 'client' && m.author_id === me.id);
    const lastMine = mine[mine.length - 1];
    for (const m of S.messages) {
      const d = dayLabel(m.created_at);
      if (d !== day) { html += `<div class="chat-day">${esc(d)}</div>`; day = d; prev = null; }
      if (m.kind === 'evenement') { html += `<div class="chat-event">${esc(m.body)}</div>`; prev = null; continue; }
      const own = m.author_role === 'client' && m.author_id === me.id;
      const side = m.author_role === 'client' ? 'me' : 'them';
      const grouped = prev && prev.author_role === m.author_role && prev.author_name === m.author_name && new Date(m.created_at) - new Date(prev.created_at) < 120000;
      const who = m.author_role === 'support' ? `${m.author_name} · Support Comptoir` : own ? '' : m.author_name;
      const meta = own && m === lastMine && readAt && readAt >= m.created_at ? `${time(m.created_at)} · Lu` : time(m.created_at);
      html += `<div class="chat-msg ${side}${grouped ? ' grouped' : ''}" data-id="${m.id}">${who && !grouped ? `<span class="chat-author">${esc(who)}</span>` : ''}<div class="chat-bubble">${text(m.body)}</div><span class="chat-meta">${meta}</span></div>`;
      prev = m;
    }
    for (const p of S.pending) {
      html += `<div class="chat-msg me pending${p.state === 'échec' ? ' failed' : ''}"><div class="chat-bubble">${text(p.body)}</div><span class="chat-meta">${p.state === 'échec' ? `Non envoyé · <button type="button" class="chat-retry" data-retry="${p.tmp}">Réessayer</button>` : p.state === 'attente' ? 'En attente de connexion · envoi automatique' : 'Envoi…'}</span></div>`;
    }
    if (S.thread?.status === 'résolue' && S.messages.length) html += '<div class="chat-event">Conversation résolue. Écrivez un message pour la rouvrir.</div>';
    if (S.notify && (S.messages.length || S.pending.length)) html += S.notify === 'ios'
      ? '<div class="chat-notify"><strong>Être prévenu de la réponse</strong><span>Sur iPhone, installez Comptoir sur l’écran d’accueil (Partager, puis Sur l’écran d’accueil) pour recevoir les réponses en notification, même téléphone verrouillé.</span></div>'
      : '<div class="chat-notify"><strong>Être prévenu de la réponse</strong><span>Recevez une notification dès que le support vous répond, même application fermée et téléphone verrouillé.</span><div><button type="button" class="btn btn-primary btn-sm" data-notify>Activer les notifications</button><button type="button" class="btn btn-sm" data-notify-later>Plus tard</button></div></div>';
    const b = $('#chatPanel .chat-body');
    const atBottom = b.scrollHeight - b.scrollTop - b.clientHeight < 80;
    list.innerHTML = html;
    if (toBottom || atBottom) scroll();
  }

  // Faut-il proposer d'activer les notifications ? (null : non ; 'ask' : bouton ; 'ios' : expliquer l'installation)
  async function checkNotify() {
    let later = false; try { later = sessionStorage.getItem('comptoir.chat.notify') === 'plus-tard'; } catch { /* navigation privée */ }
    if (later) return (S.notify = null);
    const P = App.push;
    if (!P || !P.supported()) return (S.notify = P && P.iosNeedsInstall() ? 'ios' : null);
    if (Notification.permission === 'denied') return (S.notify = null);
    const sub = await P.current().catch(() => null);
    S.notify = sub ? null : 'ask';
  }

  /* ---------------- Démarrage ---------------- */
  function start(app) {
    if (App) return;
    App = app; build(); queued().then(load).then(() => { badge(); render(false); }); connect();
    // Message envoyé par la synchronisation (application ou arrière-plan) : il quitte « en attente ».
    if (typeof BroadcastChannel === 'function') new BroadcastChannel('comptoir-sync').addEventListener('message', (e) => {
      if (e.data?.type === 'synced' && e.data.op?.type === 'support') { S.pending = S.pending.filter((p) => p.ref !== e.data.op.ref); load().then(() => render(false)); }
    });
    checkNotify().then(() => render(false));
    // Notification reçue alors que l'application est ouverte : affichée ici plutôt qu'en double.
    navigator.serviceWorker?.addEventListener('message', (e) => {
      const d = e.data && e.data.data; if (!e.data || e.data.type !== 'push' || !d || d.kind !== 'chat') return;
      if (!S.open) { load().then(() => { badge(); render(false); }); App.toast(`${d.body}`); }
    });
    if (location.hash === '#/support') toggle(true);
    // La notification « réponse du support » ouvre la conversation (adresse /app/#/support).
    window.addEventListener('hashchange', () => { if (location.hash === '#/support') toggle(true); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { load().then(() => render(false)); connect(); } });
  }
  window.ComptoirChat = { start, open: () => toggle(true) };
  if (window.ComptoirApp) start(window.ComptoirApp);
  else window.addEventListener('comptoir:ready', (e) => start(e.detail), { once: true });
})();
