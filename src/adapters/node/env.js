// Configuration de l'application hors Cloudflare : variables d'environnement (et fichier .env facultatif),
// transformées en « env » identique à celui de Cloudflare (DB, ASSETS, STORAGE, variables).
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDatabase } from './d1.js';
import { createAssets } from './assets.js';
import { fsStorage } from './fs-storage.js';
import { memoryStorage } from '../../platform/storage.js';
import { memoryHub } from '../../platform/realtime.js';

export const ROOT = resolve(new URL('../../..', import.meta.url).pathname);

export function loadDotEnv(path = join(ROOT, '.env')) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

// Liste des adresses traitées par l'application avant les fichiers : lue dans wrangler.jsonc (source unique).
export function workerFirstPatterns() {
  const text = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
  const list = JSON.parse(text).assets?.run_worker_first || [];
  return list.map((p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'));
}

export async function createEnv(vars = process.env, overrides = {}) {
  const env = { ...vars };
  env.DB = overrides.DB || await openDatabase(vars.DATABASE_URL || `file:${join(ROOT, 'data', 'comptoir.db')}`, vars.DATABASE_AUTH_TOKEN);
  env.ASSETS = overrides.ASSETS || await createAssets(join(ROOT, 'public'));
  const driver = (vars.STORAGE_DRIVER || 'fs').toLowerCase();
  if (overrides.STORAGE) env.STORAGE = overrides.STORAGE;
  else if (driver === 'fs') env.STORAGE = fsStorage(vars.FILES_DIR || join(ROOT, 'data', 'files'));
  else if (driver === 'memory') env.STORAGE = memoryStorage();
  // « db » et « s3 » : gérés par src/platform/storage.js à partir des variables.
  env.STORAGE_DRIVER = driver;
  // Sauvegardes : dossier local par défaut ; en production, une destination externe (BACKUP_DRIVER=s3).
  const bdriver = (vars.BACKUP_DRIVER || 'fs').toLowerCase();
  if (overrides.BACKUP_STORAGE) env.BACKUP_STORAGE = overrides.BACKUP_STORAGE;
  else if (bdriver === 'fs') env.BACKUP_STORAGE = fsStorage(vars.BACKUP_DIR || join(ROOT, 'data', 'backups'));
  else if (bdriver === 'memory') env.BACKUP_STORAGE = memoryStorage();
  env.BACKUP_DRIVER = bdriver;
  // Messagerie : concentrateur temps réel en mémoire (un serveur ; voir docs/SCALING.md pour plusieurs).
  env.REALTIME = overrides.REALTIME || memoryHub();
  return env;
}
