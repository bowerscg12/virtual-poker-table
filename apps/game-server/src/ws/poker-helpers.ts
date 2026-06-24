import type { Card } from '@vct/shared-types';
import type { GameTableState } from '@vct/poker-engine';

/** True when a game action triggered an all-in board runout (cards were auto-dealt to showdown). */
export function isAllInRunoutTrigger(newState: GameTableState, preBoardCount: number): boolean {
  return (
    newState.street === 'complete' &&
    (newState.board?.length ?? 0) > preBoardCount &&
    (newState.showdownHands?.length ?? 0) > 0
  );
}

/**
 * Compute each seat's stack as it was immediately before pots were awarded.
 * The engine state has already applied winnerPayouts to seat.stack; we reverse that here.
 */
export function computePrePayoutStacks(finalState: GameTableState): Map<number, number> {
  const wonBySeat = new Map<number, number>();
  for (const payout of finalState.winnerPayouts) {
    wonBySeat.set(payout.seatIndex, (wonBySeat.get(payout.seatIndex) ?? 0) + payout.amount);
  }
  const stacks = new Map<number, number>();
  for (const seat of finalState.seats) {
    stacks.set(seat.seatIndex, seat.stack - (wonBySeat.get(seat.seatIndex) ?? 0));
  }
  return stacks;
}

/** True when the hand ended because everyone else folded (single winner, no showdown). */
export function isFoldWin(state: GameTableState): boolean {
  return state.winnerPayouts.length === 1 && state.winnerPayouts[0].handDescription === '';
}

/**
 * Peek at the next community cards that would have been dealt from the remaining deck.
 * Returns the turn+river for a flop fold, or the river for a turn fold. Empty otherwise.
 * Deck layout: each street burns 1 then deals, so the real cards are at odd indices.
 */
export function peekRabbitCards(state: GameTableState): Card[] {
  if (state.board.length === 3 && state.deck.length >= 4) {
    return [state.deck[1], state.deck[3]]; // turn then river
  }
  if (state.board.length === 4 && state.deck.length >= 2) {
    return [state.deck[1]]; // river
  }
  return [];
}

const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;

/**
 * Auto-select the card to discard from 3 hole cards.
 * Rules: discard lowest rank. If two cards tie for lowest (a pocket pair), discard the odd card.
 * If all three are the same rank, discard a random one.
 */
export function autoDiscardIndex(holeCards: Card[], rng: () => number = Math.random): number {
  const rankOf = (c: Card) => RANK_ORDER.indexOf(c[0] as typeof RANK_ORDER[number]);
  const ranks = holeCards.map(rankOf);
  const minRank = Math.min(...ranks);
  const minIndices = ranks.map((r, i) => r === minRank ? i : -1).filter((i) => i !== -1);

  if (minIndices.length === 3) {
    // All three same rank — discard random
    return minIndices[Math.floor(rng() * 3)];
  }
  if (minIndices.length === 2) {
    // Two tied for lowest (pocket pair) — discard the third (odd) card
    const oddIdx = ranks.findIndex((_, i) => !minIndices.includes(i));
    return oddIdx;
  }
  // One clear lowest — discard it
  return minIndices[0];
}
