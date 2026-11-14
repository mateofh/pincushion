# syntax=docker/dockerfile:1
# Pincushion: imagen de producción.
#   docker build -t pincushion .
#   docker run -d -p 4321:4321 -v pincushion-data:/data \
#     -e APP_SECRET="$(openssl rand -base64 48)" -e APP_ORIGIN=https://enlaces.tu-dominio.es -e TRUST_PROXY=1 pincushion
#   docker exec -it <contenedor> node --disable-warning=ExperimentalWarning scripts/user-create.ts --email tu@correo --password '…'
#   docker exec <contenedor> node --disable-warning=ExperimentalWarning scripts/backup.ts --keep 7
# APP_SECRET es obligatorio en tiempo de ejecución (nunca se hornea en la imagen).

ARG NODE_VERSION=22.23.4

# ── 1. Dependencias completas (incluye las de desarrollo para compilar) ──────────
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    ASTRO_TELEMETRY_DISABLED=1 \
    npm_config_fund=false \
    npm_config_audit=false
COPY package.json package-lock.json ./
RUN npm ci

# ── 2. Build de Astro y poda a dependencias de producción ──────────────────────
FROM deps AS build
COPY . .
RUN npm run build && npm prune --omit=dev

# ── 3. Imagen final: solo lo necesario para migrar y servir ─────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    DATABASE_PATH=/data/pincushion.db \
    ASTRO_TELEMETRY_DISABLED=1
WORKDIR /app

# node_modules de producción (Astro, sirv, htmlparser2…), build y lo que usan los scripts de operación.
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src/server ./src/server
COPY --from=build /app/src/domain ./src/domain
COPY --from=build /app/migrations ./migrations

# Usuario no root (uid 1000 "node" de la imagen base) dueño del volumen de datos.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4321) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Migra (con copia previa automática si la DB ya existe) y arranca; exec para recibir SIGTERM.
CMD ["sh", "-c", "node --disable-warning=ExperimentalWarning scripts/migrate.ts && exec node --disable-warning=ExperimentalWarning server/entry.mjs"]
