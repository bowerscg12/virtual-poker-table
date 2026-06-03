import { describe, expect, it } from 'vitest';
import type { VariantConfig } from '@vct/shared-types';
import { applyAction, createInitialTable } from './game-table.js';

const config: VariantConfig = {
  game: 'holdem',
  limit: 'no_limit',
  maxPlayers: 8,
  blinds: { small: 5, big: 10 },
  buyIn: 500,
  minBuyIn: 500,
  maxBuyIn: 2000,
};

const players = [
  { seatIndex: 0, userId: 'u0', displayName: 'A', stack: 500 },
  { seatIndex: 1, userId: 'u1', displayName: 'B', stack: 500 },
  { seatIndex: 2, userId: 'u2', displayName: 'C', stack: 500 },
];

function expectOk<T extends { ok: true; state: unknown } | { ok: false; error: string }>(
  result: T
): asserts result is Extract<T, { ok: true }> {
  expect(result.ok).toBe(true);
}

describe('game-table betting flow', () => {
  it('requires every active player to act before advancing the street', () => {
    let state = createInitialTable(players, config, 1, 0, () => 0.5);
    expect(state.street).toBe('preflop');
    expect(state.actionSeatIndex).toBe(0);

    const preflopActions = [
      { seatIndex: 0, action: 'call' as const, amount: 10 },
      { seatIndex: 1, action: 'call' as const, amount: 5 },
      { seatIndex: 2, action: 'check' as const },
    ];

    for (const [index, action] of preflopActions.entries()) {
      const result = applyAction(state, config, action.seatIndex, action.action, action.amount, `pre-${index}`);
      expectOk(result);
      state = result.state;
    }

    expect(state.street).toBe('flop');
    expect(state.actionSeatIndex).toBe(1);

    const flopChecks = [1, 2, 0];
    for (const [index, seatIndex] of flopChecks.entries()) {
      const result = applyAction(state, config, seatIndex, 'check', undefined, `flop-${index}`);
      expectOk(result);
      state = result.state;
      if (index < 2) {
        expect(state.street).toBe('flop');
      }
    }

    expect(state.street).toBe('turn');
    expect(state.actionSeatIndex).toBe(1);
  });

  it('resets the action queue after a raise', () => {
    let state = createInitialTable(players, config, 1, 0, () => 0.5);

    const preflopActions = [
      { seatIndex: 0, action: 'call' as const, amount: 10 },
      { seatIndex: 1, action: 'call' as const, amount: 5 },
      { seatIndex: 2, action: 'check' as const },
    ];

    for (const [index, action] of preflopActions.entries()) {
      const result = applyAction(state, config, action.seatIndex, action.action, action.amount, `pre-reset-${index}`);
      expectOk(result);
      state = result.state;
    }

    expect(state.street).toBe('flop');
    expect(state.actionSeatIndex).toBe(1);

    let result = applyAction(state, config, 1, 'raise', 50, 'flop-bet');
    expectOk(result);
    state = result.state;
    expect(state.actionSeatIndex).toBe(2);

    result = applyAction(state, config, 2, 'raise', 100, 'flop-raise');
    expectOk(result);
    state = result.state;
    expect(state.actionSeatIndex).toBe(0);

    result = applyAction(state, config, 0, 'call', undefined, 'flop-call-a');
    expectOk(result);
    state = result.state;
    expect(state.actionSeatIndex).toBe(1);

    result = applyAction(state, config, 1, 'call', undefined, 'flop-call-b');
    expectOk(result);
    state = result.state;
    expect(state.street).toBe('turn');
    expect(state.actionSeatIndex).toBe(1);
  });
});
