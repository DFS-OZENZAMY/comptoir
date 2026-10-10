// Stockage des fichiers sur disque (serveur unique ou volume partagé).
import { mkdir, readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
const TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const safe = (key) => { if (!/^[\w\-./]+$/.test(key) || key.split('/').includes('..')) throw new Error('Clé de fichier invalide.'); return key; };
export function fsStorage(root) {
  return {
    driver: 'fs',
    async put(key, bytes) { const p = join(root, safe(key)); await mkdir(dirname(p), { recursive: true }); await writeFile(p, bytes); },
    async get(key) { try { return { bytes: new Uint8Array(await readFile(join(root, safe(key)))), type: TYPES[extname(key)] || 'application/octet-stream' }; } catch { return null; } },
    async delete(key) { try { await unlink(join(root, safe(key))); } catch { /* déjà absent */ } },
    async list(prefix = '') {
      let all = []; try { all = await readdir(root, { recursive: true, withFileTypes: true }); } catch { return []; }
      return all.filter((d) => d.isFile()).map((d) => join(d.parentPath ?? d.path, d.name).slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')).filter((k) => k.startsWith(prefix)).sort();
    },
  };
}
