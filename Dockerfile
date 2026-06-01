# ---- Builder ----
FROM node:22-alpine AS builder
WORKDIR /app

# Copy workspace manifests first so npm ci is cached unless deps change
COPY package.json package-lock.json ./
COPY apps/game-server/package.json ./apps/game-server/
COPY apps/web/package.json ./apps/web/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/poker-engine/package.json ./packages/poker-engine/

RUN npm ci

# Copy source needed for the server build
COPY tsconfig.base.json ./
COPY apps/game-server/ ./apps/game-server/
COPY packages/shared-types/ ./packages/shared-types/
COPY packages/poker-engine/ ./packages/poker-engine/

RUN npm run build -w @vct/shared-types && \
    npm run build -w @vct/poker-engine && \
    npm run build -w @vct/game-server

# ---- Runner ----
FROM node:22-alpine AS runner
WORKDIR /app

# Workspace manifests needed for npm to wire up symlinks
COPY package.json package-lock.json ./
COPY apps/game-server/package.json ./apps/game-server/
COPY apps/web/package.json ./apps/web/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/poker-engine/package.json ./packages/poker-engine/

RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/apps/game-server/dist ./apps/game-server/dist
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/packages/poker-engine/dist ./packages/poker-engine/dist

ENV NODE_ENV=production

WORKDIR /app/apps/game-server
EXPOSE 3001

CMD ["node", "dist/index.js"]
