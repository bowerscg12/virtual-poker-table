import type { Card } from '@vct/shared-types';
import type { BlackjackTableState } from './types.js';
import { calculateTotal } from './hand.js';

/** Returns true when the dealer must draw another card per standard casino rules. */
export function dealerShouldHit(
  total: number,
  isSoft: boolean,
  softSeventeenRule: 'hit' | 'stand',
): boolean {
  if (total < 17) return true;
  if (total === 17 && isSoft && softSeventeenRule === 'hit') return true;
  return false;
}

/**
 * Run the full dealer AI: reveal hole card, hit until standing or bust.
 * Returns the updated state with dealer cards and shoe consumed.
 * softSeventeenRule: 'hit' = dealer hits soft 17, 'stand' = dealer stands.
 */
export function runDealerAI(
  state: BlackjackTableState,
  softSeventeenRule: 'hit' | 'stand',
): BlackjackTableState {
  let cards: Card[] = [...state.dealer.cards];
  let shoe = [...state.shoe];

  while (true) {
    const { total, isSoft } = calculateTotal(cards);
    if (!dealerShouldHit(total, isSoft, softSeventeenRule)) break;
    if (shoe.length === 0) break; // Shoe exhausted — dealer stands on what it has.
    const [next, ...rest] = shoe as [Card, ...Card[]];
    cards = [...cards, next];
    shoe = rest;
  }

  return {
    ...state,
    shoe,
    dealer: { cards, holeCardRevealed: true },
  };
}
