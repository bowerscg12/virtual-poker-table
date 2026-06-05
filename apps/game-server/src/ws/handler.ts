import type { WebSocket } from 'ws';
import type { Card, ClientMessage, ServerMessage, VariantConfig } from '@vct/shared-types';
import { getTableBuyIn } from '@vct/shared-types';
import type { GameTableState } from '@vct/poker-engine';
import {
  cancelAllBjTimers,
  handleBjMessage,
  sendBjStateToClient,
  startBjBettingPhase,
  teardownBjLobby,
} from './blackjack-handler.js';
import { getUserById } from '../services/auth.js';
import {
  approveRebuy,
  autoSeatPlayer,
  claimHostIfVacant,
  consumeBlindHandFlags,
  donateChips,
  getActiveSeatForUser,
  getLobbyById,
  kickSeat,
  rebuyPlayer,
  removeSeat,
  setActionTimerSetting,
  setFlipAnte,
  setNextHandBombPot,
  clearNextHandBombPot,
  setNextHandBlind,
  setRunItOut,
  setSitOutNextHand,
  setTableBuyIn,
  setSittingOut,
  setWaitingForReentryBlind,
  sitAtSeat,
  swapSeats,
  syncEndOfHandStacks,
  transferHost,
  updateLobbyStatus,
} from '../services/lobby.js';
import {
  applyMultipleRunouts,
  cancelInterruptedHand,
  clearActionDeadline,
  clearBlindHandSeats,
  clearGame,
  clearIntermissionDeadline,
  getActiveGame,
  getActionDeadline,
  getAutoAction,
  getBlindHandSeats,
  removeBlindHandSeat,
  getHandHistories,
  getIntermissionDeadline,
  processGameAction,
  setActionDeadline,
  setBlindHandSeats,
  setIntermissionDeadline,
  setSeatShownCards,
  startBombPotHand,
  startHand,
  toPublicState,
  transferChipsBetweenSeats,
  updateLastHandHistoryFoldWin,
  updateSeatStackAfterRebuy,
} from '../services/game-manager.js';
import { addChatMessage, addSystemChatMessage, canSendChat, getChatHistory } from '../services/chat.js';
import { getMemoryLobby } from '../services/lobby.js';
import { deleteLobby } from '../services/lobby-cleanup.js';
import { redisDel, keys } from '../store/redis.js';
import {
  createSession,
  deleteSession,
  deleteSessionsByUserId,
  deleteSessionsByUserAndLobby,
  getSession,
  getSessionByUserAndLobby,
  markSessionConnected,
  markSessionDisconnected,
  updateSessionLobby,
  GRACE_PERIOD_MS,
  SEAT_RELEASE_MS,
} from '../services/session.js';
import {
  finalizeCashOut,
  initSession,
  recordAction,
  recordFoldWinChoice,
  recordHandEnd,
  recordHandStart,
  recordRebuy,
} from '../services/session-stats.js';

interface ClientState {
  userId: string | null;
  lobbyId: string | null;
  isSpectator: boolean;
  sessionId: string | null;
}

interface PendingCashOut {
  lobbyId: string;
  sessionId: string | null;
}

const clients = new Map<WebSocket, ClientState>();
const lobbyClients = new Map<string, Set<WebSocket>>();

/** userId → the single authoritative WebSocket for that user */
const connectedUserSockets = new Map<string, WebSocket>();

/** sessionId → auto-act timer (fires GRACE_PERIOD_MS after disconnect; auto-folds if player's turn) */
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** userId → seat release timer (fires SEAT_RELEASE_MS after disconnect; releases the seat entirely) */
const seatReleaseTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** lobbyId → active action-turn timer */
const actionTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Monotonically-incrementing generation counter per lobby.
 * Incremented every time the timer is cancelled, so in-flight callbacks
 * can detect they were superseded and bail without acting.
 */
const actionTimerGenerations = new Map<string, number>();

/** lobbyId → between-hand countdown timer (fires to auto-start next hand) */
const intermissionTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Monotonic generation counter for intermission timers.
 * Incremented whenever the timer is cancelled so stale callbacks bail immediately.
 */
const intermissionTimerGenerations = new Map<string, number>();

/** lobbyId → ms remaining on action timer at moment of pause */
const actionTimerPausedRemainingMs = new Map<string, number>();

/** lobbyId → ms remaining on intermission timer at moment of pause */
const intermissionPausedRemainingMs = new Map<string, number>();

/** userId → pending cash-out request (deferred until hand ends) */
const pendingCashOuts = new Map<string, PendingCashOut>();

/** ms the player has to confirm a queued cash-out at hand end before auto-confirming */
const CASH_OUT_CONFIRM_MS = 15_000;

/** userId → pending end-of-hand cash-out confirmation */
const pendingCashOutConfirms = new Map<string, {
  lobbyId: string;
  sessionId: string | null;
  amount: number;
  deadline: string;
  confirmTimer: ReturnType<typeof setTimeout>;
}>();

/** userId → pending rebuy request (deferred when hand is in progress) */
const pendingRebuys = new Map<string, { lobbyId: string; amount: number }>();

/** lobbyId → pending show-cards decision after a fold win */
const showCardsPending = new Map<string, {
  winnerId: string;
  winnerSeatIndex: number;
  holeCards: Card[];
  config: VariantConfig;
  gen: number;
  deadline: string;
}>();

/** lobbyId → active show-cards auto-muck timer */
const showCardsTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Monotonic generation counter for show-cards timers */
const showCardsGenerations = new Map<string, number>();

/** How long the winner has to decide before cards are auto-mucked */
const SHOW_CARDS_TIMEOUT_MS = 5_000;

/** lobbyId → rabbit-hunt cards available for anyone at the table to peek at */
const rabbitHuntPending = new Map<string, Card[]>();

/** lobbyId → timer that fires after 1 hour of no connected clients */
const emptyLobbyTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Set when onIntermissionExpired fires but startHand fails due to insufficient active players.
 * Cleared atomically at the start of tryStartWaitingHand to prevent concurrent triggers.
 */
const waitingForPlayers = new Map<string, boolean>();

const EMPTY_LOBBY_CLOSE_MS = 60 * 60 * 1000;
const ALL_PLAYERS_GONE_CLOSE_MS = 10 * 60 * 1000;

async function maybeScheduleAllPlayersGoneClose(lobbyId: string): Promise<void> {
  if (emptyLobbyTimers.has(lobbyId)) return;
  const lobby = await getLobbyById(lobbyId);
  if (!lobby || lobby.seats.some(s => s.userId)) return;
  emptyLobbyTimers.set(lobbyId, setTimeout(() => {
    onEmptyLobbyExpired(lobbyId).catch(() => {});
  }, ALL_PLAYERS_GONE_CLOSE_MS));
}

function cancelEmptyLobbyTimer(lobbyId: string): void {
  const t = emptyLobbyTimers.get(lobbyId);
  if (t) {
    clearTimeout(t);
    emptyLobbyTimers.delete(lobbyId);
  }
}

function maybeScheduleEmptyLobbyClose(lobbyId: string): void {
  const sockets = lobbyClients.get(lobbyId);
  if (sockets && sockets.size > 0) return;
  if (emptyLobbyTimers.has(lobbyId)) return;
  emptyLobbyTimers.set(lobbyId, setTimeout(() => {
    onEmptyLobbyExpired(lobbyId).catch(() => {});
  }, EMPTY_LOBBY_CLOSE_MS));
}

async function onEmptyLobbyExpired(lobbyId: string): Promise<void> {
  emptyLobbyTimers.delete(lobbyId);
  const sockets = lobbyClients.get(lobbyId);
  if (sockets && sockets.size > 0) return;

  cancelActionTimer(lobbyId);
  cancelIntermissionTimer(lobbyId);
  cancelShowCardsTimer(lobbyId);
  cancelRunout(lobbyId);
  cancelBombPotOptIn(lobbyId);
  cancelRunItOut(lobbyId);
  cancelAllBjTimers(lobbyId);
  waitingForPlayers.delete(lobbyId);

  clearGame(lobbyId);
  await teardownBjLobby(lobbyId);
  lobbyClients.delete(lobbyId);

  await deleteLobby(lobbyId);
  console.log(`[lobby] Deleted abandoned lobby ${lobbyId}`);
}

/**
 * Consume nextHandBlind flags from the lobby and register which seats are playing blind
 * for the just-started hand. Must be called after startHand/startBombPotHand succeeds.
 */
async function applyBlindHandFlags(lobbyId: string, state: GameTableState): Promise<void> {
  const blindUserIds = await consumeBlindHandFlags(lobbyId);
  if (blindUserIds.length === 0) return;
  const blindSeatIndices = state.seats
    .filter((s) => blindUserIds.includes(s.userId))
    .map((s) => s.seatIndex);
  setBlindHandSeats(lobbyId, blindSeatIndices);
}

/**
 * Attempt to start the next hand for a lobby that is waiting for enough active players.
 * Clears the flag before any await to prevent concurrent triggers; restores it if startHand
 * still fails. No-op when the lobby is not in the waiting state.
 */
async function tryStartWaitingHand(lobbyId: string): Promise<void> {
  if (!waitingForPlayers.get(lobbyId)) return;

  // Clear synchronously before any await to prevent a second concurrent call from also firing.
  waitingForPlayers.delete(lobbyId);

  const lobby = await getLobbyById(lobbyId);
  if (!lobby || lobby.status !== 'playing') return;

  // Guard: bail if a hand is already in progress (duplicate event race)
  const existing = await getActiveGame(lobbyId);
  const activeStreets = ['preflop', 'flop', 'turn', 'river', 'showdown', 'reveal'] as const;
  if (existing && (activeStreets as readonly string[]).includes(existing.street)) return;

  // If the host queued a Bomb Pot for the next hand, run the opt-in flow instead.
  if (await maybeStartBombPot(lobbyId, lobby.settings)) return;

  const result = await startHand(lobbyId, lobby.settings);
  if ('error' in result) {
    // Still not enough players — restore the flag and broadcast so clients see the message.
    waitingForPlayers.set(lobbyId, true);
    await broadcastTableState(lobbyId);
    return;
  }

  await applyBlindHandFlags(lobbyId, result);
  recordHandStart(lobbyId, result);
  scheduleActionTimer(lobbyId, lobby.settings, result);
  const connected = getConnectedSet(lobbyId);
  const startedLobby = await getLobbyById(lobbyId, connected);
  if (startedLobby) broadcastLobby(lobbyId, () => ({ type: 'lobby_state', lobby: startedLobby }));
  await broadcastTableState(lobbyId);
}

// ── All-in runout orchestration ───────────────────────────
interface RunoutState {
  finalEngineState: GameTableState;
  config: VariantConfig;
  startBoardCount: number;
  visibleBoardCount: number;
  gen: number;
  /** Whether all participants' hole cards should be revealed at this point in the runout. */
  revealHoleCards: boolean;
  /**
   * Stack for each seat *before* pot distribution. The engine resolves the showdown (and
   * credits winner stacks) atomically, so during the runout animation we override seat stacks
   * with these values so chips appear to remain in the center pot until the reveal is done.
   */
  prePayoutStacks: Map<number, number>;
  /** Set for multi-runout reveals; undefined for single-board runouts. */
  numRuns?: number;
  currentRunIndex?: number;
  currentRunVisibleCount?: number;
}

/**
 * Compute each seat's stack as it was immediately before pots were awarded.
 * The engine state has already applied winnerPayouts to seat.stack; we reverse that here.
 */
function computePrePayoutStacks(finalState: GameTableState): Map<number, number> {
  const wonBySeat = new Map<number, number>();
  for (const payout of finalState.winnerPayouts) {
    wonBySeat.set(payout.seatIndex, (wonBySeat.get(payout.seatIndex) ?? 0) + payout.amount);
  }
  const stacks = new Map<number, number>();
  for (const seat of finalState.seats) {
    stacks.set(seat.seatIndex, seat.stack - (wonBySeat.get(seat.seatIndex) ?? 0));
  }
  return stacks;
}

/** lobbyId → active runout sequence (board cards being progressively revealed) */
const activeRunouts = new Map<string, RunoutState>();

/**
 * Monotonic generation counter for runout callbacks.
 * Incremented by cancelRunout so stale setTimeout callbacks bail immediately.
 */
const runoutGenerations = new Map<string, number>();

function cancelRunout(lobbyId: string): void {
  activeRunouts.delete(lobbyId);
  runoutGenerations.set(lobbyId, (runoutGenerations.get(lobbyId) ?? 0) + 1);
}

/** True when a game action triggered an all-in board runout (cards were auto-dealt to showdown). */
function isAllInRunoutTrigger(newState: GameTableState, preBoardCount: number): boolean {
  return (
    newState.street === 'complete' &&
    (newState.board?.length ?? 0) > preBoardCount &&
    (newState.showdownHands?.length ?? 0) > 0
  );
}

/**
 * Orchestrate the dramatic all-in runout sequence:
 *   1. Broadcast immediately with hole cards revealed + board at startBoardCount.
 *   2. Progressively reveal each remaining street (flop/turn/river) with pauses.
 *   3. After the final pause, call handleHandComplete (winner shown, intermission starts).
 */
async function startAllInRunout(
  lobbyId: string,
  finalState: GameTableState,
  config: VariantConfig,
  startBoardCount: number,
): Promise<void> {
  cancelRunout(lobbyId); // increments generation; clears any prior runout
  const gen = runoutGenerations.get(lobbyId) ?? 0;

  activeRunouts.set(lobbyId, {
    finalEngineState: finalState,
    config,
    startBoardCount,
    visibleBoardCount: startBoardCount,
    gen,
    revealHoleCards: true, // all-in runout reveals hole cards throughout
    prePayoutStacks: computePrePayoutStacks(finalState),
  });

  // Step 0: broadcast initial state — holes visible, board at startBoardCount
  await broadcastTableState(lobbyId);

  // Build the list of board counts to reveal to, street-by-street
  const totalCards = finalState.board.length;
  const stepCounts: number[] = [];
  if (startBoardCount < 3 && totalCards >= 3) stepCounts.push(3);
  if (startBoardCount < 4 && totalCards >= 4) stepCounts.push(4);
  if (startBoardCount < totalCards) stepCounts.push(totalCards);
  const reveals = [...new Set(stepCounts)]
    .filter((n) => n > startBoardCount)
    .sort((a, b) => a - b);

  // Timing: 2500 ms initial pause, then 2000 ms between streets, 2500 ms before winner
  let cumDelay = 2500;

  for (let i = 0; i < reveals.length; i++) {
    const targetCount = reveals[i];
    const isLast = i === reveals.length - 1;
    const revealAt = cumDelay;
    cumDelay += isLast ? 2500 : 2000;

    setTimeout(async () => {
      if ((runoutGenerations.get(lobbyId) ?? 0) !== gen) return;
      const r = activeRunouts.get(lobbyId);
      if (!r) return;
      r.visibleBoardCount = targetCount;
      await broadcastTableState(lobbyId);
    }, revealAt);
  }

  // Final callback: clear runout and trigger hand-complete (winner display + intermission)
  setTimeout(async () => {
    if ((runoutGenerations.get(lobbyId) ?? 0) !== gen) return;
    cancelRunout(lobbyId);
    await handleHandComplete(lobbyId, finalState, config);
  }, cumDelay);
}

/**
 * Orchestrate a Bomb Pot runout:
 *   1. Broadcast with board empty and hole cards hidden (own cards only) for a 5s viewing delay.
 *   2. Reveal the flop AND flip every participant's hole cards face-up.
 *   3. Reveal turn, then river (both boards in lockstep for a double board).
 *   4. After the final pause, complete the hand (showdown + intermission).
 */
async function startBombPotRunout(
  lobbyId: string,
  finalState: GameTableState,
  config: VariantConfig,
): Promise<void> {
  cancelRunout(lobbyId);
  const gen = runoutGenerations.get(lobbyId) ?? 0;

  activeRunouts.set(lobbyId, {
    finalEngineState: finalState,
    config,
    startBoardCount: 0,
    visibleBoardCount: 0,
    gen,
    revealHoleCards: false, // own cards only during the 5s viewing delay
    prePayoutStacks: computePrePayoutStacks(finalState),
  });

  // Step 0: hole cards hidden, board empty
  await broadcastTableState(lobbyId);

  const total = finalState.board.length;       // flop(+extra) + turn + river
  const flopCount = Math.max(3, total - 2);
  const reveals = [flopCount, flopCount + 1, total].filter((n) => n <= total);

  let cumDelay = 5000; // 5s viewing delay before the flop
  for (let i = 0; i < reveals.length; i++) {
    const targetCount = reveals[i];
    const isLast = i === reveals.length - 1;
    const revealAt = cumDelay;
    cumDelay += isLast ? 2500 : 2000;

    setTimeout(async () => {
      if ((runoutGenerations.get(lobbyId) ?? 0) !== gen) return;
      const r = activeRunouts.get(lobbyId);
      if (!r) return;
      r.visibleBoardCount = targetCount;
      r.revealHoleCards = true; // flop onward: all cards face up
      await broadcastTableState(lobbyId);
    }, revealAt);
  }

  setTimeout(async () => {
    if ((runoutGenerations.get(lobbyId) ?? 0) !== gen) return;
    cancelRunout(lobbyId);
    await handleHandComplete(lobbyId, finalState, config);
  }, cumDelay);
}

// ── Bomb Pot opt-in orchestration ─────────────────────────
const BOMB_POT_OPT_IN_MS = 10_000;

interface BombPotPendingState {
  amount: number;
  doubleBoard: boolean;
  deadline: string;
  gen: number;
  joined: Set<string>;
  config: VariantConfig;
}

/** lobbyId → active 10-second Bomb Pot opt-in window */
const bombPotPending = new Map<string, BombPotPendingState>();
const bombPotTimers = new Map<string, ReturnType<typeof setTimeout>>();
const bombPotGenerations = new Map<string, number>();

function cancelBombPotOptIn(lobbyId: string): void {
  const t = bombPotTimers.get(lobbyId);
  if (t) { clearTimeout(t); bombPotTimers.delete(lobbyId); }
  bombPotPending.delete(lobbyId);
  bombPotGenerations.set(lobbyId, (bombPotGenerations.get(lobbyId) ?? 0) + 1);
}

/** Seated players eligible to be offered a Bomb Pot: have chips, not sitting out, not waiting for reentry blind. */
async function eligibleBombPotPlayers(lobbyId: string): Promise<string[]> {
  const lobby = await getLobbyById(lobbyId);
  if (!lobby) return [];
  return lobby.seats
    .filter((s) => s.userId && s.stack > 0 && !s.sitOutNextHand && !s.waitingForReentryBlind)
    .map((s) => s.userId!);
}

/**
 * Begin the Bomb Pot opt-in phase: prompt every eligible connected player and start the
 * 10-second countdown. Returns true so callers know not to start a normal hand.
 */
async function startBombPotOptIn(lobbyId: string, config: VariantConfig): Promise<boolean> {
  const bp = config.nextHandBombPot;
  if (!bp) return false;

  cancelBombPotOptIn(lobbyId);
  const gen = bombPotGenerations.get(lobbyId) ?? 0;
  const deadline = new Date(Date.now() + BOMB_POT_OPT_IN_MS).toISOString();
  bombPotPending.set(lobbyId, {
    amount: bp.amount,
    doubleBoard: bp.doubleBoard,
    deadline,
    gen,
    joined: new Set(),
    config,
  });

  const eligible = await eligibleBombPotPlayers(lobbyId);
  for (const userId of eligible) {
    const ws = connectedUserSockets.get(userId);
    if (ws) send(ws, { type: 'bomb_pot_prompt', deadline, amount: bp.amount, doubleBoard: bp.doubleBoard });
  }

  bombPotTimers.set(lobbyId, setTimeout(() => {
    if ((bombPotGenerations.get(lobbyId) ?? 0) !== gen) return;
    resolveBombPotOptIn(lobbyId).catch(() => {});
  }, BOMB_POT_OPT_IN_MS));

  return true;
}

/** Start a normal hand after a Bomb Pot is cancelled, so play continues. */
async function startNormalHandFallback(lobbyId: string, settings: VariantConfig): Promise<void> {
  const result = await startHand(lobbyId, settings);
  if ('error' in result) {
    waitingForPlayers.set(lobbyId, true);
    await broadcastTableState(lobbyId);
    return;
  }
  await applyBlindHandFlags(lobbyId, result);
  recordHandStart(lobbyId, result);
  scheduleActionTimer(lobbyId, settings, result);
  await broadcastTableState(lobbyId);
}

/**
 * Resolve the opt-in window: clear the host's one-shot Bomb Pot setting, then either start
 * the Bomb Pot hand (>= 2 joined and still seated) or cancel and fall back to a normal hand.
 */
async function resolveBombPotOptIn(lobbyId: string): Promise<void> {
  const pending = bombPotPending.get(lobbyId);
  cancelBombPotOptIn(lobbyId); // clears timer + pending + bumps generation
  if (!pending) return;

  await clearNextHandBombPot(lobbyId); // one-shot reset regardless of outcome

  const lobby = await getLobbyById(lobbyId);
  if (!lobby || lobby.status !== 'playing') {
    await broadcastTableState(lobbyId);
    return;
  }

  // Push the cleared setting to all clients so the host checkbox unchecks immediately.
  broadcastLobby(lobbyId, () => ({ type: 'lobby_state', lobby }));

  const seatedWithChips = new Set(lobby.seats.filter((s) => s.userId && s.stack > 0).map((s) => s.userId!));
  const participants = [...pending.joined].filter((id) => seatedWithChips.has(id));

  if (participants.length < 2) {
    broadcastLobby(lobbyId, () => ({ type: 'bomb_pot_cancelled', reason: 'Bomb Pot cancelled: not enough participants' }));
    await startNormalHandFallback(lobbyId, lobby.settings);
    return;
  }

  const result = await startBombPotHand(lobbyId, lobby.settings, pending.amount, pending.doubleBoard, participants);
  if ('error' in result) {
    broadcastLobby(lobbyId, () => ({ type: 'bomb_pot_cancelled', reason: 'Bomb Pot cancelled: not enough participants' }));
    await startNormalHandFallback(lobbyId, lobby.settings);
    return;
  }

  await applyBlindHandFlags(lobbyId, result);
  recordHandStart(lobbyId, result);
  await startBombPotRunout(lobbyId, result, lobby.settings);
}

/** If a Bomb Pot is pending for the next hand, begin opt-in and return true. */
async function maybeStartBombPot(lobbyId: string, settings: VariantConfig): Promise<boolean> {
  if (!settings.nextHandBombPot) return false;
  return startBombPotOptIn(lobbyId, settings);
}

// ── Run-It-Out prompt orchestration ──────────────────────────

const RUN_IT_OUT_TIMEOUT_MS = 10_000;

interface RunItOutPendingState {
  preRunoutState: GameTableState;
  chooserSeatIndex: number;
  sharedBoardCount: number;
  deadline: string;
  gen: number;
  config: VariantConfig;
}

/** lobbyId → active run-it-out choice window */
const runItOutPending = new Map<string, RunItOutPendingState>();
const runItOutTimers = new Map<string, ReturnType<typeof setTimeout>>();
const runItOutGenerations = new Map<string, number>();

function cancelRunItOut(lobbyId: string): void {
  const t = runItOutTimers.get(lobbyId);
  if (t) { clearTimeout(t); runItOutTimers.delete(lobbyId); }
  runItOutPending.delete(lobbyId);
  runItOutGenerations.set(lobbyId, (runItOutGenerations.get(lobbyId) ?? 0) + 1);
}

/**
 * Begin the run-it-out prompt: pick a random all-in player as the chooser, broadcast the
 * prompt to all clients, and start the 10-second countdown. Defaults to 1 run on expiry.
 */
async function startRunItOutPrompt(
  lobbyId: string,
  state: GameTableState,
  config: VariantConfig,
): Promise<void> {
  const allInSeats = state.seats.filter((s) => s.allIn && !s.folded);
  if (allInSeats.length === 0) {
    // No eligible chooser — resolve immediately with 1 run (safety fallback)
    const finalState = await applyMultipleRunouts(lobbyId, config, state, 1);
    await startAllInRunout(lobbyId, finalState, config, state.board.length);
    return;
  }

  cancelRunItOut(lobbyId);
  const gen = runItOutGenerations.get(lobbyId) ?? 0;
  const chooser = allInSeats[Math.floor(Math.random() * allInSeats.length)];
  const sharedBoardCount = state.board.length;
  const deadline = new Date(Date.now() + RUN_IT_OUT_TIMEOUT_MS).toISOString();
  const maxRuns = config.runItOut ?? 1;

  runItOutPending.set(lobbyId, {
    preRunoutState: state,
    chooserSeatIndex: chooser.seatIndex,
    sharedBoardCount,
    deadline,
    gen,
    config,
  });

  broadcastLobby(lobbyId, () => ({
    type: 'run_it_out_prompt' as const,
    chooserSeatIndex: chooser.seatIndex,
    deadline,
    maxRuns,
  }));
  await broadcastTableState(lobbyId);

  runItOutTimers.set(lobbyId, setTimeout(() => {
    if ((runItOutGenerations.get(lobbyId) ?? 0) !== gen) return;
    resolveRunItOut(lobbyId, 1).catch(() => {});
  }, RUN_IT_OUT_TIMEOUT_MS));
}

/**
 * Resolve the run-it-out choice: deal numRuns boards, run the showdown, and start the
 * sequential board-reveal sequence.
 */
async function resolveRunItOut(lobbyId: string, numRuns: number): Promise<void> {
  const pending = runItOutPending.get(lobbyId);
  cancelRunItOut(lobbyId);
  if (!pending) return;

  const finalState = await applyMultipleRunouts(lobbyId, pending.config, pending.preRunoutState, numRuns);

  if (numRuns <= 1) {
    await startAllInRunout(lobbyId, finalState, pending.config, pending.sharedBoardCount);
  } else {
    await startMultiRunoutReveal(lobbyId, finalState, pending.config, pending.sharedBoardCount, numRuns);
  }
}

/**
 * Orchestrate a multi-runout reveal: reveal each run's board cards progressively (2.5s initial
 * pause, 2s between streets), then pause 4s between runs. After all runs, call handleHandComplete.
 */
async function startMultiRunoutReveal(
  lobbyId: string,
  finalState: GameTableState,
  config: VariantConfig,
  sharedBoardCount: number,
  numRuns: number,
): Promise<void> {
  cancelRunout(lobbyId);
  const gen = runoutGenerations.get(lobbyId) ?? 0;

  activeRunouts.set(lobbyId, {
    finalEngineState: finalState,
    config,
    startBoardCount: sharedBoardCount,
    visibleBoardCount: sharedBoardCount,
    gen,
    revealHoleCards: true,
    prePayoutStacks: computePrePayoutStacks(finalState),
    numRuns,
    currentRunIndex: 0,
    currentRunVisibleCount: sharedBoardCount,
  });

  await broadcastTableState(lobbyId);

  let cumDelay = 0;

  for (let runIdx = 0; runIdx < numRuns; runIdx++) {
    const capturedRunIdx = runIdx;
    const runBoard = finalState.runoutBoards?.[runIdx] ?? finalState.board;
    const runTotal = runBoard.length;

    // For runs after the first, broadcast the "start of this run" (shared cards, new run label)
    if (runIdx > 0) {
      const startAt = cumDelay;
      setTimeout(async () => {
        if ((runoutGenerations.get(lobbyId) ?? 0) !== gen) return;
        const r = activeRunouts.get(lobbyId);
        if (!r) return;
        r.currentRunIndex = capturedRunIdx;
        r.currentRunVisibleCount = sharedBoardCount;
        await broadcastTableState(lobbyId);
      }, startAt);
    }

    cumDelay += 2500;

    // Build the reveal steps for this run (street by street)
    const stepCounts: number[] = [];
    if (sharedBoardCount < 3 && runTotal >= 3) stepCounts.push(3);
    if (sharedBoardCount < 4 && runTotal >= 4) stepCounts.push(4);
    if (sharedBoardCount < runTotal) stepCounts.push(runTotal);
    const reveals = [...new Set(stepCounts)].filter((n) => n > sharedBoardCount).sort((a, b) => a - b);

    for (let i = 0; i < reveals.length; i++) {
      const targetCount = reveals[i];
      const isLast = i === reveals.length - 1;
      const revealAt = cumDelay;
      cumDelay += isLast ? 2500 : 2000;

      setTimeout(async () => {
        if ((runoutGenerations.get(lobbyId) ?? 0) !== gen) return;
        const r = activeRunouts.get(lobbyId);
        if (!r) return;
        r.currentRunIndex = capturedRunIdx;
        r.currentRunVisibleCount = targetCount;
        await broadcastTableState(lobbyId);
      }, revealAt);
    }

    if (runIdx < numRuns - 1) {
      cumDelay += 4000;
    }
  }

  setTimeout(async () => {
    if ((runoutGenerations.get(lobbyId) ?? 0) !== gen) return;
    cancelRunout(lobbyId);
    await handleHandComplete(lobbyId, finalState, config);
  }, cumDelay);
}

/** userId set to prevent duplicate cash-out processing */
const cashOutInProgress = new Set<string>();

/**
 * Recently-processed donation IDs. Capped at MAX_DONATION_IDS entries (FIFO eviction) to
 * prevent a reconnect-retry from crediting a donation twice.
 */
const processedDonationIds = new Set<string>();
const MAX_DONATION_IDS = 10_000;

function trackDonationId(id: string): void {
  if (processedDonationIds.size >= MAX_DONATION_IDS) {
    const first = processedDonationIds.values().next().value as string;
    processedDonationIds.delete(first);
  }
  processedDonationIds.add(id);
}

export type TokenVerifier = (token: string) => Promise<{ sub: string }>;

let verifyToken: TokenVerifier | null = null;

export function setTokenVerifier(fn: TokenVerifier): void {
  verifyToken = fn;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/** Build the dependency bag for the blackjack handler (captures module-level maps). */
function bjDeps() {
  return { send, broadcastLobby, getConnectedSet };
}

/** Returns the set of userIds currently connected to a lobby. */
function getConnectedSet(lobbyId: string): Set<string> {
  const sockets = lobbyClients.get(lobbyId);
  if (!sockets) return new Set();
  const connected = new Set<string>();
  for (const ws of sockets) {
    const st = clients.get(ws);
    if (st?.userId) connected.add(st.userId);
  }
  return connected;
}

function broadcastLobby(
  lobbyId: string,
  build: (userId: string | null, isSpectator: boolean) => ServerMessage
): void {
  const set = lobbyClients.get(lobbyId);
  if (!set) return;
  for (const ws of set) {
    const st = clients.get(ws);
    if (st) send(ws, build(st.userId, st.isSpectator));
  }
}

/**
 * After a seat is vacated, post a system chat message if host status migrated to a new player.
 * `updated` is the lobby summary reflecting the post-removal state.
 */
function announceHostChange(
  lobbyId: string,
  prevHostUserId: string | null,
  updated: { hostUserId: string | null; hostDisplayName: string } | null
): void {
  if (!updated) return;
  if (updated.hostUserId && updated.hostUserId !== prevHostUserId) {
    const msg = addSystemChatMessage(lobbyId, `${updated.hostDisplayName} is now the host.`);
    broadcastLobby(lobbyId, () => ({ type: 'chat', message: msg }));
  }
}

async function broadcastTableState(lobbyId: string): Promise<void> {
  const connected = getConnectedSet(lobbyId);
  const lobby = await getLobbyById(lobbyId, connected);
  if (!lobby) return;

  const deadline = getActionDeadline(lobbyId);
  const intermDeadline = getIntermissionDeadline(lobbyId);
  const paused = lobby.status === 'paused';
  const isWaitingForPlayers = waitingForPlayers.get(lobbyId) ?? false;

  // When a runout is active use the final engine state and a truncated board count.
  // Override seat stacks with pre-payout values so chips appear to stay in the center
  // pot until the board has been fully revealed and handleHandComplete fires.
  const runout = activeRunouts.get(lobbyId);
  const rawGame = runout ? runout.finalEngineState : await getActiveGame(lobbyId);

  // For multi-runout: override the board to show the current run's cards at the current reveal depth.
  let boardOverride: import('@vct/shared-types').Card[] | undefined;
  let runoutCurrentRun: number | undefined;
  let runoutTotalRuns: number | undefined;
  if (runout?.numRuns !== undefined && runout.currentRunIndex !== undefined && rawGame?.runoutBoards) {
    boardOverride = rawGame.runoutBoards[runout.currentRunIndex].slice(0, runout.currentRunVisibleCount ?? 0);
    runoutCurrentRun = runout.currentRunIndex + 1;
    runoutTotalRuns = runout.numRuns;
  }

  const game = runout && rawGame
    ? {
        ...rawGame,
        board: boardOverride ?? rawGame.board,
        seats: rawGame.seats.map((s) => ({
          ...s,
          stack: runout.prePayoutStacks.get(s.seatIndex) ?? s.stack,
        })),
      }
    : rawGame;
  // For single runout pass visibleBoardCount; for multi-runout the board is already sliced above.
  const visibleBoardCount = (runout && !boardOverride) ? runout.visibleBoardCount : undefined;
  const runoutActive = runout !== undefined;
  const revealHoleCards = runout ? runout.revealHoleCards : undefined;

  broadcastLobby(lobbyId, (userId, isSpectator) => {
    if (!game) {
      return { type: 'lobby_state', lobby };
    }
    const { public: pub, private: priv } = toPublicState(
      lobbyId, game, userId, isSpectator, lobby.settings, deadline, paused, intermDeadline,
      visibleBoardCount, runoutActive, revealHoleCards,
      runoutCurrentRun, runoutTotalRuns,
    );
    return {
      type: 'table_state',
      public: { ...pub, waitingForPlayers: isWaitingForPlayers || undefined },
      private: priv,
    };
  });
}

/** Evict a stale socket for a userId, removing it from all tracking maps. */
function evictSocket(existing: WebSocket): void {
  const st = clients.get(existing);
  if (st?.lobbyId) lobbyClients.get(st.lobbyId)?.delete(existing);
  if (st?.userId && connectedUserSockets.get(st.userId) === existing) {
    connectedUserSockets.delete(st.userId);
  }
  clients.delete(existing);
  try { existing.close(); } catch { /* already closed */ }
}

// ── Stuck-game recovery helpers ───────────────────────────

const ACTIVE_STREETS = ['preflop', 'flop', 'turn', 'river', 'showdown', 'reveal'] as const;

/**
 * Returns true when the active game has seats that no longer exist in the lobby.
 * This happens when all players' SEAT_RELEASE_MS elapsed mid-hand and their seats
 * were removed, leaving an orphaned engine state that blocks new hands from starting.
 */
async function isGameOrphaned(lobbyId: string): Promise<boolean> {
  const game = await getActiveGame(lobbyId);
  if (!game) return false;
  if (!(ACTIVE_STREETS as readonly string[]).includes(game.street)) return false;
  const lobby = await getLobbyById(lobbyId);
  if (!lobby) return true;
  const lobbySeatUserIds = new Set(lobby.seats.filter((s) => s.userId).map((s) => s.userId!));
  const anyMatch = game.seats.some((s) => lobbySeatUserIds.has(s.userId));
  return !anyMatch;
}

/**
 * Clear an orphaned game for a lobby: wipes the in-memory and Redis game state so
 * a fresh hand can start. Safe to call; no-op if the game is not orphaned.
 */
async function clearOrphanedGame(lobbyId: string): Promise<boolean> {
  if (!(await isGameOrphaned(lobbyId))) return false;
  console.log(`[recovery] Clearing orphaned game state for lobby ${lobbyId} — all original players left`);
  clearGame(lobbyId);
  await redisDel(keys.tableState(lobbyId));
  return true;
}

/**
 * When a player joins or reconnects, ensure the lobby's hand lifecycle is healthy:
 *  - Clear orphaned game state (all original players' seats have been released).
 *  - If the game is complete (or gone) and no intermission/runout is scheduled,
 *    start a short intermission so the next hand begins automatically.
 *  - If the action-seat player is disconnected and no action timer is running,
 *    reconstruct their grace-period countdown so the hand eventually self-resolves.
 */
async function recoverHandLifecycle(lobbyId: string): Promise<void> {
  const orphanCleared = await clearOrphanedGame(lobbyId);

  const game = orphanCleared ? null : await getActiveGame(lobbyId);
  const lobby = await getLobbyById(lobbyId);
  if (!lobby || lobby.status !== 'playing') return;

  // Schedule an intermission if the game is stuck between hands with no timer running.
  const isComplete = !game || game.street === 'complete' || game.street === 'waiting';
  if (
    isComplete &&
    !intermissionTimers.has(lobbyId) &&
    !activeRunouts.has(lobbyId) &&
    !bombPotPending.has(lobbyId)
  ) {
    console.log(`[recovery] Scheduling intermission for stuck lobby ${lobbyId}`);
    scheduleIntermission(lobbyId, lobby.settings, 5000);
    return;
  }

  // For an active hand, reconstruct the grace timer for a disconnected action-seat player.
  if (!game || !(ACTIVE_STREETS as readonly string[]).includes(game.street)) return;
  if (actionTimers.has(lobbyId)) return; // action timer already covers it

  const actionSeat = game.seats.find(
    (s) => s.seatIndex === game.actionSeatIndex && !s.folded && !s.allIn,
  );
  if (!actionSeat) return;
  if (connectedUserSockets.has(actionSeat.userId)) return; // player is online

  // Look up their session to see how long they've been gone.
  const sess = await getSessionByUserAndLobby(actionSeat.userId, lobbyId);
  if (!sess?.disconnectedAt) return; // no session or not marked disconnected

  const disconnectedMs = Date.now() - sess.disconnectedAt.getTime();
  const remainingMs = Math.max(0, GRACE_PERIOD_MS - disconnectedMs);

  if (disconnectTimers.has(sess.id)) return; // grace timer already running

  console.log(
    `[recovery] Reconstructing grace timer for ${actionSeat.userId} in lobby ${lobbyId} ` +
    `(${Math.round(remainingMs / 1000)}s remaining)`,
  );

  if (remainingMs === 0) {
    // Grace period already elapsed — act immediately.
    await onGracePeriodExpired(sess.id, actionSeat.userId, lobbyId);
  } else {
    const timer = setTimeout(() => {
      onGracePeriodExpired(sess.id, actionSeat.userId, lobbyId).catch(() => {});
    }, remainingMs);
    disconnectTimers.set(sess.id, timer);
  }
}

/**
 * Cancel any running action timer for the lobby.
 * Incrementing the generation prevents an already-queued callback from firing.
 */
function cancelActionTimer(lobbyId: string): void {
  const t = actionTimers.get(lobbyId);
  if (t) {
    clearTimeout(t);
    actionTimers.delete(lobbyId);
  }
  clearActionDeadline(lobbyId);
  actionTimerGenerations.set(lobbyId, (actionTimerGenerations.get(lobbyId) ?? 0) + 1);
}

/**
 * Start (or restart) the action timer for the current action seat in state.
 * - If actionTimerSec > 0: schedule the normal countdown.
 * - If actionTimerSec === 0 BUT the action-seat player is currently disconnected:
 *   schedule a GRACE_PERIOD_MS fallback so the hand self-resolves even without a
 *   configured timer (handles server-restart scenarios where grace timers were lost).
 */
function scheduleActionTimer(lobbyId: string, config: VariantConfig, state: GameTableState): void {
  cancelActionTimer(lobbyId); // always cancel first; increments generation

  if (state.actionSeatIndex === null) return;
  if (state.street === 'complete' || state.street === 'waiting' || state.street === 'reveal') return;

  const seat = state.seats.find((s) => s.seatIndex === state.actionSeatIndex);
  if (!seat || seat.folded || seat.allIn) return;

  const timerSec = config.actionTimerSec;
  const isConnected = connectedUserSockets.has(seat.userId);

  // Determine effective duration:
  // - configured action timer, OR
  // - grace-period fallback when the player is offline and no timer is configured
  let durationMs: number;
  let hasDeadline = false;

  if (timerSec && timerSec > 0) {
    durationMs = timerSec * 1000;
    hasDeadline = true;
  } else if (!isConnected) {
    // No action timer configured, but the player is offline.
    // Use GRACE_PERIOD_MS so the hand eventually self-resolves.
    durationMs = GRACE_PERIOD_MS;
  } else {
    return; // no timer needed: player is online, no countdown configured
  }

  if (hasDeadline) {
    const deadline = new Date(Date.now() + durationMs).toISOString();
    setActionDeadline(lobbyId, deadline);
  }

  const { userId, seatIndex } = seat;
  const gen = actionTimerGenerations.get(lobbyId) ?? 0;

  const timer = setTimeout(() => {
    if ((actionTimerGenerations.get(lobbyId) ?? 0) !== gen) return;
    onActionTimerExpired(lobbyId, userId, seatIndex, config).catch(() => {});
  }, durationMs);

  actionTimers.set(lobbyId, timer);
}

/** Cancel any running between-hand countdown. Increments generation to invalidate stale callbacks. */
function cancelIntermissionTimer(lobbyId: string): void {
  const t = intermissionTimers.get(lobbyId);
  if (t) {
    clearTimeout(t);
    intermissionTimers.delete(lobbyId);
  }
  clearIntermissionDeadline(lobbyId);
  intermissionTimerGenerations.set(lobbyId, (intermissionTimerGenerations.get(lobbyId) ?? 0) + 1);
}

const INTERMISSION_MS = 20_000;

/** Schedule the next hand to start after delayMs (default 20 s). */
function scheduleIntermission(lobbyId: string, config: VariantConfig, delayMs = INTERMISSION_MS): void {
  cancelIntermissionTimer(lobbyId);
  const gen = intermissionTimerGenerations.get(lobbyId) ?? 0;
  const deadline = new Date(Date.now() + delayMs).toISOString();
  setIntermissionDeadline(lobbyId, deadline);
  intermissionTimers.set(
    lobbyId,
    setTimeout(() => {
      if ((intermissionTimerGenerations.get(lobbyId) ?? 0) !== gen) return;
      onIntermissionExpired(lobbyId, config).catch(() => {});
    }, delayMs)
  );
}

/** Auto-starts the next hand once the between-hand countdown reaches zero. */
async function onIntermissionExpired(lobbyId: string, _config: VariantConfig): Promise<void> {
  intermissionTimers.delete(lobbyId);
  clearIntermissionDeadline(lobbyId);

  const lobby = await getLobbyById(lobbyId);
  if (!lobby || lobby.status !== 'playing') return;

  // Guard: bail if a hand is already in progress (e.g. duplicate callback race)
  const existing = await getActiveGame(lobbyId);
  const activeStreets = ['preflop', 'flop', 'turn', 'river', 'showdown', 'reveal'] as const;
  if (existing && (activeStreets as readonly string[]).includes(existing.street)) return;

  // If the host queued a Bomb Pot for the next hand, run the opt-in flow instead.
  if (await maybeStartBombPot(lobbyId, lobby.settings)) return;

  const result = await startHand(lobbyId, lobby.settings);
  if ('error' in result) {
    console.warn(`[intermission] Cannot start next hand for ${lobbyId}: ${result.error}`);
    waitingForPlayers.set(lobbyId, true);
    await broadcastTableState(lobbyId);
    return;
  }

  rabbitHuntPending.delete(lobbyId);
  await applyBlindHandFlags(lobbyId, result);
  recordHandStart(lobbyId, result);
  scheduleActionTimer(lobbyId, lobby.settings, result);
  const connectedPlayers = getConnectedSet(lobbyId);
  const startedLobby = await getLobbyById(lobbyId, connectedPlayers);
  if (startedLobby) broadcastLobby(lobbyId, () => ({ type: 'lobby_state', lobby: startedLobby }));
  await broadcastTableState(lobbyId);
}

/** Auto-acts on behalf of the player whose timer expired. Check if legal, otherwise fold. */
async function onActionTimerExpired(
  lobbyId: string,
  userId: string,
  seatIndex: number,
  config: VariantConfig
): Promise<void> {
  actionTimers.delete(lobbyId);
  clearActionDeadline(lobbyId);

  const state = await getActiveGame(lobbyId);
  // Guard: if the seat has already advanced, another action beat us here.
  if (!state || state.actionSeatIndex !== seatIndex) return;

  const lobby = await getLobbyById(lobbyId);
  if (!lobby) return;

  const preBoardCount = state.board.length;
  const action = getAutoAction(state, config, seatIndex);
  const preActionStreet = state.street;
  const result = await processGameAction(lobbyId, config, userId, crypto.randomUUID(), action);
  if ('error' in result) return;

  recordAction(lobbyId, userId, action, preActionStreet);

  if (result.state.pendingMultiRunout) {
    await startRunItOutPrompt(lobbyId, result.state, config);
  } else if (result.state.street === 'complete') {
    if (isAllInRunoutTrigger(result.state, preBoardCount)) {
      await startAllInRunout(lobbyId, result.state, config, preBoardCount);
    } else {
      await handleHandComplete(lobbyId, result.state, config);
    }
  } else {
    scheduleActionTimer(lobbyId, config, result.state);
    await broadcastTableState(lobbyId);
  }
}

/**
 * Called when a disconnected player's auto-act timer fires (GRACE_PERIOD_MS).
 * Marks the player as sitting-out and auto-folds if it's their turn.
 * Does NOT delete the session — the seat release timer handles that separately.
 */
async function onGracePeriodExpired(sessionId: string, userId: string, lobbyId: string): Promise<void> {
  disconnectTimers.delete(sessionId);

  // Re-fetch to confirm player has not reconnected (reconnect sets disconnectedAt = null)
  const session = await getSession(sessionId);
  if (!session || !session.disconnectedAt) return;

  const updatedLobby = await setSittingOut(lobbyId, userId, true);
  if (updatedLobby) {
    const connected = getConnectedSet(lobbyId);
    const withConnected = await getLobbyById(lobbyId, connected);
    if (withConnected) {
      broadcastLobby(lobbyId, () => ({ type: 'lobby_state', lobby: withConnected }));
    }
  }

  // Auto-act if it is this player's turn so the hand can continue
  const game = await getActiveGame(lobbyId);
  if (game) {
    const seat = game.seats.find((s) => s.userId === userId);
    if (seat && game.actionSeatIndex === seat.seatIndex && !seat.folded && !seat.allIn) {
      const lobby = await getLobbyById(lobbyId);
      if (lobby) {
        const preBoardCount = game.board.length;
        const autoAction = getAutoAction(game, lobby.settings, seat.seatIndex);
        const result = await processGameAction(
          lobbyId,
          lobby.settings,
          userId,
          crypto.randomUUID(),
          autoAction
        );
        if (!('error' in result)) {
          recordAction(lobbyId, userId, autoAction, game.street);

          if (result.state.pendingMultiRunout) {
            await startRunItOutPrompt(lobbyId, result.state, lobby.settings);
          } else if (result.state.street === 'complete') {
            if (isAllInRunoutTrigger(result.state, preBoardCount)) {
              await startAllInRunout(lobbyId, result.state, lobby.settings, preBoardCount);
            } else {
              await handleHandComplete(lobbyId, result.state, lobby.settings);
            }
          } else {
            scheduleActionTimer(lobbyId, lobby.settings, result.state);
            await broadcastTableState(lobbyId);
          }
        }
      }
    }
  }
}

/**
 * Called when a disconnected player's seat reservation expires (SEAT_RELEASE_MS).
 * Deletes the session and removes the player's seat so it becomes available.
 */
async function onSeatReleaseExpired(sessionId: string, userId: string, lobbyId: string): Promise<void> {
  seatReleaseTimers.delete(userId);

  // Guard: player may have reconnected
  if (connectedUserSockets.has(userId)) return;

  const session = await getSession(sessionId);
  if (session && !session.disconnectedAt) return; // reconnected

  const prevHost = (await getLobbyById(lobbyId))?.hostUserId ?? null;
  await deleteSession(sessionId);
  await removeSeat(lobbyId, userId);

  const connected = getConnectedSet(lobbyId);
  const updatedLobby = await getLobbyById(lobbyId, connected);
  if (updatedLobby) {
    broadcastLobby(lobbyId, () => ({ type: 'lobby_state', lobby: updatedLobby }));
    announceHostChange(lobbyId, prevHost, updatedLobby);
  }

  await maybeScheduleAllPlayersGoneClose(lobbyId);
}

/**
 * Execute a cash-out for a connected player: finalize stats, remove from seat,
 * invalidate session, disconnect from lobby, send summary.
 */
async function processCashOut(ws: WebSocket, st: ClientState): Promise<void> {
  const userId = st.userId!;
  const lobbyId = st.lobbyId!;
  const sessionId = st.sessionId;

  if (cashOutInProgress.has(userId)) return;
  cashOutInProgress.add(userId);

  // Cancel any pending seat release timer — player is leaving intentionally
  const releaseTimer = seatReleaseTimers.get(userId);
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    seatReleaseTimers.delete(userId);
  }

  try {
    const lobby = await getLobbyById(lobbyId);
    if (!lobby) return;

    const seat = lobby.seats.find((s) => s.userId === userId);
    if (!seat) return;

    // Prefer the game engine's stack — more reliable than the lobby in Postgres mode,
    // where syncStacksToLobby is a no-op and table_seats.stack can lag behind.
    const game = await getActiveGame(lobbyId);
    const gameSeat = game?.seats.find((s) => s.userId === userId);
    const finalStack = gameSeat?.stack ?? seat.stack;
    const summary = finalizeCashOut(lobbyId, userId, finalStack);
    const prevHost = lobby.hostUserId;

    await removeSeat(lobbyId, userId);

    if (sessionId) await deleteSession(sessionId);

    // Detach from lobby before broadcasting so the player doesn't receive the lobby_state
    lobbyClients.get(lobbyId)?.delete(ws);
    maybeScheduleEmptyLobbyClose(lobbyId);
    if (connectedUserSockets.get(userId) === ws) connectedUserSockets.delete(userId);
    st.lobbyId = null;
    st.sessionId = null;

    // Send results to the cashing-out player
    send(ws, { type: 'cashed_out', summary });

    // Broadcast updated seat layout to remaining players
    const connected = getConnectedSet(lobbyId);
    const withConnected = await getLobbyById(lobbyId, connected);
    if (withConnected) {
      broadcastLobby(lobbyId, () => ({ type: 'lobby_state', lobby: withConnected }));
      announceHostChange(lobbyId, prevHost, withConnected);
    }

    await maybeScheduleAllPlayersGoneClose(lobbyId);
  } finally {
    cashOutInProgress.delete(userId);
    pendingCashOuts.delete(userId);
  }
}

/**
 * At hand end, prompt connected queued players to confirm their cash-out (15 s window,
 * auto-confirms on timeout). Disconnected queued players are removed silently.
 * Call this AFTER syncEndOfHandStacks so lobby seat stacks are post-hand accurate.
 */
async function promptPendingCashOuts(lobbyId: string): Promise<void> {
  const toProcess: string[] = [];
  for (const [userId, pending] of pendingCashOuts) {
    if (pending.lobbyId === lobbyId) toProcess.push(userId);
  }
  if (toProcess.length === 0) return;

  let hadSilentRemoval = false;

  for (const userId of toProcess) {
    const pending = pendingCashOuts.get(userId)!;
    const ws = connectedUserSockets.get(userId);
    const st = ws ? clients.get(ws) : null;

    if (!ws || !st || st.lobbyId !== lobbyId) {
      // Disconnected — remove silently
      if (cashOutInProgress.has(userId)) continue;
      cashOutInProgress.add(userId);
      try {
        const lobby = await getLobbyById(lobbyId);
        const seat = lobby?.seats.find((s) => s.userId === userId);
        if (seat) {
          finalizeCashOut(lobbyId, userId, seat.stack);
          await removeSeat(lobbyId, userId);
        }
        if (pending.sessionId) await deleteSession(pending.sessionId);
        pendingCashOuts.delete(userId);
        hadSilentRemoval = true;
      } finally {
        cashOutInProgress.delete(userId);
      }
      continue;
    }

    // Connected — read post-hand stack from lobby (already synced)
    const lobby = await getLobbyById(lobbyId);
    const seat = lobby?.seats.find((s) => s.userId === userId);
    if (!seat) {
      pendingCashOuts.delete(userId);
      continue;
    }

    const deadline = new Date(Date.now() + CASH_OUT_CONFIRM_MS).toISOString();
    send(ws, { type: 'cash_out_confirm_prompt', amount: seat.stack, deadline });

    const confirmTimer = setTimeout(async () => {
      pendingCashOutConfirms.delete(userId);
      const userWs = connectedUserSockets.get(userId);
      const userSt = userWs ? clients.get(userWs) : null;
      if (userWs && userSt && userSt.lobbyId === lobbyId) {
        await processCashOut(userWs, userSt);
      } else {
        // Disconnected during confirm window — remove silently
        if (!cashOutInProgress.has(userId)) {
          cashOutInProgress.add(userId);
          try {
            const lob = await getLobbyById(lobbyId);
            const s = lob?.seats.find((s) => s.userId === userId);
            if (s) {
              finalizeCashOut(lobbyId, userId, s.stack);
              await removeSeat(lobbyId, userId);
            }
            if (pending.sessionId) await deleteSession(pending.sessionId);
            pendingCashOuts.delete(userId);
          } finally {
            cashOutInProgress.delete(userId);
          }
        }
      }
    }, CASH_OUT_CONFIRM_MS);

    pendingCashOutConfirms.set(userId, { lobbyId, sessionId: pending.sessionId, amount: seat.stack, deadline, confirmTimer });
  }

  if (hadSilentRemoval) {
    const connected = getConnectedSet(lobbyId);
    const updatedLobby = await getLobbyById(lobbyId, connected);
    if (updatedLobby) {
      broadcastLobby(lobbyId, () => ({ type: 'lobby_state', lobby: updatedLobby }));
    }
  }
}

/**
 * After a hand completes, send rebuy_available to any player who is still seated
 * but has 0 chips (busted). Players with a pending cash-out confirm will be prompted
 * and removed once they confirm (or auto-confirm on timeout).
 */
async function notifyBustedPlayers(lobbyId: string): Promise<void> {
  const lobby = await getLobbyById(lobbyId);
  if (!lobby) return;
  const game = await getActiveGame(lobbyId);
  if (!game) return;
  const buyIn = getTableBuyIn(lobby.settings);

  for (const gameSeat of game.seats) {
    if (gameSeat.stack > 0) continue;
    // Skip players whose seats were already removed (cashed out or kicked)
    if (!lobby.seats.some((s) => s.userId === gameSeat.userId)) continue;
    const ws = connectedUserSockets.get(gameSeat.userId);
    if (!ws) continue;
    send(ws, { type: 'rebuy_available', amount: buyIn });
  }
}

/** True when the hand ended because all opponents folded (no showdown). */
function isFoldWin(state: GameTableState): boolean {
  return state.winnerPayouts.length === 1 && state.winnerPayouts[0].handDescription === '';
}

/**
 * Peek at the next community cards that would have been dealt from the remaining deck.
 * Returns the turn+river for a flop fold, or the river for a turn fold. Empty otherwise.
 * Deck layout: each street burns 1 then deals, so the real cards are at odd indices.
 */
function peekRabbitCards(state: GameTableState): Card[] {
  if (state.board.length === 3 && state.deck.length >= 4) {
    return [state.deck[1], state.deck[3]]; // turn then river
  }
  if (state.board.length === 4 && state.deck.length >= 2) {
    return [state.deck[1]]; // river
  }
  return [];
}

/** Cancel any running show-cards timer. Increments generation to invalidate stale callbacks. */
function cancelShowCardsTimer(lobbyId: string): void {
  const t = showCardsTimers.get(lobbyId);
  if (t) { clearTimeout(t); showCardsTimers.delete(lobbyId); }
  showCardsGenerations.set(lobbyId, (showCardsGenerations.get(lobbyId) ?? 0) + 1);
}

/** Process any queued rebuy requests for a lobby after a hand completes. */
async function processPendingRebuys(lobbyId: string): Promise<void> {
  const toProcess: string[] = [];
  for (const [userId, pending] of pendingRebuys) {
    if (pending.lobbyId === lobbyId) toProcess.push(userId);
  }
  for (const userId of toProcess) {
    const pending = pendingRebuys.get(userId);
    if (!pending) continue;
    pendingRebuys.delete(userId);
    await rebuyPlayer(lobbyId, userId, pending.amount);
    await updateSeatStackAfterRebuy(lobbyId, userId, pending.amount);
    await setSitOutNextHand(lobbyId, userId, false);
    await setSittingOut(lobbyId, userId, false);
    await setWaitingForReentryBlind(lobbyId, userId, true);
    recordRebuy(lobbyId, userId, pending.amount);
    const ws = connectedUserSockets.get(userId);
    if (ws) send(ws, { type: 'rebuy_confirmed', newStack: pending.amount });
  }
}

/**
 * Apply a show/muck decision for a fold-win hand, broadcast the outcome,
 * record hand history, and finally start the between-hand intermission.
 */
async function finalizeFoldWin(
  lobbyId: string,
  show: boolean,
  pending: { winnerId: string; winnerSeatIndex: number; holeCards: Card[]; config: VariantConfig } | null,
  config: VariantConfig
): Promise<void> {
  cancelShowCardsTimer(lobbyId);
  showCardsPending.delete(lobbyId);

  if (show && pending) {
    await setSeatShownCards(lobbyId, pending.winnerSeatIndex, pending.holeCards);
    updateLastHandHistoryFoldWin(lobbyId, pending.winnerSeatIndex, pending.holeCards);
    recordFoldWinChoice(lobbyId, pending.winnerId, true);
  } else if (pending) {
    updateLastHandHistoryFoldWin(lobbyId, pending.winnerSeatIndex, null);
    recordFoldWinChoice(lobbyId, pending.winnerId, false);
  }

  if (pending) {
    broadcastLobby(lobbyId, () => ({
      type: 'show_cards_result' as const,
      seatIndex: pending.winnerSeatIndex,
      cards: show ? pending.holeCards : undefined,
    }));
  }

  const histories = getHandHistories(lobbyId);
  const last = histories[histories.length - 1];
  if (last) broadcastLobby(lobbyId, () => ({ type: 'hand_history', entry: last }));

  const updatedLobby = await getLobbyById(lobbyId);
  if (updatedLobby?.status === 'playing') {
    scheduleIntermission(lobbyId, config);
  }
  // Stacks were synced in handleHandComplete before promptShowCards was called
  await promptPendingCashOuts(lobbyId);
  await broadcastTableState(lobbyId);
}

/**
 * Send the show-cards prompt to a fold-win winner and schedule the auto-muck timer.
 * Intermission is deferred until finalizeFoldWin is called.
 */
async function promptShowCards(lobbyId: string, state: GameTableState, config: VariantConfig): Promise<void> {
  const winningSeatIndex = state.lastWinningSeatIndices[0];
  const winner = state.seats.find((s) => s.seatIndex === winningSeatIndex);
  if (!winner) {
    await finalizeFoldWin(lobbyId, false, null, config);
    return;
  }

  const ws = connectedUserSockets.get(winner.userId);
  if (!ws) {
    await finalizeFoldWin(lobbyId, false, null, config);
    return;
  }

  cancelShowCardsTimer(lobbyId);
  const gen = showCardsGenerations.get(lobbyId) ?? 0;
  const deadline = new Date(Date.now() + SHOW_CARDS_TIMEOUT_MS).toISOString();

  const pending = {
    winnerId: winner.userId,
    winnerSeatIndex: winner.seatIndex,
    holeCards: [...winner.holeCards],
    config,
    gen,
    deadline,
  };
  showCardsPending.set(lobbyId, pending);

  send(ws, { type: 'show_cards_prompt', deadline });

  showCardsTimers.set(lobbyId, setTimeout(() => {
    if ((showCardsGenerations.get(lobbyId) ?? 0) !== gen) return;
    const p = showCardsPending.get(lobbyId);
    showCardsPending.delete(lobbyId);
    showCardsTimers.delete(lobbyId);
    finalizeFoldWin(lobbyId, false, p ?? null, config).catch(() => {});
  }, SHOW_CARDS_TIMEOUT_MS));
}

/**
 * Unified post-hand handler called from all three action paths
 * (game_action, onActionTimerExpired, onGracePeriodExpired).
 */
async function handleHandComplete(lobbyId: string, state: GameTableState, config: VariantConfig): Promise<void> {
  cancelActionTimer(lobbyId);
  const blindSeats = getBlindHandSeats(lobbyId);
  recordHandEnd(lobbyId, state, config, blindSeats);
  clearBlindHandSeats(lobbyId);

  if (state.winnerPayouts.length > 0) {
    const payouts = state.winnerPayouts;
    broadcastLobby(lobbyId, () => ({ type: 'hand_complete', winners: payouts }));
  }

  await broadcastTableState(lobbyId);
  await processPendingRebuys(lobbyId);

  // Sync final chip counts to the lobby store (both in-memory and Postgres) so that:
  //   1. seatedPlayers() in the next startHand correctly excludes zero-stack players.
  //   2. The lobby_state broadcast below updates every client's player tray immediately,
  //      replacing the stale buy-in amount with the real post-hand stack (0 for busted).
  // We read the active game AFTER processPendingRebuys so any just-applied rebuys are
  // included (updateSeatStackAfterRebuy mutates the active game before we reach here).
  const postHandGame = await getActiveGame(lobbyId);
  if (postHandGame) {
    await syncEndOfHandStacks(
      lobbyId,
      new Map(postHandGame.seats.map((s) => [s.userId, s.stack]))
    );
    const connectedPostHand = getConnectedSet(lobbyId);
    const lobbyPostHand = await getLobbyById(lobbyId, connectedPostHand);
    if (lobbyPostHand) {
      broadcastLobby(lobbyId, () => ({ type: 'lobby_state', lobby: lobbyPostHand }));
    }
  }

  await notifyBustedPlayers(lobbyId);

  if (isFoldWin(state)) {
    // Store rabbit cards (turn/river that would have been dealt) for anyone to peek at
    const rabbitCards = peekRabbitCards(state);
    if (rabbitCards.length > 0) {
      rabbitHuntPending.set(lobbyId, rabbitCards);
      broadcastLobby(lobbyId, () => ({ type: 'rabbit_hunt_available' }));
    }
    // show_cards prompt runs first; promptPendingCashOuts is called inside finalizeFoldWin
    await promptShowCards(lobbyId, state, config);
  } else {
    const histories = getHandHistories(lobbyId);
    const last = histories[histories.length - 1];
    if (last) broadcastLobby(lobbyId, () => ({ type: 'hand_history', entry: last }));
    const updatedLobby = await getLobbyById(lobbyId);
    if (updatedLobby?.status === 'playing') {
      scheduleIntermission(lobbyId, config);
    }
    // Prompt after stacks are synced so confirmed amount reflects post-hand chips
    await promptPendingCashOuts(lobbyId);
    await broadcastTableState(lobbyId);
  }
}

export function registerClient(ws: WebSocket): void {
  clients.set(ws, { userId: null, lobbyId: null, isSpectator: false, sessionId: null });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as ClientMessage;
      await handleMessage(ws, msg);
    } catch {
      send(ws, { type: 'error', message: 'Invalid message' });
    }
  });

  ws.on('close', () => {
    const st = clients.get(ws);
    if (!st) return;

    if (st.lobbyId) {
      lobbyClients.get(st.lobbyId)?.delete(ws);
      maybeScheduleEmptyLobbyClose(st.lobbyId);
    }

    if (st.userId && connectedUserSockets.get(st.userId) === ws) {
      connectedUserSockets.delete(st.userId);
    }

    // Start grace-period timers if this was a tracked session with a lobby
    if (st.sessionId && st.userId && st.lobbyId) {
      const { sessionId, userId, lobbyId } = st;
      markSessionDisconnected(sessionId).catch(() => {});

      // Auto-act timer: auto-fold/check if it's their turn after GRACE_PERIOD_MS
      const autoActTimer = setTimeout(() => {
        onGracePeriodExpired(sessionId, userId, lobbyId).catch(() => {});
      }, GRACE_PERIOD_MS);
      disconnectTimers.set(sessionId, autoActTimer);

      // Seat release timer: release the seat after SEAT_RELEASE_MS (longer window for rejoin)
      const releaseTimer = setTimeout(() => {
        onSeatReleaseExpired(sessionId, userId, lobbyId).catch(() => {});
      }, SEAT_RELEASE_MS);
      seatReleaseTimers.set(userId, releaseTimer);
    }

    clients.delete(ws);
  });
}

async function handleMessage(ws: WebSocket, msg: ClientMessage): Promise<void> {
  const st = clients.get(ws)!;

  switch (msg.type) {
    case 'ping':
      send(ws, { type: 'pong' });
      return;

    case 'auth': {
      try {
        if (!verifyToken) throw new Error('No verifier');
        const decoded = await verifyToken(msg.token);
        st.userId = decoded.sub;
        const user = await getUserById(decoded.sub);
        if (!user) {
          send(ws, { type: 'error', message: 'User not found', code: 'AUTH_FAILED' });
          return;
        }
        // Evict any existing socket so a user never has two live connections
        const existing = connectedUserSockets.get(st.userId);
        if (existing && existing !== ws) evictSocket(existing);
        connectedUserSockets.set(st.userId, ws);

        const sessionId = await createSession(st.userId, null);
        st.sessionId = sessionId;
        send(ws, { type: 'authenticated', userId: user.id, sessionId });
      } catch {
        send(ws, { type: 'error', message: 'Invalid token', code: 'AUTH_FAILED' });
      }
      return;
    }

    case 'reconnect': {
      const session = await getSession(msg.sessionId);
      if (!session) {
        send(ws, { type: 'session_invalid' });
        return;
      }

      // Evict stale socket for this user BEFORE any await that reads connectedUserSockets
      const existing = connectedUserSockets.get(session.userId);
      if (existing && existing !== ws) evictSocket(existing);

      // Cancel any pending disconnect timers synchronously before awaiting
      const timer = disconnectTimers.get(session.id);
      if (timer) {
        clearTimeout(timer);
        disconnectTimers.delete(session.id);
      }
      const releaseTimer = seatReleaseTimers.get(session.userId);
      if (releaseTimer) {
        clearTimeout(releaseTimer);
        seatReleaseTimers.delete(session.userId);
      }

      // Restore authoritative client state
      st.userId = session.userId;
      st.lobbyId = session.lobbyId;
      st.sessionId = session.id;
      st.isSpectator = false;
      connectedUserSockets.set(session.userId, ws);

      // Mark connected so the grace-period callback knows not to act
      await markSessionConnected(session.id);

      if (session.lobbyId) {
        if (!lobbyClients.has(session.lobbyId)) lobbyClients.set(session.lobbyId, new Set());
        lobbyClients.get(session.lobbyId)!.add(ws);
        cancelEmptyLobbyTimer(session.lobbyId);
      }

      // Re-init session stats in case the server restarted and wiped in-memory stats.
      // initSession is idempotent — no-op when the entry already exists.
      if (session.lobbyId) {
        const reconnUser = await getUserById(session.userId);
        const reconnLobby = await getLobbyById(session.lobbyId);
        const reconnSeat = reconnLobby?.seats.find((s) => s.userId === session.userId);
        if (reconnSeat) {
          initSession(session.lobbyId, session.userId, reconnUser?.displayName ?? 'Player', reconnSeat.stack);
        }
      }

      send(ws, { type: 'session_ready', userId: session.userId, lobbyId: session.lobbyId ?? '' });

      // Remind player their cash-out request is still queued
      if (pendingCashOuts.has(session.userId)) {
        send(ws, { type: 'cash_out_queued' });
      }

      // Re-send confirm prompt if they reconnect during the confirmation window
      const reconnConfirm = pendingCashOutConfirms.get(session.userId);
      if (reconnConfirm) {
        send(ws, { type: 'cash_out_confirm_prompt', amount: reconnConfirm.amount, deadline: reconnConfirm.deadline });
      }

      if (session.lobbyId) {
        for (const m of getChatHistory(session.lobbyId)) {
          send(ws, { type: 'chat', message: m });
        }
        const reconnLobbyForType = await getLobbyById(session.lobbyId);
        if (reconnLobbyForType?.settings.game === 'blackjack') {
          await sendBjStateToClient(ws, session.lobbyId, session.userId, bjDeps());
        } else {
          await broadcastTableState(session.lobbyId);
        }

        // Safety net: if the startup scan missed a hand from a prior server instance (e.g.,
        // Redis was briefly unavailable at boot), cancel it now before any timer is rescheduled.
        await cancelInterruptedHand(session.lobbyId);

        const reconnGame = await getActiveGame(session.lobbyId);
        const reconnLobby = await getLobbyById(session.lobbyId);

        // If the server restarted and lost the action timer, reschedule it so the game doesn't stall.
        if (!actionTimers.has(session.lobbyId) && reconnGame && reconnLobby) {
          scheduleActionTimer(session.lobbyId, reconnLobby.settings, reconnGame);
        }

        // Recovery: detect and resolve any stuck hand lifecycle state.
        // Handles: orphaned game, lost intermission timer, lost grace timers.
        await recoverHandLifecycle(session.lobbyId);
        await broadcastTableState(session.lobbyId);

        // If the player reconnects with 0 chips (busted, not yet rebuyed), show rebuy prompt.
        // Busted players are excluded from engine seats (stack > 0 filter), so check the lobby seat.
        if (!pendingCashOuts.has(session.userId) && reconnLobby) {
          const reconnGameSeat = reconnGame?.seats.find((s) => s.userId === session.userId);
          const reconnLobbySeat = reconnLobby.seats.find((s) => s.userId === session.userId);
          const isBusted = reconnLobbySeat && reconnLobbySeat.stack === 0 && !reconnLobbySeat.waitingForReentryBlind;
          const isInGameBusted = reconnGameSeat && reconnGameSeat.stack === 0;
          if (isBusted || isInGameBusted) {
            send(ws, { type: 'rebuy_available', amount: getTableBuyIn(reconnLobby.settings) });
          }
        }

        // Re-send the show-cards prompt if the winner reconnects during the decision window
        const reconnPending = showCardsPending.get(session.lobbyId);
        if (reconnPending && reconnPending.winnerId === session.userId) {
          send(ws, { type: 'show_cards_prompt', deadline: reconnPending.deadline });
        }

        // Re-send rabbit hunt availability if anyone reconnects before next hand starts
        if (rabbitHuntPending.has(session.lobbyId)) {
          send(ws, { type: 'rabbit_hunt_available' });
        }

        // Re-send the Bomb Pot opt-in prompt if a window is active when the player reconnects
        const reconnBombPot = bombPotPending.get(session.lobbyId);
        if (reconnBombPot) {
          send(ws, {
            type: 'bomb_pot_prompt',
            deadline: reconnBombPot.deadline,
            amount: reconnBombPot.amount,
            doubleBoard: reconnBombPot.doubleBoard,
          });
        }

        // Re-send the run-it-out prompt if it's still pending and this player is the chooser
        const reconnRunItOut = runItOutPending.get(session.lobbyId);
        if (reconnRunItOut) {
          const reconnLobbyForRio = await getLobbyById(session.lobbyId);
          send(ws, {
            type: 'run_it_out_prompt',
            chooserSeatIndex: reconnRunItOut.chooserSeatIndex,
            deadline: reconnRunItOut.deadline,
            maxRuns: reconnLobbyForRio?.settings.runItOut ?? 1,
          });
        }
      }
      return;
    }

    case 'join_lobby': {
      if (!st.userId) {
        send(ws, { type: 'error', message: 'Not authenticated' });
        return;
      }
      const lobby = await getLobbyById(msg.lobbyId);
      if (!lobby) {
        send(ws, { type: 'error', message: 'Lobby not found' });
        return;
      }

      // Resolve display name before attempting to seat (needed for uniqueness check)
      const user = await getUserById(st.userId);
      if (!user) {
        send(ws, { type: 'error', message: 'User not found' });
        return;
      }

      // Release any reserved seat in a different lobby before joining this one
      const priorSeat = await getActiveSeatForUser(st.userId);
      if (priorSeat && priorSeat.lobbyId !== msg.lobbyId) {
        const priorReleaseTimer = seatReleaseTimers.get(st.userId);
        if (priorReleaseTimer) {
          clearTimeout(priorReleaseTimer);
          seatReleaseTimers.delete(st.userId);
        }
        const priorHost = (await getLobbyById(priorSeat.lobbyId))?.hostUserId ?? null;
        await removeSeat(priorSeat.lobbyId, st.userId);
        // Only delete sessions for the old lobby — the current WS session must survive.
        await deleteSessionsByUserAndLobby(st.userId, priorSeat.lobbyId);
        const priorConnected = getConnectedSet(priorSeat.lobbyId);
        const priorLobbyState = await getLobbyById(priorSeat.lobbyId, priorConnected);
        if (priorLobbyState) {
          broadcastLobby(priorSeat.lobbyId, () => ({ type: 'lobby_state', lobby: priorLobbyState }));
          announceHostChange(priorSeat.lobbyId, priorHost, priorLobbyState);
        }
      }

      // Attempt seating with name check BEFORE connecting the socket to the lobby.
      // This ensures a rejected join never triggers a broadcast.
      const seatResult = await autoSeatPlayer(msg.lobbyId, st.userId, user.displayName);
      if (seatResult && 'error' in seatResult) {
        send(ws, { type: 'error', message: seatResult.error, code: seatResult.code });
        return;
      }

      // If player is rejoining their own reserved seat while sitting-out, re-activate them
      const lobbyAfterSeat = await getLobbyById(msg.lobbyId);
      const mySeat = lobbyAfterSeat?.seats.find((s) => s.userId === st.userId);
      if (mySeat?.sittingOut) {
        await setSittingOut(msg.lobbyId, st.userId, false);
      }

      // Seating succeeded — now wire up the socket
      if (st.lobbyId && st.lobbyId !== msg.lobbyId) {
        lobbyClients.get(st.lobbyId)?.delete(ws);
      }
      st.lobbyId = msg.lobbyId;
      st.isSpectator = false;
      if (!lobbyClients.has(msg.lobbyId)) lobbyClients.set(msg.lobbyId, new Set());
      lobbyClients.get(msg.lobbyId)!.add(ws);
      cancelEmptyLobbyTimer(msg.lobbyId);

      if (st.sessionId) {
        await updateSessionLobby(st.sessionId, msg.lobbyId);
      }

      // Init session stats for this player
      const freshSeat = (await getLobbyById(msg.lobbyId))?.seats.find((s) => s.userId === st.userId);
      if (freshSeat) {
        initSession(msg.lobbyId, st.userId, user.displayName, freshSeat.stack);
      }

      // Empty-table case: a host-less lobby gets its host from the first player to (re)join.
      const claimed = await claimHostIfVacant(msg.lobbyId, st.userId);

      const connected = getConnectedSet(msg.lobbyId);
      const lobbyState = await getLobbyById(msg.lobbyId, connected);
      if (lobbyState) {
        broadcastLobby(msg.lobbyId, () => ({ type: 'lobby_state', lobby: lobbyState }));
        if (claimed) announceHostChange(msg.lobbyId, null, lobbyState);
      }
      for (const m of getChatHistory(msg.lobbyId)) {
        send(ws, { type: 'chat', message: m });
      }
      // Send the right table state based on game type
      if (lobbyState?.settings.game === 'blackjack') {
        await sendBjStateToClient(ws, msg.lobbyId, st.userId, bjDeps());
      } else {
        await broadcastTableState(msg.lobbyId);
        // Recover any stuck hand lifecycle (orphaned game, lost intermission/grace timers).
        await recoverHandLifecycle(msg.lobbyId);
        // A new seated player may satisfy the active-player threshold.
        await tryStartWaitingHand(msg.lobbyId);
      }
      return;
    }

    case 'spectate': {
      if (!st.userId || !st.lobbyId) return;
      st.isSpectator = true;
      await broadcastTableState(st.lobbyId);
      return;
    }

    case 'chat': {
      if (!st.userId || !st.lobbyId) return;
      if (!canSendChat(st.userId)) return;
      const user = await getUserById(st.userId);
      const lobby = getMemoryLobby(st.lobbyId);
      const isHost = lobby?.hostUserId === st.userId;
      const chatMsg = addChatMessage(
        st.lobbyId,
        st.userId,
        user?.displayName ?? 'Player',
        msg.text,
        isHost
      );
      broadcastLobby(st.lobbyId, () => ({ type: 'chat', message: chatMsg }));
      return;
    }

    case 'sit': {
      if (!st.userId || !st.lobbyId) return;
      const sitUser = await getUserById(st.userId);
      let result: Awaited<ReturnType<typeof sitAtSeat>>;
      if (msg.seatIndex !== undefined) {
        result = await sitAtSeat(st.lobbyId, st.userId, msg.seatIndex, msg.buyIn, sitUser?.displayName);
      } else {
        const seated = await autoSeatPlayer(st.lobbyId, st.userId, sitUser?.displayName);
        result = seated ?? { error: 'No seats available' };
      }
      if ('error' in result) {
        send(ws, { type: 'error', message: result.error, code: result.code });
        return;
      }
      broadcastLobby(st.lobbyId, () => ({ type: 'lobby_state', lobby: result }));
      return;
    }

    case 'host_set_buy_in': {
      if (!st.userId || !st.lobbyId) return;
      const result = await setTableBuyIn(st.lobbyId, st.userId, msg.buyIn);
      if ('error' in result) {
        send(ws, { type: 'error', message: result.error });
        return;
      }
      broadcastLobby(st.lobbyId, () => ({ type: 'lobby_state', lobby: result }));
      return;
    }

    case 'host_start': {
      if (!st.userId || !st.lobbyId) return;
      const lobby = await getLobbyById(st.lobbyId);
      if (!lobby || lobby.hostUserId !== st.userId) {
        send(ws, { type: 'error', message: 'Only host can start' });
        return;
      }

      // Block if a hand is genuinely in progress (active betting round, runout, or bomb-pot opt-in).
      const existingGame = await getActiveGame(st.lobbyId);
      const isActiveHand =
        existingGame && (ACTIVE_STREETS as readonly string[]).includes(existingGame.street);
      if (isActiveHand || activeRunouts.has(st.lobbyId) || bombPotPending.has(st.lobbyId)) {
        send(ws, { type: 'error', message: 'Game already in progress' });
        return;
      }

      // Allow start when:
      //   (a) First hand: lobby is still 'open'
      //   (b) Recovery: lobby is 'playing' but no hand is running and no intermission is
      //       scheduled (e.g. server restarted and lost the intermission timer).
      const isFirstStart = lobby.status === 'open';
      const isRecoveryStart =
        lobby.status === 'playing' &&
        !intermissionTimers.has(st.lobbyId);

      if (!isFirstStart && !isRecoveryStart) {
        // Intermission is already ticking — no need to start manually.
        send(ws, { type: 'error', message: 'Next hand is already scheduled' });
        return;
      }

      // Cancel any stale intermission before starting (covers the recovery path).
      cancelIntermissionTimer(st.lobbyId);

      // If a Bomb Pot is queued, run the opt-in flow instead.
      if (lobby.settings.nextHandBombPot) {
        if (isFirstStart) await updateLobbyStatus(st.lobbyId, 'playing');
        await startBombPotOptIn(st.lobbyId, lobby.settings);
        const bpLobby = await getLobbyById(st.lobbyId);
        if (bpLobby) broadcastLobby(st.lobbyId, () => ({ type: 'lobby_state', lobby: bpLobby }));
        await broadcastTableState(st.lobbyId);
        return;
      }

      // ── Blackjack ────────────────────────────────────────────────────────
      if (lobby.settings.game === 'blackjack') {
        if (isFirstStart) await updateLobbyStatus(st.lobbyId, 'playing');
        const bjLobby = await getLobbyById(st.lobbyId);
        if (bjLobby) {
          broadcastLobby(st.lobbyId, () => ({ type: 'lobby_state', lobby: bjLobby }));
          await startBjBettingPhase(st.lobbyId, lobby.settings, bjLobby, bjDeps(), false);
        }
        return;
      }
      // ── Poker ────────────────────────────────────────────────────────────
      const result = await startHand(st.lobbyId, lobby.settings);
      if ('error' in result) {
        send(ws, { type: 'error', message: result.error });
        return;
      }
      await applyBlindHandFlags(st.lobbyId, result);
      recordHandStart(st.lobbyId, result);
      if (isFirstStart) await updateLobbyStatus(st.lobbyId, 'playing');
      scheduleActionTimer(st.lobbyId, lobby.settings, result);
      const startedLobby = await getLobbyById(st.lobbyId);
      if (startedLobby) broadcastLobby(st.lobbyId, () => ({ type: 'lobby_state', lobby: startedLobby }));
      await broadcastTableState(st.lobbyId);
      return;
    }

    case 'host_pause': {
      if (!st.userId || !st.lobbyId) return;
      const lobby = await getLobbyById(st.lobbyId);
      if (!lobby || lobby.hostUserId !== st.userId) return;

      if (msg.paused) {
        // --- PAUSE: freeze all timers, recording exact remaining durations ---

        // Snapshot action timer remaining before cancelling (cancel clears the deadline)
        const actionDeadlineSnap = getActionDeadline(st.lobbyId);
        if (actionDeadlineSnap) {
          actionTimerPausedRemainingMs.set(
            st.lobbyId,
            Math.max(0, new Date(actionDeadlineSnap).getTime() - Date.now())
          );
        } else {
          actionTimerPausedRemainingMs.delete(st.lobbyId);
        }
        cancelActionTimer(st.lobbyId);

        // Snapshot intermission remaining before cancelling
        const intermDeadlineSnap = getIntermissionDeadline(st.lobbyId);
        if (intermDeadlineSnap) {
          intermissionPausedRemainingMs.set(
            st.lobbyId,
            Math.max(0, new Date(intermDeadlineSnap).getTime() - Date.now())
          );
        } else {
          intermissionPausedRemainingMs.delete(st.lobbyId);
        }
        cancelIntermissionTimer(st.lobbyId);

        await updateLobbyStatus(st.lobbyId, 'paused');
      } else {
        // --- RESUME: restart all timers from their frozen remaining durations ---
        await updateLobbyStatus(st.lobbyId, 'playing');
        const resumedLobby = await getLobbyById(st.lobbyId);
        if (!resumedLobby) return;

        const intermRemaining = intermissionPausedRemainingMs.get(st.lobbyId);
        if (intermRemaining !== undefined) {
          // Intermission was frozen — resume from remaining duration
          intermissionPausedRemainingMs.delete(st.lobbyId);
          actionTimerPausedRemainingMs.delete(st.lobbyId);
          scheduleIntermission(st.lobbyId, resumedLobby.settings, Math.max(0, intermRemaining));
        } else {
          // Action timer may have been frozen — resume from remaining duration (or full if unknown)
          const actionRemaining = actionTimerPausedRemainingMs.get(st.lobbyId);
          actionTimerPausedRemainingMs.delete(st.lobbyId);

          const resumeLobbyId = st.lobbyId;
          const state = await getActiveGame(resumeLobbyId);
          if (
            state &&
            state.actionSeatIndex !== null &&
            state.street !== 'complete' &&
            state.street !== 'waiting'
          ) {
            const seat = state.seats.find((s) => s.seatIndex === state.actionSeatIndex);
            if (seat && !seat.folded && !seat.allIn && (resumedLobby.settings.actionTimerSec ?? 0) > 0) {
              // Use frozen remaining, or fall back to the full configured duration
              const durationMs =
                actionRemaining !== undefined
                  ? Math.max(0, actionRemaining)
                  : resumedLobby.settings.actionTimerSec! * 1000;

              cancelActionTimer(resumeLobbyId); // increments generation
              const gen = actionTimerGenerations.get(resumeLobbyId) ?? 0;
              const deadline = new Date(Date.now() + durationMs).toISOString();
              setActionDeadline(resumeLobbyId, deadline);
              const { userId: seatUserId, seatIndex } = seat;
              actionTimers.set(
                resumeLobbyId,
                setTimeout(() => {
                  if ((actionTimerGenerations.get(resumeLobbyId) ?? 0) !== gen) return;
                  onActionTimerExpired(resumeLobbyId, seatUserId, seatIndex, resumedLobby.settings).catch(() => {});
                }, durationMs)
              );
            }
          }
        }

        // Recovery: if the game finished while paused (e.g., runout completed), start intermission.
        if (
          !intermissionTimers.has(st.lobbyId) &&
          !activeRunouts.has(st.lobbyId) &&
          resumedLobby.status === 'playing'
        ) {
          const resumeCheckGame = await getActiveGame(st.lobbyId);
          if (resumeCheckGame?.street === 'complete') {
            scheduleIntermission(st.lobbyId, resumedLobby.settings, 5000);
          }
        }
      }

      // If the table was blocked waiting for players, try to start now that we're resumed.
      await tryStartWaitingHand(st.lobbyId);

      const updated = await getLobbyById(st.lobbyId);
      if (updated) broadcastLobby(st.lobbyId, () => ({ type: 'lobby_state', lobby: updated }));
      await broadcastTableState(st.lobbyId);
      return;
    }

    case 'host_kick': {
      if (!st.userId || !st.lobbyId) return;
      const lobby = await getLobbyById(st.lobbyId);
      if (!lobby || lobby.hostUserId !== st.userId) return;
      // Cancel any seat release timer for the kicked player
      const kickedSeat = lobby.seats.find((s) => s.seatIndex === msg.seatIndex);
      if (kickedSeat?.userId) {
        const kickReleaseTimer = seatReleaseTimers.get(kickedSeat.userId);
        if (kickReleaseTimer) {
          clearTimeout(kickReleaseTimer);
          seatReleaseTimers.delete(kickedSeat.userId);
        }
        await deleteSessionsByUserId(kickedSeat.userId);
      }
      const prevHost = lobby.hostUserId;
      const updated = await kickSeat(st.lobbyId, msg.seatIndex);
      if (updated) {
        broadcastLobby(st.lobbyId, () => ({ type: 'lobby_state', lobby: updated }));
        announceHostChange(st.lobbyId, prevHost, updated);
      }
      return;
    }

    case 'host_transfer': {
      if (!st.userId || !st.lobbyId) return;
      const prevHost = (await getLobbyById(st.lobbyId))?.hostUserId ?? null;
      const result = await transferHost(st.lobbyId, st.userId, msg.seatIndex);
      if ('error' in result) {
        send(ws, { type: 'error', message: result.error });
        return;
      }
      const connected = getConnectedSet(st.lobbyId);
      const withConnected = await getLobbyById(st.lobbyId, connected);
      if (withConnected) {
        broadcastLobby(st.lobbyId, () => ({ type: 'lobby_state', lobby: withConnected }));
        announceHostChange(st.lobbyId, prevHost, withConnected);
      }
      return;
    }

    case 'host_move_player': {
      if (!st.userId || !st.lobbyId) return;
      const lobby = await getLobbyById(st.lobbyId);
      if (!lobby || lobby.hostUserId !== st.userId) return;
      const game = await getActiveGame(st.lobbyId);
      if (game && game.street !== 'waiting' && game.street !== 'complete') {
        send(ws, { type: 'error', message: 'Cannot move players during a hand' });
        return;
      }
      const result = await swapSeats(st.lobbyId, msg.fromSeatIndex, msg.toSeatIndex);
      if ('error' in result) {
        send(ws, { type: 'error', message: result.error });
        return;
      }
      const connected = getConnectedSet(st.lobbyId);
      const withConnected = await getLobbyById(st.lobbyId, connected);
      if (withConnected) broadcastLobby(st.lobbyId, () => ({ type: 'lobby_state', lobby: withConnected }));
      return;
    }

    case 'host_approve_rebuy': {
      if (!st.userId || !st.lobbyId) return;
      const lobby = await getLobbyById(st.lobbyId);
      if (!lobby || lobby.hostUserId !== st.userId) return;
      const updated = await approveRebuy(st.lobbyId, msg.seatIndex, msg.amount);
      if (updated) broadcastLobby(st.lobbyId, () => ({ type: 'lobby_state', lobby: updated }));
      return;
    }

    case 'game_action': {
      if (!st.userId || !st.lobbyId) return;
      // Cancel timer BEFORE any await — prevents race with the auto-action callback.
      cancelActionTimer(st.lobbyId);
      const lobby = await getLobbyById(st.lobbyId);
      if (!lobby) return;
      // Snapshot the street BEFORE the action so PFR tracking knows which street this was.
      const preActionState = await getActiveGame(st.lobbyId);
      const preActionStreet = preActionState?.street;
      const preBoardCount = preActionState?.board.length ?? 0;
      const result = await processGameAction(
        st.lobbyId,
        lobby.settings,
        st.userId,
        msg.actionId,
        msg.action,
        msg.amount
      );
      if ('error' in result) {
        send(ws, { type: 'error', message: result.error });
        // Action was illegal; reload state so we restart the timer for the same player.
        const current = await getActiveGame(st.lobbyId);
        if (current) scheduleActionTimer(st.lobbyId, lobby.settings, current);
        return;
      }
      recordAction(st.lobbyId, st.userId, msg.action, preActionStreet);

      if (result.state.pendingMultiRunout) {
        await startRunItOutPrompt(st.lobbyId, result.state, lobby.settings);
      } else if (result.state.street === 'complete') {
        if (isAllInRunoutTrigger(result.state, preBoardCount)) {
          await startAllInRunout(st.lobbyId, result.state, lobby.settings, preBoardCount);
        } else {
          await handleHandComplete(st.lobbyId, result.state, lobby.settings);
        }
      } else {
        scheduleActionTimer(st.lobbyId, lobby.settings, result.state);
        await broadcastTableState(st.lobbyId);
      }
      return;
    }

    case 'run_it_out_choice': {
      if (!st.userId || !st.lobbyId) return;
      const pending = runItOutPending.get(st.lobbyId);
      if (!pending) return;
      // Only the designated chooser may respond
      const game = await getActiveGame(st.lobbyId);
      const seat = game?.seats.find((s) => s.userId === st.userId);
      if (!seat || seat.seatIndex !== pending.chooserSeatIndex) return;
      const lobby = await getLobbyById(st.lobbyId);
      if (!lobby) return;
      const maxRuns = lobby.settings.runItOut ?? 1;
      const times = Math.min(Math.max(1, Math.round(msg.times)), maxRuns);
      await resolveRunItOut(st.lobbyId, times);
      return;
    }

    case 'host_set_run_it_out': {
      if (!st.userId || !st.lobbyId) return;
      const result = await setRunItOut(st.lobbyId, st.userId, msg.times);
      if ('error' in result) {
        send(ws, { type: 'error', message: result.error });
        return;
      }
      broadcastLobby(st.lobbyId, () => ({ type: 'lobby_state', lobby: result }));
      return;
    }

    case 'host_set_action_timer': {
      if (!st.userId || !st.lobbyId) return;
      const result = await setActionTimerSetting(st.lobbyId, st.userId, msg.seconds);
      if ('error' in result) {
        send(ws, { type: 'error', message: result.error });
        return;
      }
      // Reschedule with new duration (or cancel if seconds === 0).
      const state = await getActiveGame(st.lobbyId);
      if (state) {
        scheduleActionTimer(st.lobbyId, result.settings, state);
      } else {
        cancelActionTimer(st.lobbyId);
      }
      broadcastLobby(st.lobbyId, () => ({ type: 'lobby_state', lobby: result }));
      await broadcastTableState(st.lobbyId);
      return;
    }

    case 'host_set_flip_ante': {
      if (!st.userId || !st.lobbyId) return;
      const currentGame = await getActiveGame(st.lobbyId);
      if (currentGame && currentGame.street !== 'complete') {
        send(ws, { type: 'error', message: 'Cannot change ante while a hand is in progress' });
        return;
      }
      const result = await setFlipAnte(st.lobbyId, st.userId, msg.ante);
      if ('error' in result) {
        send(ws, { type: 'error', message: result.error });
        return;
      }
      broadcastLobby(st.lobbyId, () => ({ type: 'lobby_state', lobby: result }));
      return;
    }

    case 'host_set_bomb_pot': {
      if (!st.userId || !st.lobbyId) return;
      const value = msg.enabled ? { amount: msg.amount ?? 0, doubleBoard: !!msg.doubleBoard } : null;
      const result = await setNextHandBombPot(st.lobbyId, st.userId, value);
      if ('error' in result) {
        send(ws, { type: 'error', message: result.error });
        return;
      }
      broadcastLobby(st.lobbyId, () => ({ type: 'lobby_state', lobby: result }));
      return;
    }

    case 'bomb_pot_join': {
      if (!st.userId || !st.lobbyId) return;
      const pending = bombPotPending.get(st.lobbyId);
      if (!pending) return;
      if (msg.join) pending.joined.add(st.userId);
      else pending.joined.delete(st.userId);
      return;
    }

    case 'rebuy': {
      if (!st.userId || !st.lobbyId) return;
      const userId = st.userId;
      const lobbyId = st.lobbyId;

      const lobby = await getLobbyById(lobbyId);
      if (!lobby) return;

      // Verify the player is still seated
      const lobbySeat = lobby.seats.find((s) => s.userId === userId);
      if (!lobbySeat) { send(ws, { type: 'error', message: 'Not seated' }); return; }

      // Check game engine stack (authoritative; lobby lags in Postgres mode)
      const game = await getActiveGame(lobbyId);
      const gameSeat = game?.seats.find((s) => s.userId === userId);
      const currentStack = gameSeat?.stack ?? lobbySeat.stack;

      if (currentStack > 0) {
        send(ws, { type: 'error', message: 'You still have chips', code: 'REBUY_NOT_NEEDED' });
        return;
      }

      const buyIn = getTableBuyIn(lobby.settings);

      // If a hand is in progress, queue the rebuy for after the hand completes
      if (game && game.street !== 'complete' && game.street !== 'waiting') {
        pendingRebuys.set(userId, { lobbyId, amount: buyIn });
        send(ws, { type: 'rebuy_queued' });
        return;
      }

      await rebuyPlayer(lobbyId, userId, buyIn);
      await updateSeatStackAfterRebuy(lobbyId, userId, buyIn);
      await setSitOutNextHand(lobbyId, userId, false);
      await setSittingOut(lobbyId, userId, false);
      await setWaitingForReentryBlind(lobbyId, userId, true);
      recordRebuy(lobbyId, userId, buyIn);

      send(ws, { type: 'rebuy_confirmed', newStack: buyIn });
      const connected = getConnectedSet(lobbyId);
      const updatedLobby = await getLobbyById(lobbyId, connected);
      if (updatedLobby) broadcastLobby(lobbyId, () => ({ type: 'lobby_state', lobby: updatedLobby }));
      await broadcastTableState(lobbyId);
      await tryStartWaitingHand(lobbyId);
      return;
    }

    case 'donate_chips': {
      if (!st.userId || !st.lobbyId) return;
      const userId = st.userId;
      const lobbyId = st.lobbyId;
      const { recipientSeatIndex, amount, donationId } = msg;

      // Duplicate-send guard (reconnect retry with same donationId)
      if (processedDonationIds.has(donationId)) return;

      if (!Number.isInteger(amount) || amount <= 0) {
        send(ws, { type: 'error', message: 'Donation amount must be a positive integer' });
        return;
      }

      const lobby = await getLobbyById(lobbyId);
      if (!lobby) return;

      const donorSeat = lobby.seats.find((s) => s.userId === userId);
      if (!donorSeat) { send(ws, { type: 'error', message: 'You are not seated' }); return; }

      const recipientSeat = lobby.seats.find((s) => s.seatIndex === recipientSeatIndex);
      if (!recipientSeat?.userId) {
        send(ws, { type: 'error', message: 'No player in that seat' });
        return;
      }

      if (recipientSeat.userId === userId) {
        send(ws, { type: 'error', message: 'Cannot donate chips to yourself' });
        return;
      }

      // Use engine stack as the authoritative chip count (lobby may lag in Postgres mode)
      const game = await getActiveGame(lobbyId);
      const donorGameSeat = game?.seats.find((s) => s.userId === userId);
      const effectiveDonorStack = donorGameSeat?.stack ?? donorSeat.stack;

      if (effectiveDonorStack < amount) {
        send(ws, { type: 'error', message: 'Insufficient chips' });
        return;
      }

      // Mark processed before the async updates to prevent races on fast duplicate sends
      trackDonationId(donationId);

      // Update lobby seat stacks (both paths: memory and Postgres)
      await donateChips(lobbyId, userId, recipientSeat.userId, amount);

      // Update live engine state so the next broadcast shows correct stacks immediately
      await transferChipsBetweenSeats(lobbyId, userId, recipientSeat.userId, amount);

      // If recipient had a rebuy queued (was at 0 chips), cancel it — donated chips restore them
      pendingRebuys.delete(recipientSeat.userId);

      const donorDisplayName = donorSeat.displayName ?? 'Player';
      const recipientDisplayName = recipientSeat.displayName ?? 'Player';

      // Notify recipient (dismisses rebuy screen if showing)
      const recipientWs = connectedUserSockets.get(recipientSeat.userId);
      if (recipientWs) {
        send(recipientWs, { type: 'donation_received', donorDisplayName, amount });
      }

      // Confirm to donor
      send(ws, { type: 'donation_confirmed', recipientDisplayName, amount });

      // Broadcast updated state to all clients
      const connected = getConnectedSet(lobbyId);
      const updatedLobby = await getLobbyById(lobbyId, connected);
      if (updatedLobby) broadcastLobby(lobbyId, () => ({ type: 'lobby_state', lobby: updatedLobby }));
      await broadcastTableState(lobbyId);

      // Recipient now has chips — they may unblock a hand waiting for players
      await tryStartWaitingHand(lobbyId);
      return;
    }

    case 'show_cards': {
      if (!st.userId || !st.lobbyId) return;
      const lobbyId = st.lobbyId;
      const pending = showCardsPending.get(lobbyId);
      if (!pending || pending.winnerId !== st.userId) return;
      showCardsPending.delete(lobbyId);
      await finalizeFoldWin(lobbyId, msg.show, pending, pending.config);
      return;
    }

    case 'rabbit_hunt': {
      if (!st.lobbyId) return;
      const rabbitCards = rabbitHuntPending.get(st.lobbyId);
      if (!rabbitCards) return;
      broadcastLobby(st.lobbyId, () => ({ type: 'rabbit_hunt_result', cards: rabbitCards }));
      return;
    }

    case 'cash_out': {
      if (!st.userId || !st.lobbyId) return;
      const userId = st.userId;
      const lobbyId = st.lobbyId;

      if (cashOutInProgress.has(userId)) return;

      const game = await getActiveGame(lobbyId);
      if (game && game.street !== 'waiting' && game.street !== 'complete') {
        // Defer until hand ends regardless of whose turn it is
        pendingCashOuts.set(userId, { lobbyId, sessionId: st.sessionId });
        send(ws, { type: 'cash_out_queued' });
        return;
      }

      // No active hand (or hand already complete) — process immediately
      await processCashOut(ws, st);
      return;
    }

    case 'cash_out_confirm': {
      if (!st.userId || !st.lobbyId) return;
      const userId = st.userId;
      const confirm = pendingCashOutConfirms.get(userId);
      if (!confirm) return;
      clearTimeout(confirm.confirmTimer);
      pendingCashOutConfirms.delete(userId);
      await processCashOut(ws, st);
      return;
    }

    case 'cash_out_cancel': {
      if (!st.userId) return;
      const userId = st.userId;
      // Cancel confirmation timer if the hand already ended and prompt was sent
      const confirm = pendingCashOutConfirms.get(userId);
      if (confirm) {
        clearTimeout(confirm.confirmTimer);
        pendingCashOutConfirms.delete(userId);
      }
      if (pendingCashOuts.has(userId)) {
        pendingCashOuts.delete(userId);
        send(ws, { type: 'cash_out_cancelled' });
      }
      return;
    }

    case 'sit_out_next_hand': {
      if (!st.userId || !st.lobbyId) return;
      const result = await setSitOutNextHand(st.lobbyId, st.userId, msg.enabled);
      if (result) {
        const connected = getConnectedSet(st.lobbyId);
        const withConnected = await getLobbyById(st.lobbyId, connected);
        if (withConnected) broadcastLobby(st.lobbyId, () => ({ type: 'lobby_state', lobby: withConnected }));
      }
      // Player returned to active — check if we can now start the blocked hand.
      if (!msg.enabled) {
        await tryStartWaitingHand(st.lobbyId);
      }
      return;
    }

    case 'set_blind_hand': {
      if (!st.userId || !st.lobbyId) return;
      const blindResult = await setNextHandBlind(st.lobbyId, st.userId, msg.enabled);
      if (blindResult) {
        const connected = getConnectedSet(st.lobbyId);
        const withConnected = await getLobbyById(st.lobbyId, connected);
        if (withConnected) broadcastLobby(st.lobbyId, () => ({ type: 'lobby_state', lobby: withConnected }));
      }
      return;
    }

    case 'reveal_blind_cards': {
      if (!st.userId || !st.lobbyId) return;
      const game = await getActiveGame(st.lobbyId);
      if (!game) return;
      const seat = game.seats.find((s) => s.userId === st.userId);
      if (!seat) return;
      removeBlindHandSeat(st.lobbyId, seat.seatIndex);
      await broadcastTableState(st.lobbyId);
      return;
    }

    case 'bj_place_bet':
    case 'bj_clear_bet':
    case 'bj_hit':
    case 'bj_stand':
    case 'bj_double_down':
    case 'bj_split': {
      if (!st.userId || !st.lobbyId) return;
      const bjLobby = await getLobbyById(st.lobbyId);
      if (!bjLobby) return;
      await handleBjMessage(ws, msg, st.userId, st.lobbyId, bjLobby.settings, bjDeps());
      return;
    }

    default:
      send(ws, { type: 'error', message: 'Unknown message type' });
  }
}
