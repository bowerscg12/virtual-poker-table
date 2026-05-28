import type { Card } from './cards.js';

export type Street = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';

export type PlayerActionType = 'fold' | 'check' | 'call' | 'raise' | 'all_in';

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
  paused: boolean;
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
}
