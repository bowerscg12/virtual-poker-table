import type { ChatMessage, ReactionEmoji, TableReaction } from '@vct/shared-types';
import { randomUUID } from 'crypto';

const chatByLobby = new Map<string, ChatMessage[]>();
const MAX_MESSAGES = 100;

export function addChatMessage(
  lobbyId: string,
  userId: string,
  displayName: string,
  text: string,
  isHost?: boolean
): ChatMessage {
  const trimmed = text.trim().slice(0, 500);
  const msg: ChatMessage = {
    id: randomUUID(),
    userId,
    displayName,
    text: trimmed,
    timestamp: new Date().toISOString(),
    isHost,
  };
  const list = chatByLobby.get(lobbyId) ?? [];
  list.push(msg);
  if (list.length > MAX_MESSAGES) list.shift();
  chatByLobby.set(lobbyId, list);
  return msg;
}

/** Store a private message — only replayed to the sender and recipient (see getChatHistory). */
export function addWhisperMessage(
  lobbyId: string,
  senderId: string,
  senderDisplayName: string,
  recipientId: string,
  recipientDisplayName: string,
  text: string
): ChatMessage {
  const msg: ChatMessage = {
    id: randomUUID(),
    userId: senderId,
    displayName: senderDisplayName,
    text: text.trim().slice(0, 500),
    timestamp: new Date().toISOString(),
    isWhisper: true,
    recipientUserId: recipientId,
    recipientDisplayName,
  };
  const list = chatByLobby.get(lobbyId) ?? [];
  list.push(msg);
  if (list.length > MAX_MESSAGES) list.shift();
  chatByLobby.set(lobbyId, list);
  return msg;
}

/** Push a server-generated announcement (e.g. host migration) into a lobby's chat. */
export function addSystemChatMessage(lobbyId: string, text: string): ChatMessage {
  const msg: ChatMessage = {
    id: randomUUID(),
    userId: '',
    displayName: 'System',
    text: text.slice(0, 500),
    timestamp: new Date().toISOString(),
    isSystem: true,
  };
  const list = chatByLobby.get(lobbyId) ?? [];
  list.push(msg);
  if (list.length > MAX_MESSAGES) list.shift();
  chatByLobby.set(lobbyId, list);
  return msg;
}

/**
 * Chat history visible to a given user. Whispers are included only when the
 * user is the sender or recipient; with no userId (anonymous replay) they are
 * always excluded so private messages can never leak.
 */
export function getChatHistory(lobbyId: string, forUserId?: string): ChatMessage[] {
  const list = chatByLobby.get(lobbyId) ?? [];
  return list.filter(
    (m) => !m.isWhisper || (forUserId !== undefined && (m.userId === forUserId || m.recipientUserId === forUserId))
  );
}

const lastMessageAt = new Map<string, number>();

export function canSendChat(userId: string): boolean {
  const now = Date.now();
  const last = lastMessageAt.get(userId) ?? 0;
  if (now - last < 500) return false;
  lastMessageAt.set(userId, now);
  return true;
}

/** Minimum interval between reactions per player (server-enforced spam guard). */
export const REACTION_COOLDOWN_MS =
  Number(process.env.REACTION_COOLDOWN_MS) > 0 ? Number(process.env.REACTION_COOLDOWN_MS) : 2500;

const lastReactionAt = new Map<string, number>();

export function canSendReaction(userId: string): boolean {
  const now = Date.now();
  const last = lastReactionAt.get(userId) ?? 0;
  if (now - last < REACTION_COOLDOWN_MS) return false;
  lastReactionAt.set(userId, now);
  return true;
}

/** Build a reaction event. Reactions are transient — never stored, never replayed. */
export function createReaction(
  userId: string,
  displayName: string,
  emoji: ReactionEmoji,
  seatIndex: number | null
): TableReaction {
  return {
    id: randomUUID(),
    userId,
    displayName,
    emoji,
    seatIndex,
    timestamp: new Date().toISOString(),
  };
}
