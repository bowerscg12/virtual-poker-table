# Virtual Card Table — Claude Context

## What This Is

A multiplayer browser poker app. Players join a lobby with an invite code, get seated automatically, and play Texas Hold'em or Omaha with real-time WebSocket sync. No real money, no auth besides a guest display name.

---

## Repo Layout

```
virtual-card-table/
├── apps/
│   ├── game-server/          # Fastify + ws WebSocket server
│   │   └── src/
│   │       ├── db/           # Drizzle schema, migrate.ts, client.ts
│   │       ├── services/     # auth, lobby, game-manager, chat, session
│   │       ├── store/        # memory-fallback.ts (in-memory Maps)
│   │       └── ws/           # handler.ts — all WebSocket message handling
│   └── web/                  # React + Vite PWA
│       └── src/
│           ├── api/          # client.ts — REST helpers + getWsUrl()
│           ├── components/   # PokerTable, ActionBar, ChatPanel, HostControls, ...
│           ├── context/      # AuthContext.tsx
│           ├── hooks/        # useGameSocket.ts
│           └── pages/        # TablePage.tsx, LobbyPage.tsx, ...
├── packages/
│   ├── poker-engine/         # Pure game logic — no I/O
│   │   └── src/
│   │       ├── game-table.ts # GameTableState, deal/action/advance
│   │       ├── evaluate.ts   # Hand ranking
│   │       ├── pots.ts       # Side-pot calculation
│   │       ├── holdem.ts     # Hold'em variant
│   │       └── omaha.ts      # Omaha variant
│   └── shared-types/         # Types shared by all packages
│       └── src/
│           ├── ws.ts         # ClientMessage / ServerMessage unions
│           ├── game.ts       # PublicTableState, LegalAction, HandHistoryEntry
│           ├── lobby.ts      # LobbySummary, TableSeat
│           ├── variant.ts    # VariantConfig
│           └── auth.ts       # AuthUser
```

---

## Core Architecture

### Server (`@vct/game-server`)

- **Fastify** HTTP server + raw **`ws`** WebSocket server
- **Drizzle ORM** on Postgres (production); falls back to in-memory Maps when Postgres is unavailable (local dev without Docker)
- `isMemoryMode()` from `services/lobby.ts` determines which path every service uses
- Game state (`GameTableState`) is kept in-process in `game-manager.ts`
- All WebSocket message routing lives in `ws/handler.ts`

### Client (`@vct/web`)

- React + Vite, deployed as a PWA
- `useGameSocket` hook owns the WebSocket lifecycle, reconnection, and state sync
- `AuthContext` holds the JWT token and the guest user object
- `TablePage` is the main in-game view

### Shared types (`@vct/shared-types`)

- **Must be rebuilt** (`npm run build -w @vct/shared-types`) after any edit before dependent packages typecheck
- `ws.ts` is the canonical source for all socket message shapes

---

## Database Schema

| Table | Key columns |
|---|---|
| `users` | id, display_name, is_guest |
| `lobbies` | id, host_user_id, invite_code, status, settings (JSONB) |
| `table_seats` | lobby_id, seat_index, user_id, stack, sitting_out |
| `hand_histories` | lobby_id, hand_number, data (JSONB) |
| `player_sessions` | id, user_id, lobby_id, disconnected_at, expires_at |

Run `npm run migrate -w @vct/game-server` to apply DDL.

---

## WebSocket Message Protocol

### Client → Server

| type | purpose |
|---|---|
| `auth` | First message on a fresh connection; sends JWT `token` |
| `reconnect` | First message when restoring a session; sends `sessionId` |
| `join_lobby` | Join/enter a lobby by `lobbyId` |
| `game_action` | `{ actionId, action, amount? }` — player bet/fold/check |
| `chat` | Send a chat message |
| `sit` | Take or auto-assign a seat |
| `host_start` / `host_pause` / `host_kick` / `host_set_buy_in` / `host_approve_rebuy` | Host controls |
| `host_set_action_timer` | `{ seconds: number }` — change action timer mid-table (0 = disabled) |
| `ping` | Heartbeat keepalive |

### Server → Client

| type | purpose |
|---|---|
| `authenticated` | `{ userId, sessionId }` — issued after successful `auth` |
| `session_ready` | `{ userId, lobbyId }` — session restored after `reconnect` |
| `session_invalid` | Session not found or expired; client must fall back to `auth` |
| `lobby_state` | Full `LobbySummary` broadcast |
| `table_state` | `{ public: PublicTableState, private?: { holeCards, legalActions } }` |
| `chat` | Single `ChatMessage` |
| `hand_history` | `HandHistoryEntry` at end of each hand |
| `error` | `{ message, code? }` |
| `pong` | Heartbeat response |

---

## Action Timer System

### Overview

Each table has a configurable per-turn countdown (`VariantConfig.actionTimerSec`). Valid values: 0 (disabled) or any multiple of 15 up to 180 — exported as `TIMER_STEPS_SEC` from `@vct/shared-types`. When the timer expires the server auto-acts: **check** if legal, otherwise **fold**.

### Server (`ws/handler.ts` + `services/game-manager.ts`)

Two module-level Maps in `handler.ts`:
```
actionTimers:      Map<string, setTimeout>  // lobbyId → active countdown
actionTimerGenerations: Map<string, number> // lobbyId → monotonic counter (race guard)
```
`actionDeadlines: Map<string, string>` lives in `game-manager.ts` (co-located with `toPublicState`).

**`cancelActionTimer(lobbyId)`** — clears the timeout AND increments the generation counter so any already-queued callback bails immediately. Always called synchronously before awaiting `processGameAction` in `game_action`.

**`scheduleActionTimer(lobbyId, config, state)`** — calls `cancelActionTimer`, then (if timer enabled and seat is live) sets the deadline and schedules the callback with a generation snapshot.

**`onActionTimerExpired`** — re-fetches state (guard: bail if `actionSeatIndex` has changed), calls `processGameAction` with auto-action, reschedules for next player, broadcasts.

Timer is also rescheduled/cancelled by: `host_start`, `host_pause`/resume, `host_set_action_timer`, and `onGracePeriodExpired`.

### Client (`hooks/useActionTimer.ts` + `components/PokerTable.tsx`)

`useActionTimer(deadline?: string): number | null` — polls every 100ms, returns remaining integer seconds (0 when expired, null when no deadline). Deadline comes from `PublicTableState.actionDeadline` (ISO string set by server). On reconnect the fresh `table_state` push from the server carries the correct deadline, eliminating drift.

Display: acting seat shows a countdown badge and a progress bar (`--timer-pct` CSS custom property). Both turn red (`urgent` class) at ≤ 10 seconds.

### Configuration

- Set at table creation via the "Action timer" fieldset in `CreateLobbyPage`
- Changed live by host in `HostControls` ("Action timer" select → sends `host_set_action_timer`)
- `DISCONNECT_GRACE_PERIOD_MS` env var governs the grace-period auto-fold (separate from the action timer)

---

## Session / Reconnection System

### Overview

Every authenticated WebSocket gets a `sessionId` (UUID). It is stored in `localStorage('vct_session_id')` on the client. On reconnect the client sends `{ type: 'reconnect', sessionId }` instead of `auth`. The server restores seat, lobby, and turn state from the `player_sessions` table.

### Server-side (`services/session.ts`)

- `createSession(userId, lobbyId)` — creates a row, returns `sessionId`
- `getSession(sessionId)` — returns `PlayerSession | null`; auto-deletes expired rows
- `updateSessionLobby(sessionId, lobbyId)` — called when player joins a lobby
- `markSessionDisconnected(sessionId)` — sets `disconnected_at = NOW()`
- `markSessionConnected(sessionId)` — clears `disconnected_at = NULL`
- `deleteSession(sessionId)` — hard-delete (called when grace period expires)
- `cleanExpiredSessions()` — bulk cleanup (call periodically if desired)

Grace period: `GRACE_PERIOD_MS` (env `DISCONNECT_GRACE_PERIOD_MS`, default 180 000 ms / 3 min).
Session TTL: 24 hours.

### Handler-level state (`ws/handler.ts`)

```
connectedUserSockets: Map<string, WebSocket>  // userId → live socket (one per user)
disconnectTimers:     Map<string, setTimeout>  // sessionId → grace timer
```

**On disconnect (`ws.close`):**
`markSessionDisconnected` → `setTimeout(onGracePeriodExpired, GRACE_PERIOD_MS)`

**On `reconnect` message:**

1. Look up session; send `session_invalid` and return if missing/expired
2. `evictSocket` any existing socket for that userId
3. **Synchronously** `clearTimeout` + `disconnectTimers.delete` (before any `await`)
4. Restore `ClientState` (userId, lobbyId, sessionId)
5. `await markSessionConnected`
6. Re-add socket to `lobbyClients`
7. Send `session_ready`
8. Replay chat history
9. `broadcastTableState`

**On grace period expiry (`onGracePeriodExpired`):**
Re-fetches session — aborts if `disconnectedAt` is null (player reconnected). Otherwise:
`deleteSession` → `setSittingOut(true)` → if it is the player's turn: `processGameAction('fold')` → broadcast.

### Client-side (`hooks/useGameSocket.ts`)

- `localStorage.getItem('vct_session_id')` checked on every `onopen`; sends `reconnect` if present
- `session_ready` → resets backoff counter, flushes pending message queue
- `session_invalid` → removes stored sessionId, falls back to `auth`
- `authenticated` → saves `msg.sessionId` to localStorage, sends `join_lobby`
- Heartbeat: ping every 25 s; force-close if no pong within 55 s
- Exponential backoff: `min(1000 × 2^attempt, 30 000)` ms, max 12 attempts
- `reconnecting: boolean` state exposed to UI

### UI (`pages/TablePage.tsx`)

- Status chip: Connected / Reconnecting... / Connecting... (CSS classes `on` / `reconnecting` / `off`)
- Warning banner shown when `reconnecting && !connected`

---

## Betting / Game Flow

1. Host clicks **Start** → `host_start` → `startHand()` in `game-manager.ts`
2. `startHand` calls `poker-engine` deal logic, stores `GameTableState` in memory
3. Each player action → `game_action` → `processGameAction()` → engine validates + advances state
4. After each action `broadcastTableState` pushes `table_state` to all lobby sockets
5. When `street === 'complete'` the engine resolves pots and emits `hand_history`

### Pot / side-pot logic

Lives entirely in `packages/poker-engine/src/pots.ts`. Side pots are calculated at showdown, not incrementally.

---

## Where To Change Things

| Task | File(s) |
|---|---|
| Add/change a poker rule | `packages/poker-engine/src/game-table.ts`, variant file |
| New WebSocket message type | `packages/shared-types/src/ws.ts` → rebuild → `handler.ts` + `useGameSocket.ts` |
| Session / reconnect behaviour | `apps/game-server/src/services/session.ts`, `ws/handler.ts` |
| Disconnect grace period | `DISCONNECT_GRACE_PERIOD_MS` env var (server); `GRACE_PERIOD_MS` in `session.ts` |
| Client reconnect logic | `apps/web/src/hooks/useGameSocket.ts` |
| Action timer durations / steps | `TIMER_STEPS_SEC` in `packages/shared-types/src/variant.ts` |
| Action timer server logic | `scheduleActionTimer` / `cancelActionTimer` in `ws/handler.ts` |
| Action timer auto-action logic | `getAutoAction` in `services/game-manager.ts` |
| Action timer client display | `hooks/useActionTimer.ts`, `components/PokerTable.tsx` |
| Lobby seat / chip changes | `apps/game-server/src/services/lobby.ts` |
| DB schema change | `apps/game-server/src/db/schema.ts` + `migrate.ts` |
| In-memory fallback | `apps/game-server/src/store/memory-fallback.ts` |
| Betting UI (raise slider etc.) | `apps/web/src/components/ActionBar.tsx` |
| Table layout / cards | `apps/web/src/components/PokerTable.tsx` |

---

## Useful Commands

```bash
# Install all workspace deps
npm install

# Build shared types (required after editing ws.ts / game.ts / lobby.ts)
npm run build -w @vct/shared-types

# Dev servers
npm run dev -w @vct/game-server
npm run dev -w @vct/web

# Run all tests
npm test

# Typecheck everything
npm run typecheck

# Run DB migrations
npm run migrate -w @vct/game-server
```

---

## Local Setup

No Docker required for local dev — the server auto-falls back to in-memory storage when Postgres is unreachable. Set `DATABASE_URL` in `apps/game-server/.env` for persistent mode.

Environment variables:

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection string |
| `JWT_SECRET` | — | Signing secret for auth tokens |
| `DISCONNECT_GRACE_PERIOD_MS` | `180000` | How long to hold a disconnected player's seat (ms) |
| `PORT` | `3001` | Game-server HTTP/WS port |

---

## Gameplay Notes

- Players are seated automatically when they join a lobby (`autoSeatPlayer`)
- Buy-in is set by the host and cannot be changed mid-hand
- A player who disconnects keeps their seat for the grace period; if it's their turn they are auto-folded only after the grace period expires
- `sittingOut: true` on a seat means the player missed their seat (disconnected too long); they need to re-join to play
- Hand history is stored per lobby in `hand_histories` and replayed to newly joined sockets

---

## Working Rules

- Prefer fixing game rules in the engine first, then adjust UI to match.
- Add or update tests when changing betting logic.
- Keep the client responsive on desktop and mobile.
- Do not add real-money language or flow.
