# Montée en charge

Comptoir est conçu pour grandir par étapes, sans réécriture. Ce document dit ce qui est déjà prêt, où sont les limites et quoi faire quand on les approche.

## Ce qui est déjà en place

- **Serveurs sans état.** Les sessions, les verrous et toutes les données sont en base ; rien n'est gardé en mémoire d'un serveur à l'autre (les seules mémoires locales sont des caches qui se reconstruisent seuls). On peut donc ajouter des serveurs derrière un répartiteur de charge.
- **Tâche du matin sûre à plusieurs.** Chaque serveur peut la programmer ; un verrou en base (`platform_meta`, clé `cron:AAAA-MM-JJ`) garantit une seule exécution par jour.
- **Photos hors de la base.** Avec `STORAGE_DRIVER=s3` (ou R2 sur Cloudflare), les images ne pèsent plus sur la base et sont servies avec un cache d'un an.
- **Caches navigateur.** Fichiers statiques avec ETag, polices et photos mises en cache longtemps, pages publiques mises en cache quelques minutes.
- **Côté navigateur.** Mémoire courte des lectures (30 s), préchargement des rubriques, service worker : l'application sollicite peu le serveur.
- **Santé.** `/api/health` pour les répartiteurs de charge et les sondes Kubernetes ; la console (« Système ») suit le temps de réponse et les erreurs de chaque route.

## Les étapes

| Étape | Ordre de grandeur | Architecture |
|---|---|---|
| 1 | jusqu'à quelques centaines de commerces | un serveur, SQLite sur disque, photos sur disque |
| 2 | quelques milliers de commerces | plusieurs serveurs, Turso (libSQL), photos sur S3 ; ou Cloudflare (D1 et R2) |
| 3 | au-delà | répartition des commerces sur plusieurs bases (voir plus bas) |

Ces ordres de grandeur dépendent surtout du nombre de ventes par jour. Surveillez dans la console la taille de la base et le temps de réponse des routes avant de changer d'étape.

## Les limites à connaître

- **Écritures SQLite.** SQLite (et donc D1 et libSQL) accepte une écriture à la fois par base. Les écritures de Comptoir sont courtes (une vente = un lot de quelques instructions), ce qui laisse beaucoup de marge, mais c'est la limite qui finira par compter.
- **Taille d'une base D1** : 10 Go au plus. Les photos stockées en base consomment vite cet espace : passez à R2 tôt.
- **Lectures lourdes.** Les rapports et la console agrègent beaucoup de lignes. Les index utiles existent (`store_id`, dates, boutiques) ; ajoutez-en par migration si une route ralentit (la console indique lesquelles).

## Répartir les commerces sur plusieurs bases (étape 3)

Chaque requête ne concerne qu'**un seul commerce** (règle d'or n° 1), ce qui rend le partage naturel : un groupe de commerces par base.

1. Une petite base « annuaire » associe chaque commerce à sa base (`store_id → base`), ainsi que les comptes utilisateurs.
2. À l'entrée de chaque requête, l'application choisit `env.DB` selon le commerce de la session : c'est le seul endroit à modifier (`getContext` dans `features/auth.js` et le routeur `app.js`).
3. La console de la plateforme interroge toutes les bases et additionne les résultats.

Turso et D1 permettent de créer des milliers de bases ; libSQL propose aussi des réplicas en lecture proches des utilisateurs.

## Vers PostgreSQL ?

Le code utilise un SQL compatible SQLite (`INSERT OR REPLACE`, `json_each`, `ON CONFLICT`, `RETURNING`…). Passer à PostgreSQL demanderait un adaptateur au format D1 (comme `adapters/node/d1.js`) et la traduction de ces quelques tournures. Ce n'est pas nécessaire tant que l'étape 3 suffit : les bases de la famille SQLite tiennent des volumes très importants quand chaque commerce est isolé.
