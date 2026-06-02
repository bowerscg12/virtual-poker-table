# ── Stage 1: build ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy manifests first so Docker layer-caches the install step
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/poker-engine/package.json ./packages/poker-engine/
COPY apps/game-server/package.json ./apps/game-server/

RUN npm ci

# Build packages in dependency order
COPY packages/shared-types/ ./packages/shared-types/
RUN npm run build -w @vct/shared-types

COPY packages/poker-engine/ ./packages/poker-engine/
RUN npm run build -w @vct/poker-engine

COPY apps/game-server/ ./apps/game-server/
RUN npm run build -w @vct/game-server

# ── Stage 2: production image ───────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

# Copy manifests and install production deps only
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/poker-engine/package.json ./packages/poker-engine/
COPY apps/game-server/package.json ./apps/game-server/

RUN npm ci --omit=dev

# Copy compiled output from builder (workspace symlinks resolve via package.json exports)
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/packages/poker-engine/dist ./packages/poker-engine/dist
COPY --from=builder /app/apps/game-server/dist ./apps/game-server/dist

# Run as non-root
USER node

WORKDIR /app/apps/game-server

ENV NODE_ENV=production

# Cloud Run injects PORT via --port flag; config.ts reads process.env.PORT
EXPOSE 3001

CMD ["node", "dist/index.js"]
