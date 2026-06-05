import type { Card } from '@vct/shared-types';

/** Blackjack pip value of a single card (Ace = 11 before soft reduction). */
export function getCardPip(card: Card): number {
  const rank = card[0]!;
  if (rank === 'A') return 11;
  if (rank === 'T' || rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return parseInt(rank, 10);
}

/**
 * Blackjack hand total with soft-Ace logic.
 * Returns the highest total ≤ 21, or the lowest total > 21 if bust.
 */
export function calculateTotal(cards: Card[]): { total: number; isSoft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += getCardPip(card);
    if (card[0] === 'A') aces++;
  }
  // Reduce aces from 11 → 1 as needed to stay ≤ 21
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  // isSoft: at least one ace still counted as 11
  const isSoft = aces > 0;
  return { total, isSoft };
}

/** Natural 21: exactly two cards, one ace and one ten-value card. */
export function isNaturalBlackjack(cards: Card[]): boolean {
  if (cards.length !== 2) return false;
  const { total } = calculateTotal(cards);
  if (total !== 21) return false;
  return cards.some((c) => c[0] === 'A') && cards.some((c) => getCardPip(c) === 10);
}

export function isBust(cards: Card[]): boolean {
  return calculateTotal(cards).total > 21;
}

/** Returns the rank character for split-eligibility comparison (T/J/Q/K all map to '10'). */
export function splitRankKey(card: Card): string {
  const rank = card[0]!;
  if (rank === 'T' || rank === 'J' || rank === 'Q' || rank === 'K') return '10';
  return rank;
}
