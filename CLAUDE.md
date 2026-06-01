# Virtual Card Table — Claude Context

## What This Is

A multiplayer browser poker app. Players pick a display name, create or join a table with an invite code, get seated automatically, and play Texas Hold'em, Omaha, or 12 Card Flip with real-time WebSocket sync. No real money, no persistent accounts — identity is guest-only via a display name entered at join/create time.

---

## Repo Layout

```
virtual-card-table/
├── apps/
│   ├── game-server/          # Fastify + ws WebSocket server
│   │   └── src/
│   │       ├── config.ts         # Env-var config (PORT, JWT_SECRET, REDIS_URL, etc.)
│   │       ├── db/               # Drizzle schema, migrate.ts, client.ts
│   │       ├── routes/api.ts     # REST endpoints (auth, lobbies, hand-history)
│   │       ├── services/
│   │       │   ├── auth.ts           # Guest login, JWT signing
│   │       │   ├── lobby.ts          # Lobby CRUD, autoSeatPlayer, isMemoryMode()
│   │       │   ├── game-manager.ts   # GameTableState lifecycle, toPublicState
│   │       │   ├── chat.ts           # Chat history store
│   │       │   ├── session.ts        # Reconnect session CRUD
│   │       │   └── session-stats.ts  # Per-session stat accumulation → CashOutSummary
│   │       ├── store/
│   │       │   ├── memory-fallback.ts  # In-memory Maps (users, lobbies, seats, etc.)
│   │       │   └── redis.ts            # ioredis wrapper with in-memory fallback
│   │       └── ws/handler.ts     # All WebSocket message routing
│   └── web/                  # React + Vite PWA
│       └── src/
│           ├── api/client.ts         # REST helpers + getWsUrl()
│           ├── components/
│           │   ├── PokerTable.tsx        # Felt, seats, hole cards, action badges
│           │   ├── ActionBar.tsx         # Fold/Check/Call/Raise/All-In buttons + slider
│           │   ├── ChatPanel.tsx         # In-game chat sidebar
│           │   ├── HostControls.tsx      # Host-only controls (start, pause, kick, timer…)
│           │   ├── HandHistoryPanel.tsx  # Scrollable hand history log
│           │   ├── TwelveCardFlip.tsx    # 12-Card-Flip reveal UI overlay
│           │   ├── WinnerBanner.tsx      # Post-hand winner overlay
│           │   ├── CardView.tsx          # Single playing card (face-up / back)
│           │   ├── ChipStack.tsx         # Chip icon + formatted amount
│           │   ├── AvatarSvg.tsx         # Renders AvatarConfig as SVG
│           │   ├── AvatarCreator.tsx     # Avatar customisation UI
│           │   ├── CashOutModal.tsx      # Confirm cash-out prompt
│           │   ├── RebuyModal.tsx        # Rebuy request UI
│           │   ├── SessionResultsModal.tsx # Post-session stats summary
│           │   └── ShowCardsModal.tsx    # "Show or muck" prompt after fold-win
│           ├── context/AuthContext.tsx   # JWT token + guest user
│           ├── hooks/
│           │   ├── useGameSocket.ts      # WebSocket lifecycle, reconnect, state sync
│           │   ├── useActionTimer.ts     # Polls actionDeadline → remaining seconds
│           │   └── useTableAnimations.ts # Detects state transitions → CSS anim classes
│           └── pages/
│               ├── HomePage.tsx          # Landing: create or join
│               ├── NameSelectionPage.tsx # Guest name entry (first visit)
│               ├── CreateLobbyPage.tsx   # Variant/rules config + create table
│               ├── JoinLobbyPage.tsx     # Enter invite code
│               └── TablePage.tsx         # Main in-game view
├── packages/
│   ├── poker-engine/         # Pure game logic — no I/O
│   │   └── src/
│   │       ├── game-table.ts   # GameTableState, createInitialTable, applyAction
│   │       ├── evaluate.ts     # Hand ranking (evaluateHand, compareHands)
│   │       ├── pots.ts         # Side-pot calculation (at showdown)
│   │       ├── holdem.ts       # Hold'em variant helpers
│   │       ├── omaha.ts        # Omaha / PLO8 helpers
│   │       └── twelve-card-flip.ts  # 12-Card-Flip state + actions
│   └── shared-types/         # Types shared by all packages
│       └── src/
│           ├── ws.ts           # ClientMessage / ServerMessage unions
│           ├── game.ts         # PublicTableState, SeatGameState, LegalAction, HandHistoryEntry
│           ├── lobby.ts        # LobbySummary, TableSeat, UserProfile
│           ├── variant.ts      # VariantConfig, TIMER_STEPS_SEC, GameVariant
│           ├── avatar.ts       # AvatarConfig, coerceAvatar, defaults
│           ├── session-stats.ts # CashOutSummary, ActionCounts
│           ├── presets.ts      # RULES_PRESETS — preset table configs shown at create
│           ├── cards.ts        # Card type
│           └── auth.ts         # AuthUser
```

---

## Core Architecture

### Server (`@vct/game-server`)

- **Fastify** HTTP server + raw **`ws`** WebSocket server
- **Drizzle ORM** on Postgres (production); falls back to in-memory Maps when Postgres is unavailable
- **Redis** stores serialized `GameTableState` (key `table:{lobbyId}:state`); falls back to an in-process `Map` when Redis is unreachable
- `isMemoryMode()` from `services/lobby.ts` selects the storage path for lobby/seat data
- `game-manager.ts` owns all in-memory game state: `activeGames`, `seatLastActions`, `actionDeadlines`, `intermissionDeadlines`
- All WebSocket message routing lives in `ws/handler.ts`

### Client (`@vct/web`)

- React + Vite, deployed as a PWA
- `useGameSocket` hook owns the WebSocket lifecycle, reconnection, and all state sync
- `AuthContext` holds the JWT token and the guest user object
- `TablePage` is the main in-game view; it assembles all sub-components
- `useTableAnimations` detects table-state transitions and returns CSS animation metadata

### Shared types (`@vct/shared-types`)

- **Must be rebuilt** (`npm run build -w @vct/shared-types`) after any edit before dependent packages typecheck
- `ws.ts` is the canonical source for all socket message shapes

---

## Onboarding Flow

Name selection happens before lobby creation/join — identity is created atomically at that step.

1. `/` — **HomePage**: two buttons: "Create Table" and "Join Table"
2. Either button navigates to **NameSelectionPage** first if no display name is set in context
3. On **CreateLobbyPage**: POST `/lobbies` with `{ displayName, settings }` — server creates guest user + JWT + lobby in one call; response includes `{ user, token, sessionId, lobby }`
4. On **JoinLobbyPage**: enter invite code → POST `/lobbies/join` with `{ displayName, inviteCode }` — same atomic response shape
5. Client stores the token in `AuthContext` and navigates to `TablePage`

No JWT is needed before step 3/4 — the REST endpoint is unauthenticated and returns a fresh token.

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

| type | payload / purpose |
|---|---|
| `auth` | `{ token }` — first message on a fresh connection |
| `reconnect` | `{ sessionId }` — first message when restoring a session |
| `join_lobby` | `{ lobbyId }` |
| `game_action` | `{ actionId, action, amount? }` — player bet/fold/check |
| `chat` | `{ text }` |
| `sit` | `{ seatIndex?, buyIn? }` — take or auto-assign a seat |
| `stand` | Leave seat (stay in lobby as spectator) |
| `spectate` | Enter as observer (no seat) |
| `host_start` | Start the next hand |
| `host_pause` | `{ paused: boolean }` |
| `host_kick` | `{ seatIndex }` |
| `host_set_buy_in` | `{ buyIn }` |
| `host_approve_rebuy` | `{ seatIndex, amount }` |
| `host_adjust_blinds` | `{ small, big }` |
| `host_set_action_timer` | `{ seconds }` — 0 = disabled; change mid-table |
| `host_set_flip_ante` | `{ ante }` — 12-Card-Flip ante |
| `cash_out` | Request cash-out (queued until end of hand) |
| `cash_out_cancel` | Cancel a queued cash-out |
| `rebuy` | Request a rebuy (queued until end of hand) |
| `show_cards` | `{ show: boolean }` — respond to show-cards prompt after fold-win |
| `ping` | Heartbeat keepalive |

### Server → Client

| type | payload / purpose |
|---|---|
| `authenticated` | `{ userId, sessionId }` — issued after successful `auth` |
| `session_ready` | `{ userId, lobbyId }` — session restored after `reconnect` |
| `session_invalid` | Session not found or expired; client must fall back to `auth` |
| `lobby_state` | Full `LobbySummary` broadcast |
| `table_state` | `{ public: PublicTableState, private?: { holeCards, legalActions } }` |
| `chat` | Single `ChatMessage` |
| `hand_history` | `HandHistoryEntry` at end of each hand |
| `hand_complete` | `{ winners[] }` — triggers winner banner + glow |
| `cash_out_queued` | Acknowledged cash-out request |
| `cash_out_cancelled` | Cash-out request cancelled |
| `cashed_out` | `{ summary: CashOutSummary }` — final session stats |
| `rebuy_available` | `{ amount }` — rebuy approved by host, ready to accept |
| `rebuy_queued` | Rebuy request acknowledged |
| `rebuy_confirmed` | `{ newStack }` — chips added |
| `show_cards_prompt` | `{ deadline }` — ISO deadline for fold-win show/muck decision |
| `show_cards_result` | `{ seatIndex, cards? }` — broadcast after decision |
| `error` | `{ message, code? }` |
| `pong` | Heartbeat response |

---

## Game Variants

Configured via `VariantConfig` in `packages/shared-types/src/variant.ts`.

| `game` value | Description |
|---|---|
| `holdem` | Texas Hold'em (NL, PL, Fixed) |
| `omaha` | Pot-Limit Omaha (4 hole cards, use exactly 2) |
| `plo8` | Omaha Hi-Lo 8-or-better |
| `stud` | 7-Card Stud |
| `twelve_card_flip` | Heads-up bomb-pot: 12 private cards, players alternate revealing to beat opponent |

Notable `VariantConfig` fields: `bombPot`, `runItTwice`, `straddle`, `sevenDeuceRule`, `extraFlopCards`, `twelveCardFlipAnte`.

Pre-built presets live in `packages/shared-types/src/presets.ts` (`RULES_PRESETS`) and are shown in the create-table UI.

---

## Avatar System

Each player has an `AvatarConfig` persisted in `localStorage` and echoed through `TableSeat.avatar`.

Fields: `gender`, `skinTone`, `hairStyle`, `hairColor`, `eyeColor`.

- `AvatarSvg` renders the config as an inline SVG sprite
- `AvatarCreator` is the customisation panel (shown at name selection or from a settings button)
- `coerceAvatar()` in `avatar.ts` repairs stale saved configs if field values are removed
- Avatars travel through: `localStorage` → REST body on join/create → `table_seats.avatar` column → `LobbySummary.seats[].avatar` → `TableSeat.avatar` on the client

---

## Action Badge System

Each seat on the table displays a small badge showing the player's last action (Fold / Check / Call / Raise / All-In) that persists for the entire round of betting.

### Server (`services/game-manager.ts`)

`seatLastActions: Map<string, Map<number, { action, amount? }>>` — keyed `lobbyId → seatIndex`.

Cleared at three points:

1. **Street advances** — `processGameAction` detects `result.state.street !== state.street` and calls `seatLastActions.delete(lobbyId)`
2. **New hand starts** — `startHand` calls `seatLastActions.delete(lobbyId)` before persisting the new state
3. **Table cleared** — `clearGame` deletes the entry

`toPublicState` reads `seatLastActions` and populates `SeatGameState.lastAction` for every seat.

### Client (`components/PokerTable.tsx`)

`formatActionBadge(action, amount?)` formats the label. Badge is rendered with class `action-badge action-badge--{action}` — styled in `styles.css` with color coding (fold=gray, check=silver, call=green, raise=gold, all-in=orange).

---

## Session Stats / Cash-Out

`services/session-stats.ts` accumulates per-player stats across all hands in a session:

- `initSession(lobbyId, userId, displayName, startingStack)` — called when a player sits
- `recordHandStart` / `recordHandResult` / `recordAction` — called from `handler.ts` after each game event
- `computeCashOut(lobbyId, userId, finalStack)` → `CashOutSummary`

Cash-out flow:

1. Player sends `cash_out` → server queues them; replies `cash_out_queued`
2. At end of current hand, server calls `computeCashOut`, sends `cashed_out` with full stats
3. Client shows `SessionResultsModal` with the summary

---

## Action Timer System

Each table has a configurable per-turn countdown (`VariantConfig.actionTimerSec`). Valid values: 0 (disabled) or any multiple of 15 up to 180 — exported as `TIMER_STEPS_SEC`. When the timer expires the server auto-acts: **check** if legal, otherwise **fold** (for 12-Card-Flip: **flip_card**).

### Server (`ws/handler.ts` + `services/game-manager.ts`)

Two module-level Maps in `handler.ts`:
```
actionTimers:           Map<string, setTimeout>  // lobbyId → active countdown
actionTimerGenerations: Map<string, number>      // lobbyId → monotonic counter (race guard)
```
`actionDeadlines: Map<string, string>` lives in `game-manager.ts` (co-located with `toPublicState`).

**`cancelActionTimer(lobbyId)`** — clears the timeout AND increments the generation counter so any already-queued callback bails immediately. Always called synchronously before awaiting `processGameAction` in `game_action`.

**`scheduleActionTimer(lobbyId, config, state)`** — calls `cancelActionTimer`, then (if timer enabled and seat is live) sets the deadline and schedules the callback with a generation snapshot.

**`onActionTimerExpired`** — re-fetches state (guard: bail if `actionSeatIndex` has changed), calls `processGameAction` with auto-action, reschedules for next player, broadcasts.

Timer is also rescheduled/cancelled by: `host_start`, `host_pause`/resume, `host_set_action_timer`, and `onGracePeriodExpired`.

### Client (`hooks/useActionTimer.ts` + `components/PokerTable.tsx`)

`useActionTimer(deadline?: string): number | null` — polls every 100ms, returns remaining integer seconds (0 when expired, null when no deadline). Deadline comes from `PublicTableState.actionDeadline` (ISO string). On reconnect the fresh `table_state` push from the server carries the correct deadline, eliminating drift.

Display: acting seat shows a countdown badge and a progress bar (`--timer-pct` CSS custom property). Both turn red (`urgent` class) at ≤ 10 seconds.

---

## Session / Reconnection System

Every authenticated WebSocket gets a `sessionId` (UUID) stored in `localStorage('vct_session_id')`. On reconnect the client sends `{ type: 'reconnect', sessionId }`. The server restores seat, lobby, and turn state from `player_sessions`.

### Server-side (`services/session.ts`)

- `createSession(userId, lobbyId)` → `sessionId`
- `getSession(sessionId)` → `PlayerSession | null`; auto-deletes expired rows
- `markSessionDisconnected` / `markSessionConnected` / `deleteSession`

Grace period: `GRACE_PERIOD_MS` (env `DISCONNECT_GRACE_PERIOD_MS`, default 180 000 ms).
Session TTL: 24 hours.

### Handler-level state (`ws/handler.ts`)

```
connectedUserSockets: Map<string, WebSocket>  // userId → live socket (one per user)
disconnectTimers:     Map<string, setTimeout>  // sessionId → grace timer
```

**On disconnect:** `markSessionDisconnected` → `setTimeout(onGracePeriodExpired, GRACE_PERIOD_MS)`

**On `reconnect`:**

1. Look up session; send `session_invalid` if missing/expired
2. Evict any existing socket for that userId
3. **Synchronously** `clearTimeout` + `disconnectTimers.delete` (before any `await`)
4. Restore `ClientState`, `await markSessionConnected`, re-add to `lobbyClients`
5. Send `session_ready`, replay chat, `broadcastTableState`

**On grace period expiry:** Re-fetch session — abort if `disconnectedAt` is null. Otherwise: `deleteSession` → `setSittingOut(true)` → if player's turn: `processGameAction('fold')` → broadcast.

### Client-side (`hooks/useGameSocket.ts`)

- Sends `reconnect` if `vct_session_id` is in localStorage, otherwise `auth`
- `session_ready` → resets backoff, flushes pending queue
- `session_invalid` → removes sessionId, falls back to `auth`
- `authenticated` → saves sessionId, sends `join_lobby`
- Heartbeat: ping every 25 s; force-close if no pong within 55 s
- Exponential backoff: `min(1000 × 2^attempt, 30 000)` ms, max 12 attempts

---

## Betting / Game Flow

1. Host clicks **Start** → `host_start` → `startHand()` in `game-manager.ts`
2. `startHand` deals via `poker-engine`, clears action badges, persists state to Redis
3. Each player action → `game_action` → `processGameAction()` → engine validates + advances
4. After each action `broadcastTableState` pushes `table_state` to all lobby sockets
5. When `street === 'complete'` the engine resolves pots; server broadcasts `hand_complete` then `hand_history`
6. After the intermission timer (`intermissionDeadline`) fires, the next hand auto-starts

### Pot / side-pot logic

Lives entirely in `packages/poker-engine/src/pots.ts`. Side pots are calculated at showdown, not incrementally.

### Raise defaults (ActionBar)

Default raise = 1/3 pot. Re-raise = 3× previous raise. Quick buttons: Min (minimum legal raise), 1/2 Pot, Full Pot, Max (all-in).

---

## Table Animations (`hooks/useTableAnimations.ts`)

`useTableAnimations(table, handComplete)` returns `TableAnimState`:

| field | meaning |
|---|---|
| `dealingHandNum` | Hand number being dealt (drives staggered hole-card deal CSS) |
| `boardDealFromIndex` | Board cards from this index are animating in (flop/turn/river) |
| `recentBetSeat` | Seat that just bet (triggers chip-pulse on bet badge) |
| `winningSeats` | Set of seat indices glowing after hand ends |
| `winnerBanner` | `WinnerBannerData` displayed by `WinnerBanner`; null when hidden |

Winner banner auto-dismisses after 4.5 s. Chip-flight animations (chips travelling from pot to winner) are driven in `PokerTable.tsx` using `ref` callbacks and CSS custom properties.

---

## Where To Change Things

| Task | File(s) |
|---|---|
| Add/change a poker rule | `packages/poker-engine/src/game-table.ts`, variant file |
| New WebSocket message type | `packages/shared-types/src/ws.ts` → rebuild → `handler.ts` + `useGameSocket.ts` |
| Session / reconnect behaviour | `apps/game-server/src/services/session.ts`, `ws/handler.ts` |
| Disconnect grace period | `DISCONNECT_GRACE_PERIOD_MS` env var; `GRACE_PERIOD_MS` in `session.ts` |
| Client reconnect logic | `apps/web/src/hooks/useGameSocket.ts` |
| Action timer durations / steps | `TIMER_STEPS_SEC` in `packages/shared-types/src/variant.ts` |
| Action timer server logic | `scheduleActionTimer` / `cancelActionTimer` in `ws/handler.ts` |
| Action timer auto-action logic | `getAutoAction` in `services/game-manager.ts` |
| Action timer client display | `hooks/useActionTimer.ts`, `components/PokerTable.tsx` |
| Action badges (last-action indicators) | `seatLastActions` in `services/game-manager.ts`; badge CSS in `styles.css` |
| Lobby seat / chip changes | `apps/game-server/src/services/lobby.ts` |
| DB schema change | `apps/game-server/src/db/schema.ts` + `migrate.ts` |
| In-memory fallback | `apps/game-server/src/store/memory-fallback.ts` |
| Redis game state storage | `apps/game-server/src/store/redis.ts` |
| Betting UI (raise slider etc.) | `apps/web/src/components/ActionBar.tsx` |
| Table layout / cards / seat UI | `apps/web/src/components/PokerTable.tsx` |
| Avatar appearance | `packages/shared-types/src/avatar.ts`, `components/AvatarSvg.tsx` |
| Avatar customisation UI | `apps/web/src/components/AvatarCreator.tsx` |
| Session stats accumulation | `apps/game-server/src/services/session-stats.ts` |
| Cash-out / rebuy flow | `ws/handler.ts` (`cash_out`, `rebuy` handlers) + `CashOutModal`, `RebuyModal` |
| Show-cards-after-fold flow | `ws/handler.ts` (`show_cards` handler) + `ShowCardsModal.tsx` |
| Table presets | `packages/shared-types/src/presets.ts` |
| 12-Card-Flip logic | `packages/poker-engine/src/twelve-card-flip.ts`, `components/TwelveCardFlip.tsx` |
| Table animations | `apps/web/src/hooks/useTableAnimations.ts` |

---

## Useful Commands

```bash
# Install all workspace deps
npm install

# Build shared types (required after editing ws.ts / game.ts / lobby.ts / variant.ts)
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

No Docker required for local dev — the server auto-falls back to in-memory storage when Postgres and Redis are unreachable. Set `DATABASE_URL` and `REDIS_URL` in `apps/game-server/.env` for persistent mode.

Environment variables:

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection string |
| `REDIS_URL` | — | Redis connection string (game state persistence) |
| `JWT_SECRET` | — | Signing secret for auth tokens |
| `DISCONNECT_GRACE_PERIOD_MS` | `180000` | How long to hold a disconnected player's seat (ms) |
| `PORT` | `3001` | Game-server HTTP/WS port |

---

## Gameplay Notes

- Players are seated automatically when they join a lobby (`autoSeatPlayer`)
- Buy-in is set by the host; cannot be changed mid-hand
- A disconnected player keeps their seat for the grace period; auto-folded only after it expires on their turn
- `sittingOut: true` means the player missed their seat; they must re-sit to play
- Hand history is stored per lobby and replayed to newly joined sockets
- The 7-deuce rule (optional): winners showing 7-2 offsuit collect a bonus from all other players
- Bomb pots fire every N hands (configurable); all players post a forced ante and play goes directly to the flop

---

## Working Rules

- Prefer fixing game rules in the engine first, then adjust UI to match.
- Add or update tests when changing betting logic.
- Keep the client responsive on desktop and mobile.
- Do not add real-money language or flow.
