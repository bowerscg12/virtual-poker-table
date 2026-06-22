import type { Card } from './cards.js';

export type BlackjackPhase =
  | 'waiting_for_bets'
  | 'dealing'
  | 'insurance'
  | 'player_turn'
  | 'dealer_turn'
  | 'settlement'
  | 'round_complete';

export type BlackjackHandResult = 'win' | 'loss' | 'push' | 'blackjack' | 'surrender';

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
  /** True when the player surrendered this hand. */
  isSurrendered?: boolean;
  /** True when the player took even money on a natural facing a dealer Ace. */
  evenMoney?: boolean;
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
  /** Insurance side bet placed during the insurance window (0 = none/declined). */
  insuranceBet?: number;
  /** True once the player has resolved their insurance/even-money decision. */
  insuranceActed?: boolean;
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
  /** Deadline (Unix ms) for the insurance decision window (set while phase === 'insurance'). */
  insuranceDeadline?: number;
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

/**
 * End-of-run recap shown when a player busts (high-score mode). Each buy-in is its own run:
 * peak chips and winning hands reset on every fresh buy-in.
 */
export interface BlackjackSessionRecap {
  /** Buy-in amount this run started with. */
  buyIn: number;
  /** Highest chip stack reached at any point during this run. */
  peakChips: number;
  /** Number of winning hands this run (split hands counted separately). */
  handsWon: number;
  /** Total hands played this run. */
  handsPlayed: number;
  /** Player's best-ever peak across all runs (after recording this one). */
  bestPeak: number;
  /** Player's best-ever winning-hands count across all runs (after recording this one). */
  bestHandsWon: number;
  /** True when this run set a new personal-best peak. */
  isPeakRecord: boolean;
  /** True when this run set a new personal-best winning-hands count. */
  isHandsRecord: boolean;
  /** True when the run ended by a voluntary cash-out (vs. busting out). */
  cashedOut?: boolean;
  /** Chip stack the player walked away with (only set on cash-out). */
  finalStack?: number;
}

/**
 * Persistent personal-best blackjack stats shown on the avatar screen for registered players.
 * All values are all-time bests; 0 across the board means the player has no recorded blackjack play.
 */
export interface BlackjackStats {
  /** Highest chip stack ever reached in a single run. */
  highestPeak: number;
  /** Longest streak of consecutive winning hands. */
  longestWinStreak: number;
  /** Most hands (rounds) survived in a single buy-in before going broke. */
  mostHandsWithoutBusting: number;
  /** Largest net chips won on a single hand. */
  biggestHandWin: number;
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
