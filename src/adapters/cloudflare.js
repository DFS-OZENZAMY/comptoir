// Adaptateur Cloudflare Workers : la plateforme fournit déjà tout ce que l'application attend
// (env.DB = D1, env.ASSETS = fichiers du site, env.FILES = R2 facultatif, ctx.waitUntil, tâche planifiée).
export { default } from '../app.js';
