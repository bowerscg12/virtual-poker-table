import type { Card } from '@vct/shared-types';

export type BlackjackPhase =
  | 'waiting_for_bets'
  | 'dealing'
  | 'insurance'
  | 'player_turn'
  | 'dealer_turn'
  | 'settlement'
  | 'round_complete';

export type HandResult = 'win' | 'loss' | 'push' | 'blackjack' | 'surrender';

export interface BlackjackHand {
  id: string;
  cards: Card[];
  wager: number;
  isStanding: boolean;
  isBust: boolean;
  /** Natural 21 on original 2-card deal (not after split). Pays 3:2 (or the configured ratio). */
  isBlackjack: boolean;
  isDoubled: boolean;
  /** True when this hand resulted from a split. Split blackjacks pay 1:1. */
  isSplit: boolean;
  /** True when the player surrendered this hand (late surrender). Returns half the wager. */
  isSurrendered?: boolean;
  /** True when the player took even money on a natural facing a dealer Ace. Settles at 1:1. */
  evenMoney?: boolean;
  result?: HandResult;
  /** Amount returned to player (0 on loss, wager on push, wager*2 on win, wager + bonus on BJ). */
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
  /** Side bet placed during the insurance window (0 = none). Pays 2:1 if dealer has a natural. */
  insuranceBet: number;
  /** True once the player has made their insurance/even-money decision (or declined). */
  insuranceActed?: boolean;
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
  /** Deadline for the insurance decision window (set while phase === 'insurance'). */
  insuranceDeadline?: number;
  /** SHA-256 seed used to shuffle this round's shoe (for provably-fair verification). */
  seed: string;
}

export type BlackjackActionType = 'hit' | 'stand' | 'double_down' | 'split' | 'insurance' | 'surrender';

export interface BlackjackLegalAction {
  type: BlackjackActionType;
  handId: string;
}

/**
 * House rules for a blackjack table. Derived from {@link VariantConfig} on the server and threaded
 * through the pure engine so rule variations don't require engine changes.
 */
export interface BlackjackRules {
  /** Dealer hits (true) or stands (false) on soft 17. */
  dealerHitsSoft17: boolean;
  /** Natural blackjack payout ratio. */
  blackjackPayout: '3:2' | '6:5';
  /** Surrender option. 'late' = after the dealer peek confirms no natural. */
  surrender: 'none' | 'late';
  /** Whether insurance / even money is offered when the dealer shows an Ace. */
  insurance: boolean;
  /** Whether a player may double after splitting. */
  doubleAfterSplit: boolean;
  /** Whether split aces may be re-split / acted on (false = ace splits auto-stand). */
  resplitAces: boolean;
  /** Maximum total hands a player may hold after splitting (e.g. 4 = up to 3 splits). */
  maxSplitHands: number;
}

export const DEFAULT_BLACKJACK_RULES: BlackjackRules = {
  dealerHitsSoft17: false,
  blackjackPayout: '3:2',
  surrender: 'late',
  insurance: true,
  doubleAfterSplit: true,
  resplitAces: false,
  maxSplitHands: 4,
};
