import type { WebSocket } from 'ws';
import type { ClientMessage } from '@vct/shared-types';
import { isReactionEmoji } from '@vct/shared-types';
import type { ClientState } from './connection.js';
import { send, broadcastLobby, getConnectedSet, connectedUserSockets, clients } from './connection.js';
import { getUserById } from '../services/auth.js';
import { getLobbyById, getMemoryLobby } from '../services/lobby.js';
import {
  addChatMessage,
  addWhisperMessage,
  canSendChat,
  canSendReaction,
  createReaction,
} from '../services/chat.js';
import { recordChatActivity } from '../services/session-stats.js';

/**
 * Social messaging: table chat, transient emoji reactions, and 1:1 whispers. Purely a
 * presentation/social concern with no game-lifecycle coupling — it sits on the transport layer
 * and the chat service, so it imports nothing from the main handler.
 */
export async function handleChatMessage(ws: WebSocket, msg: ClientMessage, st: ClientState): Promise<void> {
  switch (msg.type) {
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
      recordChatActivity(st.lobbyId, st.userId);
      broadcastLobby(st.lobbyId, () => ({ type: 'chat', message: chatMsg }));
      return;
    }

    case 'reaction': {
      if (!st.userId || !st.lobbyId) return;
      // Emoji must come from the shared allowlist — drop anything else silently.
      if (typeof msg.emoji !== 'string' || !isReactionEmoji(msg.emoji)) return;
      if (!canSendReaction(st.userId)) return;
      const user = await getUserById(st.userId);
      const lobby = await getLobbyById(st.lobbyId);
      const seatIndex = lobby?.seats.find((s) => s.userId === st.userId)?.seatIndex ?? null;
      const reaction = createReaction(st.userId, user?.displayName ?? 'Player', msg.emoji, seatIndex);
      recordChatActivity(st.lobbyId, st.userId);
      // Transient by design: broadcast to all lobby sockets (players + spectators),
      // never stored, so it cannot replay on reconnect or leak into hand history.
      broadcastLobby(st.lobbyId, () => ({ type: 'reaction', reaction }));
      return;
    }

    case 'whisper': {
      if (!st.userId || !st.lobbyId) return;
      const text = msg.text?.trim();
      if (!text) return;
      if (msg.recipientUserId === st.userId) {
        send(ws, { type: 'error', message: 'You cannot whisper to yourself' });
        return;
      }
      if (!canSendChat(st.userId)) return;
      // Recipient must be connected to the same lobby — never deliver across tables.
      if (!getConnectedSet(st.lobbyId).has(msg.recipientUserId)) {
        send(ws, { type: 'error', message: 'That player is no longer at the table' });
        return;
      }
      const sender = await getUserById(st.userId);
      const recipient = await getUserById(msg.recipientUserId);
      if (!recipient) {
        send(ws, { type: 'error', message: 'That player is no longer at the table' });
        return;
      }
      const whisperMsg = addWhisperMessage(
        st.lobbyId,
        st.userId,
        sender?.displayName ?? 'Player',
        msg.recipientUserId,
        recipient.displayName,
        text
      );
      // Deliver to exactly two sockets: the sender and the recipient.
      send(ws, { type: 'chat', message: whisperMsg });
      const recipientWs = connectedUserSockets.get(msg.recipientUserId);
      if (recipientWs && clients.get(recipientWs)?.lobbyId === st.lobbyId) {
        send(recipientWs, { type: 'chat', message: whisperMsg });
      }
      return;
    }
  }
}
