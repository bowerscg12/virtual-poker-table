# Virtual Card Table — Claude Context

## What This Is

Multiplayer browser card game app. Guest-first identity (display name at join/create; optional account registration). Variants: Texas Hold'em, Omaha, PLO8, 12-Card-Flip, Blackjack. Real-time WebSocket sync, no real money.

---

## Key Files

| Layer | Path | Purpose |
| --- | --- | --- |
| Server entry | `apps/game-server/src/ws/handler.ts` | Poker WS message routing |
| Blackjack handler | `apps/game-server/src/ws/blackjack-handler.ts` | Blackjack WS routing, betting/action/intermission timers |
| Game state | `apps/game-server/src/services/game-manager.ts` | `GameTableState` lifecycle, `toPublicState` |
| Blackjack state | `apps/game-server/src/services/blackjack-manager.ts` | Blackjack round lifecycle, state persistence |
| Lobby/seats | `apps/game-server/src/services/lobby.ts` | CRUD, `autoSeatPlayer`, `isMemoryMode()` |
| Session | `apps/game-server/src/services/session.ts` | Reconnect session CRUD |
| Chat | `apps/game-server/src/services/chat.ts` | In-memory chat (max 100 msgs/lobby), system announcements |
| Cleanup | `apps/game-server/src/services/guest-cleanup.ts` | Purges guest accounts >48h old |
| Cleanup | `apps/game-server/src/services/lobby-cleanup.ts` | Purges abandoned lobbies >20 min |
| Poker engine | `packages/poker-engine/src/game-table.ts` | `createInitialTable`, `applyAction` |
| Bot engine | `packages/poker-engine/src/bot.ts` | Pure AI decision logic: `decidePokerAction`, `holdsCurrentNuts`, `estimateEquity` |
| Bot identity | `apps/game-server/src/services/bots.ts` | Bot users, seating (`addBot`), brain lookup, `isBotUser`, cleanup |
| Blackjack engine | `packages/blackjack-engine/src/game.ts` | Round lifecycle, `game.ts`, `hand.ts`, `shoe.ts`, `dealer.ts`, `settlement.ts` |
| Shared types | `packages/shared-types/src/` | `ws.ts`, `game.ts`, `lobby.ts`, `variant.ts`, `blackjack.ts`, `avatar.ts` |
| Table UI | `apps/web/src/components/PokerTable.tsx` | Felt, seats, cards, badges |
| Blackjack UI | `apps/web/src/components/BlackjackTable.tsx` | Blackjack table display |
| Blackjack bets | `apps/web/src/components/BlackjackActionBar.tsx` | Chip denominations, bet/action UI |
| WS client | `apps/web/src/hooks/useGameSocket.ts` | WS lifecycle, reconnect, state sync |
| Blackjack state | `apps/web/src/hooks/useBlackjackState.ts` | Blackjack-specific state management |
| REST | `apps/game-server/src/routes/api.ts` | Auth, lobbies, hand-history |

---

## Architecture

- **Server**: Fastify + raw `ws`. Drizzle ORM on Postgres (in-memory fallback). Redis stores `GameTableState` at `table:{lobbyId}:state` (in-memory fallback).
- **Client**: React + Vite PWA. `useGameSocket` owns WS lifecycle. `AuthContext` holds JWT + guest user.
- **Shared types**: Must rebuild (`npm run build -w @vct/shared-types`) after any edit.
- **Blackjack**: Separate `packages/blackjack-engine/` package; separate `blackjack-handler.ts` and `blackjack-manager.ts` on the server — does not go through the poker engine.
- **Cleanup services**: `guest-cleanup.ts` and `lobby-cleanup.ts` started at server boot from `apps/game-server/src/index.ts`.

---

## Authentication

- **Guest flow (primary)**: `POST /lobbies` or `POST /lobbies/join` — creates user + returns token in one call; no pre-auth needed.
- **Account registration**: `POST /api/auth/register { displayName, username, password }`
- **Account login**: `POST /api/auth/login { username, password }`
- **Guest creation**: `POST /api/auth/guest { displayName }`
- Display names filtered for profanity at registration (`apps/game-server/src/utils/profanity.ts` — leet-speak normalization + blocklist).

---

## Onboarding Flow

`/` → **HomePage** → **NameSelectionPage** (if no name) → **CreateLobbyPage** or **JoinLobbyPage**

- Create: `POST /lobbies { displayName, settings }` → `{ user, token, sessionId, lobby }`
- Join: `POST /lobbies/join { displayName, inviteCode }` → same shape

---

## Database Schema

| Table | Key columns |
|---|---|
| `users` | id, display_name, is_guest, is_bot |
| `lobbies` | id, host_user_id, invite_code, status, settings (JSONB) |
| `table_seats` | lobby_id, seat_index, user_id, stack, sitting_out, is_bot, bot_difficulty, bot_style |
| `hand_histories` | lobby_id, hand_number, data (JSONB) |
| `player_sessions` | id, user_id, lobby_id, disconnected_at, expires_at |

---

## WebSocket Protocol

### Client → Server (Poker)

| type | payload |
|---|---|
| `auth` | `{ token }` |
| `reconnect` | `{ sessionId }` |
| `join_lobby` | `{ lobbyId }` |
| `game_action` | `{ actionId, action, amount? }` |
| `chat` | `{ text }` |
| `reaction` | `{ emoji }` (must be in `REACTION_EMOJIS`; server-enforced cooldown) |
| `sit` | `{ seatIndex?, buyIn? }` |
| `stand` / `spectate` | — |
| `sit_out_next_hand` | — |
| `set_blind_hand` | — (play next hand without seeing hole cards) |
| `rabbit_hunt` | — (reveal unseen burn cards after hand) |
| `host_start` / `host_pause` | `{ paused: boolean }` for pause |
| `host_kick` | `{ seatIndex }` |
| `host_add_bot` | `{ seatIndex, difficulty }` (host adds an AI opponent; cash games + flip only) |
| `host_approve_rebuy` | `{ seatIndex, amount }` |
| `host_adjust_blinds` | `{ small, big }` |
| `host_set_action_timer` | `{ seconds }` |
| `host_set_bomb_pot` | `{ amount, doubleBoard }` |
| `host_set_run_it_out` | `{ times }` (1/2/3) |
| `cash_out` / `cash_out_cancel` / `rebuy` | — |
| `show_cards` | `{ show: boolean }` |
| `donate_chips` | `{ donationId, toDonateStack }` |
| `run_it_out_choice` | `{ times }` |
| `bomb_pot_join` | — |
| `ping` | — |

### Client → Server (Blackjack)

| type | payload |
|---|---|
| `bj_place_bet` | `{ amount }` |
| `bj_action` | `{ action }` (hit/stand/double/split) |

### Server → Client (Poker)

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
| `run_it_out_prompt` | `{ chooserSeatIndex, deadline, maxRuns }` |
| `bomb_pot_prompt` | `{ amount, doubleBoard, deadline }` |
| `bomb_pot_cancelled` | — |
| `chat` | `{ text, displayName, isHost, isSystem }` |
| `reaction` | `{ reaction: TableReaction }` (transient — never stored or replayed) |
| `error` | `{ message, code? }` |
| `pong` | — |

### Server → Client (Blackjack)

| type | payload |
|---|---|
| `bj_state` | `PublicBlackjackState` |
| `bj_round_started` | `{ handId }` |
| `bj_bet_placed` | `{ seatIndex, amount }` |
| `bj_player_acted` | `{ seatIndex, action, handIndex }` |
| `bj_dealer_acted` | `{ action }` |
| `bj_round_settled` | `{ results[] }` |

---

## Game Variants (`packages/shared-types/src/variant.ts`)

Supported: `holdem`, `omaha`, `plo8`, `twelve_card_flip`, `blackjack`. **`stud` is declared in the enum but has no engine implementation — do not use.**

Notable `VariantConfig` fields: `nextHandBombPot`, `runItOut` (1/2/3 runs), `straddle`, `sevenDeuceRule`, `extraFlopCards`, `twelveCardFlipAnte`. Presets in `presets.ts` (4 presets: NLHE, PLO, 12-Card-Flip, Blackjack).

> **PLO8 note**: `plo8` is declared but hi-lo evaluation is not implemented — it runs as standard Omaha.

**Bomb Pot (holdem/omaha)**: Host sets `settings.nextHandBombPot = { amount, doubleBoard }` via `host_set_bomb_pot`. At the next hand boundary the server runs a 10s opt-in (`bomb_pot_prompt` → `bomb_pot_join`); ≥2 joining builds the hand with `createBombPotTable` (forced ante, no betting, full board(s) pre-dealt + showdown resolved), then `startBombPotRunout` reveals the board(s) (5s view delay → flop + all cards face-up → turn → river → showdown). Double board splits each side pot 50/50 via `runDoubleBoardShowdown` (`winnerPayouts[].board` tags 'A'/'B'). One-shot: cleared at `resolveBombPotOptIn`; <2 join → `bomb_pot_cancelled` + normal hand. Hand-level `GameTableState` fields: `isBombPot`, `bombPotAmount`, `isDoubleBoardBombPot`, `secondBoard`, `secondShowdownHands`.

**Run It Out**: When all players are all-in, the `runItOut` config (1–3) allows the board to be run multiple times. Triggered via `run_it_out_prompt`; the designated chooser replies with `run_it_out_choice`. `applyMultipleRunouts()` in `game-manager.ts` handles the multi-run logic. UI: `RunItOutPrompt.tsx` (countdown modal, auto-selects "run once" if no choice).

**Blackjack**: Casino rules — 1/4/6/8 decks, configurable min/max bets, hit/stand on soft 17. Players hit/stand/double/split. `BlackjackPhase`: `betting → dealing → player_turns → dealer_turn → settled → intermission`. Dealer AI in `packages/blackjack-engine/src/dealer.ts`. Payout in `settlement.ts`. Config: `blackjackNumDecks`, `blackjackMinBet`, `blackjackMaxBet`, `blackjackDealerSoftSeventeen`.

---

## Key Systems

**Action Badges**: `seatLastActions: Map<lobbyId, Map<seatIndex, {action,amount?}>>` in `game-manager.ts`. Cleared on street advance, new hand, table clear. `toPublicState` populates `SeatGameState.lastAction`.

**Player Badges**: `session-stats.ts` tracks per-player stats (VPIP, biggest pot, best hand, action counts). Badge types in `shared-types/src/game.ts`: `big_stack`, `short_stack`, `hot_streak`, `calling_station`, `charlie`, `whale`, `maniac`, `loose_cannon`, `most_blind_wins`. Displayed in `PokerTable.tsx`.

**Position Markers**: `SeatGameState.isDealer/isSmallBlind/isBigBlind` populated in `toPublicState`. Heads-up: dealer = SB. Rendered as disk badges in `PokerTable.tsx`.

**Action Timer**: `actionTimerSec` in `VariantConfig`. Steps: 0 or multiples of 15 up to 180 (`TIMER_STEPS_SEC`). Auto-acts check→fold on expiry. `scheduleActionTimer`/`cancelActionTimer` in `handler.ts`. Generation counter prevents races.

**Session/Reconnect**: `sessionId` in `localStorage('vct_session_id')`. Grace period `GRACE_PERIOD_MS` (default 180s). On reconnect: cancel grace timer synchronously, restore state, send `session_ready`. On expiry: `setSittingOut(true)`, auto-fold if acting.

**Session Stats**: `session-stats.ts` accumulates per-player stats. `computeCashOut` → `CashOutSummary` sent via `cashed_out` at hand end.

**Chat**: `chat.ts` stores up to 100 messages per lobby in memory. System messages used for host migration announcements. Not profanity-filtered (hosts moderate). `ChatPanel.tsx` on client.

**Avatars**: `AvatarConfig` in localStorage → REST body → DB → `TableSeat.avatar`. `coerceAvatar()` repairs stale configs. `AvatarSvg` renders inline SVG. Config options: gender, 9 skin tones, 10 hair styles, 5 hair colors, 5 eye colors.

**Animations**: `useTableAnimations` returns `{ dealingHandNum, boardDealFromIndex, recentBetSeat, winningSeats, winnerBanner }`. Chip flights driven in `PokerTable.tsx` via ref callbacks + CSS custom properties.

**AI Opponents (Bots)**: Host-only feature for **cash games (holdem/omaha/plo8) and twelve_card_flip only** — not tournaments or blackjack. A bot is a normal seat occupant: a synthetic `users` row flagged `is_bot`, plus a persisted brain on the seat (`is_bot`/`bot_difficulty`/`bot_style` columns on `table_seats`) so behavior survives restarts. Bots have **no WebSocket connection** — the server drives their turns.

- **Difficulty** (`beginner`/`intermediate`/`pro`) = execution quality (Monte-Carlo equity accuracy, pot-odds discipline, mistake rate). **Style** (`tag`/`lag`/`nit`/`station`/`maniac`, randomly assigned) = personality. Types in `shared-types/src/bot.ts`.
- **Decision logic** is pure in `poker-engine/src/bot.ts` (`decidePokerAction`) — unit-tested in `bot.test.ts`. Hard rule: `holdsCurrentNuts` makes a bot **never fold the best possible hand for the visible board**, at any difficulty.
- **Turn driver** (`handler.ts`): `driveTurn` routes the next actor to `scheduleBotTurn` (AI, randomized "thinking" delay) or `scheduleActionTimer` (human). `scheduleBotTurn` shares the action-timer slot + generation counter, so the two are mutually exclusive. All action paths (human `game_action`, timer auto-act, bot turn) funnel through `afterActionApplied`, which chains consecutive bots. `scheduleActionTimer` early-returns for bot seats (`isBotUser`).
- **Add flow**: client `host_add_bot` → `addBot()` in `bots.ts` creates the user, picks a random style + name + avatar, seats via `sitAtSeat`, persists the brain via `setSeatBotFields`. Cash games show a difficulty modal (`AddBotPrompt.tsx`); flip adds directly (no betting decisions there).
- **Lifecycle**: busted bots auto-rebuy to the buy-in **immediately** (`processBotRebuys` clears the re-entry-blind flag so they're dealt into the very next hand, not held "Waiting for BB"); occasional emoji reactions (`maybeBotReactions`); bot `users` rows are deleted on kick and on lobby teardown (`deleteBotUsersForLobby`). Bots show `isConnected: true` in `toSummary` so they don't render as disconnected.
- **Stats/badges**: bots never connect, so they're never `initSession`'d by the WS handshake. `registerLobbyBots` (called at every hand start/resume) and the `host_add_bot` handler call `initSession` for each bot so they accrue session stats and earn the same superlative badges as humans. Without this, `getSessionBadgeData` has <2 entries and `computeBadges` skips all session badges entirely (only stack-derived `big_stack`/`short_stack` would ever show).
- **Pacing**: `botThinkDelayMs` is a fixed 3 s per action. `decidePokerAction` never folds when a check is legal (and never folds the current nuts).

**Cleanup Services** (started at boot):

- `guest-cleanup.ts`: deletes guest accounts older than `GUEST_EXPIRY_HOURS` (default 48h) with no active sessions.
- `lobby-cleanup.ts`: deletes abandoned lobbies where all players have been disconnected >10 min and the lobby is >20 min old.

---

## Where To Change Things

| Task | File(s) |
|---|---|
| Poker rule | `packages/poker-engine/src/game-table.ts`, variant file |
| Blackjack rule | `packages/blackjack-engine/src/`, `blackjack-manager.ts`, `blackjack-handler.ts` |
| New WS message | `shared-types/ws.ts` → rebuild → `handler.ts` + `useGameSocket.ts` |
| Session/reconnect | `services/session.ts`, `ws/handler.ts` |
| Action timer | `scheduleActionTimer`/`cancelActionTimer` in `handler.ts`; `getAutoAction` in `game-manager.ts` |
| Action badges | `seatLastActions` in `game-manager.ts`; CSS in `styles.css` |
| Player badges | `session-stats.ts`, badge types in `shared-types/src/game.ts` |
| AI opponents (bots) | Decision logic `poker-engine/src/bot.ts`; identity/seating `services/bots.ts`; turn driver (`driveTurn`/`scheduleBotTurn`/`afterActionApplied`) + `host_add_bot` in `ws/handler.ts`; UI `AddBotPrompt.tsx` + `PokerTable.tsx`/`TwelveCardFlip.tsx` |
| Chat | `services/chat.ts`, `components/ChatPanel.tsx` |
| Run It Out | `game-manager.ts` (`applyMultipleRunouts`), `RunItOutPrompt.tsx` |
| DB schema | `db/schema.ts` + `migrate.ts` |
| Betting UI | `components/ActionBar.tsx` |
| Table UI | `components/PokerTable.tsx` |
| Avatar | `shared-types/avatar.ts`, `AvatarSvg.tsx`, `AvatarCreator.tsx` |
| 12-Card-Flip | `poker-engine/twelve-card-flip.ts`, `TwelveCardFlip.tsx` |
| Table presets | `shared-types/presets.ts` |
| Profanity filter | `apps/game-server/src/utils/profanity.ts` |

---

## Project Agents (`.claude/agents/`)

Specialized agents scoped to high-frequency task patterns. Claude Code surfaces them automatically when the task matches.

| Agent | File | Use when... |
|---|---|---|
| `ws-protocol` | `.claude/agents/ws-protocol.md` | Adding or modifying any WS message type |
| `game-engine` | `.claude/agents/game-engine.md` | Changing poker or blackjack rules/logic |
| `schema-migration` | `.claude/agents/schema-migration.md` | Adding columns, tables, or indexes |
| `test-writer` | `.claude/agents/test-writer.md` | Writing engine tests after logic changes |

---

## Commands

```bash
npm install
npm run build -w @vct/shared-types       # required after editing shared types
npm run build -w @vct/blackjack-engine   # required after editing blackjack engine
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
| `JWT_SECRET` | — | Auth token signing secret. **Required in production** — boot fails fast if unset or left at the dev default (`config.ts`). |
| `LOG_LEVEL` | `info` | Pino log level (`trace`/`debug`/`info`/`warn`/`error`/`fatal`). All server logs go through the shared `logger.ts` instance. |
| `DISCONNECT_GRACE_PERIOD_MS` | `180000` | Seat hold duration on disconnect (ms) |
| `PORT` | `3001` | HTTP/WS port |
| `WEB_ORIGIN` | — | CORS origin for the web client |
| `GUEST_EXPIRY_HOURS` | `48` | Hours before stale guest accounts are purged |
| `REACTION_COOLDOWN_MS` | `2500` | Min interval between emoji reactions per player (ms) |

No Docker needed — server falls back to in-memory when Postgres/Redis are unreachable.

---

## Operations / Observability

- **Probes** (`routes/api.ts`): `GET /api/health` = liveness (static `{ ok: true }`, never gated on stores). `GET /api/ready` = readiness — pings Postgres + Redis (`pingDb`/`redisPing`), returns `503` if Postgres is down so the orchestrator stops routing to a broken instance. Redis is reported but degrades gracefully (memory fallback), so it doesn't gate readiness. Memory-mode reports ready.
- **Structured logging** (`logger.ts`): one shared `pino` instance used by Fastify and every service — JSON logs queryable by field (`lobbyId`/`userId`/`err`). Level via `LOG_LEVEL`. The standalone `db/migrate.ts` CLI script intentionally keeps plain `console` output.
- **Graceful shutdown** (`index.ts`): `SIGTERM`/`SIGINT` drain — stop loops, close client sockets with WS `1012` (clients auto-reconnect into the Redis-recovered table), `app.close()`, then release DB/Redis pools (8s force-exit cap). `uncaughtException` drains + exits non-zero; `unhandledRejection` logs only (one stray rejection must not take down every table).

---

## Deployment

- **Local infra**: `infra/docker-compose.yml` — PostgreSQL 16 + Redis 7 for local dev.
- **Dockerfile**: Multi-stage build (builder + runner), exposes port 3001, targets Google Cloud Run.
- **CI/CD**: `.github/workflows/ci.yml` — on push to `main`:
  1. Runs tests against PostgreSQL 16 + Redis 7 containers.
  2. Builds and pushes Docker image to GCP Artifact Registry.
  3. Deploys game-server to Google Cloud Run (secrets via Secret Manager).
  4. Deploys web frontend to Firebase Hosting.
  5. Runs database migrations during deploy.

---

## Working Rules

- Fix game rules in the engine first, then adjust UI.
- Add/update tests when changing betting logic.
- Keep client responsive on desktop and mobile.
- No real-money language or flow.
