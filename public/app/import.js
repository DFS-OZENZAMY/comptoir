// Import de produits : lecture du fichier (CSV, XLSX) et correspondance des colonnes, entièrement dans le navigateur.
// Le fichier n'est jamais envoyé tel quel : seules les lignes produits normalisées partent vers le serveur.
(() => {
  const norm = (v) => String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, "'").replace(/\s+/g, ' ');

  /* ------------------------------------------------------------ */
  /* Lecture                                                       */
  /* ------------------------------------------------------------ */
  // Encodage d'un fichier texte : marque d'en-tête (BOM), UTF-16 sans marque, UTF-8, sinon Windows
  // européen ou arabe selon les lettres obtenues. « forced » impose un encodage choisi par l'utilisateur.
  const ENCODINGS = { 'utf-8': 'UTF-8', 'utf-16le': 'UTF-16 (Unicode)', 'utf-16be': 'UTF-16 BE', 'windows-1252': 'Windows (Europe occidentale)', 'windows-1256': 'Windows (arabe)', ibm850: 'DOS (Europe occidentale)' };
  function sniffEncoding(b) {
    if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return 'utf-8';
    if (b[0] === 0xff && b[1] === 0xfe) return 'utf-16le';
    if (b[0] === 0xfe && b[1] === 0xff) return 'utf-16be';
    const n = Math.min(b.length, 2000); let odd = 0, even = 0;
    for (let i = 0; i < n; i++) if (b[i] === 0) { if (i % 2) odd++; else even++; }
    if (odd > n * 0.2 && even < n * 0.02) return 'utf-16le';
    if (even > n * 0.2 && odd < n * 0.02) return 'utf-16be';
    try { new TextDecoder('utf-8', { fatal: true }).decode(b); return 'utf-8'; } catch { /* pas de l'UTF-8 */ }
    const fr = (new TextDecoder('windows-1252').decode(b).match(/[éèêàâçùûôîëïüœÉÈÀÇ]/g) || []).length;
    const ar = (new TextDecoder('windows-1256').decode(b).match(/[\u0621-\u064A]/g) || []).length;
    return ar > fr * 2 && ar > 3 ? 'windows-1256' : 'windows-1252';
  }
  const cleanText = (t) => t.replace(/^\uFEFF/, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/g, '');
  function decode(bytes, forced) {
    const enc = forced || sniffEncoding(bytes);
    return { text: cleanText(new TextDecoder(enc).decode(bytes)), encoding: enc };
  }
  // Un fichier binaire inconnu ne doit jamais être lu comme du texte (sinon : caractères au hasard).
  function looksBinary(b) {
    const n = Math.min(b.length, 4096); if (!n) return false;
    const enc = sniffEncoding(b.subarray(0, n));
    if (enc.startsWith('utf-16')) return false;
    let bad = 0; for (let i = 0; i < n; i++) { const c = b[i]; if (c === 0 || (c < 9) || (c > 13 && c < 32)) bad++; }
    return bad > n * 0.03;
  }
  function describeUnknown(b, name) {
    const ext = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    const head = ascii(b, 0, 64);
    const hex = [...b.subarray(0, 16)].map((x) => x.toString(16).padStart(2, '0')).join(' ');
    const printable = head.replace(/[^\x20-\x7e]/g, '.').slice(0, 32);
    let what = 'un format de base de données propre au logiciel, ou protégé';
    if (/LiteDB/.test(head)) what = 'une base LiteDB, format que Comptoir ne lit pas encore';
    else if (/\.(fic|ndx|mmo)$/.test(ext)) what = 'une base HFSQL (WinDev), format que Comptoir ne lit pas';
    else if (ext === '.stockdb') what = 'la base de données de Stock Express, dans un format propre au logiciel ou protégé';
    const how = ext === '.stockdb' ? 'Dans Stock Express, ouvrez la liste des Produits et utilisez l’export des produits vers CSV, puis déposez ce fichier ici.' : 'Utilisez l’export des articles en CSV ou en Excel depuis le logiciel, puis déposez ce fichier ici.';
    const e = new Error(`Ce fichier${ext ? ` (${ext})` : ''} est ${what} : il ne peut pas être lu directement. ${how}`);
    e.detail = `Signature du fichier : ${hex}  |  ${printable}`;
    return e;
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
  async function unzip(buf, wanted, binary = false) {
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
      const raw = method === 0 ? new Response(data) : method === 8 ? new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))) : null;
      if (raw) out[name] = binary ? new Uint8Array(await raw.arrayBuffer()) : await raw.text();
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

  /* ------------------------------------------------------------ */
  /* Bases de données : SQLite, Access, dBase (lues dans le navigateur) */
  /* ------------------------------------------------------------ */
  const ascii = (u8, a, b) => String.fromCharCode(...u8.subarray(a, b));
  function kindOf(u8, name = '') {
    if (ascii(u8, 0, 15) === 'SQLite format 3') return 'sqlite';
    const jet = ascii(u8, 4, 19);
    if (jet === 'Standard Jet DB' || jet === 'Standard ACE DB') return 'access';
    if (/\.dbf$/i.test(name) || ([0x02, 0x03, 0x30, 0x31, 0x83, 0x8b, 0xf5].includes(u8[0]) && u8[1] < 200 && u8[2] >= 1 && u8[2] <= 12 && u8[3] >= 1 && u8[3] <= 31 && (u8[8] | (u8[9] << 8)) > 32)) return 'dbf';
    if (u8[0] === 0x50 && u8[1] === 0x4b) return 'zip';
    if (/\.(mdf|ldf|bak)$/i.test(name)) return 'sqlserver';
    if (/\.sdf$/i.test(name)) return 'sqlce';
    if (/\.(fdb|gdb)$/i.test(name)) return 'firebird';
    return null;
  }
  const UNREADABLE = {
    sqlserver: 'Ce fichier est une base SQL Server : elle ne peut pas être lue directement. Dans votre logiciel, utilisez l’export des articles en Excel ou en CSV.',
    sqlce: 'Ce fichier est une base SQL Server Compact : elle ne peut pas être lue directement. Dans votre logiciel, utilisez l’export des articles en Excel ou en CSV.',
    firebird: 'Ce fichier est une base Firebird : elle ne peut pas être lue directement. Dans votre logiciel, utilisez l’export des articles en Excel ou en CSV.',
  };
  const loadScript = (src) => new Promise((ok, ko) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const sc = document.createElement('script'); sc.src = src; sc.onload = ok; sc.onerror = () => ko(new Error('Chargement du lecteur impossible.')); document.head.append(sc);
  });
  const cell = (v) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'object' ? '' : typeof v === 'bigint' ? String(v) : typeof v === 'string' ? cleanText(v) : v);
  const MAX_ROWS = 200000;

  async function openSqlite(u8) {
    await loadScript('/vendor/sqljs/sql-wasm.js');
    const SQL = await window.initSqlJs({ locateFile: (f) => '/vendor/sqljs/' + f });
    const db = new SQL.Database(u8);
    const names = (db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")[0]?.values || []).map((r) => r[0]);
    const q = (n) => `"${String(n).replace(/"/g, '""')}"`;
    return {
      label: 'SQLite',
      tables: names.map((n) => ({ name: n, headers: (db.exec(`SELECT * FROM ${q(n)} LIMIT 0`)[0]?.columns) || db.exec(`PRAGMA table_info(${q(n)})`)[0]?.values.map((r) => r[1]) || [], count: db.exec(`SELECT COUNT(*) FROM ${q(n)}`)[0].values[0][0] })),
      rows: (n) => { const r = db.exec(`SELECT * FROM ${q(n)} LIMIT ${MAX_ROWS}`)[0]; return r ? r.values.map((row) => row.map(cell)) : []; },
    };
  }
  async function openAccess(u8) {
    await loadScript('/vendor/mdb/mdb-reader.min.js');
    let reader;
    try { reader = new window.MDBReader(window.MDBBuffer.from(u8)); }
    catch (e) { throw new Error(/password|encrypt/i.test(e.message) ? 'Cette base Access est protégée par un mot de passe : exportez les articles depuis le logiciel.' : 'Base Access illisible.'); }
    const names = reader.getTableNames();
    return {
      label: 'Access',
      tables: names.map((n) => { const t = reader.getTable(n); return { name: n, headers: t.getColumnNames(), count: t.rowCount }; }),
      rows: (n) => { const t = reader.getTable(n); const cols = t.getColumnNames(); return t.getData({ rowLimit: MAX_ROWS }).map((o) => cols.map((c) => cell(o[c]))); },
    };
  }
  // Page de code dBase (octet 29) → encodage.
  const DBF_CP = { 0x01: 'ibm437', 0x02: 'ibm850', 0x03: 'windows-1252', 0x57: 'windows-1252', 0x58: 'windows-1252', 0x59: 'windows-1252', 0x64: 'ibm852', 0x65: 'ibm866', 0x7d: 'windows-1255', 0x7e: 'windows-1256', 0xc8: 'windows-1250', 0xc9: 'windows-1251', 0xcb: 'windows-1253' };
  function openDbf(u8, name, forced) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const count = dv.getUint32(4, true), headLen = dv.getUint16(8, true), recLen = dv.getUint16(10, true);
    const fields = []; let off = 1;
    for (let p = 32; p + 32 <= headLen && u8[p] !== 0x0d; p += 32) {
      const fname = ascii(u8, p, p + 11).replace(/\0.*$/, '').trim(); const type = String.fromCharCode(u8[p + 11]); const len = u8[p + 16];
      fields.push({ name: fname, type, off, len }); off += len;
    }
    let enc = forced || DBF_CP[u8[29]];
    if (!enc) { const sample = u8.subarray(headLen, Math.min(u8.length, headLen + recLen * 200)); enc = sniffEncoding(sample); if (enc.startsWith('utf-16')) enc = 'windows-1252'; }
    let td; try { td = new TextDecoder(enc); } catch { td = new TextDecoder('windows-1252'); enc = 'windows-1252'; }
    const rows = [];
    for (let i = 0; i < Math.min(count, MAX_ROWS); i++) {
      const base = headLen + i * recLen; if (base + recLen > u8.length) break;
      if (u8[base] === 0x2a) continue; // enregistrement supprimé
      rows.push(fields.map((f) => { const raw = cleanText(td.decode(u8.subarray(base + f.off, base + f.off + f.len))).trim(); return f.type === 'L' ? (/^[TtYy]/.test(raw) ? 'TRUE' : 'FALSE') : raw; }));
    }
    const tname = name.replace(/^.*[\\/]/, '').replace(/\.dbf$/i, '');
    return { label: 'dBase', encoding: enc, tables: [{ name: tname, headers: fields.map((f) => f.name), count: rows.length }], rows: () => rows };
  }

  // La table des produits : celle dont les colonnes ressemblent le plus à un catalogue.
  const BAD_TABLE = /(facture|ligne|vente|achat|mouvement|client|fournisseur|document|piece|commande|reglement|paiement|journal|log|histori|inventaire|user|utilisateur|param|config|tiers|contact|ticket|caisse)/;
  const GOOD_TABLE = /(produit|article|item|product|catalogue|stock_?item|marchandise)/;
  function scoreTable(t) {
    const B = t.headers.map(baseName), n = norm(t.name);
    const has = (f) => B.some((b) => FIELDS[f].some((x) => same(b, x)));
    let sc = (has('name') ? 4 : 0) + (has('price') ? 3 : 0) + (has('ref') ? 1 : 0) + (has('barcode') ? 2 : 0) + (has('stock') ? 1 : 0) + (has('category') ? 1 : 0) + (has('purchase') ? 1 : 0);
    if (GOOD_TABLE.test(n)) sc += 4;
    if (BAD_TABLE.test(n)) sc -= 5;
    if (!t.count) sc -= 3;
    return sc;
  }
  const LABEL_COLS = ['nom', 'name', 'libelle', 'designation', 'intitule', 'label', 'titre', 'title', 'description'];
  const idCol = (headers) => headers.findIndex((h) => /^(id|code|cle|key|num|numero|pk|rowid)$/.test(norm(h).replace(/[^a-z]/g, '')));
  const labelCol = (headers) => headers.findIndex((h) => LABEL_COLS.includes(norm(h).replace(/_/g, ' ')));
  const stemOf = (h) => norm(h).replace(/[^a-z]/g, '').replace(/^(id|code|fk|ref|num)/, '').replace(/(id|code|fk|ref|num)$/, '').replace(/s$/, '');
  const LOOKUP_STEMS = { famille: 'Famille', categorie: 'Catégorie', category: 'Catégorie', sousfamille: 'Sous-famille', marque: 'Marque', brand: 'Marque', unite: 'Unité', unit: 'Unité', tva: 'TVA', taxe: 'TVA', tax: 'TVA', rayon: 'Rayon' };

  // Feuille « produits » : identifiants remplacés par leurs libellés, stock d'une table à part ajouté par dépôt.
  async function buildSheet(db, tableName) {
    const T = db.tables.find((t) => t.name === tableName);
    const headers = [...T.headers]; const rows = db.rows(tableName).map((r) => [...r]);
    const cache = {}; const rowsOf = (n) => (cache[n] ||= db.rows(n));
    const tableByStem = (stem) => db.tables.find((t) => t.name !== tableName && norm(t.name).replace(/[^a-z]/g, '').replace(/s$/, '').replace(/^(t|tbl|table)(?=[a-z]{4})/, '') === stem);
    headers.forEach((h, ci) => {
      const stem = stemOf(h);
      if (!LOOKUP_STEMS[stem] || norm(h).replace(/[^a-z]/g, '') === stem && !/^\d+$/.test(String(rows.find((r) => r[ci] !== '')?.[ci] ?? ''))) return;
      const lt = tableByStem(stem); if (!lt) return;
      const lid = idCol(lt.headers) >= 0 ? idCol(lt.headers) : 0, llab = labelCol(lt.headers);
      if (llab < 0) return;
      const map = new Map(rowsOf(lt.name).map((r) => [String(r[lid]), r[llab]]));
      let hits = 0; rows.forEach((r) => { const v = map.get(String(r[ci])); if (v !== undefined) { r[ci] = v; hits++; } });
      if (hits) headers[ci] = LOOKUP_STEMS[stem];
    });
    // Stock dans une table à part (produit, dépôt, quantité) : une colonne « Quantité <dépôt> » par dépôt.
    const pk = idCol(T.headers) >= 0 ? idCol(T.headers) : 0;
    for (const st of db.tables) {
      if (st.name === tableName || !/(stock|quantite|qte|inventory|depot)/.test(norm(st.name))) continue;
      const H = st.headers.map((h) => norm(h).replace(/[^a-z]/g, ''));
      const pcol = H.findIndex((h) => /(produit|article|product|item)/.test(h));
      const qcol = H.findIndex((h) => /^(quantite|qte|qty|quantity|stock|stockreel|qtestock|enstock)$/.test(h));
      if (pcol < 0 || qcol < 0) continue;
      const dcol = H.findIndex((h) => /(depot|magasin|emplacement|location|store|boutique|entrepot)/.test(h));
      let depotName = (v) => (v === '' ? 'stock' : String(v));
      if (dcol >= 0) {
        const dt = db.tables.find((t) => /(depot|magasin|emplacement|location|store|boutique|entrepot)/.test(norm(t.name)) && t.name !== st.name);
        if (dt && labelCol(dt.headers) >= 0) { const m = new Map(rowsOf(dt.name).map((r) => [String(r[idCol(dt.headers) >= 0 ? idCol(dt.headers) : 0]), r[labelCol(dt.headers)]])); depotName = (v) => m.get(String(v)) ?? String(v); }
      }
      const sums = new Map(); const depots = new Set();
      for (const r of rowsOf(st.name)) { const d = dcol >= 0 ? depotName(r[dcol]) : 'stock'; depots.add(d); const k = `${r[pcol]}|${d}`; sums.set(k, (sums.get(k) || 0) + (Number(r[qcol]) || 0)); }
      if (!sums.size) continue;
      for (const d of depots) { headers.push(d === 'stock' ? 'Quantité' : `Quantité ${d}`); rows.forEach((r) => r.push(sums.get(`${r[pk]}|${d}`) ?? '')); }
      break;
    }
    return { headers: headers.map((h) => String(h)), rows: rows.filter((r) => r.some((c) => String(c).trim())) };
  }

  async function openDatabase(u8, name, forced) {
    let kind = kindOf(u8, name);
    if (kind === 'zip') {
      // Archive (sauvegarde, dossier zippé) : la plus grande base lisible qu'elle contient.
      const files = await unzip(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), (n) => !/\/$/.test(n) && !/^(__MACOSX|\.)/.test(n), true);
      const cands = Object.entries(files).map(([n, b]) => ({ n, b, k: kindOf(b, n) })).filter((x) => ['sqlite', 'access', 'dbf'].includes(x.k)).sort((a, b) => b.b.length - a.b.length);
      if (!cands.length) {
        const other = Object.entries(files).map(([n, b]) => kindOf(b, n)).find((k) => UNREADABLE[k]);
        if (other) throw new Error(UNREADABLE[other]);
        // Une archive peut aussi contenir un export CSV ou Excel : il est lu comme un fichier ordinaire.
        const text = Object.entries(files).find(([n]) => /\.(csv|txt)$/i.test(n));
        if (text) return { textFile: text };
        const big = Object.entries(files).sort((a, b) => b[1].length - a[1].length)[0];
        throw big ? describeUnknown(big[1], big[0]) : new Error('Archive vide.');
      }
      if (cands[0].k === 'dbf') { // plusieurs .dbf : une table par fichier
        const dbs = cands.filter((c) => c.k === 'dbf').map((c) => openDbf(c.b, c.n, forced));
        const multi = { label: 'dBase', encoding: dbs[0].encoding, tables: dbs.map((d) => d.tables[0]), rows: (n) => dbs.find((d) => d.tables[0].name === n).rows() };
        multi.tables.forEach((t) => { t.score = scoreTable(t); }); multi.tables.sort((a, b) => b.score - a.score || b.count - a.count); multi.sheet = (n) => buildSheet(multi, n);
        return multi;
      }
      u8 = cands[0].b; name = cands[0].n; kind = cands[0].k;
    }
    if (UNREADABLE[kind]) throw new Error(UNREADABLE[kind]);
    const db = kind === 'sqlite' ? await openSqlite(u8) : kind === 'access' ? await openAccess(u8) : kind === 'dbf' ? openDbf(u8, name, forced) : null;
    if (!db) return null;
    db.tables.forEach((t) => { t.score = scoreTable(t); });
    db.tables.sort((a, b) => b.score - a.score || b.count - a.count);
    db.sheet = (n) => buildSheet(db, n);
    return db;
  }

  async function readFile(file, opts = {}) {
    const buf = await file.arrayBuffer();
    let u8 = new Uint8Array(buf);
    const head = u8.subarray(0, 4);
    const kind = kindOf(u8, file.name);
    let encoding = null, rows;
    if (kind && kind !== 'zip') {
      const db = await openDatabase(u8, file.name, opts.encoding);
      return { db, encoding: db.encoding || null, ...(await db.sheet(db.tables[0].name)) };
    }
    if (kind === 'zip') {
      const isXlsx = Object.keys(await unzip(buf, (n) => n === 'xl/workbook.xml')).length > 0;
      if (!isXlsx) {
        const db = await openDatabase(u8, file.name, opts.encoding);
        if (!db.textFile) return { db, encoding: db.encoding || null, ...(await db.sheet(db.tables[0].name)) };
        u8 = db.textFile[1];
      } else rows = await parseXlsx(buf);
    }
    else if (head[0] === 0xd0 && head[1] === 0xcf) throw new Error('Ancien format Excel (.xls) : ouvrez-le dans Excel et enregistrez-le en .xlsx ou en CSV.');
    if (!rows) {
      if (looksBinary(u8)) throw describeUnknown(u8, file.name);
      const d = decode(u8, opts.encoding); encoding = d.encoding;
      rows = parseCsv(d.text);
    }
    const start = rows.findIndex((r) => r.filter((c) => String(c).trim()).length >= 2);
    if (start < 0) throw new Error('Aucun tableau trouvé dans ce fichier.');
    const headers = rows[start].map((h) => String(h).trim());
    const data = rows.slice(start + 1).filter((r) => r.some((c) => String(c).trim()));
    return { headers, rows: data, encoding };
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
    { key: 'stockexpress', label: 'Stock Express (Klick)', test: (h) => h.has('designation') && [...h].some((x) => /^(quantite|qte) (d'alerte|alerte)$|^marque$|^colisage$|^codes? a barres?$/.test(x)), prices: 'ht' },
    { key: 'ebp', label: 'EBP ou Sage', test: (h) => h.has('libelle') || h.has('designation'), prices: 'ht' },
  ];
  // Intitulés reconnus pour chaque information (anglais et français, sans accents).
  const FIELDS = {
    name: ['name', 'nom', 'nom du produit', 'title', 'item name', 'product name', 'designation', 'libelle', 'article', 'produit', 'intitule', 'nom article'],
    variant: ['variation name', 'option1 value', 'option 1 value', 'variante', 'declinaison'],
    variant2: ['option2 value', 'option 2 value'],
    parent: ['handle', 'parent', 'reference handle'],
    ref: ['sku', 'variant sku', 'reference', 'ref', 'code', 'code article', 'reference interne', 'internal reference', 'ref article', 'reference article', 'code produit', 'ref produit', 'reference produit', 'code art', 'cod art'],
    barcode: ['barcode', 'bar code', 'codebarre', 'cb', 'code barre', 'code-barre', 'code-barres', 'code barres', 'code a barres', 'codes a barres', 'code a barre', 'gtin', 'ean', 'ean13', 'ean 13', 'variant barcode', 'gtin, upc, ean, or isbn', 'upc', 'code ean'],
    category: ['category', 'categorie', 'categories', 'famille', 'famille article', 'product category', 'categorie de produit', 'rayon', 'type'],
    price: ['prix de vente ttc', 'prix ttc', 'pv ttc', 'prix vente ttc', 'price', 'default price', 'regular price', 'variant price', 'sales price', 'prix de vente', 'prix', 'prix vente', 'prix de vente ht', 'pv ht', 'prix ht', 'prix unitaire', 'sale price', 'prix vente ht', 'pu ht', 'prix unitaire ht', 'pvht', 'pv', 'pu', 'prix vente ttc'],
    purchase: ['cost', 'cost per item', 'default unit cost', 'purchase cost', 'cost price', "prix d'achat", "prix d'achat ht", 'prix achat', 'prix de revient', 'cout', 'cout unitaire', 'pa ht', 'cout moyen', 'pa', 'prix achat ht', 'cout achat', 'pump', 'pmp', 'cump'],
    stock: ['in stock', 'stock', 'quantity', 'quantite', 'qty', 'variant inventory qty', 'current quantity', 'quantity on hand', 'quantite en stock', 'stock reel', 'stock disponible', 'on hand', 'quantite disponible', 'qte', 'qte en stock', 'qte stock', 'quantite stock', 'stock actuel', 'qte reel', 'qte reelle'],
    stock_min: ['low stock', 'stock alert count', 'low stock amount', 'stock minimum', 'stock mini', 'stock min', 'seuil', "seuil d'alerte", "stock d'alerte", 'point de commande', "quantite d'alerte", 'quantite alerte', 'qte alerte', "qte d'alerte", 'stock alerte', 'qte min', 'seuil alerte', 'stock securite', 'qte mini'],
    tva: ['tva', 'taux tva', 'taux de tva', 'tax rate', 'vat', 'taux', 'tva %'],
    unit: ['unit', 'unite', 'unite de vente', 'unit and precision', 'uom', 'unite de mesure', 'sold by weight'],
    description: ['description', 'body (html)', 'short description', 'description courte', 'description commerciale'],
    photo: ['photo', 'image', 'image src', 'image url', 'images', 'featured image', 'variant image'],
    track: ['track stock', 'stockable', 'manage stock?', 'gerer le stock'],
    type: ['type'],
    archived: ['archived', 'archive'],
  };
  // « PrixVenteHT », « prix_vente_ht », « Prix de vente HT » : même intitulé.
  const baseName = (h) => norm(String(h ?? '').replace(/([a-z\u00e0-\u00ff])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/[_.]+/g, ' ')).replace(/\s*\[.*\]\s*$/, '').replace(/\s*\(.*\)\s*$/, '').trim();

  function detect(headers) {
    const set = new Set(headers.map(baseName));
    for (const h of [...set]) set.add(h.replace(/\s+/g, ' '));
    return SOURCES.find((s) => s.test(set)) || { key: 'autre', label: 'tableau Excel', prices: 'ttc' };
  }
  // Intitulé reconnu : identique, identique sans espaces (« PRIXVENTE »), ou tronqué à 10 caractères (dBase).
  const compact = (x) => x.replace(/[\s'-]/g, '');
  const same = (b, k) => b === k || compact(b) === compact(k) || (b.length === 10 && compact(k).startsWith(compact(b)));
  function autoMap(headers, source) {
    const H = headers.map(norm), B = headers.map(baseName);
    const pick = (list, avoid = []) => { for (const k of list) { const i = B.findIndex((b, j) => same(b, k) && !avoid.includes(j)); if (i >= 0) return i; } return -1; };
    const m = {};
    for (const f of ['name', 'variant', 'variant2', 'parent', 'ref', 'barcode', 'purchase', 'stock_min', 'tva', 'unit', 'description', 'track', 'archived', 'photo']) m[f] = pick(FIELDS[f]);
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
    m.stocks = B.map((b, i) => ((FIELDS.stock.some((k) => same(b, k)) || /^(current quantity|in stock|quantite) .+/.test(H[i])) && !/new quantity/.test(H[i]) ? i : -1)).filter((i) => i >= 0);
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
      // Plusieurs codes-barres dans une même cellule (Stock Express, Sage…) : le premier est gardé.
      if (/[;,|/\s]/.test(barcode)) { const codes = barcode.split(/[;,|/\s]+/).filter(Boolean); if (codes.length > 1) warn.push(`${codes.length} codes-barres, le premier est gardé`); barcode = codes[0] || ''; }
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
        photo: /^https:\/\//.test(g('photo').split(/[,\s]/)[0]) ? g('photo').split(/[,\s]/)[0] : '',
      });
    });
    return out;
  }

  const TEMPLATE = '\uFEFF' + ['Nom;Référence;Code-barres;Catégorie;Prix de vente TTC;Prix d’achat HT;Stock;Seuil d’alerte;TVA;Unité;Description',
    'Café moulu 250 g;CAF-250;3017620422003;Épicerie;4,80;2,90;24;6;5,5;paquet;Arabica, mouture fine',
    'Perceuse sans fil 18 V;PER-18V;;Outillage;149,00;92,00;5;2;20;pièce;'].join('\r\n');

  window.ComptoirImport = { readFile, detect, autoMap, toProducts, number, TEMPLATE, FIELDS, norm, kindOf, ENCODINGS };
})();
