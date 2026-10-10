(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const today = () => new Date().toISOString().slice(0, 10);

  const state = { settings: {}, products: [], categories: [], customers: [], me: null, platform: null };
  const isOwner = () => state.me?.role === 'owner';
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
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch('/api' + path, {
      method, credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path.startsWith('/store')) { showLogin(); throw new Error(data.error || 'Session expirée.'); }
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    return data;
  }

  function toast(msg, error = false) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.textContent = msg; t.classList.toggle('error', error); t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), error ? 4500 : 2400);
  }
  const fail = (e) => toast(e.message, true);

  /* ---------------- Modale ---------------- */
  const modal = $('#modal');
  function openModal(title, html, wide = false) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    modal.classList.toggle('wide', wide);
    if (!modal.open) modal.showModal();
    modal.scrollTop = 0;
    return $('#modalBody');
  }
  const closeModal = () => modal.open && modal.close();
  $('#modalClose').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  function confirmAction(message) { return window.confirm(message); }

  /* ---------------- Données partagées ---------------- */
  async function loadShared() {
    const [settings, products, categories, customers] = await Promise.all([
      api('/store/settings'), api('/store/products'), api('/store/categories'), api('/store/customers'),
    ]);
    Object.assign(state, { settings, products, categories, customers });
    updateBadges();
  }
  async function refresh(...keys) {
    const map = { products: '/store/products', categories: '/store/categories', customers: '/store/customers', settings: '/store/settings' };
    const res = await Promise.all(keys.map((k) => api(map[k])));
    keys.forEach((k, i) => { state[k] = res[i]; });
    updateBadges();
  }
  async function updateBadges() {
    const low = state.products.filter((p) => p.stock <= p.stock_min).length;
    const b = $('#badgeStock'); b.hidden = !low; b.textContent = low;
    try {
      const a = await api('/store/alerts');
      const n = a.overdue.length + a.out_of_stock.length;
      const ba = $('#badgeAlerts'); ba.hidden = !a.totals.count; ba.textContent = a.totals.count;
      ba.classList.toggle('urgent', n > 0);
    } catch { /* silencieux */ }
    try {
      const orders = await api('/store/documents?type=commande');
      const n = orders.filter((o) => ['nouvelle', 'confirmée'].includes(o.status)).length;
      const bo = $('#badgeOrders'); bo.hidden = !n; bo.textContent = n;
    } catch { /* silencieux */ }
  }

  /* ---------------- Connexion et inscription ---------------- */
  function showLogin(mode) {
    $('#app').hidden = true; $('#auth').hidden = false; closeModal();
    const signup = mode === 'signup' || (mode === undefined && location.hash === '#/inscription');
    $('#loginForm').hidden = signup; $('#signupForm').hidden = !signup;
    $$('[data-authtab]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.authtab === 'signup') === signup)));
    if (signup) loadPlatform();
    setTimeout(() => $(signup ? '#suName' : '#liEmail').focus(), 30);
  }
  async function loadPlatform() {
    if (state.platform) return;
    try {
      state.platform = await api('/platform');
      $('#suType').innerHTML = state.platform.business_types.map((t) => `<option value="${t.key}">${esc(t.label)}</option>`).join('');
      $('#suCountry').innerHTML = state.platform.countries.map((c) => `<option value="${c.key}">${esc(c.name)} (${esc(c.currency)})</option>`).join('');
      $('#trialDays').textContent = state.platform.trial_days;
    } catch (e) { fail(e); }
  }
  $$('[data-authtab]').forEach((b) => b.addEventListener('click', () => {
    history.replaceState(null, '', b.dataset.authtab === 'signup' ? '#/inscription' : '#/');
    showLogin(b.dataset.authtab);
  }));
  async function showApp() {
    $('#auth').hidden = true; $('#app').hidden = false;
    $('#view').innerHTML = '<p class="loading">Chargement…</p>';
    try {
      state.me = await api('/auth/me');
      if (!state.me.authenticated) return showLogin();
      if (!state.me.store) { location.href = state.me.platform_admin ? '/console/' : '/'; return; }
      await loadShared();
    } catch (e) { fail(e); }
    renderShell();
    if (location.hash === '#/inscription' || location.hash === '') location.hash = '#/tableau-de-bord'; else route();
    if (state.me.user.must_change_password) passwordModal(true);
  }
  function renderShell() {
    const me = state.me, st = me.store;
    $('#storeName').textContent = state.settings.shop_name || st.name;
    $('#storeLink').href = `/s/${st.slug}`;
    $('#consoleLink').hidden = !me.platform_admin;
    $$('[data-owner]').forEach((el) => { el.hidden = !isOwner(); });
    const days = st.trial_ends_at ? Math.round((new Date(st.trial_ends_at + 'T00:00:00Z') - new Date(today() + 'T00:00:00Z')) / 86400000) : -1;
    $('#planBadge').textContent = st.plan === 'essai' ? (days > 0 ? `Essai : ${days} j restant${days > 1 ? 's' : ''}` : days === 0 ? "Dernier jour d'essai" : 'Essai terminé') : st.plan_name;
    $('#planBadge').classList.toggle('warn', st.plan === 'essai' && days <= 3);
    const banner = $('#accessBanner');
    banner.hidden = me.access.writable;
    banner.innerHTML = me.access.writable ? '' : `${esc(me.access.reason)} ${isOwner() ? '<a href="#/abonnement">Voir les formules</a>' : ''}`;
    $('#userName').textContent = me.user.name;
  }
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
    try {
      await api('/auth/signup', { method: 'POST', body: d });
      location.hash = '#/tableau-de-bord';
      await showApp();
      toast('Bienvenue ! Votre espace est prêt.');
    } catch (ex) { $('#signupError').textContent = ex.message; } finally { btn.disabled = false; }
  });
  $('#logout').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    state.me = null; location.hash = '#/'; showLogin('login');
  });
  $('#accountBtn').addEventListener('click', () => passwordModal(false));

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
    'tableau-de-bord': ['Tableau de bord', viewDashboard],
    alertes: ['Alertes', viewAlerts],
    commandes: ['Commandes', () => viewDocuments('commande')],
    devis: ['Devis', () => viewDocuments('devis')],
    factures: ['Factures', () => viewDocuments('facture')],
    produits: ['Produits', viewProducts],
    stock: ['Stock', viewStock],
    clients: ['Clients', viewCustomers],
    parametres: ['Paramètres', viewSettings],
    equipe: ['Équipe', viewTeam],
    abonnement: ['Abonnement', viewSubscription],
  };
  const OWNER_VIEWS = ['parametres', 'equipe', 'abonnement'];
  function route() {
    const key = (location.hash.replace(/^#\//, '') || 'tableau-de-bord').split('?')[0];
    if (!state.me) return;
    const allowed = VIEWS[key] && (isOwner() || !OWNER_VIEWS.includes(key));
    const [title, fn] = allowed ? VIEWS[key] : VIEWS['tableau-de-bord'];
    $$('.side-nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === key));
    $('#viewTitle').textContent = title;
    $('#viewActions').innerHTML = '';
    document.title = `${title} : ${state.settings.shop_name || ''} | Comptoir`;
    Promise.resolve(fn()).catch(fail);
  }
  window.addEventListener('hashchange', route);
  const setActions = (html) => { $('#viewActions').innerHTML = html; };

  /* ================= Tableau de bord ================= */
  async function viewDashboard() {
    const d = await api('/store/dashboard');
    const s = state.settings;
    const steps = [
      { done: !!(s.phone && s.address), label: 'Renseigner l’adresse et le téléphone', href: '#/parametres', owner: true },
      { done: state.products.some((p) => !/^EX-\d{3}$/.test(p.ref || '')), label: 'Ajouter vos propres produits', href: '#/produits' },
      { done: d.today_tickets > 0 || d.recent.some((r) => r.type === 'ticket'), label: 'Faire une première vente en caisse', href: '#/caisse' },
      { done: s.legal_info !== '', label: 'Compléter les mentions légales des factures', href: '#/parametres', owner: true },
    ].filter((x) => !x.owner || isOwner());
    const todo = steps.filter((x) => !x.done);
    const max = Math.max(...d.months.map((m) => m.value), 1);
    const monthName = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'short' });
    const thisMonth = today().slice(0, 7);
    setActions(`<a class="btn btn-primary" href="#/caisse">Ouvrir la caisse</a><button class="btn" data-new="devis">Nouveau devis</button>`);
    $('#view').innerHTML = `
      ${todo.length ? `<section class="panel onboarding"><div class="panel-head"><h2>Premiers pas</h2><span class="muted">${steps.length - todo.length} sur ${steps.length}</span></div>
        <ol>${steps.map((x) => `<li class="${x.done ? 'done' : ''}"><a href="${x.href}">${x.label}</a></li>`).join('')}
          <li><a href="/s/${esc(state.me.store.slug)}" target="_blank" rel="noopener">Ouvrir votre vitrine en ligne</a> et partager le lien à vos clients</li></ol></section>` : ''}
      <section class="kpis" aria-label="Indicateurs">
        <a class="kpi" href="#/caisse"><span class="kpi-label">Caisse du jour</span><span class="kpi-value">${money(d.today_sales)}</span><span class="kpi-sub">${d.today_tickets} ticket${d.today_tickets > 1 ? 's' : ''}</span></a>
        <a class="kpi" href="#/factures"><span class="kpi-label">Ventes du mois</span><span class="kpi-value">${money(d.revenue_month)}</span><span class="kpi-sub">tickets et factures</span></a>
        <a class="kpi" href="${d.overdue ? '#/alertes' : '#/factures'}"><span class="kpi-label">À encaisser</span><span class="kpi-value">${money(d.unpaid)}</span><span class="kpi-sub ${d.overdue ? 'alert' : ''}">${d.overdue ? `${d.overdue} en retard de paiement` : `${d.unpaid_count} facture${d.unpaid_count > 1 ? 's' : ''} en attente`}</span></a>
        <a class="kpi" href="#/commandes"><span class="kpi-label">Commandes en cours</span><span class="kpi-value">${d.open_orders}</span><span class="kpi-sub">à préparer ou mises de côté</span></a>
        <a class="kpi" href="#/devis"><span class="kpi-label">Devis en attente</span><span class="kpi-value">${d.open_quotes}</span><span class="kpi-sub">${money(d.open_quotes_value)}</span></a>
        <a class="kpi" href="#/stock"><span class="kpi-label">Valeur du stock</span><span class="kpi-value">${money(d.stock_value)}</span><span class="kpi-sub">au prix d'achat</span></a>
      </section>
      <div class="dash-grid">
        <div class="stack">
          <section class="panel">
            <div class="panel-head"><h2>Ventes des 6 derniers mois</h2><span class="muted">TTC</span></div>
            <div class="chart">
              ${d.months.map((m) => `<div class="bar ${m.month === thisMonth ? 'current' : ''}"><span class="bar-val">${m.value ? new Intl.NumberFormat('fr-FR').format(Math.round(m.value)) : ''}</span><div class="bar-fill" style="height:${Math.round((m.value / max) * 150)}px"></div></div>`).join('')}
            </div>
            <div class="chart-labels">${d.months.map((m) => `<span>${monthName(m.month)}</span>`).join('')}</div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Derniers documents</h2></div>
            ${d.recent.length ? `<div class="table-wrap"><table><thead><tr><th>Numéro</th><th>Client</th><th class="num">Total TTC</th><th>Statut</th></tr></thead><tbody>
              ${d.recent.map((r) => `<tr class="clickable" data-doc="${r.id}"><td><span class="cell-main doc-num">${esc(r.number)}</span>${r.origin === 'site' ? '<span class="site-flag">site</span>' : ''}<div class="cell-sub">${dateFmt(r.date)}</div></td><td>${esc(r.client_name)}</td><td class="num">${money(r.total_ttc)}</td><td>${docBadge(r)}</td></tr>`).join('')}
            </tbody></table></div>` : `<div class="empty-state"><strong>Aucun document pour l'instant.</strong>Créez un devis ou une facture pour commencer.</div>`}
          </section>
        </div>
        <div class="stack">
        ${d.top.length ? `<section class="panel"><div class="panel-head"><h2>Meilleures ventes</h2><span class="muted">30 jours</span></div><div class="table-wrap"><table><tbody>
          ${d.top.map((t) => `<tr><td class="cell-main">${esc(t.label)}</td><td class="num muted">${qtyFmt(t.qty)} vendu${t.qty > 1 ? 's' : ''}</td><td class="num">${money(t.amount)}</td></tr>`).join('')}
        </tbody></table></div></section>` : ''}
        <section class="panel">
          <div class="panel-head"><h2>Stock à réapprovisionner</h2><a href="#/alertes">Voir les alertes</a></div>
          ${d.alerts.length ? `<div class="table-wrap"><table><thead><tr><th>Produit</th><th class="num">Stock</th><th class="num">Minimum</th></tr></thead><tbody>
            ${d.alerts.map((p) => `<tr class="clickable" data-restock="${p.id}"><td><span class="cell-main">${esc(p.name)}</span><div class="cell-sub">${esc(p.ref)}</div></td><td class="num ${p.stock <= 0 ? 'stock-out' : 'stock-low'}">${qtyFmt(p.stock)}</td><td class="num">${qtyFmt(p.stock_min)}</td></tr>`).join('')}
          </tbody></table></div>` : `<div class="empty-state"><strong>Tout est en stock.</strong>Aucun produit sous son seuil minimum.</div>`}
        </section>
        </div>
      </div>`;
  }

  /* ================= Caisse ================= */
  const pos = { tab: 'vente', lines: [], customer_id: '', client_name: '', client_phone: '', discount: 0, source: null, q: '', cat: '', journalDate: '' };
  const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
  const ttcOf = (ht, rate) => r2(ht * (1 + rate / 100));

  // Mêmes calculs que le serveur, pour que le total affiché soit exactement celui encaissé.
  function posPayload() {
    const base = pos.lines.map((l) => ({ product_id: l.product_id, label: l.label, qty: Number(l.qty) || 0, unit_price_ht: r4(l.ht), tva_rate: l.tva_rate })).filter((l) => l.qty);
    const pct = Math.min(100, Math.max(0, Number(pos.discount) || 0));
    const byRate = {};
    base.forEach((l) => { byRate[l.tva_rate] = (byRate[l.tva_rate] || 0) + l.qty * l.unit_price_ht; });
    const disc = pct ? Object.entries(byRate).filter(([, ht]) => ht > 0).map(([rate, ht]) => ({ product_id: null, label: `Remise ${pct} %`, qty: 1, unit_price_ht: -Math.round(ht * pct * 100) / 10000, tva_rate: Number(rate) })) : [];
    const all = [...base, ...disc];
    let ht = 0, tva = 0;
    all.forEach((l) => { const h = l.qty * l.unit_price_ht; ht += h; tva += (h * l.tva_rate) / 100; });
    ht = r2(ht); tva = r2(tva);
    const gross = r2(base.reduce((s, l) => s + l.qty * l.unit_price_ht * (1 + l.tva_rate / 100), 0));
    return { lines: base, discountLines: disc, ht, tva, ttc: r2(ht + tva), discountAmount: r2(gross - r2(ht + tva)) };
  }

  function posAdd(p, qty = 1) {
    const line = pos.lines.find((l) => l.product_id === p.id && !l.edited);
    if (line) line.qty = Number(line.qty) + qty;
    else pos.lines.push({ product_id: p.id, label: p.name, ref: p.ref, unit: p.unit, qty, tva_rate: p.tva_rate, ht: p.price_ht, ttc: ttcOf(p.price_ht, p.tva_rate), stock: p.stock });
    if (p.stock - qty < 0 && !pos.warned?.[p.id]) { pos.warned = { ...(pos.warned || {}), [p.id]: 1 }; toast(`Stock insuffisant pour ${p.name} (${qtyFmt(p.stock)} en stock)`, true); }
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
    $('#view').innerHTML = `
      <div class="pos">
        <section class="pos-catalog">
          <div class="pos-search">
            <input id="posSearch" type="search" placeholder="Scanner un code-barres ou rechercher un produit" value="${esc(pos.q)}" autocomplete="off">
            <button class="btn" id="posFree" type="button">Article libre</button>
          </div>
          <div class="chips pos-cats" id="posCats"></div>
          <div class="pos-grid" id="posGrid"></div>
        </section>
        <aside class="pos-ticket" aria-label="Ticket en cours">
          <div id="posClient"></div>
          <div class="pos-lines" id="posLines"></div>
          <div class="pos-bottom">
            <div class="pos-totals" id="posTotals"></div>
            <button class="btn btn-primary pos-pay" id="posPay" type="button"></button>
            <div class="pos-more">
              <button class="btn" id="posDiscount" type="button">Remise</button>
              <button class="btn" id="posReserve" type="button">Mettre de côté</button>
              <button class="btn" id="posCredit" type="button">À crédit</button>
              <button class="btn btn-danger" id="posClear" type="button">Vider</button>
            </div>
          </div>
        </aside>
      </div>`;
    const search = $('#posSearch');
    search.addEventListener('input', () => { pos.q = search.value; renderPosGrid(); });
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = search.value.trim().toLowerCase(); if (!q) return;
      const exact = state.products.find((p) => (p.barcode && p.barcode.toLowerCase() === q) || (p.ref && p.ref.toLowerCase() === q));
      const list = posFiltered();
      const p = exact || (list.length === 1 ? list[0] : null);
      if (p) { posAdd(p); search.value = ''; pos.q = ''; renderPosGrid(); }
      else toast(list.length ? 'Plusieurs produits correspondent : touchez le bon.' : `Aucun produit pour « ${search.value} ».`, !list.length);
    });
    $('#posFree').addEventListener('click', freeItemModal);
    $('#posPay').addEventListener('click', payModal);
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
      const cls = p.stock <= 0 ? 'stock-out' : p.stock <= p.stock_min ? 'stock-low' : 'stock-ok';
      return `<button class="pos-tile" type="button" data-posadd="${p.id}">
        <span class="pos-tile-name">${esc(p.name)}</span>
        <span class="pos-tile-ref">${esc(p.ref)}</span>
        <span class="pos-tile-foot"><strong>${money(ttcOf(p.price_ht, p.tva_rate))}</strong><span class="${cls}">${qtyFmt(p.stock)}</span></span>
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
    $('#posCustomer').addEventListener('change', (e) => { pos.customer_id = e.target.value; pos.client_name = ''; pos.client_phone = ''; renderPosTicket(); });
    $('#posNewCustomer').addEventListener('click', () => customerForm(null, (id) => { pos.customer_id = id; closeModal(); route(); }));
    $('#posDetach')?.addEventListener('click', () => { pos.source = null; renderPosTicket(); });

    $('#posLines').innerHTML = pos.lines.length ? pos.lines.map((l, i) => `
      <div class="pos-line">
        <div class="pos-line-main"><span class="pos-line-name">${esc(l.label)}</span>
          <label class="pos-line-price">PU <input type="number" step="0.01" min="0" value="${l.ttc.toFixed(2)}" data-posprice="${i}" aria-label="Prix unitaire TTC"> ${esc(cur())}</label></div>
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
    $('#posTotals').innerHTML = `
      ${pos.discount ? `<div><span>Remise ${pos.discount} %</span><span>− ${money(t.discountAmount)}</span></div>` : ''}
      <div><span>dont TVA</span><span>${money(t.tva)}</span></div>
      <div class="grand"><span>Total${count ? ` (${qtyFmt(count)} article${count > 1 ? 's' : ''})` : ''}</span><span>${money(t.ttc)}</span></div>`;
    const empty = !pos.lines.length;
    $('#posPay').textContent = empty ? 'Encaisser' : `Encaisser ${money(t.ttc)}`;
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
    return { mode, lines: t.lines, discount_pct: pos.discount, payments, notes, source_id: pos.source?.id || null, customer_id: pos.customer_id || null, client_name: pos.client_name, client_phone: pos.client_phone };
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
      <label class="field"><span id="payLabel">Montant</span><input id="payAmount" type="number" step="0.01" min="0" inputmode="decimal"></label>
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
      $$('[data-quick]', body).forEach((b) => b.addEventListener('click', () => { amount.value = Number(b.dataset.quick).toFixed(2); refresh(); }));
      const v = r2(Number(amount.value) || 0);
      $('#payChange').textContent = method === 'espèces' && v > r ? `À rendre : ${money(v - r)}` : '';
      $('#payGo').textContent = v >= r ? 'Valider la vente' : 'Ajouter ce paiement';
      $('#payList').innerHTML = payments.map((p, i) => `<li><span>${cap(p.method)}</span><span>${money(p.amount)} <button type="button" class="link" data-unpay="${i}">retirer</button></span></li>`).join('');
      $$('[data-unpay]', body).forEach((b) => b.addEventListener('click', () => { payments.splice(b.dataset.unpay, 1); amount.value = rest().toFixed(2); refresh(); }));
    };
    $$('.pay-method', body).forEach((b) => b.addEventListener('click', () => { method = b.dataset.method; if (method !== 'espèces' && Number(amount.value) > rest()) amount.value = rest().toFixed(2); refresh(); amount.focus(); }));
    amount.addEventListener('input', refresh);
    amount.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#payGo').click(); } });
    $('#payCancel').addEventListener('click', closeModal);
    $('#payGo').addEventListener('click', async (e) => {
      const r = rest(); const v = r2(Number(amount.value) || 0);
      $('#payErr').textContent = '';
      if (v <= 0) { $('#payErr').textContent = 'Indiquez le montant reçu.'; return; }
      if (v > r && method !== 'espèces') { $('#payErr').textContent = 'Seules les espèces permettent de rendre la monnaie.'; return; }
      const change = method === 'espèces' && v > r ? r2(v - r) : 0;
      payments.push({ method, amount: Math.min(v, r), note: change ? `Reçu ${money(v)}, rendu ${money(change)}` : '' });
      if (rest() > 0) { amount.value = rest().toFixed(2); refresh(); amount.focus(); return; }
      e.currentTarget.disabled = true;
      try {
        const doc = await api('/store/pos/checkout', { method: 'POST', body: posBody('ticket', payments) });
        saleDone(doc, change);
      } catch (ex) { payments.pop(); $('#payErr').textContent = ex.message; e.currentTarget.disabled = false; refresh(); }
    });
    amount.value = total.toFixed(2);
    refresh(); amount.select();
  }

  async function saleDone(doc, change = 0) {
    posReset();
    await refresh('products', 'customers').catch(() => {});
    const body = openModal('Vente enregistrée', `
      <div class="sale-done">
        <p class="sale-number">${esc(doc.number)} : ${money(doc.total_ttc)}</p>
        ${change ? `<p class="sale-change">À rendre <strong>${money(change)}</strong></p>` : ''}
      </div>
      <div class="modal-foot">
        <div><button class="btn" id="sdPrint">Imprimer le ticket</button> <button class="btn" id="sdInvoice">Faire une facture</button></div>
        <div class="right"><button class="btn btn-primary" id="sdNext">Nouvelle vente</button></div>
      </div>`);
    $('#sdPrint', body).addEventListener('click', () => printTicket(doc, change));
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
        const doc = await api('/store/pos/checkout', { method: 'POST', body: posBody('reserve', [], d.notes) });
        posReset(); closeModal(); toast(`${doc.number} mise de côté pour ${doc.client_name}`); updateBadges(); route();
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
        const doc = await api('/store/pos/checkout', { method: 'POST', body: posBody('credit', pay) });
        posReset(); await refresh('products', 'customers'); toast(`${doc.number} créée`); updateBadges(); route(); showDoc(doc.id);
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
      <hr><div class="c">${esc(s.doc_footer || 'Merci de votre visite')}<br><small>${esc(s.legal_info || '')}</small></div>
      <script>setTimeout(() => window.print(), 200);<\/script></body></html>`);
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
      <script>setTimeout(() => window.print(), 200);<\/script></body></html>`);
  }

  /* ================= Produits ================= */
  const pv = { q: '', cat: '' };
  function stockCell(p) {
    if (p.track_stock === 0) return '<span class="muted">non suivi</span>';
    const cls = p.stock <= 0 ? 'stock-out' : p.stock <= p.stock_min ? 'stock-low' : 'stock-ok';
    return `<span class="${cls}">${qtyFmt(p.stock)}</span> <span class="muted">${esc(p.unit)}</span>`;
  }
  const thumb = (p) => p.image ? `<img class="thumb" src="${esc(p.image)}" alt="">` : `<span class="thumb">${esc((p.ref || p.name).replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase())}</span>`;

  function viewProducts() {
    setActions(`<button class="btn" id="manageCats">Catégories</button><button class="btn btn-primary" id="newProduct">Nouveau produit</button>`);
    $('#view').innerHTML = `
      <div class="toolbar">
        <input type="search" id="pq" placeholder="Rechercher un produit" value="${esc(pv.q)}">
        <select id="pcat"><option value="">Toutes les catégories</option>${state.categories.map((c) => `<option value="${c.id}" ${String(pv.cat) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      </div>
      <div id="ptable"></div>`;
    $('#pq').addEventListener('input', (e) => { pv.q = e.target.value; renderProductTable(); });
    $('#pcat').addEventListener('change', (e) => { pv.cat = e.target.value; renderProductTable(); });
    $('#newProduct').addEventListener('click', () => productForm());
    $('#manageCats').addEventListener('click', categoriesModal);
    renderProductTable();
  }
  function renderProductTable() {
    const q = norm(pv.q);
    const list = state.products.filter((p) => (!pv.cat || String(p.category_id) === String(pv.cat)) && (!q || norm(`${p.name} ${p.ref}`).includes(q)));
    if (!state.products.length) {
      $('#ptable').innerHTML = `<div class="table-wrap"><div class="empty-state"><strong>Aucun produit.</strong>Ajoutez votre premier produit : il apparaîtra sur le site dès qu'il est enregistré.<br><button class="btn btn-primary" data-act="new-product">Nouveau produit</button></div></div>`;
      return;
    }
    $('#ptable').innerHTML = `<div class="table-wrap"><table><thead><tr><th></th><th>Produit</th><th>Catégorie</th><th class="num">Prix HT</th><th class="num">Prix TTC</th><th class="num">Stock</th><th>Sur le site</th></tr></thead><tbody>
      ${list.map((p) => `<tr class="clickable" data-product="${p.id}">
        <td style="width:56px">${thumb(p)}</td>
        <td><span class="cell-main">${esc(p.name)}</span><div class="cell-sub">${esc(p.ref)}</div></td>
        <td>${esc(p.category_name || '—')}</td>
        <td class="num">${money(p.price_ht)}</td>
        <td class="num">${money(p.price_ht * (1 + p.tva_rate / 100))}</td>
        <td class="num">${stockCell(p)}</td>
        <td>${p.visible ? '<span class="badge s-ok">visible</span>' : '<span class="badge s-neutral">masqué</span>'}</td>
      </tr>`).join('') || `<tr><td colspan="7" class="empty-state">Aucun produit ne correspond à cette recherche.</td></tr>`}
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

  function productForm(p = null) {
    const isNew = !p;
    p = p || { track_stock: 1, name: '', ref: '', barcode: '', description: '', category_id: '', price_ht: '', purchase_price: '', tva_rate: state.settings.tva_default || 20, stock: 0, stock_min: 0, unit: 'pièce', visible: 1 };
    let newImage = null, removeImage = false;
    const body = openModal(isNew ? 'Nouveau produit' : 'Modifier le produit', `
      <form id="pform" class="fields" novalidate>
        <label class="field full"><span>Nom du produit</span><input name="name" value="${esc(p.name)}" required></label>
        <label class="field"><span>Référence</span><input name="ref" value="${esc(p.ref)}"></label>
        <label class="field"><span>Code-barres <span class="muted">(facultatif)</span></span><input name="barcode" value="${esc(p.barcode || '')}" inputmode="numeric" placeholder="Scannez ou saisissez"></label>
        <label class="field"><span>Catégorie</span><select name="category_id"><option value="">Sans catégorie</option>${state.categories.map((c) => `<option value="${c.id}" ${String(c.id) === String(p.category_id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="field full"><span>Description</span><textarea name="description" rows="3">${esc(p.description)}</textarea></label>
        <label class="field"><span>Prix de vente HT (${esc(cur())})</span><input name="price_ht" type="number" step="0.01" min="0" value="${p.price_ht}" required><small id="ttcHint"></small></label>
        <label class="field"><span>TVA (%)</span><input name="tva_rate" type="number" step="0.1" min="0" value="${p.tva_rate}"></label>
        <label class="field"><span>Prix d'achat HT (${esc(cur())})</span><input name="purchase_price" type="number" step="0.01" min="0" value="${p.purchase_price}"><small id="marginHint"></small></label>
        <label class="field"><span>Unité de vente</span><input name="unit" value="${esc(p.unit)}" list="units"><datalist id="units">${(state.me.units || []).map((u) => `<option>${esc(u)}</option>`).join('')}</datalist></label>
        ${isNew
          ? `<label class="field"><span>Stock initial</span><input name="stock" type="number" step="any" min="0" value="0"></label>`
          : `<div class="field"><span>Stock actuel</span><div>${stockCell(p)} <button type="button" class="link" id="adjustStock">Ajuster</button></div></div>`}
        <label class="field"><span>Seuil d'alerte</span><input name="stock_min" type="number" step="any" min="0" value="${p.stock_min}"><small>Alerte quand le stock descend à ce niveau.</small></label>
        <div class="field full"><span>Photo</span>
          <div class="img-field">
            <div class="img-preview" id="imgPreview">${p.image ? `<img src="${esc(p.image)}" alt="">` : 'Aucune photo'}</div>
            <div class="img-actions">
              <label class="btn btn-sm">Choisir une photo<input type="file" accept="image/*" id="imgInput" hidden></label>
              <button type="button" class="link" id="imgRemove" ${p.image ? '' : 'hidden'}>Retirer la photo</button>
            </div>
          </div>
        </div>
        <label class="check full"><input type="checkbox" name="visible" ${p.visible ? 'checked' : ''}> Afficher ce produit sur la vitrine en ligne</label>
        <label class="check full"><input type="checkbox" name="track_stock" ${p.track_stock === 0 ? '' : 'checked'}> Suivre le stock de ce produit <span class="muted">(décochez pour un service ou une prestation)</span></label>
        <p class="form-error full" id="pError"></p>
      </form>
      <div class="modal-foot">
        ${isNew ? '' : '<button class="btn btn-danger" id="pDelete">Supprimer</button>'}
        <div class="right"><button class="btn" id="pCancel">Annuler</button><button class="btn btn-primary" id="pSave">${isNew ? 'Ajouter le produit' : 'Enregistrer'}</button></div>
      </div>`);
    const form = $('#pform', body);
    const hints = () => {
      const ht = Number(form.price_ht.value) || 0, tva = Number(form.tva_rate.value) || 0, pa = Number(form.purchase_price.value) || 0;
      $('#ttcHint').textContent = ht ? `Soit ${money(ht * (1 + tva / 100))} TTC` : '';
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
    $('#imgRemove').addEventListener('click', () => { newImage = null; removeImage = true; $('#imgPreview').textContent = 'Aucune photo'; $('#imgRemove').hidden = true; });
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
      if (!data.name.trim()) { $('#pError').textContent = 'Le nom du produit est obligatoire.'; form.name.focus(); return; }
      btn.disabled = true;
      try {
        let id = p.id;
        if (isNew) id = (await api('/store/products', { method: 'POST', body: data })).id;
        else await api(`/store/products/${id}`, { method: 'PUT', body: data });
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
    setActions(`<button class="btn" data-stock="sortie">Sortie</button><button class="btn" data-stock="inventaire">Inventaire</button><button class="btn btn-primary" data-stock="entrée">Entrée de stock</button>`);
    const moves = await api('/store/stock');
    const alerts = state.products.filter((p) => p.stock <= p.stock_min);
    const typeBadge = { 'entrée': 's-ok', sortie: 's-info', inventaire: 's-neutral', retour: 's-warn' };
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
          ${moves.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Produit</th><th>Type</th><th class="num">Quantité</th><th>Motif</th></tr></thead><tbody>
            ${moves.map((m) => `<tr><td class="muted">${dateTimeFmt(m.created_at)}</td><td><span class="cell-main">${esc(m.product_name || 'Produit supprimé')}</span><div class="cell-sub">${esc(m.product_ref || '')}</div></td><td><span class="badge ${typeBadge[m.type] || 's-neutral'}">${esc(m.type)}</span></td><td class="num ${m.qty < 0 ? 'stock-out' : 'stock-ok'}">${m.qty > 0 ? '+' : ''}${qtyFmt(m.qty)}</td><td>${esc(m.reason)}</td></tr>`).join('')}
          </tbody></table></div>` : `<div class="empty-state"><strong>Aucun mouvement enregistré.</strong>Les entrées, sorties et ventes apparaîtront ici.</div>`}
        </section>
      </div>`;
  }

  function stockModal(type = 'entrée', productId = '') {
    const titles = { 'entrée': 'Entrée de stock', sortie: 'Sortie de stock', inventaire: 'Inventaire' };
    const body = openModal(titles[type], `
      <form id="sform" class="fields" novalidate>
        <label class="field full"><span>Produit</span><select name="product_id" required><option value="">Choisir un produit</option>${state.products.map((p) => `<option value="${p.id}" ${String(p.id) === String(productId) ? 'selected' : ''}>${esc(p.name)}${p.ref ? ' (' + esc(p.ref) + ')' : ''}</option>`).join('')}</select></label>
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
        const r = await api('/store/stock', { method: 'POST', body: data });
        await refresh('products'); closeModal(); toast(`Stock mis à jour : ${qtyFmt(r.stock)}`); route();
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
    $('#ctable').innerHTML = state.customers.length ? `<div class="table-wrap"><table><thead><tr><th>Client</th><th>Contact</th><th class="num">Documents</th><th class="num">Total facturé</th><th class="num">Reste dû</th></tr></thead><tbody>
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
        el.innerHTML = `<h3 class="section-title">Historique</h3><div class="table-wrap"><table><tbody>${mine.map((d) => `<tr class="clickable" data-doc="${d.id}"><td class="cell-main doc-num">${esc(d.number)}</td><td class="muted">${dateFmt(d.date)}</td><td class="num">${money(d.total_ttc)}</td><td>${docBadge(d)}</td></tr>`).join('')}</tbody></table></div>`;
      }).catch(() => {});
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
        if (isNew) id = (await api('/store/customers', { method: 'POST', body: data })).id;
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
      <link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,300..900&display=swap" rel="stylesheet">
      <style>@page{size:A4;margin:16mm 14mm}body{font-family:Archivo,Arial,sans-serif;color:#1B2530;font-size:10.5pt}
      h1{font-stretch:75%;margin:0 0 4px}p{margin:0 0 16px;color:#5A6774}table{width:100%;border-collapse:collapse}
      th{text-align:left;font-size:9pt;color:#5A6774;border-bottom:1px solid #1F2D3A;padding:6px}td{padding:8px 6px;border-bottom:1px solid #E3E6E9}
      .num{text-align:right;font-variant-numeric:tabular-nums}.box{width:18px;height:18px;border:1px solid #1F2D3A;display:inline-block}</style></head><body>
      <h1>Liste à commander</h1><p>${esc(s.shop_name)}, le ${new Date().toLocaleDateString('fr-FR')}</p>
      <table><thead><tr><th></th><th>Produit</th><th>Réf.</th><th class="num">Stock</th><th class="num">Seuil</th><th class="num">À commander</th><th class="num">Coût estimé</th></tr></thead><tbody>
      ${list.map((p) => `<tr><td><span class="box"></span></td><td>${esc(p.name)}</td><td>${esc(p.ref)}</td><td class="num">${qtyFmt(p.stock)}</td><td class="num">${qtyFmt(p.stock_min)}</td><td class="num"><strong>${qtyFmt(p.suggested)}</strong> ${esc(p.unit)}</td><td class="num">${p.purchase_price ? money(p.suggested * p.purchase_price) : '—'}</td></tr>`).join('')}
      </tbody></table><p style="margin-top:14px;text-align:right">Coût estimé HT : <strong>${money(total)}</strong></p>
      <script>document.fonts.ready.then(() => setTimeout(() => window.print(), 150));<\/script></body></html>`;
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
        if (location.hash !== `#/${conf.view}`) location.hash = `#/${conf.view}`; else route();
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
      <link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,300..900&display=swap" rel="stylesheet">
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
      <script>document.fonts.ready.then(() => setTimeout(() => window.print(), 150));<\/script>
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
  async function viewTeam() {
    const team = await api('/store/team');
    const lim = state.me.limits.users;
    setActions(`<button class="btn btn-primary" id="addMember">Ajouter un employé</button>`);
    $('#view').innerHTML = `
      <p class="muted" style="margin-top:0">${team.length} utilisateur${team.length > 1 ? 's' : ''}${lim ? ` sur ${lim} inclus dans votre formule` : ''}. Les employés ont accès à la caisse, aux produits, au stock, aux clients et aux documents, mais pas aux paramètres, à l'équipe ni à l'abonnement.</p>
      <div class="table-wrap"><table><thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Dernière connexion</th><th></th></tr></thead><tbody>
        ${team.map((u) => `<tr><td class="cell-main">${esc(u.name)}</td><td>${esc(u.email)}</td><td>${u.role === 'owner' ? '<span class="badge s-info">propriétaire</span>' : '<span class="badge s-neutral">employé</span>'}</td>
          <td class="muted">${u.last_login_at ? dateTimeFmt(u.last_login_at) : 'jamais'}</td>
          <td class="num">${u.role === 'owner' ? '' : `<button class="btn btn-sm" data-reset="${u.id}">Nouveau mot de passe</button> <button class="btn btn-sm btn-danger" data-remove="${u.id}">Retirer</button>`}</td></tr>`).join('')}
      </tbody></table></div>`;
    const showPassword = (email, pw) => openModal('Identifiants à transmettre', `
      <p>Transmettez ces identifiants à votre employé. Il devra choisir son propre mot de passe à la première connexion.</p>
      <div class="credentials"><div><span>Adresse</span><strong>${location.origin}/app/</strong></div><div><span>E-mail</span><strong>${esc(email)}</strong></div><div><span>Mot de passe temporaire</span><strong class="mono">${esc(pw)}</strong></div></div>
      <div class="modal-foot"><div class="right"><button class="btn btn-primary" id="credOk">C'est noté</button></div></div>`);
    $('#addMember').addEventListener('click', () => {
      const body = openModal('Ajouter un employé', `
        <form id="tmForm" class="fields" novalidate>
          <label class="field"><span>Nom</span><input name="name" required></label>
          <label class="field"><span>E-mail</span><input name="email" type="email" required></label>
          <p class="form-error full" id="tmErr"></p>
        </form>
        <div class="modal-foot"><div class="right"><button class="btn" id="tmCancel">Annuler</button><button class="btn btn-primary" id="tmSave">Créer l'accès</button></div></div>`);
      $('#tmCancel', body).addEventListener('click', closeModal);
      $('#tmSave', body).addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        try {
          const r = await api('/store/team', { method: 'POST', body: Object.fromEntries(new FormData($('#tmForm'))) });
          showPassword(r.email, r.temp_password); $('#credOk').addEventListener('click', () => { closeModal(); route(); });
        } catch (ex) { $('#tmErr').textContent = ex.message; e.currentTarget.disabled = false; }
      });
    });
    $$('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirmAction('Générer un nouveau mot de passe temporaire pour cet employé ? Il sera déconnecté.')) return;
      try { const r = await api(`/store/team/${b.dataset.reset}/reset`, { method: 'POST', body: {} }); const u = team.find((x) => x.id === Number(b.dataset.reset)); showPassword(u.email, r.temp_password); $('#credOk').addEventListener('click', closeModal); } catch (e) { fail(e); }
    }));
    $$('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirmAction("Retirer cet employé ? Il n'aura plus accès à votre commerce.")) return;
      try { await api(`/store/team/${b.dataset.remove}`, { method: 'DELETE' }); toast('Employé retiré'); route(); } catch (e) { fail(e); }
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
          <span class="muted">${sub.plan === 'essai' ? `Essai gratuit jusqu'au ${dateFmt(sub.trial_ends_at)}` : current ? `${current.price} € HT par mois` : ''}</span></div>
        <div><span class="kpi-label">Produits</span><strong>${sub.usage.products}</strong><span class="muted">sur ${lim(state.me.limits.products)}</span></div>
        <div><span class="kpi-label">Utilisateurs</span><strong>${sub.usage.users}</strong><span class="muted">sur ${lim(state.me.limits.users)}</span></div>
      </section>
      ${sub.plan_requested ? `<p class="notice">Demande de passage à la formule <strong>${esc(sub.plans.find((p) => p.key === sub.plan_requested)?.name || sub.plan_requested)}</strong> envoyée. Nous vous contactons pour finaliser l'abonnement.</p>` : ''}
      <div class="plans">
        ${sub.plans.map((p) => `<section class="plan ${p.key === 'pro' ? 'featured' : ''}">
          <h2>${esc(p.name)}</h2><p class="plan-price"><strong>${p.price} €</strong> HT / mois</p>
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
    else if (el.dataset.customer) customerForm(state.customers.find((c) => c.id === Number(el.dataset.customer)));
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
