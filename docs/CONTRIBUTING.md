# Contribuer à Comptoir

Bienvenue dans le projet. Ce guide explique comment travailler dans le code au quotidien. Lisez d'abord [ARCHITECTURE.md](ARCHITECTURE.md), en particulier les **règles d'or**.

## Mise en place

```bash
npm install
npm run dev        # http://localhost:8080, relancé à chaque modification de src/
npm run check      # vérification du code + tests : à lancer avant chaque envoi
```

Aucune compilation : les fichiers de `public/` sont servis tels quels, il suffit de recharger la page. La base locale est dans `data/` ; supprimez ce dossier pour repartir de zéro.

## Façon de travailler

1. Une branche par sujet : `git switch -c caisse-remise-ligne`.
2. Petits envois, avec un message qui dit ce qui change pour l'utilisateur.
3. `npm run check` doit passer. Il est vérifié deux fois :
   - **par Cloudflare avant chaque déploiement** (`scripts/predeploy.js`, lancé par Wrangler via `build.command`) : si ESLint ou un test échoue, le déploiement est annulé et la version en ligne reste inchangée. Le détail est dans le journal de construction (Workers & Pages, comptoir, Deployments) ;
   - par GitHub Actions (`.github/workflows/ci.yml`), qui construit aussi l'image Docker, quand Actions est disponible sur le compte.
4. Demande de modification (pull request) : remplissez la liste de vérification proposée.

## Conventions

- **JavaScript moderne, sans framework ni compilation.** Modules ES côté serveur ; scripts simples côté navigateur.
- **Deux espaces**, points-virgules, guillemets simples (voir `.editorconfig`). ESLint attrape les erreurs, pas le style.
- **Français partout** : textes de l'interface, messages d'erreur, commentaires, noms des tests. Les noms de variables et de fonctions restent en anglais court (`createProduct`, `stockDelta`).
- **Messages d'erreur utiles** : dire quoi faire (« Indiquez une quantité à transférer. »), jamais « Erreur 400 ».
- **Commentaires** : expliquer *pourquoi*, en une ligne au-dessus du bloc. Pas de commentaire qui répète le code.
- **Sécurité** : jamais de donnée d'un commerce sans `store_id = ?` ; jamais de route d'écriture sans permission ; jamais de clé ou de mot de passe dans les journaux.

## Recettes

### Ajouter une route d'API pour l'espace commerçant

Dans `src/features/store.js` :

1. La permission, dans `guard` :
   ```js
   case 'suppliers': if (W) ctx.need('products.edit'); return;
   ```
2. La route, dans le `switch` de `storeRoutes` :
   ```js
   case 'suppliers':
     if (!id && m === 'GET') return json((await db.prepare('SELECT * FROM suppliers WHERE store_id = ? ORDER BY name').bind(sid).all()).results);
     if (!id && m === 'POST') return json(await createSupplier(ctx, await body()), 201);
     break;
   ```
3. Un test dans `tests/api.test.js`, y compris le cas refusé (un autre commerce, un rôle sans permission).

Si la fonction grossit, créez un fichier dans `src/features/` et importez-le, comme `importer.js` ou `access.js`.

### Modifier la base de données

Dans `src/core/db.js` :

- **Nouvelle table** : ajoutez son `CREATE TABLE IF NOT EXISTS` (avec `store_id`) et ses index dans `SCHEMA`.
- **Nouvelle colonne** ou autre changement : ajoutez une **nouvelle** entrée à la fin de `MIGRATIONS`, avec le numéro suivant :
  ```js
  [5, ['ALTER TABLE products ADD COLUMN supplier_id INTEGER']],
  ```
  Ne modifiez jamais une migration déjà publiée : elle a pu s'exécuter en production.

Les migrations s'appliquent seules au démarrage, sur Cloudflare comme ailleurs.

### Ajouter un écran à l'espace commerçant

Dans `public/app/app.js` :

1. Une fonction `async function viewSuppliers() { … }`, qui remplit `$('#view')` et appelle `setActions(…)` pour les boutons du haut.
2. Son entrée dans `VIEWS` (titre de la rubrique), sa permission dans `VIEW_PERM`, son guide dans `HELP_FOR`, et, si besoin, son onglet dans `GROUPS`.
3. Le lien dans le menu (`public/app/index.html`), avec `data-perm="…"` pour qu'il ne s'affiche qu'aux membres autorisés.
4. Les styles dans `public/app/app.css`, en réutilisant les classes existantes (`panel`, `fields`, `btn`, `badge`…).

Les appels passent par `api(path, { method, body })`, qui gère la session, la boutique courante et la mémoire courte des lectures.

### Reconnaître le fichier d'un nouveau logiciel à l'import

Dans `public/app/import.js` :

1. Une entrée dans `SOURCES`, avec un test sur les intitulés de colonnes (sans accents, en minuscules) et le type de prix (`ht` ou `ttc`).
2. Si ses intitulés sont nouveaux, ajoutez-les dans `FIELDS`.
3. Un fichier d'exemple dans `tests/fixtures/` et un test dans `tests/import-reader.test.js`.
4. Une tuile dans `TOOLS` (`public/app/app.js`), avec la marche à suivre pour exporter, et une ligne dans le guide `src/features/help.js`.

### Ajouter une connexion directe à un outil en ligne

Dans `src/features/connectors.js` : une entrée dans `PROVIDERS`, une fonction de récupération d'**une page** qui renvoie `sheet(…)` et `next`, son ajout dans `FETCHERS`, et, si possible, sa détection dans `detectTool`. Dans `public/app/app.js`, le formulaire dans `DIRECT`. Testez avec des réponses simulées (voir les tests existants) : la clé d'accès ne doit jamais apparaître dans `next` ni dans un journal.

## Tests

```bash
npm test                                   # tout
node --test tests/api.test.js              # un fichier
node --test --test-name-pattern=fidélité "tests/*.test.js"   # un test précis
```

- Les tests démarrent l'application complète **en mémoire** (`tests/helpers.js`) : base SQLite `:memory:`, photos en mémoire, aucun réseau.
- Chaque fichier a sa propre instance ; dans un fichier, créez un nouveau commerce par test (`client.signup()`) plutôt que de dépendre d'identifiants fixes.
- Testez toujours le cas refusé en plus du cas normal.

### Vérifications à faire à la main

Certaines choses demandent un vrai navigateur : l'import d'une base SQLite, Access ou d'un fichier Excel (lecteurs chargés par le navigateur), l'installation de l'application (service worker), l'impression d'un ticket, l'affichage sur téléphone. Avant une version importante, parcourez-les sur `npm run dev`.

## Arborescence

Voir le [README](../README.md#organisation-du-code) et la table des modules dans [ARCHITECTURE.md](ARCHITECTURE.md#les-modules).
