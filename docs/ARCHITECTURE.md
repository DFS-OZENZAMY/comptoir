# Architecture

Ce document explique comment Comptoir est construit, pour qu'un développeur qui découvre le projet sache où chercher et quelles règles respecter.

## Vue d'ensemble

Comptoir est **une seule application JavaScript**, sans framework ni étape de compilation :

- côté serveur, un routeur (`src/app.js`) répond à toutes les requêtes avec les standards du web (`Request`, `Response`, `fetch`, `crypto.subtle`) ;
- côté navigateur, des pages HTML et des scripts simples (`public/`) appellent l'API en JSON.

L'application ne dépend d'**aucun hébergeur**. Tout ce qui est propre à un hébergeur passe par un **adaptateur** qui fournit la même « prise ».

```
                 ┌────────────────────────────── Navigateur ──────────────────────────────┐
                 │  Site (public/index.html)  Espace commerçant (public/app)  Vitrine  Console │
                 └───────────────────────────────────────┬────────────────────────────────┘
                                                         │ HTTP
        ┌────────────────────────────┬───────────────────┴──────────────────┐
        │ adapters/cloudflare.js     │ adapters/node/ (server.js, handler.js)│
        │ (Workers : D1, R2, cron)   │ (Node : SQLite/libSQL, disque/S3, minuterie) │
        └────────────────────────────┴───────────────────┬──────────────────┘
                                                         │ app.fetch(request, env, ctx)
                                     ┌───────────────────┴───────────────────┐
                                     │ src/app.js : routeur                   │
                                     │   /api/…         → features/*          │
                                     │   pages publiques → features/seo, help │
                                     └───────────────────┬───────────────────┘
                     ┌──────────────────────┬────────────┴───────────┬───────────────────────┐
                     │ core/ (lib, catalog, │ features/ (métier)      │ platform/ (portable : │
                     │ db : schéma)         │                         │ html, geo, storage)   │
                     └──────────────────────┴─────────────────────────┴───────────────────────┘
```

## Le contrat des adaptateurs

L'application reçoit `app.fetch(request, env, ctx)` et `runDailyTasks(env)`. Chaque adaptateur doit fournir :

| Élément | Rôle | Cloudflare | Node.js |
|---|---|---|---|
| `env.DB` | Base au format **D1** : `prepare(sql).bind(...).first() / all() / run()`, et `batch([...])` atomique | D1 | `node:sqlite` (fichier) ou libSQL / Turso (`adapters/node/d1.js`) |
| `env.ASSETS` | `fetch(request)` → fichier de `public/`, avec les règles d'adresses et `_headers` | Assets | `adapters/node/assets.js` |
| `env.STORAGE` ou variables `STORAGE_DRIVER` | Photos : `put / get / delete` (`platform/storage.js`) | base, R2 ou S3 | disque, base ou S3 |
| `ctx.waitUntil(promesse)` | Travail après la réponse (statistiques, journal) | natif | `adapters/node/handler.js` |
| Tâche du matin | Appelle `runDailyTasks(env)` une fois par jour (statistiques, nettoyage, e-mails, sauvegarde) | déclencheur cron | minuterie (`CRON_HOUR_UTC`) |
| `env.BACKUP_STORAGE` ou variables `BACKUP_DRIVER` | Destination des sauvegardes (`put / get / delete / list`) | R2 ou S3 | disque ou S3 |
| Temps réel | `publish(canaux, événement)`, `presence()`, connexions WebSocket sur `/api/chat/socket` | Durable Object `CHAT_HUB` (`ChatHub`, src/adapters/cloudflare.js) | `env.REALTIME` + `adapters/node/websocket.js` |
| Variables | `PLATFORM_ADMIN_EMAILS`, `APP_URL`, `LEGAL_*`, `RESEND_API_KEY`… | Variables du Worker | variables d'environnement / `.env` |

L'ordre de traitement est le même partout : les adresses listées dans `run_worker_first` (`wrangler.jsonc`, **source unique**) vont à l'application ; les autres sont d'abord cherchées dans `public/`, puis données à l'application si aucun fichier ne correspond.

**Règle :** le code de `src/core`, `src/features` et `src/platform` n'importe **jamais** de module Node (`node:fs`…) ni d'API propre à Cloudflare. Seuls les adaptateurs le font.

## Le parcours d'une requête d'API

1. `app.fetch` découpe l'adresse (`/api/store/products/12/image` → `store`, `products`, `12`, `image`) et initialise la base au premier appel (`init`, schéma et migrations).
2. `getContext` (`features/auth.js`) lit le cookie de session et charge l'utilisateur et son commerce.
3. Pour `/api/store/…`, `storeRoutes` (`features/store.js`) appelle `resolveAccess` (`features/access.js`) : permissions du membre, boutiques autorisées, boutique courante (en-tête `x-location`).
4. `guard` vérifie la permission de la route ; puis le `switch` de `storeRoutes` exécute la fonction métier.
5. La réponse JSON repart ; les statistiques de la requête sont enregistrées en arrière-plan (`ctx.waitUntil`).

Les erreurs métier sont des `HttpError(statut, message)` : le message, en français, est montré tel quel à l'utilisateur.

## Les règles d'or

1. **Isolation des commerces.** Toute requête SQL sur des données d'un commerce contient `store_id = ?` avec l'identifiant du commerce de la session (`ctx.store.id`), jamais une valeur reçue du navigateur. Le test « isolation » le vérifie.
2. **Permissions côté serveur.** Chaque route d'écriture vérifie sa permission (`guard`, ou `ctx.need('...')` dans la fonction). Masquer un bouton ne protège rien.
3. **La base n'est modifiée que par migrations.** Une nouvelle table : `SCHEMA` (avec `IF NOT EXISTS`). Une nouvelle colonne : une **nouvelle** entrée dans `MIGRATIONS` (`src/core/db.js`), jamais la modification d'une entrée existante.
4. **SQL compatible SQLite.** D1, SQLite et libSQL parlent le même SQL. Pas de fonction propre à un moteur.
5. **Textes en français**, sans jargon, avec des messages d'erreur qui disent quoi faire.
6. **Pas de dépendance sans nécessité.** Le serveur tourne sans aucune dépendance obligatoire ; libSQL est facultatif, ESLint et Wrangler ne servent qu'au développement.

## Les modules

| Fichier | Contenu |
|---|---|
| `src/app.js` | Routeur, pages publiques, santé (`/api/health`), photos, tâche du matin (verrou en base) |
| `src/core/lib.js` | Réponses JSON, erreurs, nombres, dates, mots de passe, lecture du corps |
| `src/core/catalog.js` | Formules et prix par pays, pays et TVA, métiers, permissions et rôles par défaut, réglages par défaut |
| `src/core/db.js` | Schéma, migrations, statistiques d'usage, journal, instantanés |
| `src/features/auth.js` | Inscription, connexion, sessions, création d'un commerce |
| `src/features/store.js` | Espace d'un commerce : produits, stock, clients, devis/commandes/factures, caisse, fidélité, alertes, réglages, équipe, abonnement |
| `src/features/access.js` | Boutiques, stock par boutique, transferts, rapport comparatif, rôles et permissions |
| `src/features/console.js` | Console de la plateforme (administrateurs) |
| `src/features/importer.js` | Import de produits (lignes normalisées) |
| `src/features/connectors.js` | Connexion directe à Loyverse, Square, Shopify, WooCommerce, Odoo ; import des photos |
| `src/features/seo.js` | Pages publiques rendues côté serveur : accueil, métiers, vitrines, pages légales, plan du site |
| `src/features/help.js` | Centre d'aide |
| `src/features/push.js` | Notifications push : abonnements par appareil, destinataires selon les droits, alertes de stock en temps réel, résumé du matin, alertes de plateforme |
| `src/features/purchases.js` | Achats : fournisseurs, bons de commande, suggestions depuis les alertes, réception (stock par boutique, coût moyen pondéré), rapport |
| `src/features/support.js` | Messagerie avec le support : conversations, messages, prise en charge, lecture, identité des connexions temps réel |
| `src/features/backup.js` | Sauvegardes : export SQL, chiffrement, vérification, rotation, copie des photos (voir [BACKUP.md](BACKUP.md)) |
| `src/platform/html.js` | Réécriture HTML portable (interface identique au HTMLRewriter de Cloudflare) |
| `src/platform/geo.js` | Pays du visiteur, quel que soit l'hébergeur |
| `src/platform/realtime.js` | Temps réel : canaux (`store:<id>`, `support`), relais de la saisie en cours, concentrateur en mémoire, accès au Durable Object |
| `src/platform/webpush.js` | Envoi des notifications push : signature VAPID (RFC 8292) et chiffrement aes128gcm (RFC 8291), sans dépendance |
| `src/platform/storage.js` | Stockage des photos : base, R2, S3 (signature AWS v4 en JavaScript standard), mémoire |

Côté navigateur :

| Fichier | Contenu |
|---|---|
| `public/app/app.js` | Espace commerçant : état, appels d'API (mémoire courte de 30 s, préchargement), routeur par ancre (`#/caisse`…), un `view…()` par écran |
| `public/app/import.js` | Lecture des fichiers d'import (CSV, XLSX, bases SQLite / Access / dBase), encodages, reconnaissance des logiciels |
| `public/app/purchases.js` | Interface des achats et fournisseurs (onglets de Produits, préparation depuis les Alertes) |
| `public/app/labels.js` | Codes-barres internes (EAN-13) et étiquettes à imprimer |
| `public/app/chat.js` | Messagerie du commerçant : lanceur, panneau, connexion WebSocket, envoi instantané |
| `public/app/sw.js` | Service worker : application installable et utilisable hors ligne, synchronisation en arrière-plan, notifications |
| `public/app/outbox.js` | Mode hors ligne : copies des lectures et file d'attente des opérations (IndexedDB), envoi vers `/api/store/sync` ; partagé par l'application et le service worker |
| `public/store/store.js` | Vitrine d'un commerce, panier WhatsApp |
| `public/console/console.js` | Console de la plateforme |

## Le mode hors ligne

Les opérations qui doivent marcher sans connexion (vente, client, produit, mouvement de stock, message au support) passent par la file d'attente quand le réseau manque, puis par `POST /api/store/sync`. Pour en ajouter une :

1. côté serveur, la rendre **rejouable** : colonne `client_ref` avec index unique `(store_id, client_ref)` (migration), et renvoi de l'existant si l'identifiant est déjà connu ; accepter `occurred_at` si la date compte ;
2. l'ajouter au `switch` de `syncOps` (`src/features/store.js`) avec sa permission ;
3. côté application, l'envoyer avec `client_ref` en ligne, et appeler `enqueue({ type, body })` sur une erreur `Offline` ; mettre à jour les copies locales avec `keep(chemin, données)`.

Les opérations à numérotation légale (factures, devis) restent volontairement en ligne.

## Les données

Une seule base, partagée par tous les commerces. Les tables principales : `stores`, `users`, `memberships` (rôle et boutiques d'un membre), `sessions`, `roles`, `locations` (boutiques), `products`, `location_stock`, `stock_movements`, `categories`, `customers`, `loyalty_movements`, `documents` et `document_lines` (devis, commandes, factures, tickets), `payments`, `settings` (réglages clé/valeur par commerce), `images` (index des photos), et pour la plateforme `daily_stats`, `api_stats`, `error_log`, `events`, `platform_daily`, `platform_meta`.

Le schéma complet est dans `src/core/db.js`.

## RBAC de la plateforme (console)

L'accès à `/console/` n'est plus binaire. Deux voies :

1. **Super-admin** : adresses dans `PLATFORM_ADMIN_EMAILS` (config serveur) — toutes les permissions, rôle implicite « Propriétaire ».
2. **Équipe** : table `platform_staff` + `platform_roles` — permissions granulaires (`platform.*`).

Les rôles système (Propriétaire, Administrateur, Support, Analyste, Développeur, Marketing) sont seedés au premier accès. Des rôles personnalisés se composent dans **Console → Équipe**. Chaque route `/api/console/…` vérifie la permission côté serveur ; le menu ne montre que les sections autorisées.

Voir `src/features/platform-rbac.js` et `PLATFORM_PERMISSIONS` dans `src/core/catalog.js`.

