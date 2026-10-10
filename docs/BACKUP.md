# Sauvegardes et reprise après incident

Les données des commerçants (ventes, stock, factures, clients) sont ce que Comptoir a de plus précieux. Ce document décrit comment elles sont protégées et, surtout, **comment les récupérer**.

## La stratégie : trois niveaux

| Niveau | Protège contre | Fréquence | Conservation |
|---|---|---|---|
| 1. Restauration à un instant précis (hébergeur de la base) | fausse manipulation, bogue qui abîme des données | continue | 30 jours (D1, Turso) |
| 2. Sauvegardes Comptoir, chiffrées, chez un **autre prestataire** | perte de l'hébergeur, du compte, piratage, rançongiciel | chaque nuit, et à la demande | 7 jours, 4 semaines, 12 mois |
| 3. Copie des photos | perte du stockage des photos | chaque nuit, au fil de l'eau | tant que la photo existe |

C'est la règle « 3-2-1 » : plusieurs copies, sur des supports différents, dont une hors du site principal.

**Objectifs :** au pire, une journée de données perdue avec le niveau 2 seul (quelques minutes avec le niveau 1). Remise en service en moins d'une heure.

## Ce que contient une sauvegarde

- **Toute la base** : tous les commerces, comptes, ventes, documents, stocks, réglages, en **SQL standard**. Ce SQL est relisible par SQLite, Cloudflare D1 et Turso : une sauvegarde faite sur un hébergeur se restaure sur un autre.
- **Compressée** (gzip), **chiffrée** (AES-256-GCM, clé dérivée de `BACKUP_ENCRYPTION_KEY`), **découpée** en morceaux de 8 Mo au plus.
- **Un manifeste** (`manifest.json`) : date, origine, nombre de lignes par table, empreinte SHA-256 de chaque morceau, chiffré et en clair, et empreinte de la clé utilisée.
- **Vérifiée** après chaque création : relecture, contrôle des empreintes, déchiffrement d'essai.

Rangement : `backups/<date>/manifest.json` et `backups/<date>/part-0001.bin`… ; les photos dans `files/images/…`.

## Mise en place

### 1. Créer la clé de chiffrement

```bash
openssl rand -base64 32
```

Rangez-la dans **deux endroits sûrs** : un gestionnaire de mots de passe, et une copie hors ligne (papier dans un coffre, par exemple). **Sans cette clé, les sauvegardes sont illisibles, y compris pour vous.** Ne la changez pas : une nouvelle clé ne lit pas les anciennes sauvegardes. Si vous devez en changer, gardez l'ancienne tant que les sauvegardes faites avec elle sont conservées (un an).

### 2. Choisir la destination

Un stockage compatible S3, **chez un autre prestataire ou au moins dans une autre région** que la production : AWS S3, Scaleway, OVH, Backblaze B2, Wasabi, Cloudflare R2, MinIO… Créez un compartiment dédié aux sauvegardes, avec une clé d'accès limitée à ce compartiment.

Recommandé : activez le **versionnage** et, si le prestataire le permet, le **verrouillage des objets** (Object Lock, mode « conformité », 30 jours). Une sauvegarde ne peut alors être ni modifiée ni supprimée, même par quelqu'un qui volerait vos accès : c'est la meilleure protection contre les rançongiciels.

### 3. Configurer

| Variable | Rôle |
|---|---|
| `BACKUP_DRIVER` | `s3` (recommandé), `r2` (Cloudflare, liaison `BACKUPS`), `fs` (dossier local, par défaut hors Cloudflare) |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | destination S3 (`BACKUP_S3_ENDPOINT` vide pour AWS) |
| `BACKUP_DIR` | dossier, avec `BACKUP_DRIVER=fs` |
| `BACKUP_ENCRYPTION_KEY` | clé de chiffrement (obligatoire en production) |
| `BACKUP_KEEP_DAILY`, `BACKUP_KEEP_WEEKLY`, `BACKUP_KEEP_MONTHLY` | rotation : 7, 4 et 12 par défaut |
| `BACKUP_INCLUDE_FILES` | `false` pour ne pas copier les photos |

**Serveur Node.js ou Docker :** sans configuration, les sauvegardes vont dans `data/backups`, sur le même disque que les données. C'est utile, mais insuffisant : ajoutez une destination S3. La console le signale.

**Cloudflare Workers :** deux possibilités.

- **Depuis GitHub, recommandé**, et compatible avec la formule gratuite. Le fichier `.github/workflows/backup-d1.yml` exporte D1 chaque nuit avec l'outil officiel, le chiffre, l'envoie, fait une restauration d'essai complète et applique la rotation. Renseignez les secrets du dépôt listés en tête du fichier. Le jeton Cloudflare n'a besoin que du droit de lecture sur D1.
- **Depuis le Worker**, avec la tâche du matin. Ajoutez une liaison R2 dans `wrangler.jsonc` (`"r2_buckets": [{ "binding": "BACKUPS", "bucket_name": "comptoir-sauvegardes" }]`) ou les variables `BACKUP_S3_*`, ainsi que `BACKUP_ENCRYPTION_KEY` comme secret. Attention : sur la formule gratuite, le nombre de requêtes par exécution limite la taille des bases sauvegardables. Préférez la méthode GitHub.

## Surveillance

- **Console, rubrique Sauvegardes** : dernière réussite, destination, chiffrement, liste des sauvegardes, avec « Vérifier » et « Télécharger », et les échecs récents. Le bouton « Sauvegarder maintenant » fait une sauvegarde manuelle, gardée 30 jours. Faites-en une avant toute opération risquée.
- **Alertes** :
  - une entrée dans « À traiter » si la dernière sauvegarde réussie a plus de 26 heures, si la dernière a échoué ou si rien n'est configuré ;
  - un **e-mail aux administrateurs** (`PLATFORM_ADMIN_EMAILS`) à chaque échec, si l'envoi d'e-mails est configuré.
- **GitHub Actions** : un échec du travail « Sauvegarde D1 » envoie une notification GitHub.

## Procédures de reprise

Toutes les commandes se lancent depuis une copie du dépôt, avec la configuration de sauvegarde (`.env` ou variables) et `BACKUP_ENCRYPTION_KEY`.

### A. Une erreur récente (données supprimées ou abîmées depuis moins de 30 jours)

Niveau 1, sans toucher aux sauvegardes :

- **Cloudflare D1** :
  ```bash
  npx wrangler d1 time-travel info comptoir-data
  npx wrangler d1 time-travel restore comptoir-data --timestamp=2026-10-10T08:00:00Z
  ```
- **Turso** : créer une base à partir d'un instant passé (`turso db create comptoir-restauree --from-db comptoir --timestamp …`), puis y pointer `DATABASE_URL`.

S'il ne faut récupérer que les données d'**un seul commerce**, restaurez dans une base à part (procédure B, `--to file:./restauration.db`), puis recopiez ses lignes (`WHERE store_id = …`) avec l'aide d'un développeur.

### B. Perte de la base ou de l'hébergeur

```bash
npm run backup -- list                                          # sauvegardes disponibles
npm run backup -- verify latest --deep                          # contrôle complet avant de restaurer
npm run backup -- restore latest --to file:./data/comptoir.db   # serveur Node.js / Docker
```

Puis démarrez Comptoir avec `DATABASE_URL=file:./data/comptoir.db` (ou une base Turso : `--to libsql://…`, avec `RESTORE_AUTH_TOKEN`).

Vers **Cloudflare D1** :

```bash
npm run backup -- export latest --out comptoir.sql
npx wrangler d1 execute comptoir-data --remote --file=comptoir.sql
rm comptoir.sql            # le fichier exporté est en clair : ne le gardez pas
```

Les commandes acceptent un identifiant précis (par exemple `2026-10-09T02-30-12-345Z`) à la place de `latest`.

### C. Perte du stockage des photos

```bash
npm run backup -- files-restore
```

Les photos sauvegardées sont remises dans le stockage principal configuré. Les photos stockées dans la base font partie de la sauvegarde de la base.

### D. Changer d'hébergeur

Une sauvegarde est du SQL standard : restaurez-la sur le nouvel hébergement (procédure B), puis changez l'adresse du domaine. Voir aussi [DEPLOYMENT.md](DEPLOYMENT.md#quitter-cloudflare-ou-y-revenir).

## Exercice de restauration (une fois par mois)

Une sauvegarde qu'on n'a jamais restaurée n'est qu'un espoir. Une fois par mois, sur un poste ou un serveur de test :

1. `npm run backup -- verify latest --deep` : le contrôle complet doit annoncer « toutes identiques ».
2. `npm run backup -- restore latest --to file:./exercice.db`, puis `DATABASE_URL=file:./exercice.db npm start` : connectez-vous et ouvrez un commerce au hasard.
3. Vérifiez que la clé de chiffrement est bien à ses deux emplacements.
4. Notez la date et la durée de l'exercice ; effacez `exercice.db`.

La sauvegarde nocturne depuis GitHub fait déjà le point 1 chaque nuit.

## Sécurité

- Les sauvegardes sont chiffrées **avant** de quitter le serveur : le prestataire de stockage ne peut pas les lire.
- Le téléchargement depuis la console donne un export **déchiffré**. Il est réservé aux administrateurs de la plateforme et inscrit au journal. Ne le conservez pas sur un poste non protégé.
- Les accès à la destination de sauvegarde doivent être distincts de ceux de la production, et limités à l'écriture et à la lecture de ce seul compartiment.
