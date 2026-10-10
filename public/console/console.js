(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n, cur = '€') => `${nf2.format(Number(n) || 0)} ${cur}`;
  const money0 = (n, cur = '€') => `${nf0.format(Math.round(Number(n) || 0))} ${cur}`;
  const dateFmt = (d) => (d ? new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('fr-FR') : '');
  const dayShort = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const toDate = (d) => new Date(d.includes('T') ? d : d.replace(' ', 'T') + 'Z');
  const since = (d) => {
    if (!d) return 'jamais';
    const m = Math.round((Date.now() - toDate(d).getTime()) / 60000);
    if (m < 2) return "à l'instant";
    if (m < 60) return `il y a ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `il y a ${h} h`;
    const j = Math.round(h / 24);
    return j < 45 ? `il y a ${j} j` : `le ${dateFmt(d)}`;
  };
  const bytes = (b) => (b == null ? 'inconnue' : b < 1048576 ? `${nf0.format(b / 1024)} Ko` : `${nf2.format(b / 1048576)} Mo`);
  const delta = (v, unit = '') => (v === null || v === undefined ? '' : v === 0 ? '<span class="delta flat">stable sur 7 j</span>'
    : `<span class="delta ${v > 0 ? 'up' : 'down'}">${v > 0 ? '+' : '−'}${unit ? money0(Math.abs(v), unit) : nf0.format(Math.abs(v))} sur 7 j</span>`);

  const HEALTH = { nouveau: 'h-new', actif: 'h-ok', 'à risque': 'h-warn', inactif: 'h-off', suspendu: 'h-bad', 'essai terminé': 'h-bad' };
  const HEALTH_ORDER = ['nouveau', 'actif', 'à risque', 'inactif', 'essai terminé', 'suspendu'];
  const healthBadge = (h) => `<span class="health ${HEALTH[h] || ''}">${esc(h)}</span>`;
  const EVENT_LABEL = {
    signup: 'Inscription', login: 'Connexion', plan_request: 'Demande de formule', plan_change: 'Changement de formule',
    status_change: 'Statut', trial_change: 'Essai', product: 'Produit ajouté', facture: 'Facture', devis: 'Devis', commande: 'Commande', team: 'Équipe',
  };
  const TODO_ICON = { request: 'Formule', trial_ending: 'Essai', trial_expired: 'Relance', churn_risk: 'Risque', onboarding: 'Démarrage', errors: 'Incident', cron: 'Tâche', config: 'Réglage' };

  const state = { plans: {}, stores: null, me: null, filter: { q: '', health: '', plan: '', sort: 'activity' }, timer: null, drawer: null };

  /* ---------------- Outils ---------------- */
  const CACHE_TTL = 30000;
  const cache = new Map(), inflight = new Map();
  async function api(path, opts = {}) {
    const { method = 'GET', fresh = false } = opts;
    if (method === 'GET' && !fresh) {
      const c = cache.get(path);
      if (c && Date.now() - c.t < CACHE_TTL) return c.data;
      if (inflight.has(path)) return inflight.get(path);
    }
    const run = rawApi(path, opts).then((data) => { if (method === 'GET') cache.set(path, { t: Date.now(), data }); else cache.clear(); return data; });
    if (method === 'GET') { inflight.set(path, run); run.finally(() => inflight.delete(path)).catch(() => {}); }
    return run;
  }
  const PREFETCH = { 'vue-d-ensemble': ['/console/overview'], 'a-traiter': ['/console/todo'], commerces: ['/console/stores'], activite: ['/console/activity'], revenus: ['/console/revenue'], systeme: ['/console/system'], journal: ['/console/events?'], utilisateurs: ['/console/users'] };
  const prefetch = (key) => { for (const p of PREFETCH[key] || []) { const c = cache.get(p); if ((!c || Date.now() - c.t > CACHE_TTL / 2) && !inflight.has(p)) api(p).catch(() => {}); } };
  const onIntent = (e) => { const a = e.target.closest && e.target.closest('a[href^="#/"]'); if (a) prefetch(a.getAttribute('href').slice(2).split('?')[0]); };
  document.addEventListener('mouseover', onIntent, { passive: true });
  document.addEventListener('touchstart', onIntent, { passive: true });
  async function rawApi(path, { method = 'GET', body } = {}) {
    const res = await fetch('/api' + path, {
      method, credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { location.href = '/app/'; throw new Error('Session expirée.'); }
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
  const modal = $('#modal');
  function openModal(title, html) { $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html; if (!modal.open) modal.showModal(); return $('#modalBody'); }
  const closeModal = () => modal.open && modal.close();
  $('#modalClose').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  // Infobulles des graphiques : tout élément [data-tip] affiche son texte au survol.
  const tip = $('#tip');
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) { tip.hidden = true; return; }
    tip.innerHTML = el.dataset.tip; tip.hidden = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (tip.hidden) return;
    const w = tip.offsetWidth, x = Math.min(e.clientX + 14, window.innerWidth - w - 8);
    tip.style.left = `${x}px`; tip.style.top = `${e.clientY + 16}px`;
  });

  /* ---------------- Graphiques SVG ---------------- */
  // Chaque graphique est dessiné à la largeur réelle de son emplacement (textes toujours lisibles).
  const chartFns = new Map(); let chartSeq = 0;
  const slot = (fn, height) => { const id = ++chartSeq; chartFns.set(id, fn); return `<div class="chart-slot" data-c="${id}" style="min-height:${height}px"></div>`; };
  function mountCharts() {
    document.querySelectorAll('.chart-slot').forEach((el) => {
      const fn = chartFns.get(Number(el.dataset.c)); if (!fn) return;
      const w = Math.max(260, Math.round(el.clientWidth));
      if (Number(el.dataset.w) === w) return;
      el.dataset.w = w; el.innerHTML = fn(w);
    });
  }
  new MutationObserver(() => mountCharts()).observe(document.body, { childList: true, subtree: true });
  let resizeT; window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { document.querySelectorAll('.chart-slot').forEach((el) => { delete el.dataset.w; }); mountCharts(); }, 150); });
  const lineChart = (series, labels, opts = {}) => slot((w) => drawLine(series, labels, { ...opts, width: w }), opts.height || 190);
  const barChart = (values, labels, opts = {}) => slot((w) => drawBar(values, labels, { ...opts, width: w }), opts.height || 160);
  const showLabel = (i, n, step) => i === n - 1 || (i % step === 0 && n - 1 - i >= step * 0.6);

  function drawLine(series, labels, { height = 190, width = 640, format = (v) => nf0.format(v), tipLabel = (i) => labels[i], minZero = true } = {}) {
    const W = width, H = height, P = { l: 52, r: 12, t: 12, b: 24 };
    const n = labels.length;
    const vals = series.flatMap((s) => s.values);
    const max = Math.max(...vals, 1), min = minZero ? 0 : Math.min(...vals);
    const top = max === min ? max + 1 : max;
    const x = (i) => P.l + (n === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (n - 1));
    const y = (v) => P.t + (H - P.t - P.b) * (1 - (v - min) / (top - min));
    const ticks = [min, (min + top) / 2, top];
    const step = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(W / 90))));
    let svg = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">`;
    ticks.forEach((t) => { svg += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" class="c-grid"/><text x="${P.l - 8}" y="${y(t) + 4}" class="c-axis" text-anchor="end">${esc(format(Math.round(t)))}</text>`; });
    labels.forEach((l, i) => { if (showLabel(i, n, step)) svg += `<text x="${x(i)}" y="${H - 6}" class="c-axis" text-anchor="${i === n - 1 ? 'end' : 'middle'}">${esc(l)}</text>`; });
    series.forEach((s, si) => {
      const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
      if (s.area) svg += `<polygon points="${x(0)},${y(min)} ${pts} ${x(n - 1)},${y(min)}" class="c-area s${si}"/>`;
      svg += `<polyline points="${pts}" class="c-line s${si}" fill="none"/>`;
      svg += `<circle cx="${x(n - 1)}" cy="${y(s.values[n - 1])}" r="3.5" class="c-dot s${si}"/>`;
    });
    const bw = (W - P.l - P.r) / Math.max(1, n);
    labels.forEach((l, i) => {
      const t = `<strong>${esc(tipLabel(i))}</strong>` + series.map((s) => `<br>${esc(s.label)} : ${esc(format(s.values[i]))}`).join('');
      svg += `<rect x="${x(i) - bw / 2}" y="${P.t}" width="${bw}" height="${H - P.t - P.b}" class="c-hit" data-tip="${esc(t)}"/>`;
    });
    return svg + '</svg>';
  }
  function drawBar(values, labels, { height = 160, width = 640, format = (v) => nf0.format(v), valueLabel = (v) => nf0.format(v), tipLabel = (i) => labels[i], highlightLast = true } = {}) {
    const W = width, H = height, P = { l: 8, r: 8, t: 18, b: 24 };
    const n = values.length, max = Math.max(...values, 1);
    const bw = (W - P.l - P.r) / n, gap = Math.min(8, bw * 0.25);
    const step = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(W / 70))));
    let svg = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">`;
    values.forEach((v, i) => {
      const h = Math.max(v ? 3 : 1, ((H - P.t - P.b) * v) / max);
      const xx = P.l + i * bw + gap / 2, yy = H - P.b - h;
      svg += `<rect x="${xx}" y="${yy}" width="${bw - gap}" height="${h}" rx="2" class="c-bar ${highlightLast && i === n - 1 ? 'current' : ''} ${v ? '' : 'zero'}" data-tip="<strong>${esc(tipLabel(i))}</strong><br>${esc(format(v))}"/>`;
      if (v && bw >= 28) svg += `<text x="${xx + (bw - gap) / 2}" y="${yy - 5}" class="c-axis" text-anchor="middle">${esc(valueLabel(v))}</text>`;
      if (showLabel(i, n, step)) svg += `<text x="${xx + (bw - gap) / 2}" y="${H - 6}" class="c-axis" text-anchor="middle">${esc(labels[i])}</text>`;
    });
    return svg + '</svg>';
  }
  function spark(values) {
    const W = 120, H = 28, max = Math.max(...values, 1), n = values.length;
    const pts = values.map((v, i) => `${(i * W) / (n - 1)},${H - 2 - ((H - 4) * v) / max}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,${H} ${pts} ${W},${H}" class="spark-area"/><polyline points="${pts}" class="spark-line" fill="none"/></svg>`;
  }
  const hbar = (rate, cls = '') => `<div class="hbar ${cls}"><span style="width:${Math.max(0, Math.min(100, rate))}%"></span></div>`;

  /* ---------------- Vue d'ensemble ---------------- */
  function todoList(items, limit) {
    if (!items.length) return '<div class="empty-state"><strong>Rien à traiter.</strong>Tout est sous contrôle.</div>';
    return `<ul class="todo">${items.slice(0, limit || items.length).map((t) => `
      <li class="p${t.priority}" ${t.store_id ? `data-store="${t.store_id}"` : ''} ${t.link ? `data-link="${t.link}"` : ''} tabindex="0">
        <span class="todo-kind">${esc(TODO_ICON[t.kind] || 'Info')}</span>
        <span class="todo-main"><strong>${esc(t.title)}</strong>${t.store ? ` <span class="todo-store">${esc(t.store)}</span>` : ''}<span class="todo-detail">${esc(t.detail)}</span></span>
        <span class="todo-open">Ouvrir</span>
      </li>`).join('')}</ul>${limit && items.length > limit ? `<a class="panel-more" href="#/a-traiter">Voir les ${items.length} éléments</a>` : ''}`;
  }

  async function viewOverview() {
    const o = await api('/console/overview');
    const c = o.counts;
    updateTodoBadge(o.todo);
    setSysDot(o.system);
    const [stCls, stLabel] = sysStatus(o.system);
    $('#viewActions').innerHTML = `<a class="live-pill ${stCls}" href="#/systeme"><span class="status-dot ${stCls}"></span>${stLabel === 'Opérationnel' ? 'Plateforme opérationnelle' : stLabel}</a>`;
    const histLabels = o.history.map((h) => dayShort(h.day));
    const f = o.funnel.steps;
    $('#view').innerHTML = `
      <section class="panel todo-panel">
        <div class="panel-head"><h2>À traiter</h2><span class="muted">${o.todo.length} élément${o.todo.length > 1 ? 's' : ''}</span></div>
        ${todoList(o.todo, 5)}
      </section>

      <section class="kpis kpis-console">
        <a class="kpi" href="#/commerces"><span class="kpi-label">Commerces</span><span class="kpi-value">${c.stores}</span>${delta(o.trends.stores)}<span class="kpi-sub">+${c.new_month} ce mois-ci</span></a>
        <a class="kpi" href="#/activite"><span class="kpi-label">Actifs sur 7 jours</span><span class="kpi-value">${c.active_7d}</span>${delta(o.trends.active_7d)}<span class="kpi-sub">${c.stores ? Math.round((c.active_7d / c.stores) * 100) : 0} % des commerces</span></a>
        <a class="kpi" href="#/revenus"><span class="kpi-label">En essai</span><span class="kpi-value">${c.trial}</span><span class="kpi-sub ${c.trial_expired ? 'alert' : ''}">${c.trial_expired} essai${c.trial_expired > 1 ? 's' : ''} terminé${c.trial_expired > 1 ? 's' : ''}</span></a>
        <a class="kpi" href="#/revenus"><span class="kpi-label">Abonnés payants</span><span class="kpi-value">${c.paying}</span>${delta(o.trends.paying)}<span class="kpi-sub">${c.stores ? Math.round((c.paying / c.stores) * 100) : 0} % de conversion</span></a>
        <a class="kpi kpi-strong" href="#/revenus"><span class="kpi-label">Revenu mensuel</span><span class="kpi-value">${money0(o.mrr)}</span>${delta(o.trends.mrr, '€')}<span class="kpi-sub">${money0(o.arr)} par an</span></a>
      </section>

      <div class="grid-2">
        <section class="panel">
          <div class="panel-head"><h2>Commerces actifs par jour</h2><span class="muted">30 jours</span></div>
          <div class="chart-pad">${barChart(o.activity.map((a) => a.stores), o.activity.map((a) => dayShort(a.day)), { tipLabel: (i) => dateFmt(o.activity[i].day), format: (v) => `${nf0.format(v)} commerce${v > 1 ? 's' : ''}` })}</div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Croissance</h2><span class="muted">${o.history.length} jour${o.history.length > 1 ? 's' : ''} d'historique</span></div>
          <div class="chart-pad">${o.history.length > 1
            ? lineChart([{ label: 'Commerces', values: o.history.map((h) => h.stores), area: true }, { label: 'Payants', values: o.history.map((h) => h.paying) }], histLabels, { tipLabel: (i) => dateFmt(o.history[i].day) })
            : `<p class="muted chart-empty">La courbe se construit jour après jour : un point est enregistré chaque matin.</p>`}</div>
          <div class="legend"><span class="lg s0">Commerces</span><span class="lg s1">Payants</span></div>
        </section>
      </div>

      <div class="grid-2">
        <section class="panel">
          <div class="panel-head"><h2>Entonnoir de conversion</h2><span class="muted">${o.funnel.median_hours_to_first_sale !== null ? `1re vente en ${o.funnel.median_hours_to_first_sale < 48 ? nf0.format(o.funnel.median_hours_to_first_sale) + ' h' : nf0.format(o.funnel.median_hours_to_first_sale / 24) + ' j'} (médiane)` : ''}</span></div>
          <div class="funnel">${f.map((s, i) => {
            const rate = f[0].value ? Math.round((s.value / f[0].value) * 100) : 0;
            return `<div class="funnel-row"><div class="funnel-label"><strong>${esc(s.name)}</strong>${s.hint ? `<span class="muted">${esc(s.hint)}</span>` : ''}</div>
              <div class="funnel-bar"><span style="width:${Math.max(rate, s.value ? 2 : 0)}%"></span></div>
              <div class="funnel-num"><strong>${s.value}</strong><span class="muted">${i ? `${rate} % des inscrits` : 'point de départ'}</span></div></div>`;
          }).join('')}</div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Adoption des fonctions</h2><span class="muted">sur ${o.adoption.active} commerce${o.adoption.active > 1 ? 's' : ''} actif${o.adoption.active > 1 ? 's' : ''}</span></div>
          <div class="adoption">${o.adoption.features.slice().sort((a, b) => b.rate - a.rate).map((x) => `
            <div class="adopt-row" data-tip="${esc(`${x.stores} commerce${x.stores > 1 ? 's' : ''} sur ${o.adoption.active}`)}"><span>${esc(x.name)}</span>${hbar(x.rate)}<strong>${x.rate} %</strong></div>`).join('')}</div>
        </section>
      </div>

      <div class="grid-3">
        <section class="panel">
          <div class="panel-head"><h2>Volume encaissé</h2><span class="muted">ce mois-ci</span></div>
          ${o.gmv.length ? `<div class="table-wrap"><table><tbody>${o.gmv.map((g) => {
            const evo = g.previous ? Math.round(((g.amount - g.previous) / g.previous) * 100) : null;
            return `<tr><td><span class="cell-main">${money0(g.amount, g.currency)}</span><div class="cell-sub">${g.sales} vente${g.sales > 1 ? 's' : ''}, ${g.stores} commerce${g.stores > 1 ? 's' : ''}</div></td>
              <td class="num">${evo === null ? '<span class="muted">nouveau</span>' : `<span class="delta ${evo >= 0 ? 'up' : 'down'}">${evo >= 0 ? '+' : ''}${evo} %</span>`}</td></tr>`;
          }).join('')}</tbody></table></div>` : '<div class="empty-state">Aucune vente ce mois-ci.</div>'}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Santé des commerces</h2></div>
          <div class="stack-bar">${HEALTH_ORDER.filter((h) => c.health[h]).map((h) => `<span class="${HEALTH[h]}" style="flex:${c.health[h]}" data-tip="${esc(`${h} : ${c.health[h]}`)}"></span>`).join('')}</div>
          <ul class="legend-list">${HEALTH_ORDER.filter((h) => c.health[h]).map((h) => `<li><a href="#/commerces?sante=${encodeURIComponent(h)}">${healthBadge(h)}</a><strong>${c.health[h]}</strong></li>`).join('')}</ul>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Répartition</h2></div>
          <div class="split-lists">
            <div><h3>Métiers</h3><ul>${o.by_type.slice(0, 6).map((t) => `<li><span>${esc(t.label)}</span><strong>${t.n}</strong></li>`).join('')}</ul></div>
            <div><h3>Pays</h3><ul>${o.by_country.slice(0, 6).map((t) => `<li><span>${esc(t.label)}</span><strong>${t.n}</strong></li>`).join('')}</ul></div>
          </div>
        </section>
      </div>

      <div class="grid-2">
        <section class="panel">
          <div class="panel-head"><h2>Nouveaux commerces par mois</h2></div>
          <div class="chart-pad">${barChart(o.signups.map((s) => s.value), o.signups.map((s) => new Date(s.month + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'short' })), { tipLabel: (i) => new Date(o.signups[i].month + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }), format: (v) => `${v} inscription${v > 1 ? 's' : ''}` })}</div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Derniers événements</h2><a href="#/journal">Journal complet</a></div>
          <ul class="timeline">${o.events.map((e) => `<li data-store="${e.store_id}" tabindex="0"><span class="t-type">${esc(EVENT_LABEL[e.type] || e.type)}</span><strong>${esc(e.store_name || '')}</strong><span class="muted">${esc(e.detail)}</span><span class="t-when">${since(e.created_at)}</span></li>`).join('') || '<li class="muted">Aucun événement.</li>'}</ul>
        </section>
      </div>`;
  }

  /* ---------------- À traiter ---------------- */
  async function viewTodo() {
    const items = await api('/console/todo');
    updateTodoBadge(items);
    const groups = [['Priorité haute', 1], ['À suivre', 2], ['Accompagnement', 3], ['Réglages', 4]];
    $('#view').innerHTML = items.length ? groups.filter(([, p]) => items.some((i) => i.priority === p)).map(([title, p]) => `
      <section class="panel"><div class="panel-head"><h2>${title}</h2><span class="muted">${items.filter((i) => i.priority === p).length}</span></div>${todoList(items.filter((i) => i.priority === p))}</section>`).join('')
      : '<section class="panel"><div class="empty-state"><strong>Rien à traiter.</strong>Aucune demande, aucun essai qui se termine, aucun incident.</div></section>';
  }

  /* ---------------- Commerces ---------------- */
  async function viewStores() {
    const qs = new URLSearchParams(location.hash.split('?')[1] || '');
    if (qs.has('sante')) state.filter.health = qs.get('sante');
    if (qs.has('formule')) state.filter.plan = qs.get('formule');
    state.stores = await api('/console/stores');
    $('#viewActions').innerHTML = '<a class="btn" href="/api/console/export/stores.csv">Exporter en CSV</a>';
    const counts = {}; state.stores.forEach((s) => { counts[s.health] = (counts[s.health] || 0) + 1; });
    $('#view').innerHTML = `
      <div class="toolbar">
        <input type="search" id="sq" placeholder="Commerce, propriétaire, e-mail, métier, pays…" value="${esc(state.filter.q)}">
        <select id="splan"><option value="">Toutes les formules</option>${Object.entries(state.plans).map(([k, p]) => `<option value="${k}" ${state.filter.plan === k ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
        <select id="ssort">${[['activity', 'Plus actifs'], ['recent', 'Plus récents'], ['sales', 'Plus de ventes'], ['inactive', 'Inactifs depuis longtemps'], ['name', 'Nom']].map(([k, l]) => `<option value="${k}" ${state.filter.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <div class="chips health-chips"><button class="chip" data-h="" aria-pressed="${!state.filter.health}">Tous<span class="n">${state.stores.length}</span></button>
        ${HEALTH_ORDER.filter((h) => counts[h]).map((h) => `<button class="chip" data-h="${h}" aria-pressed="${state.filter.health === h}"><i class="dot ${HEALTH[h]}"></i>${h}<span class="n">${counts[h]}</span></button>`).join('')}</div>
      <div id="stable"></div>`;
    $('#sq').addEventListener('input', (e) => { state.filter.q = e.target.value; renderStores(); });
    $('#splan').addEventListener('change', (e) => { state.filter.plan = e.target.value; renderStores(); });
    $('#ssort').addEventListener('change', (e) => { state.filter.sort = e.target.value; renderStores(); });
    $$('[data-h]').forEach((b) => b.addEventListener('click', () => { state.filter.health = b.dataset.h; $$('[data-h]').forEach((x) => x.setAttribute('aria-pressed', x === b)); renderStores(); }));
    renderStores();
  }
  function renderStores() {
    const q = norm(state.filter.q);
    const sorters = {
      activity: (a, b) => b.active_days_30d - a.active_days_30d || b.tickets_30d - a.tickets_30d,
      recent: (a, b) => b.created_at.localeCompare(a.created_at),
      sales: (a, b) => b.tickets_30d + b.documents_30d - (a.tickets_30d + a.documents_30d),
      inactive: (a, b) => (a.last_active_at || '').localeCompare(b.last_active_at || ''),
      name: (a, b) => a.name.localeCompare(b.name, 'fr'),
    };
    const list = state.stores.filter((s) => (!state.filter.health || s.health === state.filter.health) && (!state.filter.plan || s.plan === state.filter.plan) &&
      (!q || norm(`${s.name} ${s.slug} ${s.owner_name} ${s.owner_email} ${s.type_label} ${s.country_name} ${s.phone}`).includes(q))).sort(sorters[state.filter.sort]);
    $('#stable').innerHTML = `<p class="muted list-count">${list.length} commerce${list.length > 1 ? 's' : ''}</p><div class="table-wrap"><table class="stores-table"><thead><tr>
        <th>Commerce</th><th>Formule</th><th>Santé</th><th>Activité 30 j</th><th>Dernière activité</th>
        <th class="num">Ventes 30 j</th><th class="num">Tickets</th><th class="num">Produits</th><th class="num">Vitrine</th></tr></thead><tbody>
      ${list.map((s) => `<tr class="clickable" data-store="${s.id}" tabindex="0">
        <td><span class="cell-main">${esc(s.name)}</span><div class="cell-sub">${esc(s.owner_name)}, ${esc(s.type_label)}, ${esc(s.country_name)}</div></td>
        <td>${esc(s.plan_name)}${s.plan === 'essai' ? `<div class="cell-sub">jusqu'au ${dateFmt(s.trial_ends_at)}</div>` : `<div class="cell-sub">${money0(s.mrr)} / mois</div>`}${s.plan_requested ? `<div class="cell-sub req">veut : ${esc(state.plans[s.plan_requested]?.name)}</div>` : ''}</td>
        <td>${healthBadge(s.health)}</td>
        <td class="spark-cell" data-tip="${esc(`${s.active_days_30d} jour${s.active_days_30d > 1 ? 's' : ''} actif${s.active_days_30d > 1 ? 's' : ''} sur 30`)}">${spark(s.spark)}<span class="cell-sub">${s.active_days_30d} j / 30</span></td>
        <td class="muted">${since(s.last_active_at)}${s.last_sale_at ? `<div class="cell-sub">vente ${since(s.last_sale_at)}</div>` : '<div class="cell-sub">aucune vente</div>'}</td>
        <td class="num">${money0(s.sales_30d, s.currency)}</td><td class="num">${s.tickets_30d}</td><td class="num">${s.products}</td><td class="num">${s.views_30d}</td>
      </tr>`).join('') || '<tr><td colspan="9" class="empty-state">Aucun commerce ne correspond à ces filtres.</td></tr>'}
    </tbody></table></div>`;
  }

  /* ---------------- Activité ---------------- */
  async function viewActivity() {
    const a = await api('/console/activity');
    const max = Math.max(1, ...a.stores.flatMap((s) => s.values));
    const lvl = (v) => (v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
    $('#view').innerHTML = `
      <p class="muted intro">Chaque ligne est un commerce, chaque case un jour. Plus la case est foncée, plus le commerce a utilisé Comptoir ce jour-là (connexions, ventes, modifications).</p>
      <section class="panel heat-panel">
        <div class="heat" style="--days:${a.days.length}">
          <div class="heat-row heat-head"><span></span>${a.days.map((d, i) => `<span class="heat-day">${i % 5 === 0 || i === a.days.length - 1 ? dayShort(d) : ''}</span>`).join('')}<span class="heat-total">Jours actifs</span></div>
          ${a.stores.map((s) => `<div class="heat-row" data-store="${s.id}" tabindex="0">
            <span class="heat-name"><i class="dot ${HEALTH[s.health]}"></i>${esc(s.name)}</span>
            ${s.values.map((v, i) => `<span class="cell l${lvl(v)} ${a.days[i] < s.created ? 'before' : ''}" data-tip="${esc(`<strong>${esc(s.name)}</strong><br>${dateFmt(a.days[i])} : ${v} action${v > 1 ? 's' : ''}`)}"></span>`).join('')}
            <span class="heat-total"><strong>${s.active_days}</strong></span></div>`).join('')}
        </div>
        <div class="heat-legend"><span>Moins</span><i class="cell l0"></i><i class="cell l1"></i><i class="cell l2"></i><i class="cell l3"></i><i class="cell l4"></i><span>Plus</span><span class="muted">Hachuré : pas encore inscrit</span></div>
      </section>`;
  }

  /* ---------------- Revenus ---------------- */
  async function viewRevenue() {
    const r = await api('/console/revenue');
    $('#view').innerHTML = `
      <section class="kpis kpis-console">
        <div class="kpi kpi-strong"><span class="kpi-label">Revenu mensuel (MRR)</span><span class="kpi-value">${money0(r.mrr)}</span><span class="kpi-sub">${money0(r.arr)} par an</span></div>
        <div class="kpi"><span class="kpi-label">Abonnés payants</span><span class="kpi-value">${r.paying}</span><span class="kpi-sub">${money(r.arpa)} par abonné</span></div>
        <div class="kpi"><span class="kpi-label">Conversion des essais</span><span class="kpi-value">${r.trial_conversion === null ? 'n/d' : r.trial_conversion + ' %'}</span><span class="kpi-sub">${r.trials_converted} sur ${r.trials_ended} essai${r.trials_ended > 1 ? 's' : ''} terminé${r.trials_ended > 1 ? 's' : ''}</span></div>
        <div class="kpi"><span class="kpi-label">Essais en cours</span><span class="kpi-value">${r.trials.length}</span><span class="kpi-sub">${r.trials.filter((t) => t.days_left <= 3 && t.days_left >= 0).length} se terminent sous 3 j</span></div>
        <div class="kpi"><span class="kpi-label">Suspensions</span><span class="kpi-value">${r.churned_30d}</span><span class="kpi-sub">sur 30 jours</span></div>
      </section>
      <div class="grid-2">
        <section class="panel">
          <div class="panel-head"><h2>Évolution du revenu mensuel</h2></div>
          <div class="chart-pad">${r.history.length > 1 ? lineChart([{ label: 'MRR', values: r.history.map((h) => h.mrr), area: true }], r.history.map((h) => dayShort(h.day)), { format: (v) => money0(v), tipLabel: (i) => dateFmt(r.history[i].day) }) : '<p class="muted chart-empty">La courbe se construit jour après jour.</p>'}</div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Par formule</h2></div>
          <div class="table-wrap"><table><thead><tr><th>Formule</th><th class="num">Prix</th><th class="num">Abonnés</th><th class="num">MRR</th><th>Part</th></tr></thead><tbody>
            ${r.by_plan.map((p) => `<tr><td class="cell-main">${esc(p.name)}</td><td class="num">${money0(p.price)}</td><td class="num">${p.stores}</td><td class="num">${money0(p.mrr)}</td><td style="width:30%">${hbar(r.mrr ? (p.mrr / r.mrr) * 100 : 0)}</td></tr>`).join('')}
          </tbody></table></div>
        </section>
      </div>
      <div class="grid-2">
        <section class="panel">
          <div class="panel-head"><h2>Essais en cours</h2><span class="muted">par date de fin</span></div>
          ${r.trials.length ? `<div class="table-wrap"><table><tbody>${r.trials.map((t) => `<tr class="clickable" data-store="${t.id}" tabindex="0"><td class="cell-main">${esc(t.name)}<div class="cell-sub">actif ${since(t.last_active_at)}</div></td>
            <td class="num"><span class="${t.days_left <= 3 ? 'delta down' : 'muted'}">${t.days_left > 0 ? `${t.days_left} j restant${t.days_left > 1 ? 's' : ''}` : t.days_left === 0 ? 'dernier jour' : 'terminé'}</span></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">Aucun essai en cours.</div>'}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Abonnés payants</h2></div>
          ${r.paying_stores.length ? `<div class="table-wrap"><table><tbody>${r.paying_stores.map((p) => `<tr class="clickable" data-store="${p.id}" tabindex="0"><td class="cell-main">${esc(p.name)}<div class="cell-sub">${p.since ? `abonné ${since(p.since)}` : ''}, actif ${since(p.last_active_at)}</div></td><td>${esc(p.plan_name)}</td><td class="num">${money0(p.price)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><strong>Pas encore d’abonné payant.</strong>Les demandes de formule arrivent dans « À traiter ».</div>'}
        </section>
      </div>`;
  }

  /* ---------------- Système ---------------- */
  function sysStatus(s) {
    if (s.errors_24h > 20 || (s.requests_24h && s.errors_24h / s.requests_24h > 0.02)) return ['bad', 'Incidents en cours'];
    if (s.errors_24h > 0) return ['warn', 'Quelques erreurs'];
    return ['ok', 'Opérationnel'];
  }
  function setSysDot(s) {
    const [cls, label] = sysStatus(s);
    const d = $('#sysDot'); d.className = `status-dot ${cls}`; d.title = label;
  }
  async function viewSystem() {
    const s = await api('/console/system');
    const [cls, label] = sysStatus({ requests_24h: s.last24.requests, errors_24h: s.last24.errors });
    setSysDot({ requests_24h: s.last24.requests, errors_24h: s.last24.errors });
    const hours = s.hourly.map((h) => `${h.hour.slice(11, 13)} h`);
    const dbPct = s.db_size ? (s.db_size / s.db_limit) * 100 : 0;
    $('#view').innerHTML = `
      <section class="status-banner ${cls}"><span class="status-dot ${cls}"></span><div><strong>${label}</strong><span>${nf0.format(s.last24.requests)} appels sur 24 h, ${s.last24.errors} erreur${s.last24.errors > 1 ? 's' : ''} serveur, temps de réponse moyen ${s.last24.avg_ms} ms</span></div></section>
      <section class="kpis kpis-console">
        <div class="kpi"><span class="kpi-label">Appels sur 24 h</span><span class="kpi-value">${nf0.format(s.last24.requests)}</span><span class="kpi-sub">${s.last24.client_errors} refusés (session, droits, saisie)</span></div>
        <div class="kpi"><span class="kpi-label">Taux d'erreur serveur</span><span class="kpi-value ${s.last24.errors ? 'stock-out' : ''}">${nf2.format(s.last24.error_rate)} %</span><span class="kpi-sub">${s.last24.errors} erreur${s.last24.errors > 1 ? 's' : ''}</span></div>
        <div class="kpi"><span class="kpi-label">Temps de réponse</span><span class="kpi-value">${s.last24.avg_ms} ms</span><span class="kpi-sub">moyenne sur 24 h</span></div>
        <div class="kpi"><span class="kpi-label">Sessions ouvertes</span><span class="kpi-value">${s.sessions.active}</span><span class="kpi-sub">${s.sessions.users} utilisateur${s.sessions.users > 1 ? 's' : ''}</span></div>
        <div class="kpi"><span class="kpi-label">Base de données</span><span class="kpi-value">${bytes(s.db_size)}</span><span class="kpi-sub">${nf2.format(dbPct)} % de 10 Go</span></div>
      </section>
      <div class="grid-2">
        <section class="panel"><div class="panel-head"><h2>Appels par heure</h2><span class="muted">48 h</span></div>
          <div class="chart-pad">${lineChart([{ label: 'Appels', values: s.hourly.map((h) => h.requests), area: true }, { label: 'Erreurs', values: s.hourly.map((h) => h.errors) }], hours, { tipLabel: (i) => `${dateFmt(s.hourly[i].hour.slice(0, 10))} à ${s.hourly[i].hour.slice(11, 13)} h (UTC)` })}</div>
          <div class="legend"><span class="lg s0">Appels</span><span class="lg s1">Erreurs serveur</span></div></section>
        <section class="panel"><div class="panel-head"><h2>Temps de réponse</h2><span class="muted">48 h, en ms</span></div>
          <div class="chart-pad">${lineChart([{ label: 'Moyenne', values: s.hourly.map((h) => h.avg_ms), area: true }, { label: 'Maximum', values: s.hourly.map((h) => h.max_ms) }], hours, { format: (v) => `${nf0.format(v)} ms`, tipLabel: (i) => `${dateFmt(s.hourly[i].hour.slice(0, 10))} à ${s.hourly[i].hour.slice(11, 13)} h (UTC)` })}</div>
          <div class="legend"><span class="lg s0">Moyenne</span><span class="lg s1">Maximum</span></div></section>
      </div>
      <section class="panel"><div class="panel-head"><h2>Trafic sur 30 jours</h2></div>
        <div class="chart-pad">${barChart(s.daily.map((d) => d.requests), s.daily.map((d) => dayShort(d.day)), { tipLabel: (i) => `${dateFmt(s.daily[i].day)} : ${s.daily[i].errors} erreur(s), ${s.daily[i].avg_ms} ms en moyenne`, format: (v) => `${nf0.format(v)} appels` })}</div></section>
      <div class="grid-2">
        <section class="panel"><div class="panel-head"><h2>Fonctions les plus appelées</h2><span class="muted">24 h</span></div>
          <div class="table-wrap"><table><thead><tr><th>Fonction</th><th class="num">Appels</th><th class="num">Refusés</th><th class="num">Erreurs</th><th class="num">Moyenne</th><th class="num">Max</th></tr></thead><tbody>
            ${s.routes.map((r) => `<tr><td><code>${esc(r.route)}</code></td><td class="num">${nf0.format(r.requests)}</td><td class="num muted">${r.client_errors}</td><td class="num ${r.errors ? 'stock-out' : 'muted'}">${r.errors}</td><td class="num ${r.avg_ms > 500 ? 'stock-low' : ''}">${r.avg_ms} ms</td><td class="num muted">${nf0.format(r.max_ms)} ms</td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">Pas encore de trafic.</td></tr>'}
          </tbody></table></div></section>
        <div class="stack">
          <section class="panel"><div class="panel-head"><h2>Configuration</h2></div>
            <ul class="checklist">${s.config.map((c) => `<li class="${c.ok ? 'ok' : 'ko'}"><strong>${esc(c.name)}</strong><span>${esc(c.detail)}</span></li>`).join('')}
              <li class="${s.cron && toDate(s.cron.at) > new Date(Date.now() - 30 * 3600000) ? 'ok' : 'ko'}"><strong>Tâche du matin</strong><span>${s.cron ? `${since(s.cron.at)} : ${esc(s.cron.result.join(', '))}` : "Jamais exécutée : elle se lance chaque jour à 6 h UTC une fois déployée"}</span></li></ul></section>
          <section class="panel"><div class="panel-head"><h2>Volume des données</h2></div>
            <div class="db-gauge">${hbar(Math.max(dbPct, 0.5))}<span class="muted">${bytes(s.db_size)} utilisés sur 10 Go</span></div>
            <div class="table-wrap"><table><tbody>${s.tables.map((t) => `<tr><td><code>${esc(t.table)}</code></td><td class="num">${nf0.format(t.rows)} ligne${t.rows > 1 ? 's' : ''}</td></tr>`).join('')}</tbody></table></div></section>
        </div>
      </div>
      <section class="panel"><div class="panel-head"><h2>Dernières erreurs serveur</h2><span class="muted">conservées 90 jours</span></div>
        ${s.errors.length ? `<div class="table-wrap"><table><thead><tr><th>Quand</th><th>Fonction</th><th>Commerce</th><th>Message</th></tr></thead><tbody>
          ${s.errors.map((e) => `<tr><td class="muted">${since(e.created_at)}</td><td><code>${esc(e.method)} ${esc(e.path)}</code></td><td>${e.store_id ? `<button class="link" data-store="${e.store_id}">${esc(e.store_name || '#' + e.store_id)}</button>` : '<span class="muted">aucun</span>'}</td><td class="err-msg">${esc(e.message)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty-state"><strong>Aucune erreur serveur enregistrée.</strong></div>'}</section>`;
  }

  /* ---------------- Journal ---------------- */
  async function viewEvents(append = false) {
    const p = state.events || { type: '', before: null, rows: [] };
    if (!append) { p.before = null; p.rows = []; }
    const qs = new URLSearchParams(); if (p.type) qs.set('type', p.type); if (p.before) qs.set('before', p.before);
    const r = await api(`/console/events?${qs}`);
    p.rows = p.rows.concat(r.events); p.before = r.next; state.events = p;
    $('#view').innerHTML = `
      <div class="chips"><button class="chip" data-etype="" aria-pressed="${!p.type}">Tout</button>${r.types.map((t) => `<button class="chip" data-etype="${t.type}" aria-pressed="${p.type === t.type}">${esc(EVENT_LABEL[t.type] || t.type)}<span class="n">${t.n}</span></button>`).join('')}</div>
      <section class="panel" style="margin-top:14px"><div class="table-wrap"><table><thead><tr><th>Quand</th><th>Événement</th><th>Commerce</th><th>Détail</th><th>Par</th></tr></thead><tbody>
        ${p.rows.map((e) => `<tr><td class="muted" title="${esc(e.created_at)}">${since(e.created_at)}</td><td><span class="t-type">${esc(EVENT_LABEL[e.type] || e.type)}</span></td><td>${e.store_id ? `<button class="link" data-store="${e.store_id}">${esc(e.store_name)}</button>` : ''}</td><td>${esc(e.detail)}</td><td class="muted">${esc(e.user_name || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty-state">Aucun événement.</td></tr>'}
      </tbody></table></div>${p.before ? '<div class="more-row"><button class="btn" id="moreEvents">Afficher plus</button></div>' : ''}</section>`;
    $$('[data-etype]').forEach((b) => b.addEventListener('click', () => { state.events.type = b.dataset.etype; viewEvents(false).catch(fail); }));
    $('#moreEvents')?.addEventListener('click', () => viewEvents(true).catch(fail));
  }

  /* ---------------- Utilisateurs ---------------- */
  async function viewUsers() {
    const users = await api('/console/users');
    const render = (q) => {
      const n = norm(q);
      const list = users.filter((u) => !n || norm(`${u.name} ${u.email} ${u.store_name}`).includes(n));
      $('#utable').innerHTML = `<p class="muted list-count">${list.length} utilisateur${list.length > 1 ? 's' : ''}</p><div class="table-wrap"><table><thead><tr><th>Utilisateur</th><th>Commerce</th><th>Rôle</th><th>Dernière connexion</th><th>Sessions</th><th></th></tr></thead><tbody>
        ${list.map((u) => `<tr><td><span class="cell-main">${esc(u.name)}</span>${u.platform_admin ? ' <span class="badge s-info">admin plateforme</span>' : ''}<div class="cell-sub">${esc(u.email)}${u.must_change_password ? ', mot de passe temporaire' : ''}</div></td>
          <td>${u.store_id ? `<button class="link" data-store="${u.store_id}">${esc(u.store_name)}</button>` : '<span class="muted">aucun</span>'}</td>
          <td>${u.role === 'owner' ? 'propriétaire' : u.role === 'staff' ? 'employé' : ''}</td>
          <td class="muted">${since(u.last_login_at)}</td><td class="num">${u.sessions}</td>
          <td class="num nowrap"><button class="btn btn-sm" data-ulogout="${u.id}" ${u.sessions ? '' : 'disabled'}>Déconnecter</button> <button class="btn btn-sm" data-ureset="${u.id}">Nouveau mot de passe</button></td></tr>`).join('')}
      </tbody></table></div>`;
    };
    $('#view').innerHTML = `<div class="toolbar"><input type="search" id="uq" placeholder="Nom, e-mail, commerce…"></div><div id="utable"></div>`;
    $('#uq').addEventListener('input', (e) => render(e.target.value));
    render('');
  }
  async function resetPassword(id, after) {
    if (!confirm('Générer un mot de passe temporaire ? La personne sera déconnectée et devra en choisir un nouveau.')) return;
    try {
      const r = await api(`/console/users/${id}/reset`, { method: 'POST', body: {} });
      openModal('Mot de passe temporaire', `<p>À transmettre à l'utilisateur :</p><div class="credentials"><div><span>E-mail</span><strong>${esc(r.email)}</strong></div><div><span>Mot de passe temporaire</span><strong class="mono">${esc(r.temp_password)}</strong></div></div>
        <div class="modal-foot"><div class="right"><button class="btn btn-primary" id="credOk">C'est noté</button></div></div>`);
      $('#credOk').addEventListener('click', () => { closeModal(); after?.(); });
    } catch (e) { fail(e); }
  }

  /* ---------------- Fiche commerce (panneau latéral) ---------------- */
  const drawer = $('#drawer');
  function closeDrawer() {
    drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); $('#drawerBackdrop').hidden = true;
    state.drawer = null; document.body.classList.remove('locked');
  }
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#drawerBackdrop').addEventListener('click', closeDrawer);

  async function openStore(id, tab = 'apercu') {
    let d;
    try { d = await api(`/console/stores/${id}`); } catch (e) { return fail(e); }
    state.drawer = { id, tab, d };
    const s = d.store;
    $('#drawerTitle').textContent = s.name;
    $('#drawerSub').innerHTML = `${healthBadge(s.health)} ${esc(s.type_label)}, ${esc(s.country_name)}, inscrit ${since(s.created_at)} <a href="/s/${esc(s.slug)}" target="_blank" rel="noopener">Ouvrir la vitrine</a>`;
    const tabs = [['apercu', 'Aperçu'], ['usage', 'Utilisation'], ['abonnement', 'Abonnement'], ['equipe', 'Équipe'], ['journal', 'Journal']];
    $('#drawerTabs').innerHTML = tabs.map(([k, l]) => `<button class="chip" data-dtab="${k}" aria-pressed="${k === tab}">${l}</button>`).join('');
    $$('[data-dtab]').forEach((b) => b.addEventListener('click', () => { state.drawer.tab = b.dataset.dtab; $$('[data-dtab]').forEach((x) => x.setAttribute('aria-pressed', x === b)); renderDrawer(); }));
    renderDrawer();
    if (!drawer.classList.contains('open')) {
      drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); $('#drawerBackdrop').hidden = false; document.body.classList.add('locked');
      setTimeout(() => $('#drawerClose').focus(), 50);
    }
  }

  function renderDrawer() {
    const { d, tab } = state.drawer;
    const s = d.store, t = d.totals, cur = d.contact.currency || '€';
    const body = $('#drawerBody');
    const days = d.daily.map((x) => dayShort(x.day));
    if (tab === 'apercu') {
      body.innerHTML = `
        ${s.plan_requested ? `<div class="notice">Demande de formule <strong>${esc(state.plans[s.plan_requested]?.name)}</strong> en attente. <button class="link" data-dtab-go="abonnement">Traiter</button></div>` : ''}
        <section class="kpis kpis-console">
          <div class="kpi"><span class="kpi-label">Ventes totales</span><span class="kpi-value">${money0(t.sales_total, cur)}</span><span class="kpi-sub">${money0(d.daily.reduce((a, x) => a + x.sales, 0), cur)} sur 30 j</span></div>
          <div class="kpi"><span class="kpi-label">Tickets</span><span class="kpi-value">${t.tickets}</span><span class="kpi-sub">${d.daily.reduce((a, x) => a + x.tickets, 0)} sur 30 j</span></div>
          <div class="kpi"><span class="kpi-label">Impayés</span><span class="kpi-value">${money0(t.unpaid_amount, cur)}</span><span class="kpi-sub">${t.unpaid_count} facture${t.unpaid_count > 1 ? 's' : ''}</span></div>
          <div class="kpi"><span class="kpi-label">Adoption</span><span class="kpi-value">${d.adoption_score} %</span><span class="kpi-sub">des fonctions utilisées</span></div>
        </section>
        <section class="panel"><div class="panel-head"><h2>Activité sur 30 jours</h2><span class="muted">${d.daily.filter((x) => x.actions > 0).length} jour(s) actif(s)</span></div>
          <div class="chart-pad">${barChart(d.daily.map((x) => x.actions), days, { height: 120, tipLabel: (i) => `${dateFmt(d.daily[i].day)} : ${d.daily[i].tickets} ticket(s), ${money0(d.daily[i].sales, cur)}, ${d.daily[i].views} vue(s) vitrine`, format: (v) => `${v} action${v > 1 ? 's' : ''}` })}</div></section>
        <section class="panel"><div class="panel-head"><h2>Ventes sur 30 jours</h2></div>
          <div class="chart-pad">${barChart(d.daily.map((x) => x.sales), days, { height: 120, format: (v) => money0(v, cur), tipLabel: (i) => dateFmt(d.daily[i].day) })}</div></section>
        <dl class="facts">
          <div><dt>Propriétaire</dt><dd>${esc(d.team.find((u) => u.role === 'owner')?.name || '')}<br><a href="mailto:${esc(d.team.find((u) => u.role === 'owner')?.email || '')}">${esc(d.team.find((u) => u.role === 'owner')?.email || '')}</a></dd></div>
          <div><dt>Téléphone</dt><dd>${d.contact.phone ? `<a href="tel:${esc(d.contact.phone.replace(/\s/g, ''))}">${esc(d.contact.phone)}</a>` : '<span class="muted">non renseigné</span>'}</dd></div>
          <div><dt>Adresse</dt><dd>${esc(d.contact.address || '') || '<span class="muted">non renseignée</span>'}</dd></div>
          <div><dt>Dernière activité</dt><dd>${since(s.last_active_at)}</dd></div>
          <div><dt>Première vente</dt><dd>${t.first_sale_at ? `${dateFmt(t.first_sale_at)} (${since(t.first_sale_at)})` : '<span class="muted">aucune</span>'}</dd></div>
          <div><dt>Dernière vente</dt><dd>${t.last_sale_at ? since(t.last_sale_at) : '<span class="muted">aucune</span>'}</dd></div>
          <div><dt>Catalogue</dt><dd>${t.products} produit${t.products > 1 ? 's' : ''}, ${t.stock_out} en rupture</dd></div>
          <div><dt>Sessions ouvertes</dt><dd>${d.active_sessions}</dd></div>
        </dl>`;
    } else if (tab === 'usage') {
      body.innerHTML = `
        <div class="score"><div class="score-ring" style="--p:${d.adoption_score}"><span>${d.adoption_score} %</span></div><p>Ce commerce utilise <strong>${d.features.filter((f) => f.used).length} fonction${d.features.filter((f) => f.used).length > 1 ? 's' : ''} sur ${d.features.length}</strong>. Les fonctions inutilisées sont des pistes d'accompagnement.</p></div>
        <ul class="features">${d.features.map((f) => `<li class="${f.used ? 'used' : ''}"><strong>${esc(f.name)}</strong><span>${esc(f.detail)}</span></li>`).join('')}</ul>
        <section class="panel"><div class="panel-head"><h2>Vues de la vitrine</h2><span class="muted">30 jours</span></div>
          <div class="chart-pad">${barChart(d.daily.map((x) => x.views), days, { height: 110, tipLabel: (i) => dateFmt(d.daily[i].day), format: (v) => `${v} vue${v > 1 ? 's' : ''}` })}</div></section>`;
    } else if (tab === 'abonnement') {
      body.innerHTML = `
        ${s.plan_requested ? `<div class="notice">Le commerçant demande la formule <strong>${esc(state.plans[s.plan_requested]?.name)}</strong>. <button class="btn btn-sm btn-primary" id="approveReq">Activer cette formule</button> <button class="btn btn-sm" id="declineReq">Refuser</button></div>` : ''}
        <form id="subForm" class="fields">
          <label class="field"><span>Formule</span><select name="plan">${Object.entries(state.plans).map(([k, p]) => `<option value="${k}" ${k === s.plan ? 'selected' : ''}>${esc(p.name)}${p.price ? ` (${p.price} € / mois)` : ''}</option>`).join('')}</select></label>
          <label class="field"><span>Statut</span><select name="status"><option value="active" ${s.status === 'active' ? 'selected' : ''}>Actif</option><option value="suspended" ${s.status === 'suspended' ? 'selected' : ''}>Suspendu (lecture seule, vitrine masquée)</option></select></label>
          <label class="field"><span>Fin de l'essai</span><input type="date" name="trial_ends_at" value="${esc(s.trial_ends_at || '')}"></label>
          <div class="field"><span>Raccourcis</span><div class="quick"><button type="button" class="btn btn-sm" data-extend="7">+7 jours</button><button type="button" class="btn btn-sm" data-extend="14">+14 jours</button><button type="button" class="btn btn-sm" data-extend="30">+30 jours</button></div></div>
          <label class="field full"><span>Notes internes</span><textarea name="console_notes" rows="5" placeholder="Échanges, conditions négociées, moyen de paiement…">${esc(s.console_notes)}</textarea></label>
        </form>
        <div class="drawer-actions"><button class="btn btn-primary" id="subSave">Enregistrer</button></div>`;
      const form = $('#subForm');
      $$('[data-extend]').forEach((b) => b.addEventListener('click', () => {
        const todayIso = new Date().toISOString().slice(0, 10);
        const base = form.trial_ends_at.value > todayIso ? form.trial_ends_at.value : todayIso;
        const dt = new Date(base + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + Number(b.dataset.extend));
        form.trial_ends_at.value = dt.toISOString().slice(0, 10);
      }));
      const save = async (data, msg) => {
        try { await api(`/console/stores/${s.id}`, { method: 'POST', body: data }); toast(msg); await openStore(s.id, 'abonnement'); refreshCurrent(); } catch (ex) { fail(ex); }
      };
      $('#subSave').addEventListener('click', () => {
        const data = Object.fromEntries(new FormData(form));
        if (data.status === 'suspended' && s.status !== 'suspended' && !confirm(`Suspendre ${s.name} ? Son espace passera en lecture seule et sa vitrine sera masquée.`)) return;
        save(data, 'Commerce mis à jour');
      });
      $('#approveReq')?.addEventListener('click', () => save({ plan: s.plan_requested, status: 'active' }, 'Formule activée'));
      $('#declineReq')?.addEventListener('click', () => save({ clear_request: true }, 'Demande retirée'));
    } else if (tab === 'equipe') {
      body.innerHTML = `<div class="table-wrap"><table><tbody>${d.team.map((u) => `<tr><td><span class="cell-main">${esc(u.name)}</span><div class="cell-sub">${esc(u.email)}, ${u.role === 'owner' ? 'propriétaire' : 'employé'}</div></td>
        <td class="muted">${u.last_login_at ? 'connecté ' + since(u.last_login_at) : 'jamais connecté'}</td>
        <td class="num"><button class="btn btn-sm" data-ureset="${u.id}">Nouveau mot de passe</button></td></tr>`).join('')}</tbody></table></div>`;
    } else if (tab === 'journal') {
      body.innerHTML = `<ul class="timeline compact">${d.events.map((e) => `<li><span class="t-type">${esc(EVENT_LABEL[e.type] || e.type)}</span><span>${esc(e.detail)}${e.user_name ? ` <span class="muted">(${esc(e.user_name)})</span>` : ''}</span><span class="t-when" title="${esc(e.created_at)}">${since(e.created_at)}</span></li>`).join('') || '<li class="muted">Aucun événement.</li>'}</ul>`;
    }
    $$('[data-dtab-go]', body).forEach((b) => b.addEventListener('click', () => { state.drawer.tab = b.dataset.dtabGo; $$('[data-dtab]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.dtab === state.drawer.tab)); renderDrawer(); }));
  }

  /* ---------------- Recherche rapide ---------------- */
  const searchDialog = $('#searchDialog');
  async function openSearch() {
    if (!state.stores) { try { state.stores = await api('/console/stores'); } catch (e) { return fail(e); } }
    searchDialog.showModal(); $('#searchInput').value = ''; renderSearch(''); $('#searchInput').focus();
  }
  function renderSearch(q) {
    const n = norm(q);
    const list = state.stores.filter((s) => !n || norm(`${s.name} ${s.owner_name} ${s.owner_email} ${s.type_label} ${s.country_name} ${s.phone}`).includes(n)).slice(0, 8);
    $('#searchResults').innerHTML = list.map((s, i) => `<li><button data-pick="${s.id}" class="${i === 0 ? 'first' : ''}"><strong>${esc(s.name)}</strong><span>${esc(s.owner_name)}, ${esc(s.type_label)}, ${esc(s.country_name)}</span>${healthBadge(s.health)}</button></li>`).join('') || '<li class="muted">Aucun commerce.</li>';
  }
  $('#openSearch').addEventListener('click', openSearch);
  $('#openSearchM').addEventListener('click', openSearch);
  $('#searchInput').addEventListener('input', (e) => renderSearch(e.target.value));
  $('#searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { $('#searchResults button')?.click(); } });
  $('#searchResults').addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) { searchDialog.close(); openStore(Number(b.dataset.pick)); } });
  searchDialog.addEventListener('click', (e) => { if (e.target === searchDialog) searchDialog.close(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
    if (e.key === 'Escape' && drawer.classList.contains('open') && !modal.open) closeDrawer();
    if (e.key === 'Enter' && document.activeElement?.matches('[data-store][tabindex], [data-link][tabindex]')) document.activeElement.click();
  });

  /* ---------------- Routeur et rafraîchissement ---------------- */
  function updateTodoBadge(items) {
    const n = items.filter((i) => i.priority <= 2).length;
    $('#badgeTodo').hidden = !n; $('#badgeTodo').textContent = n;
  }
  const VIEWS = {
    'vue-d-ensemble': ["Vue d'ensemble", viewOverview, true], 'a-traiter': ['À traiter', viewTodo, true], commerces: ['Commerces', viewStores, false],
    activite: ['Activité des commerces', viewActivity, false], revenus: ['Revenus', viewRevenue, false], systeme: ['Système', viewSystem, true],
    journal: ['Journal', () => viewEvents(false), false], utilisateurs: ['Utilisateurs', viewUsers, false],
  };
  let lastRefresh = null;
  function route() {
    const key = (location.hash.replace(/^#\//, '') || 'vue-d-ensemble').split('?')[0];
    const [title, fn, auto] = VIEWS[key] || VIEWS['vue-d-ensemble'];
    $$('.side-nav a, .console-mnav a').forEach((a) => a.classList.toggle('active', a.dataset.view === key));
    $('.console-mnav a.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    $('#viewTitle').textContent = title; $('#viewActions').innerHTML = '';
    document.title = `${title} : console Comptoir`;
    for (const id of chartFns.keys()) if (!document.querySelector(`.chart-slot[data-c="${id}"]`)) chartFns.delete(id);
    load(fn);
    clearInterval(state.timer);
    if (auto) state.timer = setInterval(() => { if (!document.hidden && !state.drawer && !modal.open) load(fn, true); }, 60000);
  }
  function load(fn, silent = false) {
    const y = window.scrollY;
    if (silent) cache.clear(); // la mise à jour automatique va toujours chercher des chiffres frais
    const slow = silent ? null : setTimeout(() => { $('#view').innerHTML = '<p class="loading">Chargement…</p>'; }, 180);
    Promise.resolve(fn()).finally(() => clearTimeout(slow)).then(() => { lastRefresh = Date.now(); renderRefreshed(); if (silent) window.scrollTo(0, y); }).catch(fail);
  }
  function refreshCurrent() { const key = (location.hash.replace(/^#\//, '') || 'vue-d-ensemble').split('?')[0]; if (VIEWS[key]) load(VIEWS[key][1], true); state.stores = null; }
  function renderRefreshed() { $('#refreshed').textContent = lastRefresh ? `Mis à jour ${since(new Date(lastRefresh).toISOString())}` : ''; }
  setInterval(renderRefreshed, 30000);
  window.addEventListener('hashchange', route);

  document.addEventListener('click', (e) => {
    const r = e.target.closest('[data-ureset]'); if (r) { resetPassword(r.dataset.ureset, () => (state.drawer ? openStore(state.drawer.id, 'equipe') : route())); return; }
    const lo = e.target.closest('[data-ulogout]'); if (lo) { api(`/console/users/${lo.dataset.ulogout}/logout`, { method: 'POST', body: {} }).then(() => { toast('Sessions fermées'); route(); }).catch(fail); return; }
    const l = e.target.closest('[data-link]'); if (l) { location.hash = l.dataset.link; return; }
    const st = e.target.closest('[data-store]'); if (st && st.dataset.store && st.dataset.store !== 'null' && !e.target.closest('#drawer')) openStore(Number(st.dataset.store));
  });
  $('#logout').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); location.href = '/app/'; });

  (async () => {
    try {
      const me = await fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => r.json());
      if (!me.authenticated || !me.platform_admin) {
        $('#gate').hidden = false;
        if (me.authenticated) $('#gateMsg').textContent = "Ce compte n'a pas accès à la console de la plateforme.";
        return;
      }
      state.me = me;
      $('#myStore').hidden = !me.store;
      state.plans = await api('/console/plans');
      $('#app').hidden = false;
      route();
      api('/console/todo').then(updateTodoBadge).catch(() => {});
      setTimeout(() => ['commerces', 'a-traiter', 'systeme'].forEach(prefetch), 1500);
    } catch (e) { $('#gate').hidden = false; }
  })();
})();
