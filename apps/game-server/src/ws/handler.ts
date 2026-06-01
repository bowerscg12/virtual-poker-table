import type { WebSocket } from 'ws';
import type { Card, ClientMessage, ServerMessage, VariantConfig } from '@vct/shared-types';
import { getTableBuyIn } from '@vct/shared-types';
import type { GameTableState } from '@vct/poker-engine';
import { getUserById } from '../services/auth.js';
import {
  approveRebuy,
  autoSeatPlayer,
  getActiveSeatForUser,
  getLobbyById,
  kickSeat,
  rebuyPlayer,
  removeSeat,
  setActionTimerSetting,
  setFlipAnte,
  setTableBuyIn,
  setSittingOut,
  sitAtSeat,
  updateLobbyStatus,
} from '../services/lobby.js';
import {
  clearActionDeadline,
  clearGame,
  clearIntermissionDeadline,
  getActiveGame,
  getActionDeadline,
  getAutoAction,
  getHandHistories,
  getIntermissionDeadline,
  processGameAction,
  setActionDeadline,
  setIntermissionDeadline,
  setSeatShownCards,
  startHand,
  toPublicState,
  updateLastHandHistoryFoldWin,
  updateSeatStackAfterRebuy,
} from '../services/game-manager.js';
import { addChatMessage, canSendChat, getChatHistory } from '../services/chat.js';
import { getMemoryLobby } from '../services/lobby.js';
import { redisDel, keys } from '../store/redis.js';
import {
  createSession,
  deleteSession,
  deleteSessionsByUserId,
  getSession,
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

/** lobbyId → timer that fires after 1 hour of no connected clients */
const emptyLobbyTimers = new Map<string, ReturnType<typeof setTimeout>>();

const EMPTY_LOBBY_CLOSE_MS = 60 * 60 * 1000;

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

  await updateLobbyStatus(lobbyId, 'closed');
  clearGame(lobbyId);
  await redisDel(keys.tableState(lobbyId));
  lobbyClients.delete(lobbyId);

  console.log(`[lobby] Auto-closed empty lobby ${lobbyId} after 1 hour of inactivity`);
}

/** userId set to prevent duplicate cash-out processing */
const cashOutInProgress = new Set<string>();

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

async function broadcastTableState(lobbyId: string): Promise<void> {
  const game = await getActiveGame(lobbyId);
  const connected = getConnectedSet(lobbyId);
  const lobby = await getLobbyById(lobbyId, connected);
  if (!lobby) return;

  const deadline = getActionDeadline(lobbyId);
  const intermDeadline = getIntermissionDeadline(lobbyId);
  const paused = lobby.status === 'paused';

  broadcastLobby(lobbyId, (userId, isSpectator) => {
    if (!game) {
      return { type: 'lobby_state', lobby };
    }
    const { public: pub, private: priv } = toPublicState(
      lobbyId, game, userId, isSpectator, lobby.settings, deadline, paused, intermDeadline
    );
    return { type: 'table_state', public: pub, private: priv };
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

/** Start (or restart) the action timer for the current action seat in state. No-op if timer is disabled. */
function scheduleActionTimer(lobbyId: string, config: VariantConfig, state: GameTableState): void {
  cancelActionTimer(lobbyId); // always cancel first; increments generation

  const timerSec = config.actionTimerSec;
  if (!timerSec || timerSec <= 0) return;
  if (state.actionSeatIndex === null) return;
  if (state.street === 'complete' || state.street === 'waiting' || state.street === 'reveal') return;

  const seat = state.seats.find((s) => s.seatIndex === state.actionSeatIndex);
  if (!seat || seat.folded || seat.allIn) return;

  const deadline = new Date(Date.now() + timerSec * 1000).toISOString();
  setActionDeadline(lobbyId, deadline);

  const { userId, seatIndex } = seat;
  const gen = actionTimerGenerations.get(lobbyId) ?? 0;

  const timer = setTimeout(() => {
    if ((actionTimerGenerations.get(lobbyId) ?? 0) !== gen) return;
    onActionTimerExpired(lobbyId, userId, seatIndex, config).catch(() => {});
  }, timerSec * 1000);

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

const INTERMISSION_MS = 10_000;

/** Schedule the next hand to start after delayMs (default 10 s). */
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
async function onIntermissionExpired(lobbyId: string, config: VariantConfig): Promise<void> {
  intermissionTimers.delete(lobbyId);
  clearIntermissionDeadline(lobbyId);

  const lobby = await getLobbyById(lobbyId);
  if (!lobby || lobby.status !== 'playing') return;

  // Guard: bail if a hand is already in progress (e.g. duplicate callback race)
  const existing = await getActiveGame(lobbyId);
  const activeStreets = ['preflop', 'flop', 'turn', 'river', 'showdown', 'reveal'] as const;
  if (existing && (activeStreets as readonly string[]).includes(existing.street)) return;

  const result = await startHand(lobbyId, config);
  if ('error' in result) {
    console.warn(`[intermission] Cannot start next hand for ${lobbyId}: ${result.error}`);
    return;
  }

  recordHandStart(lobbyId, result);
  scheduleActionTimer(lobbyId, config, result);
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

  const action = getAutoAction(state, config, seatIndex);
  const preActionStreet = state.street;
  const result = await processGameAction(lobbyId, config, userId, crypto.randomUUID(), action);
  if ('error' in result) return;

  recordAction(lobbyId, userId, action, preActionStreet);

  if (result.state.street === 'complete') {
    await handleHandComplete(lobbyId, result.state, config);
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

          if (result.state.street === 'complete') {
            await handleHandComplete(lobbyId, result.state, lobby.settings);
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

  await deleteSession(sessionId);
  await removeSeat(lobbyId, userId);

  const connected = getConnectedSet(lobbyId);
  const updatedLobby = await getLobbyById(lobbyId, connected);
  if (updatedLobby) {
    broadcastLobby(lobbyId, () => ({ type: 'lobby_state', lobby: updatedLobby }));
  }
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
    }
  } finally {
    cashOutInProgress.delete(userId);
    pendingCashOuts.delete(userId);
  }
}

/**
 * Process all deferred cash-out requests for a lobby after a hand completes.
 * Connected players get the full summary; disconnected players are removed silently.
 */
async function processPendingCashOuts(lobbyId: string): Promise<void> {
  const toProcess: string[] = [];
  for (const [userId, pending] of pendingCashOuts) {
    if (pending.lobbyId === lobbyId) toProcess.push(userId);
  }
  if (toProcess.length === 0) return;

  for (const userId of toProcess) {
    const ws = connectedUserSockets.get(userId);
    const st = ws ? clients.get(ws) : null;

    if (ws && st && st.lobbyId === lobbyId) {
      await processCashOut(ws, st);
    } else {
      // Player disconnected — remove them silently
      if (cashOutInProgress.has(userId)) continue;
      cashOutInProgress.add(userId);
      try {
        const pending = pendingCashOuts.get(userId);
        const lobby = await getLobbyById(lobbyId);
        const seat = lobby?.seats.find((s) => s.userId === userId);
        if (seat) {
          finalizeCashOut(lobbyId, userId, seat.stack);
          await removeSeat(lobbyId, userId);
        }
        if (pending?.sessionId) await deleteSession(pending.sessionId);
        pendingCashOuts.delete(userId);
      } finally {
        cashOutInProgress.delete(userId);
      }
    }
  }

  // One final broadcast to reflect all seat removals
  const connected = getConnectedSet(lobbyId);
  const updatedLobby = await getLobbyById(lobbyId, connected);
  if (updatedLobby) {
    broadcastLobby(lobbyId, () => ({ type: 'lobby_state', lobby: updatedLobby }));
  }
}

/**
 * After a hand completes, send rebuy_available to any player who is still seated
 * but has 0 chips (busted). Players who already requested a cash-out will have been
 * processed by processPendingCashOuts and removed from the lobby before this runs.
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
  recordHandEnd(lobbyId, state, config);
  await processPendingCashOuts(lobbyId);

  if (state.winnerPayouts.length > 0) {
    const payouts = state.winnerPayouts;
    broadcastLobby(lobbyId, () => ({ type: 'hand_complete', winners: payouts }));
  }

  await broadcastTableState(lobbyId);
  await processPendingRebuys(lobbyId);
  await notifyBustedPlayers(lobbyId);

  if (isFoldWin(state)) {
    await promptShowCards(lobbyId, state, config);
  } else {
    const histories = getHandHistories(lobbyId);
    const last = histories[histories.length - 1];
    if (last) broadcastLobby(lobbyId, () => ({ type: 'hand_history', entry: last }));
    const updatedLobby = await getLobbyById(lobbyId);
    if (updatedLobby?.status === 'playing') {
      scheduleIntermission(lobbyId, config);
    }
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

      if (session.lobbyId) {
        for (const m of getChatHistory(session.lobbyId)) {
          send(ws, { type: 'chat', message: m });
        }
        await broadcastTableState(session.lobbyId);

        // If the player reconnects with 0 chips, show them the rebuy prompt
        if (!pendingCashOuts.has(session.userId)) {
          const reconnGame = await getActiveGame(session.lobbyId);
          const reconnGameSeat = reconnGame?.seats.find((s) => s.userId === session.userId);
          if (reconnGameSeat && reconnGameSeat.stack === 0) {
            const reconnLobby2 = await getLobbyById(session.lobbyId);
            if (reconnLobby2) {
              send(ws, { type: 'rebuy_available', amount: getTableBuyIn(reconnLobby2.settings) });
            }
          }
        }

        // Re-send the show-cards prompt if the winner reconnects during the decision window
        const reconnPending = showCardsPending.get(session.lobbyId);
        if (reconnPending && reconnPending.winnerId === session.userId) {
          send(ws, { type: 'show_cards_prompt', deadline: reconnPending.deadline });
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
        await removeSeat(priorSeat.lobbyId, st.userId);
        await deleteSessionsByUserId(st.userId);
        const priorConnected = getConnectedSet(priorSeat.lobbyId);
        const priorLobbyState = await getLobbyById(priorSeat.lobbyId, priorConnected);
        if (priorLobbyState) {
          broadcastLobby(priorSeat.lobbyId, () => ({ type: 'lobby_state', lobby: priorLobbyState }));
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

      const connected = getConnectedSet(msg.lobbyId);
      const lobbyState = await getLobbyById(msg.lobbyId, connected);
      if (lobbyState) {
        broadcastLobby(msg.lobbyId, () => ({ type: 'lobby_state', lobby: lobbyState }));
      }
      for (const m of getChatHistory(msg.lobbyId)) {
        send(ws, { type: 'chat', message: m });
      }
      await broadcastTableState(msg.lobbyId);
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
      // Only allow manual start before the first hand; auto-progression handles all subsequent hands.
      if (lobby.status !== 'open') {
        send(ws, { type: 'error', message: 'Game already in progress' });
        return;
      }
      const result = await startHand(st.lobbyId, lobby.settings);
      if ('error' in result) {
        send(ws, { type: 'error', message: result.error });
        return;
      }
      recordHandStart(st.lobbyId, result);
      await updateLobbyStatus(st.lobbyId, 'playing');
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
      }

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
      const updated = await kickSeat(st.lobbyId, msg.seatIndex);
      if (updated) broadcastLobby(st.lobbyId, () => ({ type: 'lobby_state', lobby: updated }));
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

      if (result.state.street === 'complete') {
        await handleHandComplete(st.lobbyId, result.state, lobby.settings);
      } else {
        scheduleActionTimer(st.lobbyId, lobby.settings, result.state);
        await broadcastTableState(st.lobbyId);
      }
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
      recordRebuy(lobbyId, userId, buyIn);

      send(ws, { type: 'rebuy_confirmed', newStack: buyIn });
      await broadcastTableState(lobbyId);
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

    case 'cash_out': {
      if (!st.userId || !st.lobbyId) return;
      const userId = st.userId;
      const lobbyId = st.lobbyId;

      if (cashOutInProgress.has(userId)) return;

      const game = await getActiveGame(lobbyId);
      if (game && game.street !== 'waiting' && game.street !== 'complete') {
        const seat = game.seats.find((s) => s.userId === userId);
        // Block if it's the player's turn and they still have actions to take
        if (seat && game.actionSeatIndex === seat.seatIndex && !seat.allIn && !seat.folded) {
          send(ws, {
            type: 'error',
            message: 'You must act before cashing out.',
            code: 'CASH_OUT_NOT_ALLOWED',
          });
          return;
        }
        // Defer until hand ends
        pendingCashOuts.set(userId, { lobbyId, sessionId: st.sessionId });
        send(ws, { type: 'cash_out_queued' });
        return;
      }

      // No active hand (or hand already complete) — process immediately
      await processCashOut(ws, st);
      return;
    }

    case 'cash_out_cancel': {
      if (!st.userId) return;
      if (pendingCashOuts.has(st.userId)) {
        pendingCashOuts.delete(st.userId);
        send(ws, { type: 'cash_out_cancelled' });
      }
      return;
    }

    default:
      send(ws, { type: 'error', message: 'Unknown message type' });
  }
}
