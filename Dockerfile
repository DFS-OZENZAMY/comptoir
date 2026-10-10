# Comptoir dans un conteneur : n'importe quel hébergeur qui exécute Docker
# (serveur, Kubernetes, AWS ECS / App Runner, Google Cloud Run, Azure Container Apps, Scaleway, OVH, Render, Railway, Fly.io…).
FROM node:22-alpine

ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 DATABASE_URL=file:/app/data/comptoir.db FILES_DIR=/app/data/files
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src
COPY public ./public
COPY wrangler.jsonc ./

# Les données (base SQLite, photos) vivent dans un volume, pas dans l'image.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/adapters/node/server.js"]
