import type { Card } from '@vct/shared-types';
import type { BlackjackActionType } from './types.js';
import { calculateTotal, getCardPip, splitRankKey } from './hand.js';

/** The subset of actions basic strategy can choose (insurance is a separate side decision). */
export type BasicStrategyAction = Exclude<BlackjackActionType, 'insurance'>;

export interface BasicStrategyOptions {
  /** Whether doubling is currently legal for this hand. */
  canDouble: boolean;
  /** Whether splitting is currently legal for this hand. */
  canSplit: boolean;
  /** Whether late surrender is currently legal for this hand. */
  canSurrender: boolean;
}

/**
 * Textbook multi-deck basic strategy (dealer stands on soft 17). Returns the optimal action for a
 * two-or-more card hand against the dealer up-card. When a "double" is indicated but illegal
 * (e.g. the hand has more than two cards), it falls back to hit; an indicated split that is illegal
 * falls back to the hard-total decision. Pure and deterministic — unit-tested in strategy.test.ts.
 */
export function decideBlackjackAction(
  cards: Card[],
  dealerUpcard: Card,
  opts: BasicStrategyOptions,
): BasicStrategyAction {
  const up = dealerPipValue(dealerUpcard); // 2..11 (Ace = 11)
  const { total, isSoft } = calculateTotal(cards);

  // ── Pairs ────────────────────────────────────────────────────────────────
  if (opts.canSplit && cards.length === 2 && splitRankKey(cards[0]!) === splitRankKey(cards[1]!)) {
    const rank = splitRankKey(cards[0]!); // '2'..'9', '10', 'A'
    if (shouldSplit(rank, up)) return 'split';
  }

  // ── Late surrender (hard hands only) ───────────────────────────────────────
  if (opts.canSurrender && !isSoft) {
    if (total === 16 && (up === 9 || up === 10 || up === 11)) return 'surrender';
    if (total === 15 && up === 10) return 'surrender';
  }

  // ── Soft totals ─────────────────────────────────────────────────────────────
  if (isSoft) {
    return softTotalAction(total, up, opts.canDouble);
  }

  // ── Hard totals ──────────────────────────────────────────────────────────────
  return hardTotalAction(total, up, opts.canDouble);
}

function dealerPipValue(card: Card): number {
  return getCardPip(card); // Ace → 11, ten-values → 10
}

/** Pair-splitting chart (multi-deck, DAS allowed). */
function shouldSplit(rank: string, up: number): boolean {
  switch (rank) {
    case 'A': return true;
    case '10': return false; // never split tens
    case '9': return up !== 7 && up >= 2 && up <= 9; // split 2-6,8,9; stand 7,10,A
    case '8': return true;
    case '7': return up >= 2 && up <= 7;
    case '6': return up >= 2 && up <= 6;
    case '5': return false; // treat as hard 10
    case '4': return up === 5 || up === 6;
    case '3': return up >= 2 && up <= 7;
    case '2': return up >= 2 && up <= 7;
    default: return false;
  }
}

/** Soft-total chart. Returns double when legal & indicated, else hit/stand. */
function softTotalAction(total: number, up: number, canDouble: boolean): BasicStrategyAction {
  const dbl = (cond: boolean): BasicStrategyAction => (cond && canDouble ? 'double_down' : 'hit');
  switch (total) {
    case 20: return 'stand';              // A,9
    case 19: return 'stand';              // A,8
    case 18:                              // A,7
      if (up >= 3 && up <= 6) return canDouble ? 'double_down' : 'stand';
      if (up === 2 || up === 7 || up === 8) return 'stand';
      return 'hit';                       // 9,10,A
    case 17: return dbl(up >= 3 && up <= 6); // A,6
    case 16: return dbl(up >= 4 && up <= 6); // A,5
    case 15: return dbl(up >= 4 && up <= 6); // A,4
    case 14: return dbl(up >= 5 && up <= 6); // A,3
    case 13: return dbl(up >= 5 && up <= 6); // A,2
    default: return 'hit';
  }
}

/** Hard-total chart. */
function hardTotalAction(total: number, up: number, canDouble: boolean): BasicStrategyAction {
  if (total >= 17) return 'stand';
  if (total >= 13 && total <= 16) return up >= 2 && up <= 6 ? 'stand' : 'hit';
  if (total === 12) return up >= 4 && up <= 6 ? 'stand' : 'hit';
  if (total === 11) return canDouble ? 'double_down' : 'hit';
  if (total === 10) return up >= 2 && up <= 9 ? (canDouble ? 'double_down' : 'hit') : 'hit';
  if (total === 9) return up >= 3 && up <= 6 ? (canDouble ? 'double_down' : 'hit') : 'hit';
  return 'hit'; // 5-8
}
