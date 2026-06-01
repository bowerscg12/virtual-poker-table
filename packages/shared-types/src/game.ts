import type { Card } from './cards.js';

export type Street = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete' | 'reveal';

export type PlayerActionType = 'fold' | 'check' | 'call' | 'raise' | 'all_in' | 'flip_card';

export interface PotInfo {
  amount: number;
  eligibleSeatIndices: number[];
}

export interface SeatGameState {
  seatIndex: number;
  userId: string;
  displayName: string;
  stack: number;
  betThisStreet: number;
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  /** Only sent to owning player */
  holeCards?: Card[];
  /** Shown at showdown */
  shownCards?: Card[];
  /** Last action this player took — persists until their next action */
  lastAction?: { action: PlayerActionType; amount?: number };
}

export interface PublicTableState {
  lobbyId: string;
  handNumber: number;
  street: Street;
  board: Card[];
  seats: Omit<SeatGameState, 'holeCards'>[];
  pots: PotInfo[];
  dealerSeatIndex: number;
  actionSeatIndex: number | null;
  currentBet: number;
  minRaise: number;
  lastAction?: { seatIndex: number; action: PlayerActionType; amount?: number };
  actionDeadline?: string;
  /** ISO deadline for next auto-hand start (set during between-hand intermission) */
  intermissionDeadline?: string;
  paused: boolean;
  /** Present only for twelve_card_flip hands during reveal phase */
  flipReveal?: {
    /** Revealed cards per seat, parallel to the seats array */
    revealedCards: Card[][];
    /** Best hand description per seat (null if no cards revealed yet) */
    bestHands: (string | null)[];
    /** Seat index of the current leader, or null if tied / no cards revealed */
    leadingSeatIndex: number | null;
  };
}

export interface PrivateTableState {
  holeCards: Card[];
  legalActions: LegalAction[];
}

export interface LegalAction {
  type: PlayerActionType;
  minAmount?: number;
  maxAmount?: number;
  amount?: number;
}

export interface HandHistoryEntry {
  id: string;
  lobbyId: string;
  handNumber: number;
  startedAt: string;
  endedAt: string;
  board: Card[];
  winners: { seatIndex: number; amount: number; handDescription: string }[];
  actions: { seatIndex: number; street: Street; action: PlayerActionType; amount?: number }[];
  /** Present when hand ended by folds; cards set if winner chose to reveal, absent if mucked */
  shownAtFoldWin?: { seatIndex: number; cards?: Card[] };
}
