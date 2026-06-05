import type { Card } from './cards.js';
import type { LegalAction, PlayerActionType, PublicTableState } from './game.js';
import type { LobbySummary } from './lobby.js';
import type { CashOutSummary } from './session-stats.js';

/** Client -> Server */
export type ClientMessage =
  | { type: 'auth'; token: string }
  | { type: 'reconnect'; sessionId: string }
  | { type: 'join_lobby'; lobbyId: string }
  | { type: 'chat'; text: string }
  | { type: 'sit'; seatIndex?: number; buyIn?: number }
  | { type: 'host_set_buy_in'; buyIn: number }
  | { type: 'host_set_action_timer'; seconds: number }
  | { type: 'host_set_flip_ante'; ante: number }
  | { type: 'host_set_bomb_pot'; enabled: boolean; amount?: number; doubleBoard?: boolean }
  | { type: 'bomb_pot_join'; join: boolean }
  | { type: 'run_it_out_choice'; times: number }
  | { type: 'host_set_run_it_out'; times: number }
  | { type: 'stand' }
  | { type: 'host_start' }
  | { type: 'host_pause'; paused: boolean }
  | { type: 'host_kick'; seatIndex: number }
  | { type: 'host_transfer'; seatIndex: number }
  | { type: 'host_move_player'; fromSeatIndex: number; toSeatIndex: number }
  | { type: 'host_approve_rebuy'; seatIndex: number; amount: number }
  | { type: 'host_adjust_blinds'; small: number; big: number }
  | { type: 'game_action'; actionId: string; action: PlayerActionType; amount?: number }
  | { type: 'spectate' }
  | { type: 'cash_out' }
  | { type: 'cash_out_confirm' }
  | { type: 'cash_out_cancel' }
  | { type: 'rebuy' }
  | { type: 'show_cards'; show: boolean }
  | { type: 'sit_out_next_hand'; enabled: boolean }
  | { type: 'set_blind_hand'; enabled: boolean }
  | { type: 'reveal_blind_cards' }
  | { type: 'donate_chips'; recipientSeatIndex: number; amount: number; donationId: string }
  | { type: 'ping' };

/** Server -> Client */
export type ServerMessage =
  | { type: 'authenticated'; userId: string; sessionId: string }
  | { type: 'session_ready'; userId: string; lobbyId: string }
  | { type: 'session_invalid' }
  | { type: 'error'; message: string; code?: string }
  | { type: 'lobby_state'; lobby: LobbySummary }
  | { type: 'table_state'; public: PublicTableState; private?: { holeCards: Card[]; legalActions: LegalAction[] } }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'hand_complete'; winners: { seatIndex: number; amount: number; handDescription: string }[] }
  | { type: 'hand_history'; entry: import('./game.js').HandHistoryEntry }
  | { type: 'cash_out_queued' }
  | { type: 'cash_out_cancelled' }
  | { type: 'cash_out_confirm_prompt'; amount: number; deadline: string }
  | { type: 'cashed_out'; summary: CashOutSummary }
  | { type: 'rebuy_available'; amount: number }
  | { type: 'rebuy_queued' }
  | { type: 'rebuy_confirmed'; newStack: number }
  | { type: 'show_cards_prompt'; deadline: string }
  | { type: 'show_cards_result'; seatIndex: number; cards?: Card[] }
  | { type: 'bomb_pot_prompt'; deadline: string; amount: number; doubleBoard: boolean }
  | { type: 'bomb_pot_cancelled'; reason: string }
  | { type: 'run_it_out_prompt'; chooserSeatIndex: number; deadline: string; maxRuns: number }
  | { type: 'donation_received'; donorDisplayName: string; amount: number }
  | { type: 'donation_confirmed'; recipientDisplayName: string; amount: number }
  | { type: 'pong' };

export interface ChatMessage {
  id: string;
  userId: string;
  displayName: string;
  text: string;
  timestamp: string;
  isHost?: boolean;
  /** Server-generated announcement (e.g. host migration), not a player message */
  isSystem?: boolean;
}
