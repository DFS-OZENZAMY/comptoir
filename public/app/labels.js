// Codes-barres internes et étiquettes autocollantes (planches A4 et rouleaux d'imprimante d'étiquettes).
// Codes générés : EAN-13 à préfixe GS1 « 20 » (réservé à l'usage interne d'un magasin, jamais en conflit avec
// un produit du commerce). Dessin vectoriel (SVG) : net à toutes les tailles, lisible par douchette et caméra.
(() => {
  'use strict';
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

  const check = (digits) => String((10 - (String(digits).split('').reverse().reduce((t, c, i) => t + Number(c) * (i % 2 ? 1 : 3), 0) % 10)) % 10);
  const valid = (code) => /^\d{8}$|^\d{12}$|^\d{13}$/.test(code) && check(code.slice(0, -1)) === code.slice(-1);
  // Code interne libre, pour un produit pas encore enregistré (le serveur, lui, part de l'identifiant).
  function internalCode(taken = new Set()) {
    for (let i = 0; i < 100; i++) {
      const d12 = '209' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
      const code = d12 + check(d12);
      if (!taken.has(code)) return code;
    }
    return null;
  }

  // Code-barres en SVG (unités = modules). EAN-13, UPC-A (= EAN-13 avec un 0 devant) et EAN-8.
  function svg(code) {
    code = String(code || '').trim();
    if (/^\d{12}$/.test(code) && valid(code)) code = '0' + code;
    if (!valid(code)) return null;
    let bits, text = [];
    // Proportions d'un code-barres du commerce : large et peu haut (meilleure lecture au téléphone).
    const H = 36, GH = 41, QL = code.length === 13 ? 11 : 7, QR = 7;
    if (code.length === 13) {
      const p = PARITY[Number(code[0])];
      bits = '101' + code.slice(1, 7).split('').map((c, i) => (p[i] === 'L' ? L : G)[Number(c)]).join('') + '01010' + code.slice(7).split('').map((c) => R[Number(c)]).join('') + '101';
      text = [[QL - 6, code[0], 'start'], [QL + 3 + 21, code.slice(1, 7), 'middle'], [QL + 50 + 21, code.slice(7), 'middle']];
    } else {
      bits = '101' + code.slice(0, 4).split('').map((c) => L[Number(c)]).join('') + '01010' + code.slice(4).split('').map((c) => R[Number(c)]).join('') + '101';
      text = [[QL + 3 + 14, code.slice(0, 4), 'middle'], [QL + 36 + 14, code.slice(4), 'middle']];
    }
    const guard = (i) => i < 3 || i >= bits.length - 3 || (i >= (bits.length - 5) / 2 && i < (bits.length + 5) / 2);
    let rects = '', i = 0;
    while (i < bits.length) {
      if (bits[i] === '1') { let j = i; while (bits[j + 1] === '1' && guard(j + 1) === guard(i)) j++; rects += `<rect x="${QL + i}" y="0" width="${j - i + 1}" height="${guard(i) ? GH : H}"/>`; i = j + 1; } else i++;
    }
    const W = QL + bits.length + QR;
    return `<svg class="bc" viewBox="0 0 ${W} ${GH + 10}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Code-barres ${code}"><g fill="#000">${rects}</g>`
      + `<g font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#000">${text.map(([x, t, a]) => `<text x="${x}" y="${GH + 9}" text-anchor="${a}" letter-spacing="1.2">${t}</text>`).join('')}</g></svg>`;
  }

  // Formats courants (mm). Planches : modèles du type Avery / Herma ; rouleaux : imprimantes d'étiquettes.
  const FORMATS = {
    'a4-21': { label: 'Planche A4, 21 étiquettes (63,5 × 38,1 mm)', cols: 3, rows: 7, w: 63.5, h: 38.1, top: 15.15, left: 7.2, gx: 2.5, gy: 0 },
    'a4-24': { label: 'Planche A4, 24 étiquettes (70 × 37 mm)', cols: 3, rows: 8, w: 70, h: 37, top: 0.5, left: 0, gx: 0, gy: 0 },
    'a4-40': { label: 'Planche A4, 40 étiquettes (52,5 × 29,7 mm)', cols: 4, rows: 10, w: 52.5, h: 29.7, top: 0, left: 0, gx: 0, gy: 0 },
    'a4-65': { label: 'Planche A4, 65 étiquettes (38,1 × 21,2 mm)', cols: 5, rows: 13, w: 38.1, h: 21.2, top: 10.7, left: 4.65, gx: 2.5, gy: 0 },
    'roll-50x30': { label: 'Rouleau 50 × 30 mm (imprimante d’étiquettes)', roll: true, w: 50, h: 30 },
    'roll-40x25': { label: 'Rouleau 40 × 25 mm (imprimante d’étiquettes)', roll: true, w: 40, h: 25 },
  };

  function labelHtml(p, o, A) {
    const small = Math.min(o.fmt.w, o.fmt.h * 1.9) < 45;
    const bc = svg(p.barcode);
    return `<div class="lbl${small ? ' s' : ''}">${o.shop && !small ? `<div class="sh">${A.esc(o.shopName)}</div>` : ''}<div class="nm">${A.esc(p.name)}</div>`
      + `${o.price ? `<div class="pr">${A.money(p.price_ttc)}</div>` : ''}<div class="bcw">${bc || ''}</div></div>`;
  }

  function sheetDocument(items, o, A) {
    const f = o.fmt;
    const css = `*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;color:#000}
      .lbl{width:${f.w}mm;height:${f.h}mm;padding:${Math.min(2.2, f.h * 0.07).toFixed(2)}mm ${Math.min(2.5, f.w * 0.05).toFixed(2)}mm;display:flex;flex-direction:column;align-items:center;justify-content:space-between;overflow:hidden;text-align:center}
      .sh{font-size:6.5pt;color:#444;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
      .nm{font-size:${f.h < 26 ? 6.5 : 8}pt;font-weight:700;line-height:1.15;max-height:2.3em;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;max-width:100%}
      .pr{font-size:${f.h < 26 ? 9 : 12}pt;font-weight:800;line-height:1.1}
      .lbl.s .nm{-webkit-line-clamp:1;max-height:1.2em}
      .bcw{flex:1;min-height:0;width:100%;display:flex;align-items:flex-end;justify-content:center}.bc{width:100%;height:100%;max-height:${(f.h * 0.5).toFixed(1)}mm}
      .bar{position:fixed;top:8px;right:8px;display:flex;gap:8px}.bar button{font:600 14px Arial;padding:10px 16px;border-radius:8px;border:0;background:#17181C;color:#fff;cursor:pointer}
      @media print{.bar{display:none}}`;
    let pages;
    if (f.roll) {
      pages = items.map((p) => `<div class="pg">${labelHtml(p, o, A)}</div>`).join('');
      return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Étiquettes</title><style>@page{size:${f.w}mm ${f.h}mm;margin:0}${css}.pg{width:${f.w}mm;height:${f.h}mm;page-break-after:always;break-after:page}</style></head>`
        + `<body><div class="bar"><button onclick="print()">Imprimer</button></div>${pages}<script>onload=function(){setTimeout(function(){print()},400)}</script></body></html>`;
    }
    const per = f.cols * f.rows; const cells = Array(Math.max(0, o.start - 1)).fill(null).concat(items);
    pages = '';
    for (let i = 0; i < cells.length; i += per) {
      pages += `<div class="pg">${cells.slice(i, i + per).map((p) => (p ? labelHtml(p, o, A) : `<div class="lbl"></div>`)).join('')}</div>`;
    }
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Étiquettes</title><style>@page{size:A4;margin:0}${css}
      .pg{width:210mm;height:297mm;padding:${f.top}mm 0 0 ${f.left}mm;display:grid;grid-template-columns:repeat(${f.cols},${f.w}mm);grid-auto-rows:${f.h}mm;column-gap:${f.gx}mm;row-gap:${f.gy}mm;align-content:start;page-break-after:always;break-after:page;overflow:hidden}
      @media screen{body{background:#ddd}.pg{background:#fff;margin:12px auto;box-shadow:0 2px 10px rgba(0,0,0,.2)}.lbl{outline:1px dashed #ccc}}</style></head>`
      + `<body><div class="bar"><button onclick="print()">Imprimer</button></div>${pages}<script>onload=function(){setTimeout(function(){print()},400)}</script></body></html>`;
  }

  // Fenêtre « Imprimer des étiquettes » : choix des produits, quantités, format, options.
  function open(preselected = []) {
    const A = window.ComptoirApp; if (!A) return;
    // preselected : identifiants (1 étiquette chacun) ou paires [identifiant, nombre d'étiquettes] (articles reçus).
    const st = { q: '', sel: new Map(preselected.map((x) => (Array.isArray(x) ? [Number(x[0]), Math.max(1, Math.round(Number(x[1]) || 1))] : [Number(x), 1]))), fmt: localStorage.getItem('comptoir.labels.fmt') || 'a4-24', price: true, shop: false, start: 1 };
    const ttc = (p) => Math.round(p.price_ht * (1 + (p.tva_rate || 0) / 100) * 100) / 100;
    const body = A.openModal('Imprimer des étiquettes', `
      <div class="lab-grid">
        <label class="field"><span>Format</span><select id="labFmt">${Object.entries(FORMATS).map(([k, f]) => `<option value="${k}">${A.esc(f.label)}</option>`).join('')}</select></label>
        <label class="field" id="labStartF"><span>Commencer à l’étiquette n°</span><input id="labStart" type="number" min="1" value="1" inputmode="numeric"><small class="muted">Pour réutiliser une planche entamée</small></label>
        <label class="check"><input type="checkbox" id="labPrice" checked> Afficher le prix</label>
        <label class="check"><input type="checkbox" id="labShop"> Afficher le nom du commerce</label>
      </div>
      <div class="lab-tools"><input type="search" id="labQ" placeholder="Rechercher un produit"><button type="button" class="btn btn-sm" id="labAllMissing">Sélectionner les produits sans code</button></div>
      <div class="lab-list" id="labList"></div>
      <p class="lab-sum" id="labSum" aria-live="polite"></p>
      <div class="modal-foot"><div><button class="btn" id="labGen" hidden>Générer les codes manquants</button></div><div class="right"><button class="btn" id="labCancel">Fermer</button><button class="btn btn-primary" id="labGo">Aperçu et impression</button></div></div>`, true);
    const $ = (s) => body.querySelector(s);
    $('#labFmt').value = FORMATS[st.fmt] ? st.fmt : 'a4-24';
    const products = () => A.state.products;
    const render = () => {
      const q = st.q.toLowerCase();
      const list = products().filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.barcode || '').includes(q) || String(p.ref || '').toLowerCase().includes(q)).slice(0, 300);
      $('#labList').innerHTML = list.length ? list.map((p) => {
        const on = st.sel.has(p.id); const ok = !!svg(p.barcode);
        return `<label class="lab-row${on ? ' on' : ''}"><input type="checkbox" data-pick="${p.id}" ${on ? 'checked' : ''}><span class="lab-name">${A.esc(p.name)}<small>${p.barcode ? (ok ? A.esc(p.barcode) : `${A.esc(p.barcode)} · <b>format non imprimable</b>`) : '<b>sans code-barres</b>'}</small></span>`
          + `<input type="number" min="1" max="999" value="${st.sel.get(p.id) || 1}" data-qty="${p.id}" aria-label="Nombre d’étiquettes" ${on ? '' : 'disabled'}></label>`;
      }).join('') : '<p class="muted">Aucun produit.</p>';
      summary();
    };
    const summary = () => {
      const f = FORMATS[$('#labFmt').value]; const sel = [...st.sel].map(([id, n]) => [products().find((p) => p.id === id), n]).filter(([p]) => p);
      const missing = sel.filter(([p]) => !svg(p.barcode)).length; const n = sel.filter(([p]) => svg(p.barcode)).reduce((t, [, k]) => t + k, 0);
      const sheets = f.roll ? null : Math.ceil((n + Math.max(0, Number($('#labStart').value || 1) - 1)) / (f.cols * f.rows));
      $('#labStartF').hidden = !!f.roll;
      $('#labSum').innerHTML = `${n} étiquette${n > 1 ? 's' : ''}${sheets ? ` · ${sheets} planche${sheets > 1 ? 's' : ''}` : ''}${missing ? ` · <b>${missing} produit${missing > 1 ? 's' : ''} sans code imprimable</b>` : ''}`;
      $('#labGen').hidden = !missing || !A.can('products.edit');
      $('#labGo').disabled = !n;
    };
    body.addEventListener('change', (e) => {
      const pick = e.target.closest('[data-pick]');
      if (pick) { const id = Number(pick.dataset.pick); if (pick.checked) st.sel.set(id, 1); else st.sel.delete(id); render(); return; }
      const q = e.target.closest('[data-qty]'); if (q) { st.sel.set(Number(q.dataset.qty), Math.max(1, Math.min(999, Number(q.value) || 1))); summary(); return; }
      if (e.target.id === 'labFmt') localStorage.setItem('comptoir.labels.fmt', e.target.value);
      summary();
    });
    body.addEventListener('input', (e) => {
      if (e.target.id === 'labQ') { st.q = e.target.value; render(); return; }
      if (e.target.dataset.qty) st.sel.set(Number(e.target.dataset.qty), Math.max(1, Math.min(999, Number(e.target.value) || 1)));
      if (e.target.dataset.qty || e.target.id === 'labStart') summary();
    });
    $('#labAllMissing').addEventListener('click', () => { products().filter((p) => !svg(p.barcode)).forEach((p) => st.sel.set(p.id, st.sel.get(p.id) || 1)); render(); });
    $('#labCancel').addEventListener('click', A.closeModal);
    $('#labGen').addEventListener('click', async () => {
      const btn = $('#labGen');
      const ids = [...st.sel.keys()].filter((id) => { const p = products().find((x) => x.id === id); return p && !p.barcode; });
      const odd = [...st.sel.keys()].filter((id) => { const p = products().find((x) => x.id === id); return p && p.barcode && !svg(p.barcode); }).length;
      btn.disabled = true;
      try {
        const r = ids.length ? await A.api('/store/products/barcodes', { method: 'POST', body: { ids } }) : { updated: 0 };
        await A.refresh('products'); render();
        A.toast(`${r.updated} code${r.updated > 1 ? 's' : ''}-barres créé${r.updated > 1 ? 's' : ''}${odd ? ` ; ${odd} produit${odd > 1 ? 's ont' : ' a'} déjà un code dans un autre format, à remplacer dans la fiche` : ''}`);
      } catch (ex) { A.toast(ex.message, true); } finally { btn.disabled = false; }
    });
    $('#labGo').addEventListener('click', () => {
      const fmt = FORMATS[$('#labFmt').value];
      const items = [];
      for (const [id, n] of st.sel) { const p = products().find((x) => x.id === id); if (p && svg(p.barcode)) for (let i = 0; i < n; i++) items.push({ name: p.name, barcode: p.barcode, price_ttc: ttc(p) }); }
      const o = { fmt, price: $('#labPrice').checked, shop: $('#labShop').checked, shopName: A.state.settings.shop_name || A.state.me.store.name, start: Math.max(1, Math.min(fmt.cols * fmt.rows || 1, Number($('#labStart').value) || 1)) };
      A.printWindow(sheetDocument(items, o, A));
    });
    render();
  }

  window.ComptoirLabels = { open, svg, valid, internalCode, check, FORMATS };
})();
