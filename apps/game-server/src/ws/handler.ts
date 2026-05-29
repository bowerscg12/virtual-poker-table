import type { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, VariantConfig } from '@vct/shared-types';
import type { GameTableState } from '@vct/poker-engine';
import { getUserById } from '../services/auth.js';
import {
  approveRebuy,
  autoSeatPlayer,
  getLobbyById,
  kickSeat,
  removeSeat,
  setActionTimerSetting,
  setTableBuyIn,
  setSittingOut,
  sitAtSeat,
  updateLobbyStatus,
} from '../services/lobby.js';
import {
  clearActionDeadline,
  clearIntermissionDeadline,
  getActiveGame,
  getActionDeadline,
  getAutoAction,
  getHandHistories,
  getIntermissionDeadline,
  processGameAction,
  setActionDeadline,
  setIntermissionDeadline,
  startHand,
  toPublicState,
} from '../services/game-manager.js';
import { addChatMessage, canSendChat, getChatHistory } from '../services/chat.js';
import { getMemoryLobby } from '../services/lobby.js';
import {
  createSession,
  deleteSession,
  getSession,
  markSessionConnected,
  markSessionDisconnected,
  updateSessionLobby,
  GRACE_PERIOD_MS,
} from '../services/session.js';
import {
  finalizeCashOut,
  initSession,
  recordAction,
  recordHandEnd,
  recordHandStart,
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

/** sessionId → grace-period expiry timer */
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
      game, userId, isSpectator, lobby.settings, deadline, paused, intermDeadline
    );
    pub.lobbyId = lobbyId;
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
  if (state.street === 'complete' || state.street === 'waiting') return;

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
  if (existing && existing.street !== 'complete' && existing.street !== 'waiting') return;

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
  const result = await processGameAction(lobbyId, config, userId, crypto.randomUUID(), action);
  if ('error' in result) return;

  recordAction(lobbyId, userId, action);

  if (result.state.street === 'complete') {
    recordHandEnd(lobbyId, result.state, config);
    await processPendingCashOuts(lobbyId);
    const histories = getHandHistories(lobbyId);
    const last = histories[histories.length - 1];
    if (last) broadcastLobby(lobbyId, () => ({ type: 'hand_history', entry: last }));
    if (result.state.winnerPayouts.length > 0) {
      const payouts = result.state.winnerPayouts;
      broadcastLobby(lobbyId, () => ({ type: 'hand_complete', winners: payouts }));
    }
    const updatedLobby = await getLobbyById(lobbyId);
    if (updatedLobby?.status === 'playing') {
      scheduleIntermission(lobbyId, config);
    }
  } else {
    scheduleActionTimer(lobbyId, config, result.state);
  }

  await broadcastTableState(lobbyId);
}

/** Called when a player's grace period expires without reconnection. */
async function onGracePeriodExpired(sessionId: string, userId: string, lobbyId: string): Promise<void> {
  disconnectTimers.delete(sessionId);

  // Re-fetch to confirm player has not reconnected (reconnect sets disconnectedAt = null)
  const session = await getSession(sessionId);
  if (!session || !session.disconnectedAt) return;

  await deleteSession(sessionId);

  const updatedLobby = await setSittingOut(lobbyId, userId, true);
  if (updatedLobby) {
    const connected = getConnectedSet(lobbyId);
    const withConnected = await getLobbyById(lobbyId, connected);
    if (withConnected) {
      broadcastLobby(lobbyId, () => ({ type: 'lobby_state', lobby: withConnected }));
    }
  }

  // Auto-fold if it is this player's turn so the hand can continue
  const game = await getActiveGame(lobbyId);
  if (game) {
    const seat = game.seats.find((s) => s.userId === userId);
    if (seat && game.actionSeatIndex === seat.seatIndex && !seat.folded && !seat.allIn) {
      const lobby = await getLobbyById(lobbyId);
      if (lobby) {
        const result = await processGameAction(
          lobbyId,
          lobby.settings,
          userId,
          crypto.randomUUID(),
          'fold'
        );
        if (!('error' in result)) {
          recordAction(lobbyId, userId, 'fold');

          if (result.state.street === 'complete') {
            recordHandEnd(lobbyId, result.state, lobby.settings);
            await processPendingCashOuts(lobbyId);
            const histories = getHandHistories(lobbyId);
            const last = histories[histories.length - 1];
            if (last) broadcastLobby(lobbyId, () => ({ type: 'hand_history', entry: last }));
            if (result.state.winnerPayouts.length > 0) {
              const payouts = result.state.winnerPayouts;
              broadcastLobby(lobbyId, () => ({ type: 'hand_complete', winners: payouts }));
            }
            const currentLobby = await getLobbyById(lobbyId);
            if (currentLobby?.status === 'playing') {
              scheduleIntermission(lobbyId, lobby.settings);
            }
          } else {
            scheduleActionTimer(lobbyId, lobby.settings, result.state);
          }

          await broadcastTableState(lobbyId);
        }
      }
    }
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

  try {
    const lobby = await getLobbyById(lobbyId);
    if (!lobby) return;

    const seat = lobby.seats.find((s) => s.userId === userId);
    if (!seat) return;

    const finalStack = seat.stack;
    const summary = finalizeCashOut(lobbyId, userId, finalStack);

    await removeSeat(lobbyId, userId);

    if (sessionId) await deleteSession(sessionId);

    // Detach from lobby before broadcasting so the player doesn't receive the lobby_state
    lobbyClients.get(lobbyId)?.delete(ws);
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

    if (st.lobbyId) lobbyClients.get(st.lobbyId)?.delete(ws);

    if (st.userId && connectedUserSockets.get(st.userId) === ws) {
      connectedUserSockets.delete(st.userId);
    }

    // Start grace period if this was a tracked session with a lobby
    if (st.sessionId && st.userId && st.lobbyId) {
      const { sessionId, userId, lobbyId } = st;
      markSessionDisconnected(sessionId).catch(() => {});
      const timer = setTimeout(() => {
        onGracePeriodExpired(sessionId, userId, lobbyId).catch(() => {});
      }, GRACE_PERIOD_MS);
      disconnectTimers.set(sessionId, timer);
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

      // Cancel any pending grace-period timer synchronously before awaiting
      const timer = disconnectTimers.get(session.id);
      if (timer) {
        clearTimeout(timer);
        disconnectTimers.delete(session.id);
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

      // Attempt seating with name check BEFORE connecting the socket to the lobby.
      // This ensures a rejected join never triggers a broadcast.
      const seatResult = await autoSeatPlayer(msg.lobbyId, st.userId, user.displayName);
      if (seatResult && 'error' in seatResult) {
        send(ws, { type: 'error', message: seatResult.error, code: seatResult.code });
        return;
      }

      // Seating succeeded — now wire up the socket
      if (st.lobbyId && st.lobbyId !== msg.lobbyId) {
        lobbyClients.get(st.lobbyId)?.delete(ws);
      }
      st.lobbyId = msg.lobbyId;
      st.isSpectator = false;
      if (!lobbyClients.has(msg.lobbyId)) lobbyClients.set(msg.lobbyId, new Set());
      lobbyClients.get(msg.lobbyId)!.add(ws);

      if (st.sessionId) {
        await updateSessionLobby(st.sessionId, msg.lobbyId);
      }

      // Init session stats for this player
      const lobbyAfterSeat = await getLobbyById(msg.lobbyId);
      const mySeat = lobbyAfterSeat?.seats.find((s) => s.userId === st.userId);
      if (mySeat) {
        initSession(msg.lobbyId, st.userId, user.displayName, mySeat.stack);
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
      recordAction(st.lobbyId, st.userId, msg.action);

      if (result.state.street === 'complete') {
        recordHandEnd(st.lobbyId, result.state, lobby.settings);
        await processPendingCashOuts(st.lobbyId);
        const histories = getHandHistories(st.lobbyId);
        const last = histories[histories.length - 1];
        if (last) broadcastLobby(st.lobbyId, () => ({ type: 'hand_history', entry: last }));
        if (result.state.winnerPayouts.length > 0) {
          const payouts = result.state.winnerPayouts;
          broadcastLobby(st.lobbyId, () => ({ type: 'hand_complete', winners: payouts }));
        }
        const updatedLobby = await getLobbyById(st.lobbyId);
        if (updatedLobby?.status === 'playing') {
          scheduleIntermission(st.lobbyId, lobby.settings);
        }
      } else {
        scheduleActionTimer(st.lobbyId, lobby.settings, result.state);
      }

      await broadcastTableState(st.lobbyId);
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
