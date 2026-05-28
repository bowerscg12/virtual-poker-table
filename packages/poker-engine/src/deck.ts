import type { Card, Rank, Suit } from '@vct/shared-types';
import { RANKS, SUITS } from '@vct/shared-types';

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push(`${rank}${suit}` as Card);
    }
  }
  return deck;
}

/** Fisher-Yates shuffle with injected RNG (0..1) */
export function shuffleDeck(deck: Card[], random: () => number = Math.random): Card[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export function drawCards(deck: Card[], count: number): { drawn: Card[]; remaining: Card[] } {
  const drawn = deck.slice(0, count);
  const remaining = deck.slice(count);
  return { drawn, remaining };
}

export function rankValue(rank: Rank): number {
  const map: Record<Rank, number> = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
  };
  return map[rank];
}

export function parseCard(card: Card): { rank: Rank; suit: Suit } {
  return { rank: card[0] as Rank, suit: card[1] as Suit };
}
