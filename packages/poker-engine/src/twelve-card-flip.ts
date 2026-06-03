import type { Card, PlayerActionType, VariantConfig } from '@vct/shared-types';
import { createDeck, drawCards, shuffleDeck } from './deck.js';
import { bestHand, compareHands, evaluateBestAvailable, type EvaluatedHand } from './evaluate.js';
import { buildSidePots } from './pots.js';
import type { GameTableState, InternalSeat } from './game-table.js';

export const TWELVE_CARD_FLIP_CARD_COUNT = 12;

export function createTwelveCardFlipState(
  seated: { seatIndex: number; userId: string; displayName: string; stack: number }[],
  config: VariantConfig,
  handNumber: number,
  rng: () => number = Math.random,
): GameTableState {
  if (seated.length !== 2) throw new Error('12 Card Flip requires exactly 2 players');

  const deck = shuffleDeck(createDeck(), rng);
  const ante = config.twelveCardFlipAnte ?? config.buyIn;

  let remaining = deck;
  const rawSeats: Array<InternalSeat & { dealtCards: Card[] }> = seated.map((s) => {
    const { drawn, remaining: r } = drawCards(remaining, TWELVE_CARD_FLIP_CARD_COUNT);
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
    dealerSeatIndex: seated[0].seatIndex,
    actionSeatIndex: seated[0].seatIndex,
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
  if (revealed.length >= TWELVE_CARD_FLIP_CARD_COUNT) {
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

  const activeRev = newRevealedCards[seatIndex].length;
  const otherRev = (newRevealedCards[otherSeatIndex] ?? []).length;

  if (activeRev >= TWELVE_CARD_FLIP_CARD_COUNT && otherRev >= TWELVE_CARD_FLIP_CARD_COUNT) {
    return finalizeHand({ ...state, revealedCards: newRevealedCards, processedActionIds: newProcessed });
  }

  const nextSeat = getNextFlipSeat(newRevealedCards, seatIndex, otherSeatIndex);

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
): number | null {
  const TOTAL = TWELVE_CARD_FLIP_CARD_COUNT;
  const activeRev = (revealedCards[activeSeat] ?? []).length;
  const otherRev = (revealedCards[otherSeat] ?? []).length;

  if (activeRev >= TOTAL && otherRev >= TOTAL) return null;

  // Other already revealed all cards — active keeps flipping if they can
  if (otherRev >= TOTAL) return activeRev < TOTAL ? activeSeat : null;

  // Active already revealed all cards — switch to other
  if (activeRev >= TOTAL) return otherSeat;

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
      payouts.push({ seatIndex: w.seatIndex, amount, handDescription: handOf(w).description });
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
  const revealed = state.revealedCards?.[seatIndex] ?? [];
  if (revealed.length >= TWELVE_CARD_FLIP_CARD_COUNT) return [];
  return [{ type: 'flip_card' }];
}

/** Compute the current lead and best hand descriptions for broadcasting. */
export function getTwelveCardFlipRevealInfo(state: GameTableState): {
  revealedCards: Card[][];
  bestHands: (string | null)[];
  leadingSeatIndex: number | null;
} {
  const revealedCards = state.seats.map((s) => state.revealedCards?.[s.seatIndex] ?? []);
  const hands = revealedCards.map((cards) => evaluateBestAvailable(cards));
  const bestHands = hands.map((h) => h?.description ?? null);

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

  return { revealedCards, bestHands, leadingSeatIndex };
}
