import { describe, expect, it } from 'vitest';
import type { Card, VariantConfig } from '@vct/shared-types';
import { createBombPotTable, type InternalSeat } from './game-table.js';
import { compareHands, evaluateHoldem, evaluateOmaha, type EvaluatedHand } from './evaluate.js';

const holdem: VariantConfig = {
  game: 'holdem',
  limit: 'no_limit',
  maxPlayers: 9,
  blinds: { small: 5, big: 10 },
  buyIn: 500,
  minBuyIn: 500,
  maxBuyIn: 2000,
};

const omaha: VariantConfig = { ...holdem, game: 'omaha', limit: 'pot_limit' };

const players = (stacks: number[]) =>
  stacks.map((stack, i) => ({ seatIndex: i, userId: `u${i}`, displayName: `P${i}`, stack }));

const zeroRng = () => 0; // deterministic shuffle
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

/** Independently determine the winning seat indices on a board (all seats eligible). */
function bestSeatsOn(seats: InternalSeat[], board: Card[], evalFn: (h: Card[], b: Card[]) => EvaluatedHand): number[] {
  let best: EvaluatedHand | null = null;
  const winners: number[] = [];
  for (const s of seats) {
    const h = evalFn(s.holeCards, board);
    if (!best || compareHands(h, best) > 0) {
      best = h;
      winners.length = 0;
      winners.push(s.seatIndex);
    } else if (compareHands(h, best) === 0) {
      winners.push(s.seatIndex);
    }
  }
  return winners.sort((a, b) => a - b);
}

describe('createBombPotTable — single board', () => {
  it('deals Hold\'em hole cards, collects the ante, seeds the pot, and skips betting', () => {
    const state = createBombPotTable(players([500, 500, 500]), holdem, 1, 0, 100, false, zeroRng);

    expect(state.isBombPot).toBe(true);
    expect(state.isDoubleBoardBombPot).toBe(false);
    expect(state.bombPotAmount).toBe(100);
    expect(state.street).toBe('complete');     // no betting round ever exists
    expect(state.actionSeatIndex).toBeNull();
    expect(state.currentBet).toBe(0);
    expect(state.board).toHaveLength(5);
    expect(state.secondBoard).toBeUndefined();

    for (const s of state.seats) {
      expect(s.holeCards).toHaveLength(2);     // Hold'em
      expect(s.totalBet).toBe(100);            // each contributed the ante
    }
    // Pot fully distributed: chips are conserved.
    expect(sum(state.seats.map((s) => s.stack))).toBe(1500);
  });

  it('deals 4 hole cards for Omaha', () => {
    const state = createBombPotTable(players([500, 500]), omaha, 1, 0, 50, false, zeroRng);
    for (const s of state.seats) expect(s.holeCards).toHaveLength(4);
    expect(sum(state.seats.map((s) => s.stack))).toBe(1000);
  });

  it('puts a short-stacked player all-in and builds the right side pots', () => {
    const state = createBombPotTable(players([30, 500, 500]), holdem, 1, 0, 100, false, zeroRng);

    const shorty = state.seats.find((s) => s.userId === 'u0')!;
    expect(shorty.totalBet).toBe(30);          // capped at stack

    // Main pot 30*3 = 90 (all eligible); side pot 70*2 = 140 (only the deep stacks).
    const potAmounts = state.pots.map((p) => p.amount).sort((a, b) => a - b);
    expect(potAmounts).toEqual([90, 140]);
    const sidePot = state.pots.find((p) => p.amount === 140)!;
    expect(sidePot.eligibleSeatIndices.sort()).toEqual([1, 2]);

    expect(sum(state.seats.map((s) => s.stack))).toBe(1030); // chips conserved
  });

  it('only includes the participants passed in', () => {
    const state = createBombPotTable(players([500, 500]), holdem, 1, 0, 100, false, zeroRng);
    expect(state.seats.map((s) => s.userId).sort()).toEqual(['u0', 'u1']);
  });
});

describe('createBombPotTable — double board', () => {
  it('deals two independent 5-card boards', () => {
    const state = createBombPotTable(players([500, 500, 500]), holdem, 1, 0, 100, true, zeroRng);
    expect(state.isDoubleBoardBombPot).toBe(true);
    expect(state.board).toHaveLength(5);
    expect(state.secondBoard).toHaveLength(5);
    // Boards must not share any card.
    expect(state.board.some((c) => state.secondBoard!.includes(c))).toBe(false);
  });

  it('splits the pot 50/50 and awards each half to its board winner (verified independently)', () => {
    const state = createBombPotTable(players([500, 500, 500]), holdem, 1, 0, 100, true, zeroRng);

    const total = 300; // 3 * 100
    const aPayouts = state.winnerPayouts.filter((p) => p.board === 'A');
    const bPayouts = state.winnerPayouts.filter((p) => p.board === 'B');

    // Half-split (odd chip favors Board A).
    expect(sum(aPayouts.map((p) => p.amount))).toBe(Math.ceil(total / 2));
    expect(sum(bPayouts.map((p) => p.amount))).toBe(Math.floor(total / 2));
    expect(sum(state.winnerPayouts.map((p) => p.amount))).toBe(total);

    // Winners match an independent evaluation of the engine's own dealt cards.
    const expectedA = bestSeatsOn(state.seats, state.board, evaluateHoldem);
    const expectedB = bestSeatsOn(state.seats, state.secondBoard!, evaluateHoldem);
    expect([...new Set(aPayouts.map((p) => p.seatIndex))].sort((a, b) => a - b)).toEqual(expectedA);
    expect([...new Set(bPayouts.map((p) => p.seatIndex))].sort((a, b) => a - b)).toEqual(expectedB);

    // Chips conserved.
    expect(sum(state.seats.map((s) => s.stack))).toBe(1500);
  });

  it('lets the same player scoop both boards (full pot)', () => {
    // Whatever the deal, a player winning both boards must receive the entire pot.
    const state = createBombPotTable(players([500, 500, 500]), holdem, 1, 0, 100, true, zeroRng);
    const a = bestSeatsOn(state.seats, state.board, evaluateHoldem);
    const b = bestSeatsOn(state.seats, state.secondBoard!, evaluateHoldem);
    if (a.length === 1 && b.length === 1 && a[0] === b[0]) {
      const scooper = a[0];
      const won = sum(state.winnerPayouts.filter((p) => p.seatIndex === scooper).map((p) => p.amount));
      expect(won).toBe(300);
    }
    // Always true regardless: total distributed equals the pot.
    expect(sum(state.winnerPayouts.map((p) => p.amount))).toBe(300);
  });

  it('handles Omaha double boards with chip conservation', () => {
    const state = createBombPotTable(players([500, 500]), omaha, 1, 0, 80, true, zeroRng);
    expect(state.board).toHaveLength(5);
    expect(state.secondBoard).toHaveLength(5);
    const expectedA = bestSeatsOn(state.seats, state.board, evaluateOmaha);
    const aPayouts = state.winnerPayouts.filter((p) => p.board === 'A');
    expect([...new Set(aPayouts.map((p) => p.seatIndex))].sort((a, b) => a - b)).toEqual(expectedA);
    expect(sum(state.seats.map((s) => s.stack))).toBe(1000);
  });
});
