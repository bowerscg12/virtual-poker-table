import type { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@vct/shared-types';
import { getUserById } from '../services/auth.js';
import {
  approveRebuy,
  autoSeatPlayer,
  getLobbyById,
  kickSeat,
  setTableBuyIn,
  sitAtSeat,
  updateLobbyStatus,
} from '../services/lobby.js';
import {
  getActiveGame,
  processGameAction,
  startHand,
  toPublicState,
  getHandHistories,
} from '../services/game-manager.js';
import { addChatMessage, canSendChat, getChatHistory } from '../services/chat.js';
import { getMemoryLobby } from '../services/lobby.js';

interface ClientState {
  userId: string | null;
  lobbyId: string | null;
  isSpectator: boolean;
}

const clients = new Map<WebSocket, ClientState>();
const lobbyClients = new Map<string, Set<WebSocket>>();

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

function broadcastLobby(lobbyId: string, build: (userId: string | null, isSpectator: boolean) => ServerMessage): void {
  const set = lobbyClients.get(lobbyId);
  if (!set) return;
  for (const ws of set) {
    const st = clients.get(ws);
    if (st) send(ws, build(st.userId, st.isSpectator));
  }
}

async function broadcastTableState(lobbyId: string): Promise<void> {
  const game = await getActiveGame(lobbyId);
  const lobby = await getLobbyById(lobbyId);
  if (!lobby) return;

  broadcastLobby(lobbyId, (userId, isSpectator) => {
    if (!game) {
      return { type: 'lobby_state', lobby };
    }
    const { public: pub, private: priv } = toPublicState(game, userId, isSpectator, lobby.settings);
    pub.lobbyId = lobbyId;
    return { type: 'table_state', public: pub, private: priv };
  });
}

export function registerClient(ws: WebSocket): void {
  clients.set(ws, { userId: null, lobbyId: null, isSpectator: false });

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
    if (st?.lobbyId) {
      lobbyClients.get(st.lobbyId)?.delete(ws);
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
        if (user) send(ws, { type: 'authenticated', userId: user.id });
      } catch {
        send(ws, { type: 'error', message: 'Invalid token', code: 'AUTH_FAILED' });
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
      if (st.lobbyId) lobbyClients.get(st.lobbyId)?.delete(ws);
      st.lobbyId = msg.lobbyId;
      st.isSpectator = false;
      if (!lobbyClients.has(msg.lobbyId)) lobbyClients.set(msg.lobbyId, new Set());
      lobbyClients.get(msg.lobbyId)!.add(ws);

      const seated = await autoSeatPlayer(msg.lobbyId, st.userId);
      const lobbyState = seated ?? lobby;
      broadcastLobby(msg.lobbyId, () => ({ type: 'lobby_state', lobby: lobbyState }));
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
      const chatMsg = addChatMessage(st.lobbyId, st.userId, user?.displayName ?? 'Player', msg.text, isHost);
      broadcastLobby(st.lobbyId, () => ({ type: 'chat', message: chatMsg }));
      return;
    }

    case 'sit': {
      if (!st.userId || !st.lobbyId) return;
      let result: Awaited<ReturnType<typeof sitAtSeat>>;
      if (msg.seatIndex !== undefined) {
        result = await sitAtSeat(st.lobbyId, st.userId, msg.seatIndex, msg.buyIn);
      } else {
        const seated = await autoSeatPlayer(st.lobbyId, st.userId);
        result = seated ?? { error: 'No seats available' };
      }
      if ('error' in result) {
        send(ws, { type: 'error', message: result.error });
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
      const result = await startHand(st.lobbyId, lobby.settings);
      if ('error' in result) {
        send(ws, { type: 'error', message: result.error });
        return;
      }
      await updateLobbyStatus(st.lobbyId, 'playing');
      await broadcastTableState(st.lobbyId);
      return;
    }

    case 'host_pause': {
      if (!st.userId || !st.lobbyId) return;
      const lobby = await getLobbyById(st.lobbyId);
      if (!lobby || lobby.hostUserId !== st.userId) return;
      await updateLobbyStatus(st.lobbyId, msg.paused ? 'paused' : 'playing');
      const updated = await getLobbyById(st.lobbyId);
      if (updated) broadcastLobby(st.lobbyId, () => ({ type: 'lobby_state', lobby: updated }));
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
        return;
      }
      await broadcastTableState(st.lobbyId);
      if (result.state.street === 'complete') {
        const histories = getHandHistories(st.lobbyId);
        const last = histories[histories.length - 1];
        if (last) {
          broadcastLobby(st.lobbyId, () => ({ type: 'hand_history', entry: last }));
        }
      }
      return;
    }

    default:
      send(ws, { type: 'error', message: 'Unknown message type' });
  }
}
