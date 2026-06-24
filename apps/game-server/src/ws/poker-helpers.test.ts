import { describe, it, expect } from 'vitest';
import type { Card } from '@vct/shared-types';
import type { GameTableState } from '@vct/poker-engine';
import {
  isAllInRunoutTrigger,
  computePrePayoutStacks,
  isFoldWin,
  peekRabbitCards,
  autoDiscardIndex,
} from './poker-helpers.js';

// These helpers read only a handful of fields off GameTableState, so tests build
// minimal partial fixtures and cast rather than constructing a full engine state.
const state = (partial: Partial<GameTableState>): GameTableState => partial as GameTableState;

describe('isAllInRunoutTrigger', () => {
  it('is true when the street completed with extra board cards and a showdown', () => {
    expect(
      isAllInRunoutTrigger(
        state({ street: 'complete', board: ['As', 'Kd', 'Qh', 'Jc', 'Ts'] as Card[], showdownHands: [{}, {}] as never }),
        3,
      ),
    ).toBe(true);
  });

  it('is false when no extra board cards were dealt', () => {
    expect(
      isAllInRunoutTrigger(
        state({ street: 'complete', board: ['As', 'Kd', 'Qh'] as Card[], showdownHands: [{}] as never }),
        3,
      ),
    ).toBe(false);
  });

  it('is false when the street is not complete', () => {
    expect(
      isAllInRunoutTrigger(
        state({ street: 'river', board: ['As', 'Kd', 'Qh', 'Jc', 'Ts'] as Card[], showdownHands: [{}, {}] as never }),
        3,
      ),
    ).toBe(false);
  });

  it('is false when there are no showdown hands (fold win)', () => {
    expect(
      isAllInRunoutTrigger(
        state({ street: 'complete', board: ['As', 'Kd', 'Qh', 'Jc', 'Ts'] as Card[], showdownHands: [] as never }),
        3,
      ),
    ).toBe(false);
  });
});

describe('computePrePayoutStacks', () => {
  it('reverses winner payouts to recover pre-distribution stacks', () => {
    const result = computePrePayoutStacks(
      state({
        seats: [
          { seatIndex: 0, stack: 150 },
          { seatIndex: 1, stack: 50 },
        ] as never,
        winnerPayouts: [{ seatIndex: 0, amount: 100, handDescription: 'Flush' }] as never,
      }),
    );
    expect(result.get(0)).toBe(50); // won 100 → had 50 before
    expect(result.get(1)).toBe(50); // won nothing → unchanged
  });

  it('sums multiple payouts to the same seat (split pots)', () => {
    const result = computePrePayoutStacks(
      state({
        seats: [{ seatIndex: 0, stack: 200 }] as never,
        winnerPayouts: [
          { seatIndex: 0, amount: 60, handDescription: 'A' },
          { seatIndex: 0, amount: 40, handDescription: 'B' },
        ] as never,
      }),
    );
    expect(result.get(0)).toBe(100);
  });
});

describe('isFoldWin', () => {
  it('is true for a single winner with an empty hand description', () => {
    expect(isFoldWin(state({ winnerPayouts: [{ seatIndex: 0, amount: 10, handDescription: '' }] as never }))).toBe(true);
  });

  it('is false when the winner has a hand description (showdown)', () => {
    expect(isFoldWin(state({ winnerPayouts: [{ seatIndex: 0, amount: 10, handDescription: 'Pair' }] as never }))).toBe(false);
  });

  it('is false when there are multiple winners', () => {
    expect(
      isFoldWin(
        state({
          winnerPayouts: [
            { seatIndex: 0, amount: 10, handDescription: '' },
            { seatIndex: 1, amount: 10, handDescription: '' },
          ] as never,
        }),
      ),
    ).toBe(false);
  });
});

describe('peekRabbitCards', () => {
  it('returns turn then river after a flop fold (odd deck indices)', () => {
    const deck = ['2c', 'Th', '3d', 'Js', '4h'] as Card[];
    expect(peekRabbitCards(state({ board: ['As', 'Kd', 'Qh'] as Card[], deck }))).toEqual(['Th', 'Js']);
  });

  it('returns just the river after a turn fold', () => {
    const deck = ['2c', 'Th'] as Card[];
    expect(peekRabbitCards(state({ board: ['As', 'Kd', 'Qh', 'Jc'] as Card[], deck }))).toEqual(['Th']);
  });

  it('returns empty when the deck is too short', () => {
    expect(peekRabbitCards(state({ board: ['As', 'Kd', 'Qh'] as Card[], deck: ['2c'] as Card[] }))).toEqual([]);
  });

  it('returns empty preflop', () => {
    expect(peekRabbitCards(state({ board: [] as Card[], deck: ['2c', 'Th', '3d', 'Js'] as Card[] }))).toEqual([]);
  });
});

describe('autoDiscardIndex', () => {
  it('discards the single lowest rank', () => {
    expect(autoDiscardIndex(['As', 'Kd', '2h'] as Card[])).toBe(2);
  });

  it('discards the odd card when two cards tie for lowest (pocket pair)', () => {
    // 5s and 5d tie for lowest → discard the third (King)
    expect(autoDiscardIndex(['5s', '5d', 'Kh'] as Card[])).toBe(2);
  });

  it('discards a deterministic card when all three share a rank', () => {
    // rng forced to 0 → first of the tied indices
    expect(autoDiscardIndex(['9s', '9d', '9h'] as Card[], () => 0)).toBe(0);
    expect(autoDiscardIndex(['9s', '9d', '9h'] as Card[], () => 0.99)).toBe(2);
  });
});
