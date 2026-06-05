import type { Card } from './cards.js';

export type BlackjackPhase =
  | 'waiting_for_bets'
  | 'dealing'
  | 'player_turn'
  | 'dealer_turn'
  | 'settlement'
  | 'round_complete';

export type BlackjackHandResult = 'win' | 'loss' | 'push' | 'blackjack';

export type BlackjackActionType =
  | 'hit'
  | 'stand'
  | 'double_down'
  | 'split'
  | 'insurance'
  | 'surrender';

export interface BlackjackLegalAction {
  type: BlackjackActionType;
  handId: string;
}

/** Public hand state (safe to broadcast to all clients). */
export interface PublicBlackjackHand {
  id: string;
  cards: Card[];
  /** Blackjack total (aces soft-reduced). Omitted when hand has only 1 card. */
  total?: number;
  isSoft?: boolean;
  wager: number;
  isStanding: boolean;
  isBust: boolean;
  isBlackjack: boolean;
  isDoubled: boolean;
  isSplit: boolean;
  result?: BlackjackHandResult;
  payout?: number;
}

/** Public player state (safe to broadcast to all clients). */
export interface PublicBlackjackPlayer {
  userId: string;
  seatIndex: number;
  displayName: string;
  /** Current chip stack (after bet deduction, before payout). */
  stack: number;
  /** Bet staged during the betting phase (0 after deal). */
  pendingBet: number;
  hands: PublicBlackjackHand[];
  activeHandIndex: number;
  status: 'betting' | 'waiting' | 'acting' | 'done' | 'sitting_out';
  avatar?: import('./avatar.js').AvatarConfig;
}

/** Dealer state. Hole card is masked (null) until the dealer turn phase. */
export interface PublicDealerState {
  /** cards[1] is null when hole card is still hidden. */
  cards: (Card | null)[];
  total?: number;
  isSoft?: boolean;
  holeCardRevealed: boolean;
}

/** Full public blackjack table state broadcast to all clients. */
export interface PublicBlackjackState {
  lobbyId: string;
  roundNumber: number;
  phase: BlackjackPhase;
  players: PublicBlackjackPlayer[];
  dealer: PublicDealerState;
  /** Index into players[] for the currently active player. -1 when no player is acting. */
  activePlayerIndex: number;
  betDeadline?: number;
  actionDeadline?: number;
  /** ISO timestamp for the intermission countdown before the next round starts. */
  intermissionDeadline?: string;
  /** Shoe penetration (0–1) — fraction of shoe remaining. Used to show reshuffle notice. */
  shoePenetration: number;
}

/** Per-hand settlement outcome for a single player (included in bj_round_settled). */
export interface BlackjackHandOutcome {
  handId: string;
  result: BlackjackHandResult;
  payout: number;
  wager: number;
}

/** Per-player settlement result for bj_round_settled. */
export interface BlackjackRoundPlayerResult {
  userId: string;
  seatIndex: number;
  displayName: string;
  stackDelta: number;
  finalStack: number;
  hands: BlackjackHandOutcome[];
}
