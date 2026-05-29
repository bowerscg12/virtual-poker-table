import type { Card } from './cards.js';
import type { LegalAction, PlayerActionType, PublicTableState } from './game.js';
import type { LobbySummary } from './lobby.js';

/** Client -> Server */
export type ClientMessage =
  | { type: 'auth'; token: string }
  | { type: 'join_lobby'; lobbyId: string }
  | { type: 'chat'; text: string }
  | { type: 'sit'; seatIndex?: number; buyIn?: number }
  | { type: 'host_set_buy_in'; buyIn: number }
  | { type: 'stand' }
  | { type: 'host_start' }
  | { type: 'host_pause'; paused: boolean }
  | { type: 'host_kick'; seatIndex: number }
  | { type: 'host_approve_rebuy'; seatIndex: number; amount: number }
  | { type: 'host_adjust_blinds'; small: number; big: number }
  | { type: 'game_action'; actionId: string; action: PlayerActionType; amount?: number }
  | { type: 'spectate' }
  | { type: 'voice_signal'; targetUserId: string; signal: unknown }
  | { type: 'ping' };

/** Server -> Client */
export type ServerMessage =
  | { type: 'authenticated'; userId: string }
  | { type: 'error'; message: string; code?: string }
  | { type: 'lobby_state'; lobby: LobbySummary }
  | { type: 'table_state'; public: PublicTableState; private?: { holeCards: Card[]; legalActions: LegalAction[] } }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'hand_complete'; winners: { seatIndex: number; amount: number; handDescription: string }[] }
  | { type: 'hand_history'; entry: import('./game.js').HandHistoryEntry }
  | { type: 'voice_token'; token: string; roomName: string }
  | { type: 'pong' };

export interface ChatMessage {
  id: string;
  userId: string;
  displayName: string;
  text: string;
  timestamp: string;
  isHost?: boolean;
}
