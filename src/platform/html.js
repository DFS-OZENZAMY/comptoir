// Réécriture HTML portable : même interface que le HTMLRewriter de Cloudflare
// (on(sélecteur, { element(el) {…} }), puis transform(réponse)), mais en JavaScript standard,
// pour fonctionner sur n'importe quel hébergeur. Elle couvre ce dont nos gabarits ont besoin :
// sélecteurs « balise », « #id », « .classe », « balise[attr="valeur"] » ; opérations
// setInnerContent, append, prepend, setAttribute, getAttribute.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');

function parseSelector(sel) {
  const m = String(sel).trim().match(/^([a-z][a-z0-9-]*)?(?:#([\w-]+))?(?:\.([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/i);
  if (!m) throw new Error(`Sélecteur non pris en charge : ${sel}`);
  return { tag: m[1] && m[1].toLowerCase(), id: m[2], cls: m[3], attr: m[4], value: m[5] };
}
function parseAttrs(src) {
  const attrs = {}; const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g; let m;
  while ((m = re.exec(src))) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return attrs;
}
const matches = (s, tag, attrs) => (!s.tag || s.tag === tag) && (!s.id || attrs.id === s.id)
  && (!s.cls || String(attrs.class || '').split(/\s+/).includes(s.cls)) && (!s.attr || (s.value === undefined ? s.attr in attrs : attrs[s.attr] === s.value));

// Fin de l'élément ouvert en « from » (balises de même nom imbriquées comptées).
function findClose(html, tag, from) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi'); re.lastIndex = from; let depth = 1, m;
  while ((m = re.exec(html))) { if (m[1]) { if (--depth === 0) return { start: m.index, end: re.lastIndex }; } else if (!m[0].endsWith('/>')) depth++; }
  return null;
}

export function rewriteHtml(html, rules) {
  for (const { selector, handlers } of rules) {
    const s = parseSelector(selector);
    const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/g; let m; const edits = [];
    while ((m = tagRe.exec(html))) {
      const tag = m[1].toLowerCase(); const attrs = parseAttrs(m[2] || '');
      if (!matches(s, tag, attrs)) continue;
      const openStart = m.index, openEnd = tagRe.lastIndex;
      const close = VOID.has(tag) || m[0].endsWith('/>') ? null : findClose(html, tag, openEnd);
      const ops = { inner: null, before: '', after: '', attrs: { ...attrs }, changed: false };
      const el = {
        tagName: tag,
        getAttribute: (n) => ops.attrs[n.toLowerCase()] ?? null,
        hasAttribute: (n) => n.toLowerCase() in ops.attrs,
        setAttribute: (n, v) => { ops.attrs[n.toLowerCase()] = String(v); ops.changed = true; return el; },
        removeAttribute: (n) => { delete ops.attrs[n.toLowerCase()]; ops.changed = true; return el; },
        setInnerContent: (c, o = {}) => { ops.inner = o.html ? String(c) : escText(c); return el; },
        append: (c, o = {}) => { ops.after += o.html ? String(c) : escText(c); return el; },
        prepend: (c, o = {}) => { ops.before += o.html ? String(c) : escText(c); return el; },
      };
      handlers.element?.(el);
      edits.push({ openStart, openEnd, close, ops, tag });
    }
    // Modifications appliquées de la fin vers le début, pour ne pas décaler les positions.
    for (const { openStart, openEnd, close, ops, tag } of edits.reverse()) {
      if (close && (ops.inner !== null || ops.before || ops.after)) {
        const inner = ops.inner !== null ? ops.inner : html.slice(openEnd, close.start);
        html = html.slice(0, openEnd) + ops.before + inner + ops.after + html.slice(close.start);
      }
      if (ops.changed) {
        const open = `<${tag}${Object.entries(ops.attrs).map(([k, v]) => (v === '' && !['content', 'value', 'alt', 'href', 'src'].includes(k) ? ` ${k}` : ` ${k}="${escAttr(v)}"`)).join('')}>`;
        html = html.slice(0, openStart) + open + html.slice(openEnd);
      }
    }
  }
  return html;
}

export class HtmlRewriter {
  constructor() { this.rules = []; }
  on(selector, handlers) { this.rules.push({ selector, handlers }); return this; }
  // Accepte une réponse (renvoie une réponse) ou un texte (renvoie un texte).
  async transform(input) {
    if (typeof input === 'string') return rewriteHtml(input, this.rules);
    const out = rewriteHtml(await input.text(), this.rules);
    const headers = new Headers(input.headers); headers.delete('content-length');
    return new Response(out, { status: input.status, headers });
  }
}
