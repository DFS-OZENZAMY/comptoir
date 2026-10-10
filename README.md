# Comptoir

Plateforme SaaS pour les commerces de proximité : caisse, stock, devis et factures, vitrine en ligne, plusieurs boutiques, équipe avec droits, fidélité, import depuis les anciens logiciels. Multi-commerces (un espace isolé par commerce), en français, pensée pour la France, le Maghreb et l'Afrique de l'Ouest.

**Fonctionne sur n'importe quel hébergeur** : Cloudflare Workers, ou n'importe où Node.js tourne (serveur, Docker, Kubernetes, AWS, Google Cloud, Azure, OVH, Scaleway, Render, Railway, Fly.io…).

## Démarrer en deux minutes

Prérequis : Node.js 22.5 ou plus récent.

```bash
npm install
cp .env.example .env      # facultatif : la configuration par défaut suffit pour essayer
npm run dev               # http://localhost:8080
```

Une base SQLite et un dossier de photos sont créés dans `data/`. Inscrivez-vous sur `/app/` : avec l'adresse e-mail indiquée dans `PLATFORM_ADMIN_EMAILS`, la console de la plateforme (`/console/`) devient accessible.

Avec Docker : `docker compose up -d`. Sur Cloudflare : `npm run deploy:cloudflare`. Voir [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur local Node.js, relancé à chaque modification de `src/` |
| `npm run dev:cloudflare` | Serveur local Cloudflare (Wrangler, base D1 locale) |
| `npm start` | Serveur Node.js de production |
| `npm test` | Tests automatisés (en mémoire, quelques secondes) |
| `npm run lint` | Vérification du code (ESLint) |
| `npm run check` | Les deux : à lancer avant chaque envoi |
| `npm run deploy:cloudflare` | Déploiement sur Cloudflare Workers |
| `npm run backup -- …` | Sauvegardes : créer, lister, vérifier, restaurer (voir docs/BACKUP.md) |

## Organisation du code

```
src/
  app.js            Routeur de l'application : API, pages publiques, tâche du matin
  core/             Socle : utilitaires (lib), catalogue (formules, pays, permissions), schéma et migrations (db)
  features/         Une fonction métier par fichier : comptes, commerce, boutiques et droits, console,
                    import, connexion aux anciens outils, référencement, centre d'aide
  platform/         Ce qui marche partout : réécriture HTML, pays du visiteur, stockage des fichiers
  adapters/
    cloudflare.js   Entrée Cloudflare Workers
    node/           Entrée Node.js : serveur HTTP, bases (SQLite, libSQL), fichiers du site, stockage disque
public/             Interfaces, sans étape de compilation : site, espace commerçant (app/),
                    vitrine (store/), console (console/), lecteurs de bases (vendor/)
scripts/            Outils en ligne de commande (sauvegardes)
tests/              Tests automatisés et fichiers d'exemple pour l'import
docs/               Architecture, déploiement, montée en charge, contribution, fonctionnalités
design/             Maquettes et jetons de design (Figma)
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) : comment l'application est construite, et ses règles d'or.
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) : travailler dans le projet (conventions, recettes, tests).
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) : mettre en ligne sur chaque type d'hébergement.
- [docs/SCALING.md](docs/SCALING.md) : monter en charge, étape par étape.
- [docs/BACKUP.md](docs/BACKUP.md) : sauvegardes, surveillance et procédures de reprise.
- [docs/FEATURES.md](docs/FEATURES.md) : le catalogue détaillé des fonctionnalités.
- [design/README.md](design/README.md) : le système de design.

## Sécurité

- Mots de passe chiffrés avec PBKDF2-SHA256 (100 000 itérations, sel aléatoire).
- Sessions : jeton aléatoire, dont seule l'empreinte SHA-256 est stockée. Cookie HttpOnly, Secure, SameSite=Lax, valable 30 jours.
- Isolation des commerces : chaque requête sur des données d'un commerce est filtrée par `store_id` (testé automatiquement).
- Permissions vérifiées côté serveur, route par route (16 permissions, rôles personnalisables).
- Clés d'accès aux anciens outils jamais enregistrées ; adresses internes refusées.
- Sauvegardes quotidiennes chiffrées (AES-256-GCM), vérifiées, avec rotation sur un an, chez un prestataire distinct (voir docs/BACKUP.md).

## Avant de commercialiser

- **Paiement des abonnements** : aujourd'hui, les demandes de formule sont validées à la main dans la console. Brancher Stripe, ou un prestataire local (CMI au Maroc, Wave ou Orange Money en Afrique de l'Ouest).
- **Mot de passe oublié par e-mail** : aujourd'hui, le propriétaire ou la console génèrent un mot de passe temporaire.
- **Caisse en France** : un logiciel de caisse certifié (NF525 ou équivalent) est exigé pour les commerçants assujettis à la TVA qui encaissent des particuliers.
- **Juridique** : renseigner les variables `LEGAL_*` et faire relire les pages légales par un juriste.
- **Anti-abus** : un captcha sur l'inscription.
