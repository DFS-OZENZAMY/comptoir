(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const AVAIL = { in: 'En stock', low: 'Stock limité', out: 'Sur commande' };

  const state = { settings: {}, categories: [], products: [], category: 'all', query: '' };
  const slug = (location.pathname.match(/^\/s\/([a-z0-9-]+)/) || [])[1] || '';

  // Couleur du commerce, avec un texte lisible (clair ou foncé) selon sa luminosité.
  function applyAccent(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return;
    const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    document.documentElement.style.setProperty('--accent', '#' + m[1]);
    const dk = (v) => Math.round(v * 0.74).toString(16).padStart(2, '0');
    document.documentElement.style.setProperty('--accent-dark', lum > 0.62 ? '#' + m[1] : `#${dk(r)}${dk(g)}${dk(b)}`);
    document.documentElement.style.setProperty('--on-accent', lum > 0.62 ? '#16181D' : '#FFFFFF');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#' + m[1]);
  }

  const money = (n) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' ' + (state.settings.currency || '€');
  // Sans photo : les trois premières lettres du nom (« Café moulu » donne CAF).
  const initials = (p) => esc(norm(p.name).replace(/[^a-z0-9]/g, '').slice(0, 3).toUpperCase() || '·');
  const media = (p) => p.image
    ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async" width="300" height="225">`
    : `<span class="placeholder" aria-hidden="true">${initials(p)}</span>`;
  const telHref = () => (state.settings.phone ? 'tel:' + state.settings.phone.replace(/[^\d+]/g, '') : '#infos');

  /* --- Paramètres du magasin --- */
  function applySettings() {
    const s = state.settings;
    document.querySelectorAll('[data-setting]').forEach((el) => {
      const v = s[el.dataset.setting];
      if (!v) return;
      el.textContent = v;
      if (el.dataset.href === 'tel') el.href = telHref();
      if (el.dataset.href === 'mailto') el.href = 'mailto:' + v;
    });
    applyAccent(s.accent);
    document.querySelectorAll('.infos-list > div').forEach((div) => { div.hidden = !(s[div.querySelector('[data-setting]').dataset.setting] || '').trim(); });
    $('#brandLink').href = location.pathname;
    $('#hoursPill').hidden = !s.hours;
    $('#hoursText').textContent = s.hours ? `Horaires : ${s.hours}` : '';
    $('#callBig').hidden = !s.phone;
    $('#callBig').href = telHref();
    if (s.phone) $('#callBigText').textContent = `Appeler le ${s.phone}`;
    if (s.tagline) document.querySelector('meta[name="description"]').setAttribute('content', s.tagline);
    $('#callTop').hidden = !s.phone;
    $('#callTop').href = telHref();
    $('#callTop').setAttribute('aria-label', `Appeler le magasin${s.phone ? ' au ' + s.phone : ''}`);
    $('#pdCall').href = telHref();
    if (s.phone) $('#pdCall').textContent = `Appeler le ${s.phone}`;
    if (s.shop_name) {
      document.title = `${s.shop_name} : catalogue`;
      const words = s.shop_name.split(' ');
      $('#heroTitle').innerHTML = words.length > 1
        ? esc(words.slice(0, -1).join(' ')) + '<br>' + esc(words.at(-1))
        : esc(s.shop_name);
    }
  }

  /* --- Catégories et grille --- */
  function renderCats() {
    const counts = {};
    state.products.forEach((p) => { counts[p.category_id] = (counts[p.category_id] || 0) + 1; });
    const cats = [{ id: 'all', name: 'Tous les produits', n: state.products.length },
      ...state.categories.filter((c) => counts[c.id]).map((c) => ({ ...c, n: counts[c.id] }))];
    $('#cats').innerHTML = cats.map((c) =>
      `<button class="cat" type="button" data-cat="${c.id}" aria-pressed="${String(c.id) === String(state.category)}">${esc(c.name)}<span class="n">${c.n}</span></button>`
    ).join('');
  }

  function filtered() {
    const q = norm(state.query);
    return state.products.filter((p) =>
      (state.category === 'all' || String(p.category_id) === String(state.category)) &&
      (!q || norm(`${p.name} ${p.ref} ${p.description}`).includes(q)));
  }

  function renderGrid() {
    const list = filtered();
    $('#resultCount').textContent = list.length ? `${list.length} produit${list.length > 1 ? 's' : ''}` : '';
    if (!list.length) {
      $('#grid').innerHTML = state.products.length
        ? `<div class="empty"><strong>Aucun produit ne correspond à « ${esc(state.query)} ».</strong>Essayez un autre mot ou une référence, ou appelez-nous : nous avons souvent ce qui n'est pas en ligne.</div>`
        : `<div class="empty"><strong>Le catalogue est en cours de préparation.</strong>Revenez bientôt ou contactez-nous.</div>`;
      return;
    }
    $('#grid').innerHTML = list.map((p) => `
      <article class="card">
        <button class="card-open" type="button" data-open="${p.id}" aria-label="${esc(p.name)}, voir le détail">
          <div class="card-media">${media(p)}</div>
          <div class="card-body">
            <span class="card-ref">${esc(p.ref)}</span>
            <h3 class="card-name">${esc(p.name)}</h3>
            ${p.availability ? `<span class="avail ${p.availability}">${AVAIL[p.availability]}</span>` : ''}
          </div>
          ${p.price_ttc !== null ? `<div class="card-foot">
            <span class="price">${money(p.price_ttc)} <small>/ ${esc(p.unit)}</small></span>
          </div>` : ''}
        </button>
      </article>`).join('');
  }

  /* --- Fiche produit --- */
  function openProduct(id) {
    const p = state.products.find((x) => x.id === id);
    if (!p) return;
    $('#pdMedia').innerHTML = media(p);
    $('#pdRef').textContent = p.ref ? 'Réf. ' + p.ref : '';
    $('#pdRefInline').textContent = p.ref || p.name;
    $('#pdName').textContent = p.name;
    $('#pdDesc').textContent = p.description || '';
    $('#pdPrice').textContent = p.price_ttc !== null ? money(p.price_ttc) : '';
    $('#pdUnit').textContent = p.price_ttc !== null ? 'TTC / ' + p.unit : '';
    const a = $('#pdAvail'); a.hidden = !p.availability;
    if (p.availability) { a.className = 'avail ' + p.availability; a.textContent = AVAIL[p.availability]; }
    $('#productDialog').showModal();
  }

  /* --- Événements --- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.cat) { state.category = t.dataset.cat; renderCats(); renderGrid(); }
    else if (t.dataset.open) openProduct(Number(t.dataset.open));
  });
  $('#productDialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('#pdCall').addEventListener('click', (e) => { if ($('#pdCall').getAttribute('href') === '#infos') $('#productDialog').close(); });
  $('#search').addEventListener('input', (e) => { state.query = e.target.value; renderGrid(); });
  $('#year').textContent = new Date().getFullYear();

  /* --- Chargement --- */
  (async () => {
    try {
      // Données livrées avec la page par le serveur (aucun aller-retour) ; sinon, appel à l'API.
      let data, status = 200;
      if (window.__STORE__ !== undefined) { data = window.__STORE__; status = data ? 200 : 404; }
      else { const res = await fetch(`/api/public/stores/${encodeURIComponent(slug)}`); data = await res.json(); status = res.status; }
      const res = { status, ok: status === 200 };
      if (res.status === 404) {
        document.querySelectorAll('.topbar, .hero, .cats, .catalog, .infos').forEach((el) => { el.hidden = true; });
        $('#notFound').hidden = false; document.title = 'Commerce introuvable';
        return;
      }
      if (!res.ok) throw new Error(data.error);
      Object.assign(state, data);
      applySettings();
      renderCats();
      renderGrid();
    } catch (e) {
      $('#grid').innerHTML = `<div class="empty"><strong>Le catalogue n'a pas pu être chargé.</strong>Actualisez la page dans un instant.</div>`;
    }
  })();
})();
