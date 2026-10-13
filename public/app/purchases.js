// Achats et fournisseurs (Produits › Achats, Produits › Fournisseurs, Alertes › Préparer les bons de commande).
// Bon de commande : brouillon → envoyé (lien au fournisseur) → partiellement reçu → reçu ; ou annulé / clôturé.
(() => {
  'use strict';
  const STATUS = { brouillon: ['Brouillon', 'po-draft'], 'envoyé': ['Envoyé', 'po-sent'], partiel: ['Partiellement reçu', 'po-partial'], 'reçu': ['Reçu', 'po-done'], 'annulé': ['Annulé', 'po-cancel'] };
  const view = { status: '' };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const A = () => window.ComptoirApp;
  const esc = (v) => A().esc(v);
  const money = (n) => A().money(n);
  const qty = (n) => A().qtyFmt(n);
  const day = (iso) => (iso ? new Date(String(iso).replace(' ', 'T') + (String(iso).length === 10 ? 'T00:00:00' : 'Z')).toLocaleDateString('fr-FR') : '');
  const badge = (o) => { const [l, c] = STATUS[o.status] || [o.status, '']; return `<span class="po-badge ${o.remainder_cancelled ? 'po-done' : c}">${o.remainder_cancelled ? 'Clôturé' : l}</span>`; };
  // « 4 pièces », « 2 sacs », mais « 1,5 kg », « 3 m » : l'unité s'accorde, sauf les abréviations.
  const unitFor = (n, unit) => { const u = String(unit || '').trim(); return Number(n) >= 2 && /^[a-zàâäéèêëîïôöûüç]{3,}$/i.test(u) && !/[sxz]$/i.test(u) && !/^(kg|ml|cl|cm|mm)$/i.test(u) ? `${u}${/au$|eu$/i.test(u) ? 'x' : 's'}` : u; };
  const remaining = (l) => Math.max(0, Math.round((l.qty - l.qty_received) * 1000) / 1000);
  const locations = () => A().state.me.locations || [];
  async function suppliers(fresh) { if (fresh || !A().state.suppliers) A().state.suppliers = await A().api('/store/suppliers', { fresh: true }); return A().state.suppliers; }

  /* ---------------- Onglet Achats ---------------- */
  async function viewOrders() {
    const manage = A().can('purchases.manage');
    A().setActions(manage ? '<button class="btn" id="poPrep">Préparer depuis les alertes</button><button class="btn btn-primary" id="poNew">Nouveau bon de commande</button>' : '');
    const [list, rep] = await Promise.all([A().api('/store/purchases' + (view.status ? `?statut=${encodeURIComponent(view.status)}` : '')), A().api('/store/purchases/report')]);
    const c = list.counts || {}; const total = Object.values(c).reduce((t, n) => t + n, 0); const top = rep.by_supplier[0];
    $('#view').innerHTML = `
      <div class="po-kpis">
        <div class="kpi"><span class="kpi-label">Achats ce mois-ci</span><span class="kpi-value">${money(rep.this_month_ht)}</span><span class="kpi-sub">HT, marchandise reçue</span></div>
        <div class="kpi"><span class="kpi-label">En attente de livraison</span><span class="kpi-value">${money(rep.pending_ht)}</span><span class="kpi-sub">${rep.pending_orders} bon${rep.pending_orders > 1 ? 's' : ''} envoyé${rep.pending_orders > 1 ? 's' : ''}</span></div>
        <div class="kpi"><span class="kpi-label">Premier fournisseur</span><span class="kpi-value po-kpi-name">${top ? esc(top.supplier_name || '—') : '—'}</span><span class="kpi-sub">${top ? `${money(top.total)} sur 12 mois` : 'aucun achat reçu'}</span></div>
      </div>
      <div class="chips po-chips">${[['', 'Tous', total], ['brouillon', 'Brouillons', c.brouillon], ['envoyé', 'Envoyés', c['envoyé']], ['partiel', 'Partiels', c.partiel], ['reçu', 'Reçus', c['reçu']], ['annulé', 'Annulés', c['annulé']]]
        .map(([k, l, n]) => `<button class="chip" data-postatus="${k}" aria-pressed="${view.status === k}">${l}${n ? ` <span class="count">${n}</span>` : ''}</button>`).join('')}</div>
      <section class="panel">${list.orders.length ? `<div class="table-wrap"><table><thead><tr><th>N°</th><th>Fournisseur</th><th>Créé le</th><th>Livraison prévue</th><th class="num">Montant HT</th><th>Statut</th></tr></thead><tbody>
        ${list.orders.map((o) => `<tr class="po-row" data-po="${o.id}" tabindex="0"><td class="cell-main">${esc(o.number)}</td><td>${esc(o.supplier_name || '—')}</td><td>${day(o.created_at)}</td><td>${o.expected_date ? day(o.expected_date) : '—'}</td><td class="num">${money(o.total_ht)}</td><td>${badge(o)}</td></tr>`).join('')}
        </tbody></table></div>` : `<div class="empty-state"><strong>Aucun bon de commande${view.status ? ' dans cette catégorie' : ''}.</strong>${manage ? 'Préparez-les depuis les produits à réapprovisionner, ou créez-en un.' : ''}</div>`}</section>
      ${rep.by_month.length ? reportHtml(rep) : ''}`;
    $('#poNew')?.addEventListener('click', () => orderForm());
    $('#poPrep')?.addEventListener('click', prepare);
    $$('[data-postatus]').forEach((b) => b.addEventListener('click', () => { view.status = b.dataset.postatus; viewOrders(); }));
    $$('[data-po]').forEach((r) => { r.addEventListener('click', () => openOrder(r.dataset.po)); r.addEventListener('keydown', (e) => { if (e.key === 'Enter') openOrder(r.dataset.po); }); });
  }
  function reportHtml(rep) {
    const max = Math.max(1, ...rep.by_month.map((m) => m.total));
    return `<div class="dash-grid">
      <section class="panel"><div class="panel-head"><h2>Achats par mois</h2><span class="muted">HT, marchandise reçue</span></div>
        <div class="month-bars">${rep.by_month.slice(-12).map((m) => `<div class="mb-col"><div class="mb-stack"><span title="${money(m.total)}" style="height:${Math.round((m.total / max) * 100)}%;background:#2D5F8A"></span></div><small>${new Date(m.month + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'short' })}</small></div>`).join('')}</div></section>
      <section class="panel"><div class="panel-head"><h2>Achats par fournisseur</h2><span class="muted">12 derniers mois</span></div>
        <ol class="tops-single">${rep.by_supplier.map((s) => `<li><span>${esc(s.supplier_name || 'Sans fournisseur')} <small class="muted">${s.orders} bon${s.orders > 1 ? 's' : ''}</small></span><strong>${money(s.total)}</strong></li>`).join('')}</ol></section>
    </div>`;
  }

  /* ---------------- Onglet Fournisseurs ---------------- */
  async function viewSuppliers() {
    const manage = A().can('purchases.manage');
    A().setActions(manage ? '<button class="btn btn-primary" id="supNew">Nouveau fournisseur</button>' : '');
    const list = await suppliers(true);
    $('#view').innerHTML = `<section class="panel">${list.length ? `<div class="table-wrap"><table><thead><tr><th>Fournisseur</th><th>Contact</th><th>Téléphone</th><th class="num">Produits</th><th class="num">Commandes en cours</th><th></th></tr></thead><tbody>
      ${list.map((s) => `<tr class="po-row" data-sup="${s.id}" tabindex="0"><td class="cell-main">${esc(s.name)}${s.lead_days ? `<small class="muted"> · livre en ${s.lead_days} j</small>` : ''}</td><td>${esc(s.contact || '—')}</td>
        <td>${s.phone ? `<a href="https://wa.me/${A().intlPhone(s.phone)}" target="_blank" rel="noopener" class="po-wa" data-stop>${esc(s.phone)}</a>` : '—'}</td><td class="num">${s.products}</td><td class="num">${s.open_orders || '—'}</td>
        <td class="num">${manage ? `<button class="btn btn-sm" data-order-from="${s.id}" data-stop>Commander</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty-state"><strong>Aucun fournisseur.</strong>${manage ? 'Ajoutez vos fournisseurs pour préparer et envoyer vos bons de commande.' : ''}</div>`}</section>`;
    $('#supNew')?.addEventListener('click', () => supplierForm(null, viewSuppliers));
    $$('[data-sup]').forEach((r) => r.addEventListener('click', (e) => { if (e.target.closest('[data-stop]')) return; if (manage) supplierForm(list.find((s) => String(s.id) === r.dataset.sup), viewSuppliers); }));
    $$('[data-order-from]').forEach((b) => b.addEventListener('click', () => orderForm(null, { supplier_id: Number(b.dataset.orderFrom) })));
  }
  function supplierForm(s, after) {
    const isNew = !s; s = s || { name: '', contact: '', phone: '', email: '', address: '', lead_days: 0, notes: '' };
    const body = A().openModal(isNew ? 'Nouveau fournisseur' : s.name, `
      <form class="fields" id="supForm" novalidate>
        <label class="field full"><span>Nom du fournisseur</span><input name="name" value="${esc(s.name)}" required placeholder="Ex. : Grossiste Atlas"></label>
        <label class="field"><span>Contact</span><input name="contact" value="${esc(s.contact)}" placeholder="Personne à joindre"></label>
        <label class="field"><span>Téléphone (WhatsApp)</span><input name="phone" value="${esc(s.phone)}" inputmode="tel"></label>
        <label class="field"><span>E-mail</span><input name="email" type="email" value="${esc(s.email)}"></label>
        <label class="field"><span>Délai de livraison (jours)</span><input name="lead_days" type="number" min="0" max="365" value="${s.lead_days || 0}"></label>
        <label class="field full"><span>Adresse</span><input name="address" value="${esc(s.address)}"></label>
        <label class="field full"><span>Notes</span><textarea name="notes" rows="2" placeholder="Conditions, minimum de commande, jours de livraison…">${esc(s.notes)}</textarea></label>
        <p class="form-error full" id="supErr"></p>
      </form>
      <div class="modal-foot"><div>${isNew ? '' : '<button class="btn btn-danger" id="supDel">Supprimer</button>'}</div><div class="right"><button class="btn" id="supCancel">Annuler</button><button class="btn btn-primary" id="supSave">Enregistrer</button></div></div>`);
    $('#supCancel', body).addEventListener('click', A().closeModal);
    $('#supSave', body).addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      try {
        const data = Object.fromEntries(new FormData($('#supForm', body)));
        const r = isNew ? await A().api('/store/suppliers', { method: 'POST', body: data }) : await A().api(`/store/suppliers/${s.id}`, { method: 'PUT', body: data });
        await suppliers(true); A().closeModal(); A().toast(isNew ? 'Fournisseur ajouté' : 'Fournisseur enregistré'); after?.(isNew ? r.id : s.id);
      } catch (ex) { $('#supErr', body).textContent = ex.message; btn.disabled = false; }
    });
    $('#supDel', body)?.addEventListener('click', async () => {
      if (!confirm(`Supprimer « ${s.name} » ? Ses produits n'auront plus de fournisseur habituel.`)) return;
      try { const r = await A().api(`/store/suppliers/${s.id}`, { method: 'DELETE' }); await suppliers(true); A().closeModal(); A().toast(r.archived ? 'Fournisseur retiré (ses bons de commande restent consultables)' : 'Fournisseur supprimé'); after?.(); }
      catch (ex) { A().toast(ex.message, true); }
    });
  }

  /* ---------------- Bon de commande : création et modification ---------------- */
  async function orderForm(o = null, prefill = {}) {
    const list = await suppliers();
    if (!list.length) { A().toast('Ajoutez d’abord un fournisseur.'); return supplierForm(null, (id) => orderForm(null, { ...prefill, supplier_id: id })); }
    const st = { supplier_id: o ? o.supplier_id : (prefill.supplier_id || list[0].id), location_id: o ? o.location_id : (prefill.location_id || (A().state.scope !== 'all' ? A().state.scope : locations()[0]?.id)), expected_date: o?.expected_date || '', notes: o?.notes || '',
      lines: (o ? o.lines : prefill.lines || []).map((l) => ({ product_id: l.product_id, label: l.label, qty: l.qty, unit_cost: l.unit_cost, unit: l.unit || A().state.products.find((p) => p.id === l.product_id)?.unit || '' })) };
    const body = A().openModal(o ? `Modifier ${o.number}` : 'Nouveau bon de commande', `
      <div class="fields">
        <label class="field"><span>Fournisseur</span><span class="input-scan"><select id="poSup">${list.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select><button type="button" class="btn btn-sm" id="poSupNew">Nouveau</button></span></label>
        ${locations().length > 1 ? `<label class="field"><span>Livrer à</span><select id="poLoc">${locations().map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span>Livraison souhaitée</span><input type="date" id="poDate"><small class="muted" id="poDateHint"></small></label>
      </div>
      <div class="po-add"><span class="input-scan"><input id="poPick" list="poProducts" placeholder="Ajouter un produit (nom, référence ou code-barres)" autocomplete="off"><button type="button" class="scan-in" id="poScan" aria-label="Scanner un produit"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7V5.5A1.5 1.5 0 0 1 5.5 4H7M17 4h1.5A1.5 1.5 0 0 1 20 5.5V7M20 17v1.5a1.5 1.5 0 0 1-1.5 1.5H17M7 20H5.5A1.5 1.5 0 0 1 4 18.5V17"/><path d="M7.5 8v8M10 8v8M12.5 8v8M15 8v5M16.5 8v8"/></svg></button></span>
        <datalist id="poProducts">${A().state.products.map((p) => `<option value="${esc(p.name)}">${esc([p.ref, p.barcode].filter(Boolean).join(' · '))}</option>`).join('')}</datalist>
        <button type="button" class="btn btn-sm" id="poLow">Ajouter les produits à réapprovisionner de ce fournisseur</button></div>
      <div class="po-lines" id="poLines"></div>
      <label class="field full"><span>Note pour le fournisseur</span><textarea id="poNotes" rows="2" placeholder="Horaires de livraison, conditions…"></textarea></label>
      <p class="form-error" id="poErr"></p>
      <div class="modal-foot"><div class="po-total" id="poTotal"></div><div class="right"><button class="btn" id="poCancel">Annuler</button><button class="btn" id="poSave">Enregistrer le brouillon</button><button class="btn btn-primary" id="poSend">Enregistrer et envoyer</button></div></div>`, true);
    $('#poSup', body).value = String(st.supplier_id);
    if ($('#poLoc', body) && st.location_id) $('#poLoc', body).value = String(st.location_id);
    $('#poNotes', body).value = st.notes;
    const lead = () => list.find((s) => String(s.id) === $('#poSup', body).value)?.lead_days || 0;
    const setDate = () => {
      if (!st.expected_date && lead()) { const d = new Date(); d.setDate(d.getDate() + lead()); $('#poDate', body).value = d.toISOString().slice(0, 10); } else $('#poDate', body).value = st.expected_date || '';
      $('#poDateHint', body).textContent = lead() ? `Délai habituel : ${lead()} jour${lead() > 1 ? 's' : ''}` : '';
    };
    setDate();
    const render = () => {
      $('#poLines', body).innerHTML = st.lines.length ? `<table class="po-table"><thead><tr><th>Produit</th><th>Quantité</th><th>Prix d'achat HT</th><th class="num">Total HT</th><th></th></tr></thead><tbody>
        ${st.lines.map((l, i) => `<tr><td class="cell-main">${esc(l.label)}</td><td><input type="number" min="0.001" step="any" value="${l.qty}" data-lq="${i}" aria-label="Quantité"> <small class="muted">${esc(unitFor(l.qty, l.unit))}</small></td>
          <td><input type="number" min="0" step="0.01" value="${l.unit_cost}" data-lc="${i}" aria-label="Prix d'achat"></td><td class="num">${money(l.qty * l.unit_cost)}</td><td><button type="button" class="link" data-ldel="${i}" aria-label="Retirer">Retirer</button></td></tr>`).join('')}
        </tbody></table>` : '<p class="muted po-empty">Ajoutez les produits à commander.</p>';
      $('#poTotal', body).innerHTML = `${st.lines.length} produit${st.lines.length > 1 ? 's' : ''} · <strong>${money(st.lines.reduce((t, l) => t + l.qty * l.unit_cost, 0))} HT</strong>`;
    };
    const add = (p, q = 1) => {
      if (!p) return;
      const ex = st.lines.find((l) => l.product_id === p.id);
      if (ex) ex.qty = Math.round((ex.qty + q) * 1000) / 1000; else st.lines.push({ product_id: p.id, label: p.name, qty: q, unit_cost: p.purchase_price || 0, unit: p.unit });
      render();
    };
    render();
    body.addEventListener('input', (e) => {
      const i = e.target.dataset.lq ?? e.target.dataset.lc; if (i === undefined) return;
      const l = st.lines[Number(i)]; if (e.target.dataset.lq !== undefined) l.qty = Number(e.target.value) || 0; else l.unit_cost = Number(e.target.value) || 0;
      const row = e.target.closest('tr'); row.querySelector('td.num').textContent = money(l.qty * l.unit_cost);
      $('#poTotal', body).innerHTML = `${st.lines.length} produit${st.lines.length > 1 ? 's' : ''} · <strong>${money(st.lines.reduce((t, x) => t + x.qty * x.unit_cost, 0))} HT</strong>`;
    });
    body.addEventListener('click', (e) => { const d = e.target.closest('[data-ldel]'); if (d) { st.lines.splice(Number(d.dataset.ldel), 1); render(); } });
    $('#poPick', body).addEventListener('change', (e) => {
      const v = e.target.value.trim().toLowerCase(); if (!v) return;
      add(A().state.products.find((p) => p.name.toLowerCase() === v) || A().findByCode(v) || A().state.products.find((p) => p.name.toLowerCase().includes(v)));
      e.target.value = '';
    });
    $('#poScan', body).hidden = !window.ComptoirScanner;
    $('#poScan', body).addEventListener('click', () => window.ComptoirScanner.open({ title: 'Scanner les produits à commander', continuous: true, onCode: (code) => {
      const p = A().findByCode(code); if (!p) return { ok: false, message: `Code ${code} inconnu` };
      add(p); return { ok: true, message: `${p.name} · ${qty(st.lines.find((l) => l.product_id === p.id).qty)} au bon` };
    } }));
    $('#poLow', body).addEventListener('click', async () => {
      const g = (await A().api('/store/purchases/suggestions', { fresh: true })).groups.find((x) => String(x.supplier_id) === $('#poSup', body).value);
      if (!g) return A().toast('Aucun produit de ce fournisseur n’est sous son seuil.');
      g.lines.forEach((l) => { if (!st.lines.some((x) => x.product_id === l.product_id)) st.lines.push({ ...l }); }); render();
    });
    $('#poSup', body).addEventListener('change', () => { st.expected_date = ''; setDate(); });
    $('#poSupNew', body).addEventListener('click', () => { A().closeModal(); supplierForm(null, (id) => orderForm(o, { ...collect(), supplier_id: id })); });
    $('#poCancel', body).addEventListener('click', A().closeModal);
    const collect = () => ({ supplier_id: Number($('#poSup', body).value), location_id: $('#poLoc', body) ? Number($('#poLoc', body).value) : st.location_id, expected_date: $('#poDate', body).value, notes: $('#poNotes', body).value,
      lines: st.lines.map((l) => ({ product_id: l.product_id, label: l.label, qty: l.qty, unit_cost: l.unit_cost })) });
    const save = async (send, btn) => {
      btn.disabled = true; $('#poErr', body).textContent = '';
      try {
        const saved = o ? await A().api(`/store/purchases/${o.id}`, { method: 'PUT', body: collect() }) : await A().api('/store/purchases', { method: 'POST', body: collect() });
        A().closeModal(); if (location.hash !== '#/achats') history.pushState(null, '', '#/achats'); A().route();
        if (send) sendOrder(saved); else { A().toast(`${saved.number} enregistré en brouillon`); openOrder(saved.id); }
      } catch (ex) { $('#poErr', body).textContent = ex.message; btn.disabled = false; }
    };
    $('#poSave', body).addEventListener('click', (e) => save(false, e.currentTarget));
    $('#poSend', body).addEventListener('click', (e) => save(true, e.currentTarget));
  }

  /* ---------------- Fiche d'un bon de commande ---------------- */
  async function openOrder(id) {
    const o = await A().api(`/store/purchases/${id}`, { fresh: true });
    const manage = A().can('purchases.manage'); const open = ['brouillon', 'envoyé', 'partiel'].includes(o.status);
    const anyReceived = o.lines.some((l) => l.qty_received > 0);
    const body = A().openModal(`Bon de commande ${o.number}`, `
      <div class="po-head">${badge(o)}<span><strong>${esc(o.supplier_name || '')}</strong>${o.supplier_contact ? ` · ${esc(o.supplier_contact)}` : ''}${o.supplier_phone ? ` · <a href="https://wa.me/${A().intlPhone(o.supplier_phone)}" target="_blank" rel="noopener">${esc(o.supplier_phone)}</a>` : ''}</span>
        <span class="muted">Créé le ${day(o.created_at)}${o.sent_at ? ` · envoyé le ${day(o.sent_at)}` : ''}${o.expected_date ? ` · livraison prévue le ${day(o.expected_date)}` : ''}${o.location_name && locations().length > 1 ? ` · à ${esc(o.location_name)}` : ''}</span></div>
      <div class="table-wrap"><table class="po-table"><thead><tr><th>Produit</th><th class="num">Commandé</th><th class="num">Reçu</th><th class="num">Prix HT</th><th class="num">Total HT</th></tr></thead><tbody>
        ${o.lines.map((l) => `<tr><td class="cell-main">${esc(l.label)}${l.ref || l.barcode ? `<small class="muted"> ${esc([l.ref, l.barcode].filter(Boolean).join(' · '))}</small>` : ''}</td><td class="num">${qty(l.qty)} ${esc(unitFor(l.qty, l.unit))}</td>
          <td class="num ${l.qty_received >= l.qty ? 'po-ok' : l.qty_received > 0 ? 'po-part' : ''}">${qty(l.qty_received)}</td><td class="num">${money(l.unit_cost)}</td><td class="num">${money(l.qty * l.unit_cost)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="4">Total HT${o.received_ht ? ` · reçu ${money(o.received_ht)}` : ''}</td><td class="num"><strong>${money(o.total_ht)}</strong></td></tr></tfoot></table></div>
      ${o.notes ? `<p class="notice">${esc(o.notes)}</p>` : ''}
      ${o.receptions.length ? `<p class="muted po-recs">Réceptions : ${o.receptions.map((r) => `${day(r.created_at)} (${money(r.total_ht)}${r.user_name ? `, ${esc(r.user_name.split(' ')[0])}` : ''})`).join(' · ')}</p>` : ''}
      <div class="modal-foot"><div>${manage && o.status === 'brouillon' ? '<button class="btn btn-danger" id="oDel">Supprimer</button>' : ''}${manage && open && o.status !== 'brouillon' ? `<button class="btn btn-danger" id="oCancel">${anyReceived ? 'Clôturer' : 'Annuler le bon'}</button>` : ''}</div>
        <div class="right">${manage && o.status === 'brouillon' ? '<button class="btn" id="oEdit">Modifier</button>' : ''}
          ${manage && open ? `<button class="btn" id="oSend">${o.status === 'brouillon' ? 'Envoyer au fournisseur' : 'Renvoyer'}</button><button class="btn btn-primary" id="oRecv">Réceptionner</button>` : ''}
          ${anyReceived && window.ComptoirLabels ? '<button class="btn" id="oLabels">Étiquettes des articles reçus</button>' : ''}</div></div>`, true);
    $('#oEdit', body)?.addEventListener('click', () => { A().closeModal(); orderForm(o); });
    $('#oSend', body)?.addEventListener('click', () => sendOrder(o));
    $('#oRecv', body)?.addEventListener('click', () => receiveForm(o));
    $('#oLabels', body)?.addEventListener('click', () => { A().closeModal(); window.ComptoirLabels.open(o.lines.filter((l) => l.product_id && l.qty_received > 0).map((l) => [l.product_id, Math.ceil(l.qty_received)])); });
    $('#oDel', body)?.addEventListener('click', async () => { if (!confirm(`Supprimer le brouillon ${o.number} ?`)) return; try { await A().api(`/store/purchases/${o.id}`, { method: 'DELETE' }); A().closeModal(); A().toast('Brouillon supprimé'); A().route(); } catch (ex) { A().toast(ex.message, true); } });
    $('#oCancel', body)?.addEventListener('click', async () => {
      if (!confirm(anyReceived ? `Clôturer ${o.number} ? Le reste n'est plus attendu ; ce qui a été reçu reste enregistré.` : `Annuler ${o.number} ? Prévenez votre fournisseur.`)) return;
      try { await A().api(`/store/purchases/${o.id}/cancel`, { method: 'POST', body: {} }); A().toast(anyReceived ? 'Bon de commande clôturé' : 'Bon de commande annulé'); A().route(); openOrder(o.id); } catch (ex) { A().toast(ex.message, true); }
    });
  }

  /* ---------------- Envoi au fournisseur ---------------- */
  async function sendOrder(o) {
    let r; try { r = await A().api(`/store/purchases/${o.id}/send`, { method: 'POST', body: {} }); } catch (ex) { return A().toast(ex.message, true); }
    const order = r.order, shop = A().state.settings.shop_name || A().state.me.store.name;
    const phone = A().intlPhone(order.supplier_phone), email = order.supplier_email || '';
    const who = order.supplier_contact ? ` ${order.supplier_contact.split(' ')[0]}` : '';
    const text = `Bonjour${who}, voici notre bon de commande ${order.number} (${order.lines.length} article${order.lines.length > 1 ? 's' : ''}, ${money(order.total_ht)} HT)${order.expected_date ? `, livraison souhaitée le ${day(order.expected_date)}` : ''} : ${r.url}\n${shop}`;
    view.status = '';   // le bon n'est plus un brouillon : on l'affiche avec tous les autres
    A().route();
    const body = A().openModal('Envoyer au fournisseur', `
      <p class="muted">${esc(order.supplier_name)} reçoit un lien vers le bon de commande, imprimable, sans créer de compte. Le bon n'est plus modifiable.</p>
      <div class="share-grid">
        <a class="share-btn wa" href="https://wa.me/${phone}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">WhatsApp<small>${phone ? '+' + esc(phone) : 'choisir le contact'}</small></a>
        <a class="share-btn" href="mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Bon de commande ${order.number} · ${shop}`)}&body=${encodeURIComponent(text)}">E-mail<small>${esc(email || 'choisir le destinataire')}</small></a>
      </div>
      <label class="share-link">Lien<input id="poUrl" readonly value="${esc(r.url)}"></label>
      <div class="modal-foot"><div><button class="btn" id="poCopy">Copier le lien</button> <a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">Voir et imprimer</a></div><div class="right"><button class="btn btn-primary" id="poDone">Terminé</button></div></div>`);
    $('#poCopy', body).addEventListener('click', async () => { try { await navigator.clipboard.writeText(r.url); } catch { $('#poUrl', body).select(); document.execCommand('copy'); } A().toast('Lien copié'); });
    $('#poDone', body).addEventListener('click', A().closeModal);
  }

  /* ---------------- Réception de la marchandise ---------------- */
  function receiveForm(o) {
    const rest = o.lines.filter((l) => remaining(l) > 0);
    const body = A().openModal(`Réceptionner ${o.number}`, `
      <p class="muted">Indiquez ce qui est arrivé. Le stock${locations().length > 1 ? ' de la boutique choisie' : ''} augmente, le prix d'achat est recalculé (coût moyen) et chaque entrée est tracée.</p>
      ${locations().length > 1 ? `<label class="field"><span>Boutique qui reçoit</span><select id="rcLoc">${locations().map((l) => `<option value="${l.id}" ${l.id === o.location_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>` : ''}
      <div class="po-rc-tools"><button type="button" class="btn btn-sm" id="rcAll">Tout est arrivé</button><button type="button" class="btn btn-sm" id="rcNone">Rien</button></div>
      <div class="table-wrap"><table class="po-table"><thead><tr><th>Produit</th><th class="num">Attendu</th><th>Reçu maintenant</th><th>Prix d'achat HT</th></tr></thead><tbody>
        ${rest.map((l) => `<tr><td class="cell-main">${esc(l.label)}</td><td class="num">${qty(remaining(l))} ${esc(unitFor(remaining(l), l.unit))}</td><td><input type="number" min="0" step="any" value="${remaining(l)}" data-rq="${l.id}" data-rest="${remaining(l)}" aria-label="Quantité reçue"></td><td><input type="number" min="0" step="0.01" value="${l.unit_cost}" data-rc="${l.id}" aria-label="Prix d'achat"></td></tr>`).join('')}
      </tbody></table></div>
      <p class="form-error" id="rcErr"></p>
      <div class="modal-foot"><div></div><div class="right"><button class="btn" id="rcCancel">Annuler</button><button class="btn btn-primary" id="rcGo">Valider la réception</button></div></div>`, true);
    $('#rcAll', body).addEventListener('click', () => $$('[data-rq]', body).forEach((i) => { i.value = i.dataset.rest; }));
    $('#rcNone', body).addEventListener('click', () => $$('[data-rq]', body).forEach((i) => { i.value = 0; }));
    $('#rcCancel', body).addEventListener('click', () => openOrder(o.id));
    $('#rcGo', body).addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      const lines = $$('[data-rq]', body).map((i) => ({ line_id: Number(i.dataset.rq), qty: Number(i.value) || 0, unit_cost: $(`[data-rc="${i.dataset.rq}"]`, body).value })).filter((l) => l.qty > 0);
      try {
        const done = await A().api(`/store/purchases/${o.id}/receive`, { method: 'POST', body: { lines, location_id: $('#rcLoc', body) ? Number($('#rcLoc', body).value) : undefined } });
        await A().refresh('products');
        A().toast(done.status === 'reçu' ? `${o.number} entièrement reçu : stock mis à jour` : `Réception enregistrée : ${o.number} partiellement reçu`);
        A().route();
        const received = lines.map((l) => [o.lines.find((x) => x.id === l.line_id)?.product_id, Math.ceil(l.qty)]).filter(([pid]) => pid);
        const b2 = A().openModal('Marchandise réceptionnée', `<p>Le stock est à jour. Voulez-vous imprimer les étiquettes des articles reçus ?</p>
          <div class="modal-foot"><div></div><div class="right"><button class="btn" id="rcNo">Plus tard</button>${window.ComptoirLabels ? '<button class="btn btn-primary" id="rcLab">Imprimer les étiquettes</button>' : ''}</div></div>`);
        $('#rcNo', b2).addEventListener('click', A().closeModal);
        $('#rcLab', b2)?.addEventListener('click', () => { A().closeModal(); window.ComptoirLabels.open(received); });
      } catch (ex) { $('#rcErr', body).textContent = ex.message; btn.disabled = false; }
    });
  }

  /* ---------------- Alertes › Préparer les bons de commande ---------------- */
  async function prepare() {
    const [{ groups }, list] = await Promise.all([A().api('/store/purchases/suggestions', { fresh: true }), suppliers(true)]);
    if (!groups.length) return A().toast('Rien à recommander : tout est au-dessus des seuils, ou déjà en commande.');
    const body = A().openModal('Préparer les bons de commande', `
      <p class="muted">Produits sous leur seuil, regroupés par fournisseur. Quantité proposée : de quoi revenir au double du seuil, moins ce qui est déjà en commande. Un brouillon est créé par fournisseur, à vérifier puis envoyer.</p>
      ${groups.map((g, gi) => `<section class="po-group">
        <div class="po-group-head">${g.supplier_id ? `<strong>${esc(g.supplier_name)}</strong>` : `<strong>Sans fournisseur habituel</strong> <select data-gsup="${gi}" aria-label="Fournisseur"><option value="">Choisir le fournisseur…</option>${list.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>`}</div>
        <table class="po-table"><tbody>${g.lines.map((l, li) => `<tr><td><label class="check"><input type="checkbox" data-gl="${gi}:${li}" checked> ${esc(l.label)}</label><small class="muted"> stock ${qty(l.stock)} / seuil ${qty(l.stock_min)}${l.on_order ? ` · ${qty(l.on_order)} déjà en commande` : ''}</small></td>
          <td><input type="number" min="0.001" step="any" value="${l.qty}" data-gq="${gi}:${li}" aria-label="Quantité"> <small class="muted">${esc(unitFor(l.qty, l.unit))}</small></td></tr>`).join('')}</tbody></table></section>`).join('')}
      <p class="form-error" id="ppErr"></p>
      <div class="modal-foot"><div></div><div class="right"><button class="btn" id="ppCancel">Annuler</button><button class="btn btn-primary" id="ppGo">Créer les brouillons</button></div></div>`, true);
    $('#ppCancel', body).addEventListener('click', A().closeModal);
    $('#ppGo', body).addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true; $('#ppErr', body).textContent = '';
      const orders = groups.map((g, gi) => ({ supplier_id: g.supplier_id || Number($(`[data-gsup="${gi}"]`, body)?.value) || null,
        lines: g.lines.map((l, li) => ({ ...l, qty: Number($(`[data-gq="${gi}:${li}"]`, body).value) || 0, on: $(`[data-gl="${gi}:${li}"]`, body).checked })).filter((l) => l.on && l.qty > 0) })).filter((x) => x.lines.length);
      const missing = orders.find((x) => !x.supplier_id);
      if (missing) { $('#ppErr', body).textContent = 'Choisissez le fournisseur des produits sans fournisseur habituel, ou décochez-les.'; btn.disabled = false; return; }
      // Même fournisseur choisi pour les produits « sans fournisseur » : regroupés dans un seul bon.
      const merged = new Map();
      for (const x of orders) { const m = merged.get(x.supplier_id) || { supplier_id: x.supplier_id, lines: [] }; m.lines.push(...x.lines); merged.set(x.supplier_id, m); }
      try {
        const made = [];
        for (const x of merged.values()) made.push(await A().api('/store/purchases', { method: 'POST', body: { supplier_id: x.supplier_id, lines: x.lines.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_cost: l.unit_cost })) } }));
        A().closeModal(); A().toast(`${made.length} brouillon${made.length > 1 ? 's' : ''} de bon de commande créé${made.length > 1 ? 's' : ''} : vérifiez-les puis envoyez-les`);
        view.status = 'brouillon'; location.hash = '#/achats';
      } catch (ex) { $('#ppErr', body).textContent = ex.message; btn.disabled = false; }
    });
  }

  window.ComptoirPurchases = { viewOrders, viewSuppliers, prepare, orderForm, openOrder, supplierForm };
})();
