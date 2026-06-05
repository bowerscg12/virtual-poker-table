import type { Card } from '@vct/shared-types';
import { RANKS, SUITS } from '@vct/shared-types';

function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push(`${rank}${suit}` as Card);
    }
  }
  return deck;
}

export function buildShoe(numDecks: number): Card[] {
  const shoe: Card[] = [];
  for (let i = 0; i < numDecks; i++) {
    shoe.push(...createDeck());
  }
  return shoe;
}

export function shuffleShoe(shoe: Card[], random: () => number): Card[] {
  const s = [...shoe];
  for (let i = s.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = s[i]!;
    s[i] = s[j]!;
    s[j] = tmp;
  }
  return s;
}

/** Cut card goes at 75% through the shoe — reshuffle after this many cards have been drawn. */
export function getCutCardPosition(numDecks: number): number {
  return Math.floor(numDecks * 52 * 0.75);
}
