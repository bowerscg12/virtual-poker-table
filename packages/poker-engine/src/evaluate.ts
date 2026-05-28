import type { Card, Rank } from '@vct/shared-types';
import { parseCard, rankValue } from './deck.js';

export type HandRank =
  | 'high_card'
  | 'pair'
  | 'two_pair'
  | 'three_kind'
  | 'straight'
  | 'flush'
  | 'full_house'
  | 'four_kind'
  | 'straight_flush'
  | 'royal_flush';

export interface EvaluatedHand {
  rank: HandRank;
  /** Higher is better; tiebreaker values */
  values: number[];
  description: string;
  bestFive: Card[];
}

const RANK_NAMES: Record<HandRank, string> = {
  high_card: 'High Card',
  pair: 'Pair',
  two_pair: 'Two Pair',
  three_kind: 'Three of a Kind',
  straight: 'Straight',
  flush: 'Flush',
  full_house: 'Full House',
  four_kind: 'Four of a Kind',
  straight_flush: 'Straight Flush',
  royal_flush: 'Royal Flush',
};

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map((c) => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

function evaluateFive(cards: Card[]): EvaluatedHand {
  const parsed = cards.map((c) => ({ card: c, ...parseCard(c), value: rankValue(parseCard(c).rank) }));
  const values = parsed.map((p) => p.value).sort((a, b) => b - a);
  const suits = parsed.map((p) => p.suit);
  const isFlush = suits.every((s) => s === suits[0]);

  const uniqueValues = [...new Set(values)].sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  const sortedUnique = [...uniqueValues].sort((a, b) => a - b);
  let isStraight = false;
  let straightHigh = 0;
  if (sortedUnique.length >= 5) {
    for (let i = 0; i <= sortedUnique.length - 5; i++) {
      let ok = true;
      for (let j = 1; j < 5; j++) {
        if (sortedUnique[i + j] !== sortedUnique[i] + j) {
          ok = false;
          break;
        }
      }
      if (ok) {
        isStraight = true;
        straightHigh = sortedUnique[i + 4];
      }
    }
    // Wheel: A-2-3-4-5
    if (sortedUnique.includes(14) && sortedUnique.includes(2) && sortedUnique.includes(3) && sortedUnique.includes(4) && sortedUnique.includes(5)) {
      isStraight = true;
      straightHigh = 5;
    }
  }

  const rankName = (v: number) => {
    const r = (['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as Rank[])[v - 2];
    return r === 'T' ? '10' : r;
  };

  if (isFlush && isStraight) {
    const isRoyal = straightHigh === 14 && isFlush;
    return {
      rank: isRoyal ? 'royal_flush' : 'straight_flush',
      values: [straightHigh],
      description: RANK_NAMES[isRoyal ? 'royal_flush' : 'straight_flush'],
      bestFive: cards,
    };
  }
  if (groups[0][1] === 4) {
    const quad = groups[0][0];
    const kicker = groups.find((g) => g[0] !== quad)?.[0] ?? 0;
    return { rank: 'four_kind', values: [quad, kicker], description: `Four of a Kind, ${rankName(quad)}s`, bestFive: cards };
  }
  if (groups[0][1] === 3 && groups[1]?.[1] === 2) {
    return {
      rank: 'full_house',
      values: [groups[0][0], groups[1][0]],
      description: `Full House, ${rankName(groups[0][0])}s full of ${rankName(groups[1][0])}s`,
      bestFive: cards,
    };
  }
  if (isFlush) {
    return { rank: 'flush', values, description: `Flush, ${rankName(values[0])} high`, bestFive: cards };
  }
  if (isStraight) {
    return { rank: 'straight', values: [straightHigh], description: `Straight, ${rankName(straightHigh)} high`, bestFive: cards };
  }
  if (groups[0][1] === 3) {
    const kickers = groups.filter((g) => g[1] === 1).map((g) => g[0]).sort((a, b) => b - a);
    return {
      rank: 'three_kind',
      values: [groups[0][0], ...kickers],
      description: `Three of a Kind, ${rankName(groups[0][0])}s`,
      bestFive: cards,
    };
  }
  if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    const [hi, lo] = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    const kicker = groups.find((g) => g[1] === 1)?.[0] ?? 0;
    return {
      rank: 'two_pair',
      values: [hi, lo, kicker],
      description: `Two Pair, ${rankName(hi)}s and ${rankName(lo)}s`,
      bestFive: cards,
    };
  }
  if (groups[0][1] === 2) {
    const pair = groups[0][0];
    const kickers = groups.filter((g) => g[1] === 1).map((g) => g[0]).sort((a, b) => b - a);
    return {
      rank: 'pair',
      values: [pair, ...kickers],
      description: `Pair of ${rankName(pair)}s`,
      bestFive: cards,
    };
  }
  return {
    rank: 'high_card',
    values,
    description: `High Card, ${rankName(values[0])}`,
    bestFive: cards,
  };
}

export function compareHands(a: EvaluatedHand, b: EvaluatedHand): number {
  const order: HandRank[] = [
    'high_card', 'pair', 'two_pair', 'three_kind', 'straight', 'flush',
    'full_house', 'four_kind', 'straight_flush', 'royal_flush',
  ];
  const ra = order.indexOf(a.rank);
  const rb = order.indexOf(b.rank);
  if (ra !== rb) return ra - rb;
  for (let i = 0; i < Math.max(a.values.length, b.values.length); i++) {
    const diff = (a.values[i] ?? 0) - (b.values[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function bestHand(cards: Card[]): EvaluatedHand {
  if (cards.length < 5) throw new Error('Need at least 5 cards');
  if (cards.length === 5) return evaluateFive(cards);
  let best: EvaluatedHand | null = null;
  for (const combo of combinations(cards, 5)) {
    const eval_ = evaluateFive(combo);
    if (!best || compareHands(eval_, best) > 0) best = eval_;
  }
  return best!;
}

/** Hold'em: best 5 of 7 */
export function evaluateHoldem(hole: Card[], board: Card[]): EvaluatedHand {
  return bestHand([...hole, ...board]);
}

/** Omaha: must use exactly 2 hole + 3 board */
export function evaluateOmaha(hole: Card[], board: Card[]): EvaluatedHand {
  if (hole.length < 4 || board.length < 3) throw new Error('Invalid Omaha cards');
  let best: EvaluatedHand | null = null;
  const holeCombos = combinations(hole, 2);
  const boardCombos = combinations(board, 3);
  for (const h of holeCombos) {
    for (const b of boardCombos) {
      const eval_ = evaluateFive([...h, ...b]);
      if (!best || compareHands(eval_, best) > 0) best = eval_;
    }
  }
  return best!;
}
