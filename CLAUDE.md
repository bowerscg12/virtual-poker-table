# Virtual Card Table — Claude Context

## What This Is

Multiplayer browser poker app. Guest-only identity (display name at join/create). Variants: Texas Hold'em, Omaha, 12-Card-Flip. Real-time WebSocket sync, no real money.

---

## Key Files

| Layer | Path | Purpose |
| --- | --- | --- |
| Server entry | `apps/game-server/src/ws/handler.ts` | All WS message routing |
| Game state | `apps/game-server/src/services/game-manager.ts` | `GameTableState` lifecycle, `toPublicState` |
| Lobby/seats | `apps/game-server/src/services/lobby.ts` | CRUD, `autoSeatPlayer`, `isMemoryMode()` |
| Session | `apps/game-server/src/services/session.ts` | Reconnect session CRUD |
| Engine | `packages/poker-engine/src/game-table.ts` | `createInitialTable`, `applyAction` |
| Shared types | `packages/shared-types/src/` | `ws.ts`, `game.ts`, `lobby.ts`, `variant.ts` |
| Table UI | `apps/web/src/components/PokerTable.tsx` | Felt, seats, cards, badges |
| WS client | `apps/web/src/hooks/useGameSocket.ts` | WS lifecycle, reconnect, state sync |
| REST | `apps/game-server/src/routes/api.ts` | Auth, lobbies, hand-history |

---

## Architecture

- **Server**: Fastify + raw `ws`. Drizzle ORM on Postgres (in-memory fallback). Redis stores `GameTableState` at `table:{lobbyId}:state` (in-memory fallback).
- **Client**: React + Vite PWA. `useGameSocket` owns WS lifecycle. `AuthContext` holds JWT + guest user.
- **Shared types**: Must rebuild (`npm run build -w @vct/shared-types`) after any edit.

---

## Onboarding Flow

`/` → **HomePage** → **NameSelectionPage** (if no name) → **CreateLobbyPage** or **JoinLobbyPage**

- Create: `POST /lobbies { displayName, settings }` → `{ user, token, sessionId, lobby }`
- Join: `POST /lobbies/join { displayName, inviteCode }` → same shape
- No JWT needed upfront — endpoint is unauthenticated, returns fresh token.

---

## Database Schema

| Table | Key columns |
|---|---|
| `users` | id, display_name, is_guest |
| `lobbies` | id, host_user_id, invite_code, status, settings (JSONB) |
| `table_seats` | lobby_id, seat_index, user_id, stack, sitting_out |
| `hand_histories` | lobby_id, hand_number, data (JSONB) |
| `player_sessions` | id, user_id, lobby_id, disconnected_at, expires_at |

---

## WebSocket Protocol

### Client → Server

| type | payload |
|---|---|
| `auth` | `{ token }` |
| `reconnect` | `{ sessionId }` |
| `join_lobby` | `{ lobbyId }` |
| `game_action` | `{ actionId, action, amount? }` |
| `chat` | `{ text }` |
| `sit` | `{ seatIndex?, buyIn? }` |
| `stand` / `spectate` | — |
| `host_start` / `host_pause` | `{ paused: boolean }` for pause |
| `host_kick` | `{ seatIndex }` |
| `host_approve_rebuy` | `{ seatIndex, amount }` |
| `host_adjust_blinds` | `{ small, big }` |
| `host_set_action_timer` | `{ seconds }` |
| `cash_out` / `cash_out_cancel` / `rebuy` | — |
| `show_cards` | `{ show: boolean }` |
| `ping` | — |

### Server → Client

| type | payload |
|---|---|
| `authenticated` | `{ userId, sessionId }` |
| `session_ready` / `session_invalid` | `{ userId, lobbyId }` / — |
| `lobby_state` | `LobbySummary` |
| `table_state` | `{ public: PublicTableState, private?: { holeCards, legalActions } }` |
| `hand_complete` | `{ winners[] }` |
| `hand_history` | `HandHistoryEntry` |
| `cashed_out` | `{ summary: CashOutSummary }` |
| `rebuy_available` / `rebuy_confirmed` | `{ amount }` / `{ newStack }` |
| `show_cards_prompt` / `show_cards_result` | `{ deadline }` / `{ seatIndex, cards? }` |
| `error` | `{ message, code? }` |
| `pong` | — |

---

## Game Variants (`packages/shared-types/src/variant.ts`)

`holdem`, `omaha`, `plo8`, `stud`, `twelve_card_flip`. Notable `VariantConfig` fields: `nextHandBombPot`, `runItTwice`, `straddle`, `sevenDeuceRule`, `extraFlopCards`, `twelveCardFlipAnte`. Presets in `presets.ts`.

**Bomb Pot (per-hand modifier, holdem/omaha)**: Host sets `settings.nextHandBombPot = { amount, doubleBoard }` via `host_set_bomb_pot`. At the next hand boundary the server runs a 10s opt-in (`bomb_pot_prompt` → `bomb_pot_join`); ≥2 joining builds the hand with `createBombPotTable` (forced ante, no betting, full board(s) pre-dealt + showdown resolved), then `startBombPotRunout` reveals the board(s) (5s view delay → flop + all cards face-up → turn → river → showdown). Double board splits each side pot 50/50 via `runDoubleBoardShowdown` (`winnerPayouts[].board` tags 'A'/'B'). One-shot: cleared at `resolveBombPotOptIn`; <2 join → `bomb_pot_cancelled` + normal hand. Hand-level `GameTableState` fields: `isBombPot`, `bombPotAmount`, `isDoubleBoardBombPot`, `secondBoard`, `secondShowdownHands`.

---

## Key Systems

**Action Badges**: `seatLastActions: Map<lobbyId, Map<seatIndex, {action,amount?}>>` in `game-manager.ts`. Cleared on street advance, new hand, table clear. `toPublicState` populates `SeatGameState.lastAction`.

**Position Markers**: `SeatGameState.isDealer/isSmallBlind/isBigBlind` populated in `toPublicState`. Heads-up: dealer = SB. Rendered as disk badges in `PokerTable.tsx`.

**Action Timer**: `actionTimerSec` in `VariantConfig`. Steps: 0 or multiples of 15 up to 180 (`TIMER_STEPS_SEC`). Auto-acts check→fold on expiry. `scheduleActionTimer`/`cancelActionTimer` in `handler.ts`. Generation counter prevents races.

**Session/Reconnect**: `sessionId` in `localStorage('vct_session_id')`. Grace period `GRACE_PERIOD_MS` (default 180s). On reconnect: cancel grace timer synchronously, restore state, send `session_ready`. On expiry: `setSittingOut(true)`, auto-fold if acting.

**Session Stats**: `session-stats.ts` accumulates per-player stats. `computeCashOut` → `CashOutSummary` sent via `cashed_out` at hand end.

**Avatars**: `AvatarConfig` in localStorage → REST body → DB → `TableSeat.avatar`. `coerceAvatar()` repairs stale configs. `AvatarSvg` renders inline SVG.

**Animations**: `useTableAnimations` returns `{ dealingHandNum, boardDealFromIndex, recentBetSeat, winningSeats, winnerBanner }`. Chip flights driven in `PokerTable.tsx` via ref callbacks + CSS custom properties.

---

## Where To Change Things

| Task | File(s) |
|---|---|
| Poker rule | `packages/poker-engine/src/game-table.ts`, variant file |
| New WS message | `shared-types/ws.ts` → rebuild → `handler.ts` + `useGameSocket.ts` |
| Session/reconnect | `services/session.ts`, `ws/handler.ts` |
| Action timer | `scheduleActionTimer`/`cancelActionTimer` in `handler.ts`; `getAutoAction` in `game-manager.ts` |
| Action badges | `seatLastActions` in `game-manager.ts`; CSS in `styles.css` |
| DB schema | `db/schema.ts` + `migrate.ts` |
| Betting UI | `components/ActionBar.tsx` |
| Table UI | `components/PokerTable.tsx` |
| Avatar | `shared-types/avatar.ts`, `AvatarSvg.tsx`, `AvatarCreator.tsx` |
| 12-Card-Flip | `poker-engine/twelve-card-flip.ts`, `TwelveCardFlip.tsx` |
| Table presets | `shared-types/presets.ts` |

---

## Commands

```bash
npm install
npm run build -w @vct/shared-types   # required after editing shared types
npm run dev -w @vct/game-server
npm run dev -w @vct/web
npm test
npm run typecheck
npm run migrate -w @vct/game-server
```

---

## Environment Variables

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection string |
| `REDIS_URL` | — | Redis (game state persistence) |
| `JWT_SECRET` | — | Auth token signing secret |
| `DISCONNECT_GRACE_PERIOD_MS` | `180000` | Seat hold duration on disconnect (ms) |
| `PORT` | `3001` | HTTP/WS port |

No Docker needed — server falls back to in-memory when Postgres/Redis are unreachable.

---

## Working Rules

- Fix game rules in the engine first, then adjust UI.
- Add/update tests when changing betting logic.
- Keep client responsive on desktop and mobile.
- No real-money language or flow.
