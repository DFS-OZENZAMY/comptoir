# Déploiement

Comptoir se déploie de la même façon partout : un programme Node.js (ou un Worker Cloudflare), une base SQLite-compatible et, au besoin, un stockage de fichiers. Choisissez selon la taille :

| Situation | Base | Photos | Serveurs |
|---|---|---|---|
| Démarrage, un serveur | fichier SQLite (`file:`) | disque (`fs`) | 1 |
| Plusieurs serveurs, cloud | libSQL / Turso (`libsql://`) | S3 compatible (`s3`) | autant que nécessaire |
| Cloudflare | D1 | base, ou R2 | géré par Cloudflare |

Toutes les variables sont décrites dans [`.env.example`](../.env.example). Avant d'accueillir des commerçants, configurez les sauvegardes : [BACKUP.md](BACKUP.md). La production doit être servie en **HTTPS** : le cookie de session est marqué `Secure`.

## Cloudflare Workers

1. Dans Cloudflare : **Workers & Pages, Create, Import a repository**, puis choisissez le dépôt. Le nom du Worker doit être `comptoir` (voir `wrangler.jsonc`).
2. La base D1 `comptoir-data` est créée au premier déploiement.
3. Dans **Settings, Variables and Secrets** : `PLATFORM_ADMIN_EMAILS` (obligatoire), puis `APP_URL`, `RESEND_API_KEY`, `MAIL_FROM` et `LEGAL_*`.
4. Photos dans R2 (recommandé dès quelques centaines de commerces) : créez un bucket, puis ajoutez dans `wrangler.jsonc` :
   ```jsonc
   "r2_buckets": [{ "binding": "FILES", "bucket_name": "comptoir-photos" }]
   ```
   Les nouvelles photos vont dans R2 ; les anciennes restent lisibles depuis la base.

En local : `npm run dev:cloudflare`. Déploiement manuel : `npm run deploy:cloudflare`.

## Un serveur (VPS) avec Docker

Sur n'importe quel serveur Linux (OVH, Scaleway, Hetzner, DigitalOcean, Contabo, un serveur au bureau…) :

```bash
git clone <dépôt> comptoir && cd comptoir
cp .env.example .env        # renseigner au moins PLATFORM_ADMIN_EMAILS et APP_URL
docker compose up -d        # http://serveur:8080
```

La base et les photos sont dans le volume `comptoir-data`. Pour le HTTPS, placez un proxy devant ; avec [Caddy](https://caddyserver.com), le certificat est automatique :

```
comptoir.example.com {
    reverse_proxy localhost:8080
}
```

Mise à jour : `git pull && docker compose up -d --build`. Sauvegarde : copiez le volume, ou utilisez `sqlite3 data/comptoir.db ".backup sauvegarde.db"`.

Sans Docker : Node.js 22.5 ou plus, puis `npm ci --omit=dev && npm start`, lancé par systemd ou pm2.

## Plusieurs serveurs (cloud, Kubernetes)

Dès qu'il y a plus d'un serveur, ils doivent partager **la base** et **les photos** :

- **Base** : [Turso](https://turso.tech) (libSQL hébergé), ou un serveur libSQL auto-hébergé (`sqld`). `DATABASE_URL=libsql://…` et `DATABASE_AUTH_TOKEN=…`.
- **Photos** : `STORAGE_DRIVER=s3` avec n'importe quel stockage compatible S3 : AWS S3, Cloudflare R2, Scaleway, OVH, Backblaze B2, Wasabi, MinIO, ou Google Cloud Storage (interface S3, clés HMAC, `S3_ENDPOINT=https://storage.googleapis.com`).

Les serveurs sont alors **sans état** : on peut en ajouter ou en retirer à tout moment. La tâche du matin peut tourner sur chacun : un verrou en base garantit une seule exécution par jour.

Hébergeurs adaptés : Google Cloud Run, AWS App Runner ou ECS, Azure Container Apps, Scaleway Serverless Containers, Render, Railway, Fly.io. Tous construisent l'image à partir du `Dockerfile`. Indiquez `/api/health` comme vérification de santé.

Azure Blob Storage ne parle pas le protocole S3 : sur Azure, utilisez un autre stockage compatible S3 (R2, par exemple) ou `STORAGE_DRIVER=db`.

### Exemple Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: comptoir }
spec:
  replicas: 3
  selector: { matchLabels: { app: comptoir } }
  template:
    metadata: { labels: { app: comptoir } }
    spec:
      containers:
        - name: comptoir
          image: registre.example.com/comptoir:1.0.0
          ports: [{ containerPort: 8080 }]
          envFrom: [{ secretRef: { name: comptoir-env } }]   # DATABASE_URL libsql://…, STORAGE_DRIVER=s3, S3_*…
          readinessProbe: { httpGet: { path: /api/health, port: 8080 }, periodSeconds: 10 }
          livenessProbe: { httpGet: { path: /api/health, port: 8080 }, periodSeconds: 30 }
          resources: { requests: { cpu: 100m, memory: 128Mi }, limits: { memory: 512Mi } }
```

Avec une base SQLite sur disque (`file:`), gardez **un seul** serveur (`replicas: 1`, stratégie `Recreate`) et un volume persistant.

## Quitter Cloudflare (ou y revenir)

Les données passent d'un hébergement à l'autre sans transformation, car toutes les bases parlent le même SQL :

```bash
npx wrangler d1 export comptoir-data --remote --output=comptoir.sql   # depuis Cloudflare D1
sqlite3 data/comptoir.db < comptoir.sql                               # vers un fichier SQLite
turso db create comptoir --from-dump comptoir.sql                     # ou vers Turso
```

Les photos enregistrées en base suivent automatiquement. Celles qui sont dans R2 se copient vers un autre stockage S3 avec un outil comme `rclone`.

Dans l'autre sens : `npx wrangler d1 execute comptoir-data --remote --file=comptoir.sql`.
