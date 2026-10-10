// Import de produits : lecture du fichier (CSV, XLSX) et correspondance des colonnes, entièrement dans le navigateur.
// Le fichier n'est jamais envoyé tel quel : seules les lignes produits normalisées partent vers le serveur.
(() => {
  const norm = (v) => String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, "'").replace(/\s+/g, ' ');

  /* ------------------------------------------------------------ */
  /* Lecture                                                       */
  /* ------------------------------------------------------------ */
  function decode(bytes) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
    catch { return new TextDecoder('windows-1252').decode(bytes); } // Excel français « CSV (séparateur : point-virgule) »
  }
  function parseCsv(text) {
    const first = text.split(/\r?\n/).find((l) => l.trim()) || '';
    const count = (ch) => { let n = 0, q = false; for (const c of first) { if (c === '"') q = !q; else if (c === ch && !q) n++; } return n; };
    const delim = [';', ',', '\t', '|'].sort((a, b) => count(b) - count(a))[0];
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  // XLSX : un fichier ZIP de XML. Décompression native du navigateur, sans bibliothèque externe.
  async function unzip(buf, wanted) {
    const dv = new DataView(buf); const u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Fichier Excel illisible.');
    const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const out = {}; const td = new TextDecoder();
    for (let k = 0; k < n; k++) {
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extra + comment;
      if (!wanted(name)) continue;
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = u8.subarray(start, start + size);
      if (method === 0) out[name] = td.decode(data);
      else if (method === 8) out[name] = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    }
    return out;
  }
  async function parseXlsx(buf) {
    const files = await unzip(buf, (n) => /^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(n));
    const dom = (s) => new DOMParser().parseFromString(s || '<x/>', 'application/xml');
    const strings = [...dom(files['xl/sharedStrings.xml']).getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
    const wb = dom(files['xl/workbook.xml']); const sheet = wb.getElementsByTagName('sheet')[0];
    let path = 'xl/worksheets/sheet1.xml';
    if (sheet) {
      const rid = sheet.getAttribute('r:id') || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const rel = [...dom(files['xl/_rels/workbook.xml.rels']).getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid);
      if (rel) path = 'xl/' + rel.getAttribute('Target').replace(/^\/?xl\//, '').replace(/^\//, '');
    }
    if (!files[path]) path = Object.keys(files).find((k) => k.startsWith('xl/worksheets/'));
    const rows = [];
    for (const r of dom(files[path]).getElementsByTagName('row')) {
      const row = [];
      for (const c of r.getElementsByTagName('c')) {
        const ref = c.getAttribute('r') || ''; let col = 0;
        for (const ch of ref.replace(/\d+/g, '')) col = col * 26 + (ch.charCodeAt(0) - 64);
        const t = c.getAttribute('t'); const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
        let val = v;
        if (t === 's') val = strings[Number(v)] ?? '';
        else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map((x) => x.textContent).join('');
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        row[Math.max(0, col - 1)] = val;
      }
      rows[Number(r.getAttribute('r')) - 1 || rows.length] = row;
    }
    return rows.filter(Boolean).map((r) => Array.from(r, (x) => x ?? ''));
  }

  async function readFile(file) {
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf.slice(0, 4));
    let rows;
    if (head[0] === 0x50 && head[1] === 0x4b) rows = await parseXlsx(buf);
    else if (head[0] === 0xd0 && head[1] === 0xcf) throw new Error('Ancien format Excel (.xls) : ouvrez-le dans Excel et enregistrez-le en .xlsx ou en CSV.');
    else rows = parseCsv(decode(new Uint8Array(buf)));
    const start = rows.findIndex((r) => r.filter((c) => String(c).trim()).length >= 2);
    if (start < 0) throw new Error('Aucun tableau trouvé dans ce fichier.');
    const headers = rows[start].map((h) => String(h).trim());
    const data = rows.slice(start + 1).filter((r) => r.some((c) => String(c).trim()));
    return { headers, rows: data };
  }

  /* ------------------------------------------------------------ */
  /* Reconnaissance du logiciel d'origine                          */
  /* ------------------------------------------------------------ */
  const SOURCES = [
    { key: 'square', label: 'Square', test: (h) => h.has('item name') && (h.has('variation name') || h.has('token')), prices: 'ttc' },
    { key: 'shopify', label: 'Shopify', test: (h) => h.has('handle') && h.has('title') && h.has('variant sku'), prices: 'ttc' },
    { key: 'loyverse', label: 'Loyverse', test: (h) => h.has('handle') && h.has('sku') && h.has('name') && [...h].some((x) => x.startsWith('price') || x === 'default price' || x === 'cost'), prices: 'ttc' },
    { key: 'woocommerce', label: 'WooCommerce', test: (h) => h.has('regular price') && h.has('type'), prices: 'ttc' },
    { key: 'odoo', label: 'Odoo', test: (h) => (h.has('internal reference') || h.has('reference interne')) && (h.has('sales price') || h.has('prix de vente')), prices: 'ht' },
    { key: 'comptoir', label: 'modèle Comptoir', test: (h) => h.has('nom') && h.has('prix de vente ttc'), prices: 'ttc' },
    { key: 'ebp', label: 'EBP ou Sage', test: (h) => h.has('libelle') || h.has('designation'), prices: 'ht' },
  ];
  // Intitulés reconnus pour chaque information (anglais et français, sans accents).
  const FIELDS = {
    name: ['name', 'nom', 'nom du produit', 'title', 'item name', 'product name', 'designation', 'libelle', 'article', 'produit', 'intitule', 'nom article'],
    variant: ['variation name', 'option1 value', 'option 1 value', 'variante', 'declinaison'],
    variant2: ['option2 value', 'option 2 value'],
    parent: ['handle', 'parent', 'reference handle'],
    ref: ['sku', 'variant sku', 'reference', 'ref', 'code', 'code article', 'reference interne', 'internal reference', 'ref article', 'reference article'],
    barcode: ['barcode', 'code barre', 'code-barre', 'code-barres', 'code barres', 'gtin', 'ean', 'ean13', 'ean 13', 'variant barcode', 'gtin, upc, ean, or isbn', 'upc', 'code ean'],
    category: ['category', 'categorie', 'categories', 'famille', 'famille article', 'product category', 'categorie de produit', 'rayon', 'type'],
    price: ['prix de vente ttc', 'prix ttc', 'pv ttc', 'price', 'default price', 'regular price', 'variant price', 'sales price', 'prix de vente', 'prix', 'prix vente', 'prix de vente ht', 'pv ht', 'prix ht', 'prix unitaire', 'sale price'],
    purchase: ['cost', 'cost per item', 'default unit cost', 'purchase cost', 'cost price', "prix d'achat", "prix d'achat ht", 'prix achat', 'prix de revient', 'cout', 'cout unitaire', 'pa ht', 'cout moyen'],
    stock: ['in stock', 'stock', 'quantity', 'quantite', 'qty', 'variant inventory qty', 'current quantity', 'quantity on hand', 'quantite en stock', 'stock reel', 'stock disponible', 'on hand', 'quantite disponible', 'qte', 'qte en stock'],
    stock_min: ['low stock', 'stock alert count', 'low stock amount', 'stock minimum', 'stock mini', 'stock min', 'seuil', "seuil d'alerte", "stock d'alerte", 'point de commande'],
    tva: ['tva', 'taux tva', 'taux de tva', 'tax rate', 'vat', 'taux', 'tva %'],
    unit: ['unit', 'unite', 'unite de vente', 'unit and precision', 'uom', 'unite de mesure', 'sold by weight'],
    description: ['description', 'body (html)', 'short description', 'description courte', 'description commerciale'],
    track: ['track stock', 'stockable', 'manage stock?', 'gerer le stock'],
    type: ['type'],
    archived: ['archived', 'archive'],
  };
  const baseName = (h) => norm(h).replace(/\s*\[.*\]\s*$/, '').replace(/\s*\(.*\)\s*$/, '').trim();

  function detect(headers) {
    const set = new Set(headers.map(baseName));
    return SOURCES.find((s) => s.test(set)) || { key: 'autre', label: 'tableau Excel', prices: 'ttc' };
  }
  function autoMap(headers, source) {
    const H = headers.map(norm), B = headers.map(baseName);
    const pick = (list, avoid = []) => { for (const k of list) { const i = B.findIndex((b, j) => b === k && !avoid.includes(j)); if (i >= 0) return i; } return -1; };
    const m = {};
    for (const f of ['name', 'variant', 'variant2', 'parent', 'ref', 'barcode', 'purchase', 'stock_min', 'tva', 'unit', 'description', 'track', 'archived']) m[f] = pick(FIELDS[f]);
    // Catégorie : « Type » seulement s'il n'y a rien de mieux (chez WooCommerce, Type = simple/variable).
    m.category = pick(FIELDS.category.filter((x) => x !== 'type'));
    if (m.category < 0 && source.key === 'shopify') m.category = pick(['type']);
    m.type = source.key === 'woocommerce' ? pick(['type']) : -1;
    // Prix : le premier intitulé reconnu ; HT ou TTC selon l'intitulé, sinon selon le logiciel.
    m.price = pick(FIELDS.price);
    if (source.key === 'woocommerce') { const reg = pick(['regular price']); if (reg >= 0) m.price = reg; }
    if (source.key === 'shopify') m.name = pick(['title']);
    if (source.key === 'square') m.name = pick(['item name']);
    const ph = m.price >= 0 ? H[m.price] : '';
    m.price_mode = /\bht\b|hors tax/.test(ph) ? 'ht' : /\bttc\b/.test(ph) ? 'ttc' : source.prices;
    // Stock : toutes les colonnes de quantité, y compris celles d'un magasin (« In stock [Centre] »).
    m.stocks = B.map((b, i) => ((FIELDS.stock.includes(b) || /^(current quantity|in stock|quantite) .+/.test(H[i])) && !/new quantity/.test(H[i]) ? i : -1)).filter((i) => i >= 0);
    if (m.stock_min < 0) m.stock_min = H.findIndex((h) => /^(stock alert count|low stock)\b/.test(h));
    return m;
  }

  /* ------------------------------------------------------------ */
  /* Valeurs                                                       */
  /* ------------------------------------------------------------ */
  function number(v) {
    let s = String(v ?? '').trim();
    if (!s || s === '-' || !/\d/.test(s)) return null;
    s = s.replace(/[^\d,.\-eE]/g, '');
    if (/^-?\d+(\.\d+)?e[+-]?\d+$/i.test(s)) return Number(s);
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (lc > -1) s = /,\d{3}$/.test(s) && s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const yes = (v) => /^(y|yes|oui|o|1|true|vrai|x)$/i.test(String(v ?? '').trim());
  const no = (v) => /^(n|no|non|0|false|faux)$/i.test(String(v ?? '').trim());
  const stripHtml = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const catName = (s) => { const first = String(s ?? '').split(/[,|]/)[0]; const parts = first.split(/\s*[>/]\s*/).filter(Boolean); return (parts[parts.length - 1] || '').trim(); };

  // Lignes du fichier → produits Comptoir. stockMap : { idBoutique: indexColonne }.
  function toProducts(sheet, m, { stockMap = {}, tvaDefault = 20 } = {}) {
    const out = []; const lastByParent = {};
    const hasWord = (text, w) => new RegExp('(^|[\\s(/-])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[\\s)/-])', 'i').test(text);
    sheet.rows.forEach((r, i) => {
      const g = (k) => (m[k] >= 0 ? String(r[m[k]] ?? '').trim() : '');
      const line = i + 2;
      const warn = [];
      if (m.type >= 0 && /^(variable|grouped|external)$/i.test(g('type'))) return; // produit « parent » WooCommerce
      if (m.archived >= 0 && yes(g('archived'))) return;
      let name = g('name');
      const parent = g('parent');
      // Lignes de variantes (Loyverse, Shopify) : le nom, la catégorie et la description viennent du produit.
      const inherited = !name && parent && lastByParent[parent];
      if (inherited) name = lastByParent[parent].name;
      else if (name && parent) lastByParent[parent] = { name, category: g('category'), description: g('description') };
      const v1 = g('variant'), v2 = g('variant2');
      const variant = [v1, v2].filter((x) => x && !/^(regular|normal|default title|standard|defaut)$/i.test(x)).join(' ');
      if (variant && !hasWord(name, variant)) name = `${name} ${variant}`.trim();
      const priceRaw = m.price >= 0 ? number(r[m.price]) : null;
      const ref = g('ref'); let barcode = g('barcode');
      // Ligne sans aucune information produit (ex. lignes d'images Shopify) : ignorée.
      if (!ref && !barcode && priceRaw === null && (!name || (inherited && !variant))) return;
      if (/e\+?\d+$/i.test(barcode) && /^[\d.,]+e\+?\d+$/i.test(barcode)) { warn.push('code-barres abîmé par Excel (format scientifique)'); barcode = ''; }
      barcode = barcode.replace(/\.0+$/, '');
      let tva = m.tva >= 0 ? number(r[m.tva]) : null;
      if (tva !== null && tva > 0 && tva < 1) tva = Math.round(tva * 10000) / 100;
      const rate = tva ?? tvaDefault;
      const price_ht = priceRaw === null ? null : m.price_mode === 'ht' ? priceRaw : Math.round((priceRaw / (1 + rate / 100)) * 10000) / 10000;
      let unit = g('unit');
      if (m.unit >= 0 && /sold by weight/.test(norm(sheet.headers[m.unit]))) unit = yes(unit) ? 'kg' : '';
      unit = unit.replace(/^(each|unit|unite|pce|pc|u)$/i, 'pièce').slice(0, 20);
      const stocks = {};
      for (const [lid, col] of Object.entries(stockMap)) if (col !== '' && col !== null && col >= 0) { const q = number(r[col]); if (q !== null) stocks[lid] = q; }
      if (!name) warn.push('nom manquant');
      if (priceRaw === null) warn.push(m.price >= 0 && String(r[m.price] ?? '').trim() ? 'prix illisible, à corriger après import' : 'pas de prix');
      const parentInfo = parent && lastByParent[parent] ? lastByParent[parent] : {};
      out.push({
        line, name, ref, barcode, category: catName(g('category') || parentInfo.category), price_ht, price_ttc: priceRaw === null ? null : (m.price_mode === 'ht' ? priceRaw * (1 + rate / 100) : priceRaw),
        purchase_price: m.purchase >= 0 ? number(r[m.purchase]) : null, tva_rate: tva, unit: unit || null,
        stock_min: m.stock_min >= 0 ? number(r[m.stock_min]) : null, description: stripHtml(g('description') || parentInfo.description).slice(0, 4000),
        track_stock: m.track >= 0 && no(g('track')) ? false : true, stocks, warn,
      });
    });
    return out;
  }

  const TEMPLATE = '\uFEFF' + ['Nom;Référence;Code-barres;Catégorie;Prix de vente TTC;Prix d’achat HT;Stock;Seuil d’alerte;TVA;Unité;Description',
    'Café moulu 250 g;CAF-250;3017620422003;Épicerie;4,80;2,90;24;6;5,5;paquet;Arabica, mouture fine',
    'Perceuse sans fil 18 V;PER-18V;;Outillage;149,00;92,00;5;2;20;pièce;'].join('\r\n');

  window.ComptoirImport = { readFile, detect, autoMap, toProducts, number, TEMPLATE, FIELDS, norm };
})();
