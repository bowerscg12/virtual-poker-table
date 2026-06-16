import type { Card, Suit } from './cards.js';

/**
 * 1v1 hole-card side bets — private wagers between two seated players, evaluated
 * purely from hole cards and completely independent of the poker pot, side pots,
 * hand evaluation, and showdown.
 */
export type SideBetType =
  | 'highest_suit' // highest hole card of the chosen suit wins (needs `suit`)
  | 'lowest_suit' // lowest hole card of the chosen suit wins (needs `suit`)
  | 'highest_sum' // highest blackjack-value sum of hole cards wins
  | 'lowest_sum'; // lowest blackjack-value sum of hole cards wins

export type SideBetStatus =
  | 'pending' // challenge sent, awaiting target's accept/decline
  | 'accepted' // accepted, queued for the next hand
  | 'declined' // target declined (terminal)
  | 'active' // bound to a hand in progress; result computed and stored internally
  | 'settled' // resolved and paid out (terminal)
  | 'expired'; // never bound to a hand (e.g. a participant wasn't dealt in) — terminal

export interface SideBetChallenge {
  id: string;
  challengerUserId: string;
  challengerName: string;
  targetUserId: string;
  targetName: string;
  type: SideBetType;
  /** Present only for `highest_suit` / `lowest_suit`. */
  suit?: Suit;
  wager: number;
  status: SideBetStatus;
}

/** One participant's side of a resolved bet — sent to clients only after the hand ends. */
export interface SideBetParticipantResult {
  userId: string;
  name: string;
  /** The two (or more) hole cards used for evaluation. */
  cards: Card[];
  /** Human-readable evaluation value, e.g. "A♠ (14)" for suit bets or "21" for sum bets. */
  value: string;
}

export interface SideBetResult {
  betId: string;
  type: SideBetType;
  suit?: Suit;
  wager: number;
  /** Winning user id, or null for a push. */
  winnerUserId: string | null;
  push: boolean;
  /** Actual chips transferred (clamped to the loser's remaining stack). */
  payout: number;
  challenger: SideBetParticipantResult;
  target: SideBetParticipantResult;
}
