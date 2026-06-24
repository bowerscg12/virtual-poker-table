import type { WebSocket } from 'ws';
import type { ServerMessage } from '@vct/shared-types';

/**
 * Low-level WebSocket transport layer: the connection registries and the primitives that
 * read/write them. This module owns the socket bookkeeping and has no dependency on game
 * logic, so any subsystem can import these primitives without creating an import cycle with
 * the main handler.
 */

export interface ClientState {
  userId: string | null;
  lobbyId: string | null;
  isSpectator: boolean;
  sessionId: string | null;
}

/** Every live socket → its authoritative client state. */
export const clients = new Map<WebSocket, ClientState>();

/** lobbyId → the set of sockets currently watching/playing that lobby. */
export const lobbyClients = new Map<string, Set<WebSocket>>();

/** userId → the single authoritative WebSocket for that user. */
export const connectedUserSockets = new Map<string, WebSocket>();

/** Send a ServerMessage to a single socket (no-op if it is not open). */
export function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * Close every connected socket with WS code 1012 ("service restart") on
 * graceful shutdown. Clients treat this as a non-intentional close and auto-reconnect (with backoff)
 * into the recovered table once the replacement instance boots and runs startup recovery. Authoritative
 * game state already persists to Redis on every action, so no per-socket flush is required here.
 */
export function closeAllClients(): void {
  for (const ws of clients.keys()) {
    try {
      ws.close(1012, 'server restarting');
    } catch {
      /* already closed */
    }
  }
}

/**
 * Send a ServerMessage to a specific user by userId (if they're connected).
 * Used by the tournament manager to send per-player notifications.
 */
export function sendToUser(userId: string, msg: ServerMessage): void {
  const ws = connectedUserSockets.get(userId);
  if (ws) send(ws, msg);
}

/**
 * Broadcast a ServerMessage to every connected client in a lobby.
 * Used by the tournament manager for tournament-level broadcasts.
 */
export function broadcastRawToLobby(lobbyId: string, msg: ServerMessage): void {
  broadcastLobby(lobbyId, () => msg);
}

/** Returns the set of userIds currently connected to a lobby. */
export function getConnectedSet(lobbyId: string): Set<string> {
  const sockets = lobbyClients.get(lobbyId);
  if (!sockets) return new Set();
  const connected = new Set<string>();
  for (const ws of sockets) {
    const st = clients.get(ws);
    if (st?.userId) connected.add(st.userId);
  }
  return connected;
}

/** Send a per-recipient ServerMessage to every connected client in a lobby. */
export function broadcastLobby(
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

/** Evict a stale socket for a userId, removing it from all tracking maps. */
export function evictSocket(existing: WebSocket): void {
  const st = clients.get(existing);
  if (st?.lobbyId) lobbyClients.get(st.lobbyId)?.delete(existing);
  if (st?.userId && connectedUserSockets.get(st.userId) === existing) {
    connectedUserSockets.delete(st.userId);
  }
  clients.delete(existing);
  try { existing.close(); } catch { /* already closed */ }
}
