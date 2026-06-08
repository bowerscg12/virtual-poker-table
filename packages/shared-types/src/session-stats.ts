import type { Card } from './cards.js';

export interface StartingHandStat {
  key: string;
  count: number;
  frequency: number;
}

export interface ActionCounts {
  fold: number;
  check: number;
  call: number;
  raise: number;
  all_in: number;
  flip_card: number;
}

export interface CashOutSummary {
  userId: string;
  displayName: string;
  startingStack: number;
  finalStack: number;
  netProfit: number;
  handsPlayed: number;
  handsWon: number;
  winPercentage: number;
  biggestPotWon: number;
  biggestLoss: number;
  bestHandDescription: string | null;
  bestHandRank: string | null;
  bestHandCards: Card[] | null;
  mostCommonStartingHand: StartingHandStat | null;
  actionCounts: ActionCounts;
  sessionDurationMs: number;
  averagePotWon: number;
  pfrHandsRaised: number;
  pfr: number;
  totalBuyIns: number;
  totalChipsPurchased: number;
  foldWinsShown: number;
  foldWinsMucked: number;
  handsWonBlind: number;
}

/** Live per-player stats sent in every table_state broadcast for the hover overlay. */
export interface LiveSessionStats {
  handsPlayed: number;
  handsWon: number;
  /** Voluntarily Put Money In Pot %, 0–100 integer */
  vpip: number;
  /** Pre-Flop Raise %, 0–100 integer */
  pfr: number;
  /** currentStack - totalChipsPurchased (signed) */
  netGainLoss: number;
  bestHandDescription: string | null;
}
