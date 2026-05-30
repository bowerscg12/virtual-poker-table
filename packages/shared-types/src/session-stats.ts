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
}
