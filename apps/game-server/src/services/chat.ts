import type { ChatMessage } from '@vct/shared-types';
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

export function getChatHistory(lobbyId: string): ChatMessage[] {
  return chatByLobby.get(lobbyId) ?? [];
}

const lastMessageAt = new Map<string, number>();

export function canSendChat(userId: string): boolean {
  const now = Date.now();
  const last = lastMessageAt.get(userId) ?? 0;
  if (now - last < 500) return false;
  lastMessageAt.set(userId, now);
  return true;
}
