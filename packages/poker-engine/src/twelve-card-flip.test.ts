import { describe, it, expect } from 'vitest';
import { bestHand, compareHands, fastHandScore } from './evaluate.js';
import { createDeck, shuffleDeck } from './deck.js';
import {
  estimateFlipWinChances,
  createTwelveCardFlipState,
  applyFlipCard,
  getTwelveCardFlipLegalActions,
} from './twelve-card-flip.js';

const SEATED = [
  { seatIndex: 0, userId: 'a', displayName: 'A', stack: 1000 },
  { seatIndex: 1, userId: 'b', displayName: 'B', stack: 1000 },
];

describe('fastHandScore', () => {
  it('orders 12-card hands consistently with bestHand/compareHands', () => {
    const deck = createDeck();
    let mismatches = 0;
    for (let i = 0; i < 500; i++) {
      const sh = shuffleDeck(deck, Math.random);
      const a = sh.slice(0, 12);
      const b = sh.slice(12, 24);
      const real = Math.sign(compareHands(bestHand(a), bestHand(b)));
      const fast = Math.sign(fastHandScore(a) - fastHandScore(b));
      if (real !== fast) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});

describe('estimateFlipWinChances', () => {
  it('is centered when no cards are revealed', () => {
    const [a, b] = estimateFlipWinChances([[], []]);
    expect(a).toBeCloseTo(0.5, 1);
    expect(a + b).toBeCloseTo(1, 5);
  });

  it('gives ~100% to a made straight flush vs two pair with one card left', () => {
    const sf = ['9h', 'Th', 'Jh', 'Qh', 'Kh', '2c', '3d', '4s'];
    const twoPair = ['Ac', 'Ad', 'Ks', 'Kd', '2h', '3s', '4d', '5c', '6s', '7d', '8c'];
    const [a, b] = estimateFlipWinChances([sf as never, twoPair as never]);
    expect(a).toBe(1);
    expect(b).toBe(0);
  });

  it('resolves a fully-revealed hand exactly', () => {
    const winner = ['9h', 'Th', 'Jh', 'Qh', 'Kh', '2c', '3d', '4s', '5h', '6d', '7s', '8c'];
    const loser = ['Ac', 'Ad', 'Ks', 'Kd', '2h', '3s', '4d', '5c', '6s', '7d', '8c', '9d'];
    expect(estimateFlipWinChances([winner as never, loser as never])).toEqual([1, 0]);
  });

  it('is deterministic for a given revealed state', () => {
    const a = ['9h', 'Th', 'Jh', '2c', '3d'];
    const b = ['Ac', 'Ad', 'Ks', '4d', '5c'];
    const first = estimateFlipWinChances([a as never, b as never]);
    const second = estimateFlipWinChances([a as never, b as never]);
    expect(first).toEqual(second);
  });
});

describe('Multi-Card Flip — configurable card count', () => {
  for (const count of [5, 12, 26]) {
    it(`deals ${count} cards each and plays out to a single payout`, () => {
      let state = createTwelveCardFlipState(
        SEATED,
        { game: 'twelve_card_flip', buyIn: 500, twelveCardFlipAnte: 500, twelveCardFlipCardCount: count } as never,
        1,
      );
      expect(state.seats.map((s) => s.holeCards.length)).toEqual([count, count]);

      let guard = 0;
      while (state.street === 'reveal' && guard++ < 300) {
        const seat = state.actionSeatIndex!;
        if (getTwelveCardFlipLegalActions(state, seat).length === 0) break;
        const r = applyFlipCard(state, seat, `act-${guard}`);
        expect(r.ok).toBe(true);
        if (r.ok) state = r.state;
      }

      expect(state.street).toBe('complete');
      expect(state.winnerPayouts.length).toBeGreaterThan(0);
      expect(state.pots.reduce((s, p) => s + p.amount, 0)).toBe(1000);
    });
  }

  it('clamps an out-of-range card count into 5–26', () => {
    const tooMany = createTwelveCardFlipState(
      SEATED,
      { game: 'twelve_card_flip', buyIn: 500, twelveCardFlipCardCount: 40 } as never,
      1,
    );
    expect(tooMany.seats[0].holeCards.length).toBe(26);

    const tooFew = createTwelveCardFlipState(
      SEATED,
      { game: 'twelve_card_flip', buyIn: 500, twelveCardFlipCardCount: 1 } as never,
      1,
    );
    expect(tooFew.seats[0].holeCards.length).toBe(5);
  });
});
