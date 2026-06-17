import type { Card, PlayerActionType, VariantConfig } from '@vct/shared-types';
import { clampFlipCardCount, FLIP_DEFAULT_CARDS } from '@vct/shared-types';
import { createDeck, drawCards, shuffleDeck } from './deck.js';
import { bestHand, compareHands, evaluateBestAvailable, fastHandScore, type EvaluatedHand, type HandRank } from './evaluate.js';
import { buildSidePots } from './pots.js';
import type { GameTableState, InternalSeat } from './game-table.js';

/** Default per-player card count (Multi-Card Flip is configurable; see twelveCardFlipCardCount). */
export const TWELVE_CARD_FLIP_CARD_COUNT = FLIP_DEFAULT_CARDS;

/** The per-player card count for an in-progress hand, derived from the dealt cards. */
function flipCardCountOf(state: GameTableState): number {
  return state.seats[0]?.holeCards.length ?? FLIP_DEFAULT_CARDS;
}

export function createTwelveCardFlipState(
  seated: { seatIndex: number; userId: string; displayName: string; stack: number }[],
  config: VariantConfig,
  handNumber: number,
  dealerSeatIndex: number = seated[0]?.seatIndex ?? 0,
  rng: () => number = Math.random,
): GameTableState {
  if (seated.length !== 2) throw new Error('Multi-Card Flip requires exactly 2 players');
  // The dealer flips first. Fall back to the first seat if an unseated index slips through.
  const firstSeat = seated.some((s) => s.seatIndex === dealerSeatIndex)
    ? dealerSeatIndex
    : seated[0].seatIndex;

  const cardCount = clampFlipCardCount(config.twelveCardFlipCardCount);
  const deck = shuffleDeck(createDeck(), rng);
  const ante = config.twelveCardFlipAnte ?? config.buyIn;

  let remaining = deck;
  const rawSeats: Array<InternalSeat & { dealtCards: Card[] }> = seated.map((s) => {
    const { drawn, remaining: r } = drawCards(remaining, cardCount);
    remaining = r;
    const pay = Math.min(ante, s.stack);
    return {
      ...s,
      stack: s.stack - pay,
      betThisStreet: 0,
      totalBet: pay,
      folded: false,
      allIn: s.stack - pay === 0,
      holeCards: drawn,
      dealtCards: drawn,
    };
  });

  const seats: InternalSeat[] = rawSeats.map(({ dealtCards: _d, ...s }) => s);

  const pots = buildSidePots(seats.map((s) => ({ seatIndex: s.seatIndex, amount: s.totalBet })));

  const revealedCards: Record<number, Card[]> = {};
  for (const s of seats) revealedCards[s.seatIndex] = [];

  return {
    handNumber,
    street: 'reveal',
    deck: remaining,
    board: [],
    seats,
    pots,
    dealerSeatIndex: firstSeat,
    actionSeatIndex: firstSeat,
    currentBet: 0,
    minRaise: 0,
    lastAggressorSeat: null,
    lastWinningSeatIndices: [],
    winnerPayouts: [],
    processedActionIds: new Set(),
    bombPotActive: true,
    isBombPot: false,
    bombPotAmount: 0,
    isDoubleBoardBombPot: false,
    pendingActionSeatIndices: [],
    revealedCards,
  };
}

export function applyFlipCard(
  state: GameTableState,
  seatIndex: number,
  actionId: string,
): { ok: true; state: GameTableState } | { ok: false; error: string } {
  if (state.processedActionIds.has(actionId)) return { ok: true, state };
  if (state.actionSeatIndex !== seatIndex) return { ok: false, error: 'Not your turn' };
  if (state.street !== 'reveal') return { ok: false, error: 'Not in reveal phase' };

  const seat = state.seats.find((s) => s.seatIndex === seatIndex);
  if (!seat) return { ok: false, error: 'Seat not found' };

  const revealed = state.revealedCards?.[seatIndex] ?? [];
  if (revealed.length >= seat.holeCards.length) {
    return { ok: false, error: 'No more cards to reveal' };
  }

  const nextCard = seat.holeCards[revealed.length];
  const newRevealedForSeat = [...revealed, nextCard];
  const newRevealedCards: Record<number, Card[]> = {
    ...(state.revealedCards ?? {}),
    [seatIndex]: newRevealedForSeat,
  };

  const newProcessed = new Set(state.processedActionIds);
  newProcessed.add(actionId);

  const otherSeat = state.seats.find((s) => s.seatIndex !== seatIndex);
  if (!otherSeat) return { ok: false, error: 'Missing other player' };
  const otherSeatIndex = otherSeat.seatIndex;

  const activeTotal = seat.holeCards.length;
  const otherTotal = otherSeat.holeCards.length;
  const activeRev = newRevealedCards[seatIndex].length;
  const otherRev = (newRevealedCards[otherSeatIndex] ?? []).length;

  if (activeRev >= activeTotal && otherRev >= otherTotal) {
    return finalizeHand({ ...state, revealedCards: newRevealedCards, processedActionIds: newProcessed });
  }

  const nextSeat = getNextFlipSeat(newRevealedCards, seatIndex, otherSeatIndex, activeTotal, otherTotal);

  return {
    ok: true,
    state: {
      ...state,
      revealedCards: newRevealedCards,
      processedActionIds: newProcessed,
      actionSeatIndex: nextSeat,
    },
  };
}

function getNextFlipSeat(
  revealedCards: Record<number, Card[]>,
  activeSeat: number,
  otherSeat: number,
  activeTotal: number,
  otherTotal: number,
): number | null {
  const activeRev = (revealedCards[activeSeat] ?? []).length;
  const otherRev = (revealedCards[otherSeat] ?? []).length;

  if (activeRev >= activeTotal && otherRev >= otherTotal) return null;

  // Other already revealed all cards — active keeps flipping if they can
  if (otherRev >= otherTotal) return activeRev < activeTotal ? activeSeat : null;

  // Active already revealed all cards — switch to other
  if (activeRev >= activeTotal) return otherSeat;

  // Both have cards remaining — decide based on who currently leads
  const activeHand = evaluateBestAvailable(revealedCards[activeSeat] ?? []);
  const otherHand = evaluateBestAvailable(revealedCards[otherSeat] ?? []);

  // Active leads if other has no hand yet, or active hand strictly beats other
  const activeLeads = !otherHand || (activeHand !== null && compareHands(activeHand, otherHand) > 0);

  return activeLeads ? otherSeat : activeSeat;
}

function finalizeHand(
  state: GameTableState,
): { ok: true; state: GameTableState } {
  const [s0, s1] = state.seats;
  const hand0 = bestHand(s0.holeCards);
  const hand1 = bestHand(s1.holeCards);

  const newSeats = state.seats.map((s) => ({ ...s, shownCards: [...s.holeCards] }));

  const payouts: GameTableState['winnerPayouts'] = [];

  for (const pot of state.pots) {
    const eligible = newSeats.filter((s) => pot.eligibleSeatIndices.includes(s.seatIndex));
    if (eligible.length === 0) continue;

    const handOf = (s: InternalSeat): EvaluatedHand => (s.seatIndex === s0.seatIndex ? hand0 : hand1);

    let best = handOf(eligible[0]);
    for (const s of eligible) {
      const h = handOf(s);
      if (compareHands(h, best) > 0) best = h;
    }

    const winners = eligible.filter((s) => compareHands(handOf(s), best) === 0);
    const share = Math.floor(pot.amount / winners.length);
    const remainder = pot.amount - share * winners.length;

    winners.forEach((w, i) => {
      const amount = share + (i === 0 ? remainder : 0);
      newSeats.find((s) => s.seatIndex === w.seatIndex)!.stack += amount;
      payouts.push({ seatIndex: w.seatIndex, amount, handDescription: handOf(w).description, isContested: eligible.length > 1 });
    });
  }

  return {
    ok: true,
    state: {
      ...state,
      seats: newSeats,
      street: 'complete',
      actionSeatIndex: null,
      lastWinningSeatIndices: [...new Set(payouts.map((p) => p.seatIndex))],
      winnerPayouts: payouts,
    },
  };
}

export function getTwelveCardFlipLegalActions(
  state: GameTableState,
  seatIndex: number,
): Array<{ type: PlayerActionType }> {
  if (state.street !== 'reveal') return [];
  if (state.actionSeatIndex !== seatIndex) return [];
  const seat = state.seats.find((s) => s.seatIndex === seatIndex);
  const revealed = state.revealedCards?.[seatIndex] ?? [];
  if (!seat || revealed.length >= seat.holeCards.length) return [];
  return [{ type: 'flip_card' }];
}

/** Deterministic 32-bit PRNG (mulberry32) so equity is stable for a given revealed state. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromCards(cards: Card[]): number {
  let h = 2166136261;
  for (const c of cards) {
    for (let i = 0; i < c.length; i++) {
      h ^= c.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

const EQUITY_ITERATIONS = 2500;

/**
 * Estimate each seat's probability of winning the hand given only the cards
 * currently flipped face-up. The unrevealed cards are treated as unknown and
 * dealt at random from the remaining deck (Monte-Carlo), with ties counted as
 * half a win. Returns [seat0, seat1] summing to 1. Heads-up only.
 *
 * The RNG is seeded from the revealed cards so the result is stable between
 * broadcasts (the bar only moves when a new card is flipped, not on every
 * state push), while still reflecting true odds — including draws and the
 * number of cards each player has left to reveal.
 *
 * `cardCount` is the per-player total card count for this hand (Multi-Card Flip
 * is configurable, 5–26). Defaults to the standard 12.
 */
export function estimateFlipWinChances(
  revealed: Card[][],
  cardCount: number = TWELVE_CARD_FLIP_CARD_COUNT,
): [number, number] {
  if (revealed.length !== 2) return [0.5, 0.5];
  const [ra, rb] = revealed;
  const needA = Math.max(0, cardCount - ra.length);
  const needB = Math.max(0, cardCount - rb.length);

  // Both hands fully revealed — the outcome is fixed, compute it exactly.
  if (needA === 0 && needB === 0) {
    const cmp = fastHandScore(ra) - fastHandScore(rb);
    return cmp > 0 ? [1, 0] : cmp < 0 ? [0, 1] : [0.5, 0.5];
  }

  const seen = new Set([...ra, ...rb]);
  const pool = createDeck().filter((c) => !seen.has(c));
  const draw = needA + needB;
  if (draw > pool.length) return [0.5, 0.5]; // safety; should never happen

  const rng = mulberry32(seedFromCards([...ra, ...rb]));
  let aWins = 0;
  for (let i = 0; i < EQUITY_ITERATIONS; i++) {
    // Partial Fisher–Yates: randomise just the cards we need to draw.
    for (let k = 0; k < draw; k++) {
      const j = k + Math.floor(rng() * (pool.length - k));
      const tmp = pool[k];
      pool[k] = pool[j];
      pool[j] = tmp;
    }
    const fullA = needA === 0 ? ra : ra.concat(pool.slice(0, needA));
    const fullB = needB === 0 ? rb : rb.concat(pool.slice(needA, draw));
    const cmp = fastHandScore(fullA) - fastHandScore(fullB);
    if (cmp > 0) aWins += 1;
    else if (cmp === 0) aWins += 0.5;
  }

  const a = aWins / EQUITY_ITERATIONS;
  return [a, 1 - a];
}

const HAND_RANK_ORDER: HandRank[] = [
  'high_card',
  'pair',
  'two_pair',
  'three_kind',
  'straight',
  'flush',
  'full_house',
  'four_kind',
  'straight_flush',
  'royal_flush',
];

/** Compute the current lead and best hand descriptions for broadcasting. */
export function getTwelveCardFlipRevealInfo(state: GameTableState): {
  revealedCards: Card[][];
  bestHands: (string | null)[];
  bestFiveCards: (Card[] | null)[];
  bestHandRanks: number[];
  winChances: number[];
  leadingSeatIndex: number | null;
} {
  const revealedCards = state.seats.map((s) => state.revealedCards?.[s.seatIndex] ?? []);
  const hands = revealedCards.map((cards) => evaluateBestAvailable(cards));
  const bestHands = hands.map((h) => h?.description ?? null);
  const bestFiveCards = hands.map((h) => (h ? h.bestFive : null));
  const bestHandRanks = hands.map((h) => (h ? HAND_RANK_ORDER.indexOf(h.rank) : -1));
  const winChances =
    state.seats.length === 2
      ? estimateFlipWinChances(revealedCards, flipCardCountOf(state))
      : revealedCards.map(() => 1 / revealedCards.length);

  let leadingSeatIndex: number | null = null;
  if (state.seats.length === 2) {
    const h0 = hands[0];
    const h1 = hands[1];
    if (h0 && !h1) {
      leadingSeatIndex = state.seats[0].seatIndex;
    } else if (!h0 && h1) {
      leadingSeatIndex = state.seats[1].seatIndex;
    } else if (h0 && h1) {
      const cmp = compareHands(h0, h1);
      if (cmp > 0) leadingSeatIndex = state.seats[0].seatIndex;
      else if (cmp < 0) leadingSeatIndex = state.seats[1].seatIndex;
      // cmp === 0 → tied → null
    }
  }

  return { revealedCards, bestHands, bestFiveCards, bestHandRanks, winChances, leadingSeatIndex };
}
