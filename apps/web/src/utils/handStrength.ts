import type { Card } from '@vct/shared-types';

// ── Rank helpers ─────────────────────────────────────────────────────────────

const RANK_ORDER = '23456789TJQKA';

function rankChar(card: Card): string { return card[0]; }
function suitChar(card: Card): string { return card[1]; }
function rankValue(r: string): number { return RANK_ORDER.indexOf(r); }

// Display for "[X] High" labels
const RANK_HIGH: Record<string, string> = {
  '2': '2', '3': '3', '4': '4', '5': '5',
  '6': '6', '7': '7', '8': '8', '9': '9',
  'T': '10', 'J': 'Jack', 'Q': 'Queen', 'K': 'King', 'A': 'Ace',
};

// Plural form used in "Pocket [X]" labels
const RANK_PLURAL: Record<string, string> = {
  '2': 'Twos', '3': 'Threes', '4': 'Fours', '5': 'Fives',
  '6': 'Sixes', '7': 'Sevens', '8': 'Eights', '9': 'Nines',
  'T': 'Tens', 'J': 'Jacks', 'Q': 'Queens', 'K': 'Kings', 'A': 'Aces',
};

// ── Pre-flop label ────────────────────────────────────────────────────────────

/**
 * Pre-flop label using hole cards only.
 * Works for both Hold'em (2 cards) and Omaha (4 cards) — uses best pocket pair
 * or highest card.
 */
export function getPreFlopLabel(holeCards: Card[]): string {
  if (holeCards.length < 2) return '';
  const ranks = holeCards.map(rankChar);

  const counts = new Map<string, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);

  const pairs = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([r]) => r)
    .sort((a, b) => rankValue(b) - rankValue(a));

  if (pairs.length > 0) return `Pocket ${RANK_PLURAL[pairs[0]]}`;

  const high = ranks.reduce((best, r) => rankValue(r) > rankValue(best) ? r : best);
  return `${RANK_HIGH[high]} High`;
}

// ── Simple 5-card evaluator (display only, no tiebreakers needed) ─────────────

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [head, ...tail] = arr;
  return [
    ...combinations(tail, k - 1).map((c) => [head, ...c]),
    ...combinations(tail, k),
  ];
}

/**
 * Returns a numeric rank (0–9) for exactly 5 cards.
 * Higher = better hand.
 */
function evaluate5(cards: Card[]): number {
  const ranks = cards.map((c) => rankValue(rankChar(c))).sort((a, b) => b - a);
  const suits = cards.map(suitChar);

  const isFlush = suits.every((s) => s === suits[0]);
  const uniqueRanks = new Set(ranks);

  const isNormalStraight = uniqueRanks.size === 5 && ranks[0] - ranks[4] === 4;
  // Wheel: A-2-3-4-5 → sorted desc = [12,3,2,1,0]
  const isWheel =
    uniqueRanks.size === 5 &&
    ranks[0] === 12 && ranks[1] === 3 && ranks[2] === 2 && ranks[3] === 1 && ranks[4] === 0;
  const isStraight = isNormalStraight || isWheel;

  if (isFlush && isStraight) {
    return (ranks[0] === 12 && ranks[1] === 11 && !isWheel) ? 9 : 8; // royal : straight flush
  }

  const countMap = new Map<number, number>();
  for (const r of ranks) countMap.set(r, (countMap.get(r) ?? 0) + 1);
  const counts = [...countMap.values()].sort((a, b) => b - a);

  if (counts[0] === 4) return 7;
  if (counts[0] === 3 && counts[1] === 2) return 6;
  if (isFlush) return 5;
  if (isStraight) return 4;
  if (counts[0] === 3) return 3;
  if (counts[0] === 2 && counts[1] === 2) return 2;
  if (counts[0] === 2) return 1;
  return 0;
}

const HAND_NAMES: Record<number, string> = {
  0: 'High Card',
  1: 'Pair',
  2: 'Two Pair',
  3: 'Three of a Kind',
  4: 'Straight',
  5: 'Flush',
  6: 'Full House',
  7: 'Four of a Kind',
  8: 'Straight Flush',
  9: 'Royal Flush',
};

function bestFrom(cards: Card[]): { rank: number; highChar: string } {
  const combos = combinations(cards, 5);
  let bestRank = -1;
  let bestHigh = '2';
  for (const combo of combos) {
    const r = evaluate5(combo);
    if (r > bestRank) {
      bestRank = r;
      bestHigh = combo.map(rankChar).reduce((b, c) => (rankValue(c) > rankValue(b) ? c : b));
    }
  }
  return { rank: bestRank, highChar: bestHigh };
}

function formatResult(rank: number, highChar: string): string {
  if (rank === 0) return `${RANK_HIGH[highChar] ?? highChar} High`;
  return HAND_NAMES[rank] ?? '';
}

// ── Post-flop labels ──────────────────────────────────────────────────────────

function getHoldemLabel(holeCards: Card[], board: Card[]): string {
  const { rank, highChar } = bestFrom([...holeCards, ...board]);
  return formatResult(rank, highChar);
}

function getOmahaLabel(holeCards: Card[], board: Card[]): string {
  if (holeCards.length < 4 || board.length < 3) return '';
  const holePairs = combinations(holeCards, 2);
  const boardTriples = combinations(board, 3);
  let bestRank = -1;
  let bestHigh = '2';
  for (const hp of holePairs) {
    for (const bt of boardTriples) {
      const combo = [...hp, ...bt] as Card[];
      const r = evaluate5(combo);
      if (r > bestRank) {
        bestRank = r;
        bestHigh = combo.map(rankChar).reduce((b, c) => (rankValue(c) > rankValue(b) ? c : b));
      }
    }
  }
  return formatResult(bestRank, bestHigh);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the display label to show under the player's hole cards.
 *
 * - Pre-flop (board empty): "Pocket Aces", "King High", etc.
 * - Post-flop: "Flush", "Two Pair", "Ace High", etc.
 * - Returns '' when there aren't enough cards to evaluate.
 */
export function getHandStrengthLabel(
  holeCards: Card[],
  board: Card[],
  variant: string,
): string {
  if (holeCards.length < 2) return '';

  if (board.length === 0) return getPreFlopLabel(holeCards);

  if (variant === 'omaha' || variant === 'plo8') {
    return getOmahaLabel(holeCards, board);
  }

  return getHoldemLabel(holeCards, board);
}
