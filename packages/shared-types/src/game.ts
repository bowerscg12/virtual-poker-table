import type { Card } from './cards.js';
import type { LiveSessionStats } from './session-stats.js';

export type Street = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete' | 'reveal';

export type PlayerActionType = 'fold' | 'check' | 'call' | 'raise' | 'all_in' | 'flip_card';

/** Table superlative badges awarded to a single clear leader in each category. */
export type BadgeType =
  | 'big_stack'       // current chip leader
  | 'short_stack'     // current lowest chip count
  | 'hot_streak'      // 3+ consecutive hand wins
  | 'calling_station' // highest calls-per-hand rate this session
  | 'charlie'         // highest preflop fold rate this session
  | 'whale'           // largest net chip loss this session
  | 'maniac'          // most raises this session
  | 'loose_cannon'    // highest VPIP rate this session
  | 'most_blind_wins'; // most hands won while playing blind this session

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
  /** Active superlative badges — computed server-side each broadcast */
  badges?: BadgeType[];
  /** True while this player is playing the current hand without seeing their hole cards */
  isBlindThisHand?: boolean;
  /** Live session stats for the avatar hover overlay — computed server-side each broadcast */
  sessionStats?: LiveSessionStats;
  /**
   * True when this seat is involved in an active 1v1 side bet visible to the viewer.
   * Viewer-scoped: only set for seats in a bet the viewer participates in (or all
   * involved seats when side-bet visibility is 'table').
   */
  hasSideBet?: boolean;
}

export interface PublicTableState {
  lobbyId: string;
  handNumber: number;
  street: Street;
  board: Card[];
  /** Second community board — present only during a Double Board Bomb Pot hand. */
  secondBoard?: Card[];
  /** Present during an active Bomb Pot hand; drives the in-hand banner. */
  bombPot?: { amount: number; doubleBoard: boolean };
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
  /** True when the game is live (status = 'playing') but blocked waiting for enough active players */
  waitingForPlayers?: boolean;
  /** Present when the last hand ended at showdown; cleared when next hand begins */
  showdownResult?: ShowdownResult;
  /** Present only for twelve_card_flip hands during reveal phase */
  flipReveal?: {
    /** Revealed cards per seat, parallel to the seats array */
    revealedCards: Card[][];
    /** Best hand description per seat (null if no cards revealed yet) */
    bestHands: (string | null)[];
    /** Seat index of the current leader, or null if tied / no cards revealed */
    leadingSeatIndex: number | null;
  };
  /** Present while community cards are being progressively revealed in an all-in runout */
  runout?: { active: boolean; currentRun?: number; totalRuns?: number };
  /**
   * SHA-256 hex digest of the RNG seed bytes used to shuffle the deck for the last completed hand.
   * Published only once the hand is complete so players can verify card dealing was fair (provably fair).
   * Cleared when the next hand begins.
   */
  lastHandSeed?: string;
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

export interface ShowdownHandEntry {
  seatIndex: number;
  displayName: string;
  handDescription: string;
  bestFive: Card[];
  isWinner: boolean;
  /** Total chips won from contested pots; 0 for non-winners */
  potWon: number;
  /** Uncalled chips returned uncontested (short-stack overhang); absent if none */
  chipsReturned?: number;
}

export interface ShowdownResult {
  hands: ShowdownHandEntry[];
  isSplit: boolean;
  /** Display name of the sole contested-pot winner; absent on true splits or double-board results. */
  soloWinner?: string;
  /** Board A community cards — present only for a Double Board Bomb Pot showdown. */
  board?: Card[];
  /** Board B cards — present only for a Double Board Bomb Pot showdown. */
  secondBoard?: Card[];
  /** Per-seat results evaluated on Board B — present only for a Double Board Bomb Pot showdown. */
  secondHands?: ShowdownHandEntry[];
  /** Per-run boards and hand results — present only for a run-it-out (2 or 3 times) showdown. */
  runoutBoards?: { board: Card[]; hands: ShowdownHandEntry[] }[];
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
