// Fichiers du site (dossier public/) servis comme sur Cloudflare : mêmes règles d'adresses
// (barre oblique finale, pages sans « .html »), mêmes en-têtes (_headers), validation par ETag.
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.mp4': 'video/mp4',
};

// Fichier _headers au format Cloudflare / Netlify : un motif d'adresse, puis des lignes « Nom: valeur » en retrait.
export function parseHeadersFile(text) {
  const rules = []; let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { cur = { re: new RegExp('^' + line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), headers: [] }; rules.push(cur); }
    else if (cur) { const i = line.indexOf(':'); if (i > 0) cur.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]); }
  }
  return rules;
}

export async function createAssets(root) {
  let rules = [];
  try { rules = parseHeadersFile(await readFile(join(root, '_headers'), 'utf8')); } catch { /* pas de fichier _headers */ }
  const file = async (p) => { try { const s = await stat(p); return s.isFile() ? s : null; } catch { return null; } };
  const send = async (request, path, pathname, s) => {
    const etag = `W/"${s.size.toString(16)}-${Math.floor(s.mtimeMs).toString(16)}"`;
    const headers = new Headers({ 'content-type': TYPES[extname(path).toLowerCase()] || 'application/octet-stream', etag, 'cache-control': 'public, max-age=0, must-revalidate' });
    for (const r of rules) if (r.re.test(pathname)) for (const [k, v] of r.headers) headers.set(k, v);
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    return new Response(request.method === 'HEAD' ? null : await readFile(path), { status: 200, headers });
  };
  return {
    async fetch(input) {
      const request = input instanceof Request ? input : new Request(input);
      const url = new URL(request.url);
      let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { return new Response('Not Found', { status: 404 }); }
      if (pathname.includes('\0') || pathname.split('/').includes('..') || /(^|\/)_headers$/.test(pathname)) return new Response('Not Found', { status: 404 });
      const p = normalize(join(root, pathname));
      if (!p.startsWith(normalize(root))) return new Response('Not Found', { status: 404 });
      const redirect = (to) => new Response(null, { status: 307, headers: { location: to + url.search } });
      if (pathname.endsWith('/index.html')) return redirect(pathname.slice(0, -10));
      if (pathname.endsWith('.html') && await file(p)) return redirect(pathname.slice(0, -5));
      if (pathname.endsWith('/')) { const s = await file(join(p, 'index.html')); return s ? send(request, join(p, 'index.html'), pathname, s) : new Response('Not Found', { status: 404 }); }
      let s = await file(p); if (s) return send(request, p, pathname, s);
      s = await file(p + '.html'); if (s) return send(request, p + '.html', pathname, s);
      if (await file(join(p, 'index.html'))) return redirect(pathname + '/');
      return new Response('Not Found', { status: 404 });
    },
  };
}
