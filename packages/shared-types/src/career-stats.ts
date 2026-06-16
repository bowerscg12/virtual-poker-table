import type { Card } from './cards.js';

export interface HoleHandStat {
  hand: string;
  timesDealt: number;
  timesWon: number;
  winRate: number;
}

export interface CareerStats {
  lifetimeProfit: number;
  winningSessions: number;
  losingSessions: number;
  handsPlayed: number;
  handsWon: number;
  biggestPotWon: number;
  biggestPotLost: number;
  biggestSessionGain: number;
  /** Stored and returned as a positive integer (the absolute loss). */
  biggestSessionLoss: number;
  /** -1 = no ranked hands yet; 0 = high card … 9 = royal flush */
  bestHandRank: number;
  bestHandDescription: string | null;
  /** The 5 cards making up the best hand ever made (hole + board). */
  bestHandCards: Card[] | null;
  favoriteGameMode: string | null;
  archetype: string | null;
  /** Most frequently dealt starting hand (≥1 sample). */
  mostCommonHoleHand: HoleHandStat | null;
  /** Starting hand with the highest win rate (requires ≥20 times dealt). */
  bestHoleHand: HoleHandStat | null;
}
