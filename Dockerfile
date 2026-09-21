# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Roblox Client MCP - single image, one Node process, one SQLite file.
#
# Build:  docker build -t roblox-client-mcp .
# Run:    docker run -p 3000:3000 -v rcm-data:/data \
#           -e PUBLIC_URL=https://roblox-mcp.example.com roblox-client-mcp
# ---------------------------------------------------------------------------

# ---- web ------------------------------------------------------------------
FROM node:22-bookworm-slim AS web
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- server ---------------------------------------------------------------
FROM node:22-bookworm-slim AS server
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# ---- production dependencies ---------------------------------------------
# Build tools are only needed if better-sqlite3 has no prebuilt binary for the
# target platform; they stay out of the runtime image either way.
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /build/server
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime --------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/bridge.db \
    WEB_ROOT=/app/public

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=prod-deps /build/server/node_modules ./node_modules
COPY --from=server    /build/server/dist          ./dist
COPY --from=web       /build/web/dist             ./public
COPY server/package.json ./package.json

RUN mkdir -p /data && chown -R node:node /app /data

USER node
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" || exit 1

CMD ["node", "dist/index.js"]
