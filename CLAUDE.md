# CLAUDE.md

Project catch-up for Claude and future agents working in this repo.

## What This Is

- `Virtual Card Table` is a server-authoritative poker app for friends.
- It is play-money only; there is no real-money wagering.
- The stack is a monorepo with a React web app, a Fastify game server, and shared TypeScript packages.

## Repo Layout

- `apps/web`: React + Vite PWA client
- `apps/game-server`: Fastify REST + WebSocket game server
- `packages/poker-engine`: Pure TypeScript poker rules and betting logic
- `packages/shared-types`: Shared types used by both client and server
- `docs/PLAYTEST.md`: Manual playtest checklist for table flow and hand flow
- `infra/`: Local infrastructure helpers, including Docker Compose for Postgres and Redis

## Core Architecture

- The game server owns all authoritative table state.
- The web app only renders state and sends player actions over the socket.
- `packages/poker-engine` is the source of truth for betting rules, legal actions, pot logic, and street transitions.
- `packages/shared-types` defines the action/state shapes used across the app.

## Betting Flow

- Legal actions are computed in `packages/poker-engine/src/holdem.ts`.
- Hand progression and action application live in `packages/poker-engine/src/game-table.ts`.
- The server receives `game_action` messages, validates turn order and legality, then persists the updated hand state.
- The client should trust the server for the exact raise amount, call amount, and all-in handling.

## Where To Change Things

- Betting rules: `packages/poker-engine/src/holdem.ts` and `packages/poker-engine/src/game-table.ts`
- Shared state/types: `packages/shared-types/src/game.ts`
- Web table UI: `apps/web/src/pages/TablePage.tsx`
- Player action UI: `apps/web/src/components/ActionBar.tsx`
- Socket/game state sync: `apps/web/src/hooks/useGameSocket.ts`
- Server action processing: `apps/game-server/src/services/game-manager.ts`

## Useful Commands

- `npm run dev` starts the server and web app together.
- `npm run dev -w @vct/game-server` runs only the game server.
- `npm run dev -w @vct/web` runs only the client.
- `npm run build` builds all workspaces.
- `npm test` runs workspace tests.
- `npm run typecheck` runs TypeScript checks across the repo.
- `npm run test:e2e -w @vct/web` runs Playwright tests when the app is up.

## Local Setup

- Copy `.env.example` to `.env`.
- Optional but helpful: `docker compose -f infra/docker-compose.yml up -d` for Postgres and Redis.
- If no database or Redis is available, the server falls back to in-memory mode.

## Gameplay Notes

- Supported poker variants include Hold'em and Omaha through the engine modules.
- The playtest checklist currently focuses on no-limit Hold'em hand flow.
- Current poker behavior includes blinds, betting rounds, all-in handling, pot building, showdown, and hand history.

## Working Rules

- Prefer fixing game rules in the engine first, then adjust UI to match.
- Add or update tests when changing betting logic.
- Keep the client responsive on desktop and mobile.
- Do not add real-money language or flow.

