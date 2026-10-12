#!/usr/bin/env node
// Vérifications avant déploiement (lancées par Wrangler, « build.command » dans wrangler.jsonc).
// Sur le serveur de construction de Cloudflare (Workers Builds) : ESLint + tests ; un échec annule le déploiement
// et l'ancienne version reste en ligne. Sur un poste de développement (wrangler dev), rien n'est lancé.
import { spawnSync } from 'node:child_process';

const inCi = process.env.WORKERS_CI || process.env.CI || process.env.CF_PAGES || process.env.COMPTOIR_CHECK;
if (!inCi) process.exit(0);

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.warn(`⚠ Vérifications non lancées : Node.js ${process.versions.node} (22.5 ou plus requis pour les tests). Réglez NODE_VERSION=22 dans Cloudflare.`);
  process.exit(0);
}
console.log(`Vérifications avant déploiement (Node.js ${process.versions.node}) : ESLint et tests…`);
const r = spawnSync('npm', ['run', 'check'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (r.status !== 0) { console.error('✖ Vérifications en échec : déploiement annulé, la version en ligne reste inchangée.'); process.exit(r.status || 1); }
console.log('✔ Vérifications réussies : déploiement autorisé.');
