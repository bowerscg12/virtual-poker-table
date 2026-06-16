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

/**
 * Evaluate the best possible hand from any number of cards (including < 5).
 * Returns null for 0 cards, otherwise returns the best classification possible
 * using available card count (no flush/straight when < 5 cards).
 */
export function evaluateBestAvailable(cards: Card[]): EvaluatedHand | null {
  if (cards.length === 0) return null;
  if (cards.length >= 5) return bestHand(cards);

  const parsed = cards.map((c) => ({ card: c, ...parseCard(c), value: rankValue(parseCard(c).rank) }));
  const values = parsed.map((p) => p.value).sort((a, b) => b - a);

  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  const rn = (v: number) => {
    const r = (['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as Rank[])[v - 2];
    return r === 'T' ? '10' : r;
  };

  if (groups[0][1] === 4) {
    return { rank: 'four_kind', values: [groups[0][0]], description: `Four of a Kind, ${rn(groups[0][0])}s`, bestFive: cards };
  }
  if (groups[0][1] === 3 && groups[1]?.[1] === 2) {
    return { rank: 'full_house', values: [groups[0][0], groups[1][0]], description: `Full House, ${rn(groups[0][0])}s full of ${rn(groups[1][0])}s`, bestFive: cards };
  }
  if (groups[0][1] === 3) {
    const kickers = groups.filter((g) => g[1] === 1).map((g) => g[0]);
    return { rank: 'three_kind', values: [groups[0][0], ...kickers], description: `Three of a Kind, ${rn(groups[0][0])}s`, bestFive: cards };
  }
  if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    const [hi, lo] = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    const kicker = groups.find((g) => g[1] === 1)?.[0] ?? 0;
    return { rank: 'two_pair', values: [hi, lo, kicker], description: `Two Pair, ${rn(hi)}s and ${rn(lo)}s`, bestFive: cards };
  }
  if (groups[0][1] === 2) {
    const kickers = groups.filter((g) => g[1] === 1).map((g) => g[0]);
    return { rank: 'pair', values: [groups[0][0], ...kickers], description: `Pair of ${rn(groups[0][0])}s`, bestFive: cards };
  }
  return { rank: 'high_card', values, description: `High Card, ${rn(values[0])}`, bestFive: cards };
}

/**
 * Fast O(n) score of the best 5-card poker hand contained in `cards`.
 *
 * Returns a single number where higher is strictly better and the ordering is
 * consistent with `compareHands(bestHand(a), bestHand(b))`. Unlike `bestHand`,
 * it does NOT enumerate C(n,5) combinations, so it is suitable for the millions
 * of evaluations a Monte-Carlo equity estimate performs (see the 12 Card Flip
 * win-chance estimator). It returns only a comparable score, not a full
 * `EvaluatedHand` — use `bestHand` when you need the description / bestFive.
 */
const RANK_VAL: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
};
const SUIT_IDX: Record<string, number> = { c: 0, d: 1, h: 2, s: 3 };

// Pack a category (0–8) and up to five tiebreak ranks (0–14) into one number.
function packScore(cat: number, a = 0, b = 0, c = 0, d = 0, e = 0): number {
  return ((((cat * 15 + a) * 15 + b) * 15 + c) * 15 + d) * 15 + e;
}

export function fastHandScore(cards: Card[]): number {
  const rankCount = new Array(15).fill(0); // indices 2..14
  const suitCount = [0, 0, 0, 0];
  const suitMask = [0, 0, 0, 0]; // bitmask of ranks present per suit
  let rankMask = 0; // bitmask of ranks present in any suit

  for (const card of cards) {
    const r = RANK_VAL[card[0]];
    const s = SUIT_IDX[card[1]];
    rankCount[r]++;
    suitCount[s]++;
    suitMask[s] |= 1 << r;
    rankMask |= 1 << r;
  }

  // Highest straight contained in a rank bitmask (Ace plays high or low), else 0.
  const straightHigh = (mask: number): number => {
    let m = mask;
    if (m & (1 << 14)) m |= 1 << 1; // wheel: Ace low
    for (let hi = 14; hi >= 5; hi--) {
      const run = (1 << hi) | (1 << (hi - 1)) | (1 << (hi - 2)) | (1 << (hi - 3)) | (1 << (hi - 4));
      if ((m & run) === run) return hi;
    }
    return 0;
  };

  // Straight flush
  let sfHigh = 0;
  for (let s = 0; s < 4; s++) {
    if (suitCount[s] >= 5) {
      const h = straightHigh(suitMask[s]);
      if (h > sfHigh) sfHigh = h;
    }
  }
  if (sfHigh) return packScore(8, sfHigh);

  // Group ranks by multiplicity (high → low within each group)
  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  const ranksDesc: number[] = [];
  for (let r = 14; r >= 2; r--) {
    const n = rankCount[r];
    if (n > 0) ranksDesc.push(r);
    if (n === 4) quads.push(r);
    else if (n === 3) trips.push(r);
    else if (n === 2) pairs.push(r);
  }
  const kickers = (used: number[], count: number): number[] => {
    const out: number[] = [];
    for (const r of ranksDesc) {
      if (used.includes(r)) continue;
      out.push(r);
      if (out.length === count) break;
    }
    while (out.length < count) out.push(0);
    return out;
  };

  if (quads.length) {
    return packScore(7, quads[0], kickers([quads[0]], 1)[0]);
  }
  // Full house: best trip + best remaining pair (a second trip counts as a pair)
  if (trips.length) {
    let pair = trips.length >= 2 ? trips[1] : 0;
    if (pairs.length && pairs[0] > pair) pair = pairs[0];
    if (pair) return packScore(6, trips[0], pair);
  }
  // Flush
  let flushScore = 0;
  for (let s = 0; s < 4; s++) {
    if (suitCount[s] >= 5) {
      const top: number[] = [];
      for (let r = 14; r >= 2 && top.length < 5; r--) if (suitMask[s] & (1 << r)) top.push(r);
      const sc = packScore(5, top[0], top[1], top[2], top[3], top[4]);
      if (sc > flushScore) flushScore = sc;
    }
  }
  if (flushScore) return flushScore;
  // Straight
  const sh = straightHigh(rankMask);
  if (sh) return packScore(4, sh);
  // Three of a kind
  if (trips.length) {
    const k = kickers([trips[0]], 2);
    return packScore(3, trips[0], k[0], k[1]);
  }
  // Two pair
  if (pairs.length >= 2) {
    return packScore(2, pairs[0], pairs[1], kickers([pairs[0], pairs[1]], 1)[0]);
  }
  // One pair
  if (pairs.length === 1) {
    const k = kickers([pairs[0]], 3);
    return packScore(1, pairs[0], k[0], k[1], k[2]);
  }
  // High card
  const k = kickers([], 5);
  return packScore(0, k[0], k[1], k[2], k[3], k[4]);
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
