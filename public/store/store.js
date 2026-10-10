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
  /* --- Panier WhatsApp --- */
  const CART_KEY = `comptoir.panier.${slug}`;
  let cart = {};
  try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '{}') || {}; } catch { cart = {}; }
  const saveCart = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* navigation privée */ } };
  const waOn = () => !!state.settings.whatsapp;
  const cartItems = () => Object.entries(cart).map(([id, q]) => ({ p: state.products.find((x) => x.id === Number(id)), q })).filter((x) => x.p && x.q > 0);
  const addBtn = (p) => {
    if (!waOn()) return '';
    const q = cart[p.id] || 0;
    return q ? `<div class="card-qty" aria-label="Quantité dans le panier"><button type="button" data-dec="${p.id}" aria-label="Retirer un">−</button><span>${q}</span><button type="button" data-inc="${p.id}" aria-label="Ajouter un">+</button></div>`
      : `<button class="card-add" type="button" data-inc="${p.id}">Ajouter</button>`;
  };
  function setQty(id, q) {
    if (q > 0) cart[id] = Math.min(999, q); else delete cart[id];
    saveCart(); renderGrid(); renderCart();
  }
  function renderCart() {
    const items = cartItems();
    const n = items.reduce((a, x) => a + x.q, 0);
    const priced = items.every((x) => x.p.price_ttc !== null);
    const sum = items.reduce((a, x) => a + (x.p.price_ttc || 0) * x.q, 0);
    $('#cartBar').hidden = !waOn() || !n;
    $('#cartCount').textContent = `${n} article${n > 1 ? 's' : ''}`;
    $('#cartTotal').textContent = priced ? money(sum) : '';
    $('#cartSum').textContent = priced ? money(sum) : 'à confirmer';
    $('#cartList').innerHTML = items.map(({ p, q }) => `<li><div><strong>${esc(p.name)}</strong><span>${p.ref ? 'Réf. ' + esc(p.ref) + ' · ' : ''}${p.price_ttc !== null ? money(p.price_ttc) + ' / ' + esc(p.unit) : 'prix à confirmer'}</span></div>
      <div class="card-qty"><button type="button" data-dec="${p.id}" aria-label="Retirer un">−</button><span>${q}</span><button type="button" data-inc="${p.id}" aria-label="Ajouter un">+</button></div></li>`).join('') || '<li class="cart-empty">Votre panier est vide.</li>';
    document.body.classList.toggle('has-cart', !$('#cartBar').hidden);
  }
  function sendWhatsApp(form) {
    const items = cartItems();
    const s = state.settings;
    const name = form.name.value.trim();
    if (!items.length) { $('#cartErr').textContent = 'Votre panier est vide.'; return; }
    if (!name) { $('#cartErr').textContent = 'Indiquez votre nom.'; form.name.focus(); return; }
    if (form.mode.value === 'livraison' && !form.address.value.trim()) { $('#cartErr').textContent = 'Indiquez l’adresse de livraison.'; form.address.focus(); return; }
    const priced = items.every((x) => x.p.price_ttc !== null);
    const sum = items.reduce((a, x) => a + (x.p.price_ttc || 0) * x.q, 0);
    const lines = [
      `Bonjour ${s.shop_name || ''}, je souhaite commander :`,
      ...items.map(({ p, q }) => `• ${q} × ${p.name}${p.ref ? ` (réf. ${p.ref})` : ''}${p.price_ttc !== null ? ` : ${money(p.price_ttc * q)}` : ''}`),
      priced ? `Total estimé : ${money(sum)}` : '',
      '',
      `Nom : ${name}`,
      form.mode.value === 'livraison' ? `Livraison : ${form.address.value.trim()}` : 'Retrait en boutique',
      form.note.value.trim() ? `Remarque : ${form.note.value.trim()}` : '',
    ].filter((l, i, a) => l !== '' || (a[i - 1] && a[i - 1] !== ''));
    window.open(`https://wa.me/${s.whatsapp}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank', 'noopener');
  }

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
    $('#waTop').hidden = !s.whatsapp;
    if (s.whatsapp) $('#waTop').href = `https://wa.me/${s.whatsapp}?text=${encodeURIComponent(`Bonjour ${s.shop_name || ''}, `)}`;
    if (s.loyalty) {
      const L = s.loyalty, cur = s.currency || '€';
      $('#loyaltyBox').hidden = false;
      $('#loyaltyText').textContent = `Gagnez 1 point tous les ${String(L.earn).replace('.', ',')} ${cur} dépensés. ${L.threshold} points = ${String(L.reward).replace('.', ',')} ${cur} offerts sur votre prochain achat. Donnez votre nom ou votre téléphone en caisse.`;
    }
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
        ${addBtn(p)}
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
    $('#pdAdd').hidden = !waOn();
    $('#pdAdd').dataset.inc = p.id;
    $('#pdAdd').textContent = cart[p.id] ? `Dans le panier (${cart[p.id]}) : en ajouter un` : 'Ajouter au panier';
    $('#productDialog').showModal();
  }

  /* --- Événements --- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.cat) { state.category = t.dataset.cat; renderCats(); renderGrid(); }
    else if (t.dataset.open) openProduct(Number(t.dataset.open));
    else if (t.dataset.inc) { const id = Number(t.dataset.inc); setQty(id, (cart[id] || 0) + 1); if (t.id === 'pdAdd') { $('#productDialog').close(); } }
    else if (t.dataset.dec) { const id = Number(t.dataset.dec); setQty(id, (cart[id] || 0) - 1); }
  });
  $('#productDialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('#pdCall').addEventListener('click', (e) => { if ($('#pdCall').getAttribute('href') === '#infos') $('#productDialog').close(); });
  $('#search').addEventListener('input', (e) => { state.query = e.target.value; renderGrid(); });
  $('#year').textContent = new Date().getFullYear();
  $('#cartOpen').addEventListener('click', () => { $('#cartErr').textContent = ''; $('#cartDialog').showModal(); });
  $('#cartDialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('#cartForm').addEventListener('change', (e) => { if (e.target.name === 'mode') $('#addrWrap').hidden = e.target.value !== 'livraison'; });
  $('#cartForm').addEventListener('submit', (e) => { e.preventDefault(); sendWhatsApp(e.target); });
  $('#cartClear').addEventListener('click', () => { cart = {}; saveCart(); renderGrid(); renderCart(); $('#cartDialog').close(); });

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
      renderCart();
    } catch (e) {
      $('#grid').innerHTML = `<div class="empty"><strong>Le catalogue n'a pas pu être chargé.</strong>Actualisez la page dans un instant.</div>`;
    }
  })();
})();
