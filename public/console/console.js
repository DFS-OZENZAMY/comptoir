(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n, cur = '€') => `${nf2.format(Number(n) || 0)} ${cur}`;
  const dateFmt = (d) => (d ? new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('fr-FR') : '');
  const since = (d) => {
    if (!d) return 'jamais';
    const ms = Date.now() - new Date(d.replace(' ', 'T') + 'Z').getTime();
    const m = Math.round(ms / 60000);
    if (m < 2) return "à l'instant";
    if (m < 60) return `il y a ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `il y a ${h} h`;
    const j = Math.round(h / 24);
    return `il y a ${j} jour${j > 1 ? 's' : ''}`;
  };
  const HEALTH = { nouveau: 's-info', actif: 's-ok', 'à risque': 's-warn', inactif: 's-neutral', suspendu: 's-bad', 'essai terminé': 's-bad' };
  const healthBadge = (h) => `<span class="badge ${HEALTH[h] || 's-neutral'}">${esc(h)}</span>`;
  const EVENT_LABEL = {
    signup: 'Inscription', login: 'Connexion', plan_request: 'Demande de formule', plan_change: 'Changement de formule',
    status_change: 'Statut', trial_change: 'Essai', product: 'Produit ajouté', facture: 'Facture', devis: 'Devis', commande: 'Commande', team: 'Équipe',
  };

  const state = { plans: {}, stores: [], filter: { q: '', health: '', plan: '' } };

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch('/api' + path, {
      method, credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || `Erreur ${res.status}`); e.status = res.status; throw e; }
    return data;
  }
  function toast(msg, error = false) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.textContent = msg; t.classList.toggle('error', error); t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), error ? 4500 : 2400);
  }
  const fail = (e) => toast(e.message, true);

  const modal = $('#modal');
  function openModal(title, html) {
    $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html;
    if (!modal.open) modal.showModal();
    return $('#modalBody');
  }
  const closeModal = () => modal.open && modal.close();
  $('#modalClose').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  function bars(values, { labels = [], height = 150, highlightLast = false, format = (v) => nf0.format(v) } = {}) {
    const max = Math.max(...values, 1);
    return `<div class="cbars" style="--n:${values.length}">
      ${values.map((v, i) => `<div class="cbar ${highlightLast && i === values.length - 1 ? 'current' : ''}" title="${esc(labels[i] || '')} : ${format(v)}">
        <span class="cbar-val">${v ? format(v) : ''}</span><div class="cbar-fill" style="height:${Math.round((v / max) * height)}px"></div></div>`).join('')}
    </div>${labels.length ? `<div class="cbar-labels" style="--n:${values.length}">${labels.map((l) => `<span>${esc(l)}</span>`).join('')}</div>` : ''}`;
  }

  /* ---------------- Vue d'ensemble ---------------- */
  async function viewOverview() {
    const o = await api('/console/overview');
    const c = o.counts;
    const monthLabel = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'short' });
    const byDay = Object.fromEntries(o.activity.map((a) => [a.day, a]));
    const act = []; for (let i = 29; i >= 0; i--) { const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); act.push({ day, stores: byDay[day]?.stores || 0 }); }
    const planOrder = ['essai', 'essentiel', 'pro', 'business'];
    $('#badgeRequests').hidden = !o.requests.length; $('#badgeRequests').textContent = o.requests.length;
    $('#view').innerHTML = `
      <section class="kpis">
        <a class="kpi" href="#/commerces"><span class="kpi-label">Commerces</span><span class="kpi-value">${c.total}</span><span class="kpi-sub">+${c.new_month} ce mois-ci</span></a>
        <a class="kpi" href="#/commerces?sante=actif"><span class="kpi-label">Actifs sur 7 jours</span><span class="kpi-value">${c.active_7d}</span><span class="kpi-sub">${c.active_30d} sur 30 jours</span></a>
        <a class="kpi" href="#/commerces?formule=essai"><span class="kpi-label">En essai</span><span class="kpi-value">${c.trial}</span><span class="kpi-sub ${c.trial_expired ? 'alert' : ''}">${c.trial_expired} essai${c.trial_expired > 1 ? 's' : ''} terminé${c.trial_expired > 1 ? 's' : ''}</span></a>
        <div class="kpi"><span class="kpi-label">Abonnés payants</span><span class="kpi-value">${c.paying}</span><span class="kpi-sub">${c.total ? Math.round((c.paying / c.total) * 100) : 0} % des commerces</span></div>
        <div class="kpi"><span class="kpi-label">Revenu mensuel (MRR)</span><span class="kpi-value">${money(o.mrr)}</span><span class="kpi-sub">${money(o.arr)} par an</span></div>
      </section>

      <div class="dash-grid">
        <div class="stack">
          <section class="panel">
            <div class="panel-head"><h2>Commerces actifs par jour</h2><span class="muted">30 derniers jours</span></div>
            <div class="chart-pad">${bars(act.map((a) => a.stores), { labels: act.map((a, i) => (i % 5 === 0 || i === act.length - 1 ? a.day.slice(8, 10) + '/' + a.day.slice(5, 7) : '')), highlightLast: true })}</div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Nouveaux commerces par mois</h2></div>
            <div class="chart-pad">${bars(o.signups.map((s) => s.value), { labels: o.signups.map((s) => monthLabel(s.month)), highlightLast: true })}</div>
          </section>
        </div>
        <div class="stack">
          <section class="panel">
            <div class="panel-head"><h2>Volume encaissé par les commerces</h2><span class="muted">ce mois-ci</span></div>
            ${o.gmv_month.length ? `<div class="table-wrap"><table><tbody>${o.gmv_month.map((g) => `<tr><td class="cell-main">${money(g.amount, g.currency)}</td><td class="muted">${g.sales} vente${g.sales > 1 ? 's' : ''}</td><td class="num muted">${g.stores} commerce${g.stores > 1 ? 's' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">Aucune vente ce mois-ci.</div>'}
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Répartition par formule</h2></div>
            <div class="plan-split">${planOrder.map((k) => `<div><span>${esc(state.plans[k]?.name || k)}</span><strong>${o.by_plan[k] || 0}</strong></div>`).join('')}</div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Demandes de formule</h2><a href="#/demandes">Tout voir</a></div>
            ${o.requests.length ? `<div class="table-wrap"><table><tbody>${o.requests.slice(0, 5).map((r) => `<tr class="clickable" data-store="${r.id}"><td class="cell-main">${esc(r.name)}</td><td>${esc(state.plans[r.plan]?.name)} → <strong>${esc(state.plans[r.plan_requested]?.name)}</strong></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">Aucune demande en attente.</div>'}
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Derniers événements</h2></div>
            <ul class="timeline">${o.events.map((e) => `<li data-store="${e.store_id}"><span class="t-type">${esc(EVENT_LABEL[e.type] || e.type)}</span> <strong>${esc(e.store_name || '')}</strong> <span class="muted">${esc(e.detail)}</span><span class="t-when">${since(e.created_at)}</span></li>`).join('') || '<li class="muted">Aucun événement.</li>'}</ul>
          </section>
        </div>
      </div>`;
  }

  /* ---------------- Commerces ---------------- */
  async function viewStores() {
    const qs = new URLSearchParams(location.hash.split('?')[1] || '');
    if (qs.get('sante')) state.filter.health = qs.get('sante');
    if (qs.get('formule')) state.filter.plan = qs.get('formule');
    state.stores = await api('/console/stores');
    const healths = ['nouveau', 'actif', 'à risque', 'inactif', 'essai terminé', 'suspendu'];
    const counts = {}; state.stores.forEach((s) => { counts[s.health] = (counts[s.health] || 0) + 1; });
    $('#view').innerHTML = `
      <div class="toolbar">
        <input type="search" id="sq" placeholder="Commerce, propriétaire, e-mail…" value="${esc(state.filter.q)}">
        <select id="splan"><option value="">Toutes les formules</option>${Object.entries(state.plans).map(([k, p]) => `<option value="${k}" ${state.filter.plan === k ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
        <div class="chips"><button class="chip" data-h="" aria-pressed="${!state.filter.health}">Tous<span class="n">${state.stores.length}</span></button>
          ${healths.filter((h) => counts[h]).map((h) => `<button class="chip" data-h="${h}" aria-pressed="${state.filter.health === h}">${h}<span class="n">${counts[h]}</span></button>`).join('')}</div>
      </div>
      <div id="stable"></div>`;
    $('#sq').addEventListener('input', (e) => { state.filter.q = e.target.value; renderStores(); });
    $('#splan').addEventListener('change', (e) => { state.filter.plan = e.target.value; renderStores(); });
    $$('[data-h]').forEach((b) => b.addEventListener('click', () => { state.filter.health = b.dataset.h; $$('[data-h]').forEach((x) => x.setAttribute('aria-pressed', x === b)); renderStores(); }));
    renderStores();
  }
  function renderStores() {
    const q = norm(state.filter.q);
    const list = state.stores.filter((s) => (!state.filter.health || s.health === state.filter.health) && (!state.filter.plan || s.plan === state.filter.plan) &&
      (!q || norm(`${s.name} ${s.slug} ${s.owner_name} ${s.owner_email} ${s.type_label} ${s.country_name}`).includes(q)));
    $('#stable').innerHTML = `<div class="table-wrap"><table><thead><tr>
        <th>Commerce</th><th>Propriétaire</th><th>Formule</th><th>Santé</th><th>Dernière activité</th><th>Jours actifs</th>
        <th class="num">Ventes 30 j</th><th class="num">Tickets</th><th class="num">Produits</th><th class="num">Équipe</th><th class="num">Vues vitrine</th></tr></thead><tbody>
      ${list.map((s) => `<tr class="clickable" data-store="${s.id}">
        <td><span class="cell-main">${esc(s.name)}</span><div class="cell-sub">${esc(s.type_label)}, ${esc(s.country_name)}</div></td>
        <td>${esc(s.owner_name)}<div class="cell-sub">${esc(s.owner_email)}</div></td>
        <td>${esc(s.plan_name)}${s.plan === 'essai' ? `<div class="cell-sub">jusqu'au ${dateFmt(s.trial_ends_at)}</div>` : ''}${s.plan_requested ? `<div class="cell-sub req">demande : ${esc(state.plans[s.plan_requested]?.name)}</div>` : ''}</td>
        <td>${healthBadge(s.health)}</td>
        <td class="muted">${since(s.last_active_at)}</td>
        <td><div class="meter" title="${s.active_days_30d} jours actifs sur 30"><span style="width:${Math.round((s.active_days_30d / 30) * 100)}%"></span></div><span class="cell-sub">${s.active_days_30d}/30</span></td>
        <td class="num">${money(s.sales_30d, s.currency || '€')}</td>
        <td class="num">${s.tickets_30d}</td><td class="num">${s.products}</td><td class="num">${s.users}</td><td class="num">${s.views_30d}</td>
      </tr>`).join('') || '<tr><td colspan="11" class="empty-state">Aucun commerce ne correspond.</td></tr>'}
    </tbody></table></div>`;
  }

  /* ---------------- Demandes ---------------- */
  async function viewRequests() {
    const o = await api('/console/overview');
    $('#badgeRequests').hidden = !o.requests.length; $('#badgeRequests').textContent = o.requests.length;
    $('#view').innerHTML = o.requests.length ? `
      <p class="muted" style="margin-top:0">Les commerçants demandent une formule depuis leur onglet Abonnement. Une fois le paiement réglé avec eux, validez la demande pour activer la formule.</p>
      <div class="table-wrap"><table><thead><tr><th>Commerce</th><th>Formule actuelle</th><th>Formule demandée</th><th class="num">Prix</th><th></th></tr></thead><tbody>
      ${o.requests.map((r) => `<tr><td><button class="link cell-main" data-store="${r.id}">${esc(r.name)}</button></td><td>${esc(state.plans[r.plan]?.name)}</td><td><strong>${esc(state.plans[r.plan_requested]?.name)}</strong></td>
        <td class="num">${money(state.plans[r.plan_requested]?.price)} / mois</td>
        <td class="num"><button class="btn btn-sm" data-decline="${r.id}">Refuser</button> <button class="btn btn-sm btn-primary" data-approve="${r.id}" data-plan="${r.plan_requested}">Activer la formule</button></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="table-wrap"><div class="empty-state"><strong>Aucune demande en attente.</strong></div></div>`;
    $$('[data-approve]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/console/stores/${b.dataset.approve}`, { method: 'POST', body: { plan: b.dataset.plan, status: 'active' } }); toast('Formule activée'); route(); } catch (e) { fail(e); }
    }));
    $$('[data-decline]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/console/stores/${b.dataset.decline}`, { method: 'POST', body: { clear_request: true } }); toast('Demande retirée'); route(); } catch (e) { fail(e); }
    }));
  }

  /* ---------------- Fiche commerce ---------------- */
  async function showStore(id) {
    let d;
    try { d = await api(`/console/stores/${id}`); } catch (e) { return fail(e); }
    const s = d.store, t = d.totals, cur = d.contact.currency || '€';
    const stats = d.stats;
    const days = []; for (let i = 29; i >= 0; i--) days.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
    const byDay = Object.fromEntries(stats.map((x) => [x.day, x]));
    const sum = (k) => stats.reduce((a, x) => a + (x[k] || 0), 0);
    const body = openModal(s.name, `
      <div class="store-head">
        <div>${healthBadge(s.health)} <span class="muted">${esc(s.type_label)}, ${esc(s.country_name)}, inscrit le ${dateFmt(s.created_at)}</span></div>
        <a class="btn btn-sm" href="/s/${esc(s.slug)}" target="_blank" rel="noopener">Ouvrir la vitrine</a>
      </div>
      <section class="kpis">
        <div class="kpi"><span class="kpi-label">Ventes totales</span><span class="kpi-value">${money(t.sales_total, cur)}</span><span class="kpi-sub">${money(sum('sales_amount'), cur)} sur 30 j</span></div>
        <div class="kpi"><span class="kpi-label">Tickets de caisse</span><span class="kpi-value">${t.tickets}</span><span class="kpi-sub">${sum('tickets')} sur 30 j</span></div>
        <div class="kpi"><span class="kpi-label">Factures et devis</span><span class="kpi-value">${t.invoices + t.quotes}</span><span class="kpi-sub">${t.orders} commande${t.orders > 1 ? 's' : ''}</span></div>
        <div class="kpi"><span class="kpi-label">Catalogue</span><span class="kpi-value">${t.products}</span><span class="kpi-sub">${t.customers} client${t.customers > 1 ? 's' : ''} enregistré${t.customers > 1 ? 's' : ''}</span></div>
        <div class="kpi"><span class="kpi-label">Vitrine</span><span class="kpi-value">${sum('catalog_views')}</span><span class="kpi-sub">vues sur 30 j</span></div>
      </section>
      <h3 class="section-title">Activité sur 30 jours</h3>
      <div class="panel chart-pad">${bars(days.map((x) => (byDay[x]?.actions || 0) + (byDay[x]?.logins || 0)), { labels: days.map((x, i) => (i % 5 === 0 || i === 29 ? x.slice(8, 10) + '/' + x.slice(5, 7) : '')), height: 90, highlightLast: true })}</div>
      <div class="store-grid">
        <section>
          <h3 class="section-title">Abonnement</h3>
          <form id="subForm" class="fields">
            <label class="field"><span>Formule</span><select name="plan">${Object.entries(state.plans).map(([k, p]) => `<option value="${k}" ${k === s.plan ? 'selected' : ''}>${esc(p.name)}${p.price ? ` (${p.price} €)` : ''}</option>`).join('')}</select></label>
            <label class="field"><span>Statut</span><select name="status"><option value="active" ${s.status === 'active' ? 'selected' : ''}>Actif</option><option value="suspended" ${s.status === 'suspended' ? 'selected' : ''}>Suspendu</option></select></label>
            <label class="field"><span>Fin de l'essai</span><input type="date" name="trial_ends_at" value="${esc(s.trial_ends_at || '')}"></label>
            <div class="field"><span>&nbsp;</span><button type="button" class="btn" id="extend">Prolonger de 14 jours</button></div>
            <label class="field full"><span>Notes internes</span><textarea name="console_notes" rows="3" placeholder="Échanges, conditions négociées…">${esc(s.console_notes)}</textarea></label>
          </form>
          ${s.plan_requested ? `<p class="notice">Demande en attente : formule <strong>${esc(state.plans[s.plan_requested]?.name)}</strong>. Sélectionnez-la puis enregistrez pour l'activer.</p>` : ''}
          <button class="btn btn-primary" id="subSave">Enregistrer</button>
        </section>
        <section>
          <h3 class="section-title">Contact et équipe</h3>
          <p class="contact">${d.contact.phone ? esc(d.contact.phone) + '<br>' : ''}${d.contact.email ? `<a href="mailto:${esc(d.contact.email)}">${esc(d.contact.email)}</a><br>` : ''}${esc(d.contact.address || '')}</p>
          <div class="table-wrap"><table><tbody>${d.team.map((u) => `<tr><td><span class="cell-main">${esc(u.name)}</span><div class="cell-sub">${esc(u.email)}, ${u.role === 'owner' ? 'propriétaire' : 'employé'}, ${u.last_login_at ? 'connecté ' + since(u.last_login_at) : 'jamais connecté'}</div></td>
            <td class="num"><button class="btn btn-sm" data-reset="${u.id}">Nouveau mot de passe</button></td></tr>`).join('')}</tbody></table></div>
          <h3 class="section-title">Journal</h3>
          <ul class="timeline compact">${d.events.slice(0, 15).map((e) => `<li><span class="t-type">${esc(EVENT_LABEL[e.type] || e.type)}</span> <span class="muted">${esc(e.detail)}${e.user_name ? ` (${esc(e.user_name)})` : ''}</span><span class="t-when">${since(e.created_at)}</span></li>`).join('') || '<li class="muted">Aucun événement.</li>'}</ul>
        </section>
      </div>`);
    const form = $('#subForm', body);
    $('#extend', body).addEventListener('click', () => {
      const base = form.trial_ends_at.value && form.trial_ends_at.value > new Date().toISOString().slice(0, 10) ? form.trial_ends_at.value : new Date().toISOString().slice(0, 10);
      const dt = new Date(base + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + 14);
      form.trial_ends_at.value = dt.toISOString().slice(0, 10);
    });
    $('#subSave', body).addEventListener('click', async (e) => {
      const data = Object.fromEntries(new FormData(form));
      if (data.status === 'suspended' && s.status !== 'suspended' && !confirm(`Suspendre ${s.name} ? Sa vitrine sera masquée et son espace passera en lecture seule.`)) return;
      e.currentTarget.disabled = true;
      try { await api(`/console/stores/${s.id}`, { method: 'POST', body: data }); toast('Commerce mis à jour'); showStore(s.id); route(); } catch (ex) { fail(ex); e.currentTarget.disabled = false; }
    });
    $$('[data-reset]', body).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Générer un mot de passe temporaire pour cet utilisateur ? Il sera déconnecté et devra en choisir un nouveau.')) return;
      try {
        const r = await api(`/console/users/${b.dataset.reset}/reset`, { method: 'POST', body: {} });
        openModal('Mot de passe temporaire', `<p>À transmettre à l'utilisateur :</p><div class="credentials"><div><span>E-mail</span><strong>${esc(r.email)}</strong></div><div><span>Mot de passe temporaire</span><strong class="mono">${esc(r.temp_password)}</strong></div></div>
          <div class="modal-foot"><div class="right"><button class="btn btn-primary" id="back">Revenir à la fiche</button></div></div>`);
        $('#back').addEventListener('click', () => showStore(s.id));
      } catch (e) { fail(e); }
    }));
  }

  /* ---------------- Routeur ---------------- */
  const VIEWS = { 'vue-d-ensemble': ["Vue d'ensemble", viewOverview], commerces: ['Commerces', viewStores], demandes: ['Demandes de formule', viewRequests] };
  function route() {
    const key = (location.hash.replace(/^#\//, '') || 'vue-d-ensemble').split('?')[0];
    const [title, fn] = VIEWS[key] || VIEWS['vue-d-ensemble'];
    $$('.side-nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === key));
    $('#viewTitle').textContent = title;
    document.title = `${title} : console Comptoir`;
    $('#view').innerHTML = '<p class="loading">Chargement…</p>';
    Promise.resolve(fn()).catch(fail);
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-store]');
    if (el && el.dataset.store) showStore(Number(el.dataset.store));
  });
  $('#logout').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); location.href = '/app/'; });

  (async () => {
    try {
      const me = await api('/auth/me');
      if (!me.authenticated || !me.platform_admin) {
        $('#gate').hidden = false;
        if (me.authenticated) $('#gateMsg').textContent = "Ce compte n'a pas accès à la console de la plateforme.";
        return;
      }
      $('#myStore').hidden = !me.store;
      state.plans = await api('/console/plans');
      $('#app').hidden = false;
      route();
    } catch (e) { $('#gate').hidden = false; }
  })();
})();
