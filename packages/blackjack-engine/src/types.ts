import type { Card } from '@vct/shared-types';

export type BlackjackPhase =
  | 'waiting_for_bets'
  | 'dealing'
  | 'player_turn'
  | 'dealer_turn'
  | 'settlement'
  | 'round_complete';

export type HandResult = 'win' | 'loss' | 'push' | 'blackjack';

export interface BlackjackHand {
  id: string;
  cards: Card[];
  wager: number;
  isStanding: boolean;
  isBust: boolean;
  /** Natural 21 on original 2-card deal (not after split). Pays 3:2. */
  isBlackjack: boolean;
  isDoubled: boolean;
  /** True when this hand resulted from a split. Split blackjacks pay 1:1. */
  isSplit: boolean;
  result?: HandResult;
  /** Amount returned to player (0 on loss, wager on push, wager*2 on win, wager + floor(wager*1.5) on BJ). */
  payout?: number;
}

export interface BlackjackPlayer {
  userId: string;
  seatIndex: number;
  stack: number;
  /** Accumulated bet during the betting phase. Deducted from stack when dealing starts. */
  pendingBet: number;
  hands: BlackjackHand[];
  /** Index into hands[] for the currently active hand. */
  activeHandIndex: number;
  status: 'betting' | 'waiting' | 'acting' | 'done' | 'sitting_out';
}

export interface DealerState {
  cards: Card[];
  /** False until the dealer turn phase begins. The public state masks cards[1] when false. */
  holeCardRevealed: boolean;
}

export interface BlackjackTableState {
  lobbyId: string;
  roundNumber: number;
  phase: BlackjackPhase;
  /** Remaining shoe cards. Draw from index 0. */
  shoe: Card[];
  /** When shoe.length <= cutCardPosition after a round, reshuffle before next round. */
  cutCardPosition: number;
  players: BlackjackPlayer[];
  dealer: DealerState;
  /** Index into players[] for the player currently acting. -1 when no player is active. */
  activePlayerIndex: number;
  betDeadline?: number;
  actionDeadline?: number;
  /** SHA-256 seed used to shuffle this round's shoe (for provably-fair verification). */
  seed: string;
}

export type BlackjackActionType = 'hit' | 'stand' | 'double_down' | 'split' | 'insurance' | 'surrender';

export interface BlackjackLegalAction {
  type: BlackjackActionType;
  handId: string;
}
