# Virtual Card Table ~ "Home Game"

I love my girlfriend Mackenzie

Server-authoritative web PWA for home poker games with friends. Play-money chips only — settle up IRL however you like.

## Stack

- **apps/web** — React + Vite PWA
- **apps/game-server** — Fastify REST + WebSocket
- **packages/poker-engine** — Pure TS Hold'em/Omaha logic
- **packages/shared-types** — Shared API/WS types

## Quick start

```bash
# Optional: Postgres + Redis
docker compose -f infra/docker-compose.yml up -d

cp .env.example .env
npm install
npm run build

# Terminal 1
npm run dev -w @vct/game-server

# Terminal 2
npm run dev -w @vct/web
```

Open http://localhost:5173 — create a table, copy the invite link, open in another browser/profile.

Without Docker, the server uses an **in-memory** store automatically.

## Environment

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis for table state |
| `JWT_SECRET` | Auth signing secret |
| `GAME_SERVER_PORT` | API/WS port (default 3001) |
| `WEB_ORIGIN` | CORS origin (default http://localhost:5173) |

## Deploy (Railway / Render)

1. Provision Postgres + Redis.
2. Deploy `apps/game-server` with env vars; expose port 3001.
3. Serve the built `apps/web` static files behind a reverse proxy to `/api` and `/ws` on the game server.

See [docs/PLAYTEST.md](docs/PLAYTEST.md) for a friend playtest checklist.

## Tests

```bash
npm test
npm run test:e2e -w @vct/web   # requires servers running
```

## Legal

Entertainment only. No real-money wagering in this application.
