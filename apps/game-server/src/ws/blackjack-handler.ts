/**
 * Blackjack-specific WebSocket message handling.
 * Imported by handler.ts and called for bj_* messages and blackjack lobby lifecycle.
 */
import type { WebSocket } from 'ws';
import type { AvatarConfig, ClientMessage, LobbySummary, ServerMessage, VariantConfig } from '@vct/shared-types';
import { getLegalActions as getBjLegalActionsEngine } from '@vct/blackjack-engine';
import {
  applyBjAction,
  autoStandBjPlayer,
  clearBjBet,
  clearBjRoundNumber,
  clearBjState,
  getBjLegalActions,
  getBjState,
  getNextBjRoundNumber,
  persistBjState,
  placeBjBet,
  settleBjRound,
  startBjRound,
  toPublicBjState,
  closeBjBetting,
  stepBjDealer,
} from '../services/blackjack-manager.js';
import { getLobbyById } from '../services/lobby.js';

// ── Timer maps ────────────────────────────────────────────────────────────────

/** lobbyId → betting-phase countdown (fires to close betting and deal) */
const bjBetTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** lobbyId → action-turn countdown (fires to auto-stand the acting player) */
const bjActionTimers = new Map<string, ReturnType<typeof setTimeout>>();
const bjActionTimerGenerations = new Map<string, number>();

/** lobbyId → between-round countdown (fires to start next round's betting phase) */
const bjIntermissionTimers = new Map<string, ReturnType<typeof setTimeout>>();

const BJ_BETTING_MS = 30_000;
const BJ_INTERMISSION_MS = 10_000;
const BJ_DEALER_STEP_MS = 1_000;

// ── Helpers shared with handler.ts ───────────────────────────────────────────

type SendFn = (ws: WebSocket, msg: ServerMessage) => void;
type BroadcastFn = (lobbyId: string, build: (userId: string | null, isSpec: boolean) => ServerMessage) => void;
type GetConnectedFn = (lobbyId: string) => Set<string>;

export interface BjHandlerDeps {
  send: SendFn;
  broadcastLobby: BroadcastFn;
  getConnectedSet: GetConnectedFn;
}

// ── Lobby metadata helpers ────────────────────────────────────────────────────

function displayNameMap(lobby: LobbySummary): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of lobby.seats) {
    if (s.userId && s.displayName) m.set(s.userId, s.displayName);
  }
  return m;
}

function avatarMap(lobby: LobbySummary): Map<string, AvatarConfig | undefined> {
  const m = new Map<string, AvatarConfig | undefined>();
  for (const s of lobby.seats) {
    if (s.userId) m.set(s.userId, s.avatar ?? undefined);
  }
  return m;
}

// ── Broadcast helpers ─────────────────────────────────────────────────────────

async function broadcastBjState(
  lobbyId: string,
  deps: BjHandlerDeps,
  intermissionDeadline?: string,
): Promise<void> {
  const [state, lobby] = await Promise.all([getBjState(lobbyId), getLobbyById(lobbyId)]);
  if (!state || !lobby) return;

  const names = displayNameMap(lobby);
  const avatars = avatarMap(lobby);
  const pub = toPublicBjState(state, names, avatars, intermissionDeadline);

  deps.broadcastLobby(lobbyId, (userId) => {
    const activePlayer = state.players[state.activePlayerIndex];
    const actions = (userId && state.phase === 'player_turn' && activePlayer?.userId === userId)
      ? getBjLegalActionsSync(state, userId)
      : [];
    return { type: 'bj_state', state: pub, legalActions: actions.length ? actions : undefined };
  });
}

function getBjLegalActionsSync(
  state: NonNullable<Awaited<ReturnType<typeof getBjState>>>,
  userId: string,
) {
  return getBjLegalActionsEngine(state, userId);
}

// ── Betting phase ─────────────────────────────────────────────────────────────

export async function startBjBettingPhase(
  lobbyId: string,
  config: VariantConfig,
  lobby: LobbySummary,
  deps: BjHandlerDeps,
  _isFirstStart: boolean,
): Promise<void> {
  // Only seated players with chips participate
  const activePlayers = lobby.seats
    .filter((s) => s.userId && s.stack > 0)
    .map((s) => ({ userId: s.userId!, seatIndex: s.seatIndex, stack: s.stack }));

  if (activePlayers.length === 0) return;

  const roundNumber = getNextBjRoundNumber(lobbyId);
  const state = await startBjRound(lobbyId, config, activePlayers, roundNumber);

  const deadline = Date.now() + BJ_BETTING_MS;
  await persistBjState(lobbyId, { ...state, betDeadline: deadline });

  console.log(`[bj] Round ${roundNumber} betting phase started for lobby ${lobbyId}`);

  await broadcastBjState(lobbyId, deps);

  // Start betting countdown
  cancelBjBetTimer(lobbyId);
  bjBetTimers.set(lobbyId, setTimeout(() => {
    onBjBetTimerExpired(lobbyId, config, deps).catch(() => {});
  }, BJ_BETTING_MS));
}

function cancelBjBetTimer(lobbyId: string): void {
  const t = bjBetTimers.get(lobbyId);
  if (t) { clearTimeout(t); bjBetTimers.delete(lobbyId); }
}

async function onBjBetTimerExpired(
  lobbyId: string,
  config: VariantConfig,
  deps: BjHandlerDeps,
): Promise<void> {
  bjBetTimers.delete(lobbyId);
  await dealAndStartPlayerTurn(lobbyId, config, deps);
}

async function dealAndStartPlayerTurn(
  lobbyId: string,
  config: VariantConfig,
  deps: BjHandlerDeps,
): Promise<void> {
  const result = await closeBjBetting(lobbyId);
  if ('error' in result) {
    console.warn(`[bj] closeBjBetting failed for ${lobbyId}: ${result.error}`);
    // No bets — schedule next round
    scheduleBjIntermission(lobbyId, config, deps);
    return;
  }

  await broadcastBjState(lobbyId, deps);

  if (result.phase === 'dealer_turn') {
    // Dealer had BJ — run dealer reveal + settle
    await runBjDealerSequence(lobbyId, config, deps);
    return;
  }

  // player_turn — schedule action timer if configured
  const timerSec = config.actionTimerSec ?? 0;
  if (timerSec > 0) {
    scheduleBjActionTimer(lobbyId, config, deps, timerSec * 1000);
  }
}

// ── Player turn timers ─────────────────────────────────────────────────────────

function scheduleBjActionTimer(
  lobbyId: string,
  config: VariantConfig,
  deps: BjHandlerDeps,
  ms: number,
): void {
  cancelBjActionTimer(lobbyId);
  const gen = (bjActionTimerGenerations.get(lobbyId) ?? 0) + 1;
  bjActionTimerGenerations.set(lobbyId, gen);

  bjActionTimers.set(lobbyId, setTimeout(async () => {
    if ((bjActionTimerGenerations.get(lobbyId) ?? 0) !== gen) return;
    bjActionTimers.delete(lobbyId);

    const state = await getBjState(lobbyId);
    if (!state || state.phase !== 'player_turn') return;
    const player = state.players[state.activePlayerIndex];
    if (!player) return;

    const result = await autoStandBjPlayer(lobbyId, player.userId);
    if (!result) return;

    await broadcastBjState(lobbyId, deps);

    if (result.phase === 'dealer_turn') {
      await runBjDealerSequence(lobbyId, config, deps);
    } else if (result.phase === 'player_turn' && config.actionTimerSec) {
      scheduleBjActionTimer(lobbyId, config, deps, config.actionTimerSec * 1000);
    }
  }, ms));
}

function cancelBjActionTimer(lobbyId: string): void {
  const t = bjActionTimers.get(lobbyId);
  if (t) { clearTimeout(t); bjActionTimers.delete(lobbyId); }
  bjActionTimerGenerations.set(lobbyId, (bjActionTimerGenerations.get(lobbyId) ?? 0) + 1);
}

// ── Dealer sequence ────────────────────────────────────────────────────────────

async function runBjDealerSequence(
  lobbyId: string,
  config: VariantConfig,
  deps: BjHandlerDeps,
): Promise<void> {
  let keepGoing = true;
  while (keepGoing) {
    const stepResult = await stepBjDealer(lobbyId, config);
    if ('error' in stepResult) break;
    keepGoing = stepResult.drew;

    if (stepResult.drew) {
      const state = stepResult.state;
      const lobby = await getLobbyById(lobbyId);
      if (lobby) {
        const pub = toPublicBjState(state, displayNameMap(lobby), avatarMap(lobby));
        deps.broadcastLobby(lobbyId, () => ({ type: 'bj_dealer_acted', state: pub }));
      }
      // Delay between dealer cards for animation
      await delay(BJ_DEALER_STEP_MS);
    }
  }

  // Settle round
  const lobby = await getLobbyById(lobbyId);
  if (!lobby) return;

  const settled = await settleBjRound(lobbyId, displayNameMap(lobby));
  if ('error' in settled) return;

  const intermissionDeadline = new Date(Date.now() + BJ_INTERMISSION_MS).toISOString();
  const pub = toPublicBjState(settled.state, displayNameMap(lobby), avatarMap(lobby), intermissionDeadline);

  deps.broadcastLobby(lobbyId, () => ({
    type: 'bj_round_settled',
    state: pub,
    results: settled.results,
  }));

  scheduleBjIntermission(lobbyId, config, deps);
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// ── Intermission ───────────────────────────────────────────────────────────────

function scheduleBjIntermission(
  lobbyId: string,
  config: VariantConfig,
  deps: BjHandlerDeps,
): void {
  const t = bjIntermissionTimers.get(lobbyId);
  if (t) clearTimeout(t);

  bjIntermissionTimers.set(lobbyId, setTimeout(async () => {
    bjIntermissionTimers.delete(lobbyId);
    await onBjIntermissionExpired(lobbyId, config, deps);
  }, BJ_INTERMISSION_MS));
}

async function onBjIntermissionExpired(
  lobbyId: string,
  config: VariantConfig,
  deps: BjHandlerDeps,
): Promise<void> {
  const lobby = await getLobbyById(lobbyId);
  if (!lobby || lobby.status !== 'playing') return;

  await startBjBettingPhase(lobbyId, config, lobby, deps, false);
}

// ── Reconnect / join ──────────────────────────────────────────────────────────

/**
 * Send the current blackjack state to a single client (reconnect or join).
 */
export async function sendBjStateToClient(
  ws: WebSocket,
  lobbyId: string,
  userId: string,
  deps: BjHandlerDeps,
): Promise<void> {
  const [state, lobby] = await Promise.all([getBjState(lobbyId), getLobbyById(lobbyId)]);
  if (!state || !lobby) return;

  const names = displayNameMap(lobby);
  const avatars = avatarMap(lobby);
  const pub = toPublicBjState(state, names, avatars);

  const legalActions = state.phase === 'player_turn'
    ? await getBjLegalActions(lobbyId, userId)
    : [];

  deps.send(ws, {
    type: 'bj_state',
    state: pub,
    legalActions: legalActions.length ? legalActions : undefined,
  });
}

// ── Message handler ────────────────────────────────────────────────────────────

/**
 * Handle a blackjack-specific client message.
 * Returns true if the message was handled (so handler.ts can skip the default error).
 */
export async function handleBjMessage(
  ws: WebSocket,
  msg: ClientMessage,
  userId: string,
  lobbyId: string,
  config: VariantConfig,
  deps: BjHandlerDeps,
): Promise<boolean> {
  switch (msg.type) {
    case 'bj_place_bet': {
      const result = await placeBjBet(lobbyId, userId, msg.amount, config);
      if ('error' in result) {
        deps.send(ws, { type: 'error', message: result.error });
        return true;
      }
      // Broadcast updated bet totals
      const lobby = await getLobbyById(lobbyId);
      if (lobby) {
        const pub = toPublicBjState(result, displayNameMap(lobby), avatarMap(lobby));
        const seatIndex = result.players.find((p) => p.userId === userId)?.seatIndex ?? -1;
        deps.broadcastLobby(lobbyId, () => ({
          type: 'bj_bet_placed',
          seatIndex,
          amount: msg.amount,
        }));
        deps.broadcastLobby(lobbyId, () => ({ type: 'bj_state', state: pub }));
      }
      return true;
    }

    case 'bj_clear_bet': {
      const result = await clearBjBet(lobbyId, userId);
      if ('error' in result) {
        deps.send(ws, { type: 'error', message: result.error });
        return true;
      }
      await broadcastBjState(lobbyId, deps);
      return true;
    }

    case 'bj_hit':
    case 'bj_stand':
    case 'bj_double_down':
    case 'bj_split': {
      const actionMap = {
        bj_hit: 'hit',
        bj_stand: 'stand',
        bj_double_down: 'double_down',
        bj_split: 'split',
      } as const;
      const action = actionMap[msg.type];
      const newHandId = action === 'split' ? crypto.randomUUID() : undefined;

      cancelBjActionTimer(lobbyId);

      const result = await applyBjAction(lobbyId, userId, action, msg.handId, newHandId);
      if ('error' in result) {
        deps.send(ws, { type: 'error', message: result.error });
        return true;
      }

      const lobby = await getLobbyById(lobbyId);
      if (!lobby) return true;

      const names = displayNameMap(lobby);
      const avatars = avatarMap(lobby);
      const pub = toPublicBjState(result, names, avatars);

      const seatIndex = result.players.find((p) => p.userId === userId)?.seatIndex ?? -1;

      if (result.phase === 'dealer_turn') {
        deps.broadcastLobby(lobbyId, () => ({ type: 'bj_player_acted', seatIndex, action: msg.type, state: pub }));
        await runBjDealerSequence(lobbyId, config, deps);
        return true;
      }

      // Still in player_turn — send legalActions to the now-active player
      deps.broadcastLobby(lobbyId, (uid) => {
        const nextPlayer = result.players[result.activePlayerIndex];
        const legalActions = (uid && nextPlayer && uid === nextPlayer.userId)
          ? getBjLegalActionsSync(result, uid)
          : [];
        return {
          type: 'bj_player_acted',
          seatIndex,
          action: msg.type,
          state: pub,
          legalActions: legalActions.length ? legalActions : undefined,
        };
      });

      // Schedule action timer for next player
      if (config.actionTimerSec && config.actionTimerSec > 0) {
        scheduleBjActionTimer(lobbyId, config, deps, config.actionTimerSec * 1000);
      }

      return true;
    }

    default:
      return false;
  }
}

// ── Cleanup ────────────────────────────────────────────────────────────────────

export function cancelAllBjTimers(lobbyId: string): void {
  cancelBjBetTimer(lobbyId);
  cancelBjActionTimer(lobbyId);
  const t = bjIntermissionTimers.get(lobbyId);
  if (t) { clearTimeout(t); bjIntermissionTimers.delete(lobbyId); }
}

export async function teardownBjLobby(lobbyId: string): Promise<void> {
  cancelAllBjTimers(lobbyId);
  await clearBjState(lobbyId);
  clearBjRoundNumber(lobbyId);
}
