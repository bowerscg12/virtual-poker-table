import { describe, expect, it } from 'vitest';
import type { VariantConfig } from '@vct/shared-types';
import { computeLegalActions, nextActiveSeat } from './holdem.js';

const noLimitConfig: VariantConfig = {
  game: 'holdem',
  limit: 'no_limit',
  maxPlayers: 8,
  blinds: { small: 5, big: 50 },
  buyIn: 1000,
  minBuyIn: 1000,
  maxBuyIn: 1000,
};

describe('nextActiveSeat', () => {
  it('wraps around after the last seat', () => {
    const result = nextActiveSeat([0, 1], 2, () => true);
    expect(result).toBe(0);
  });

  it('skips inactive seats while wrapping', () => {
    const result = nextActiveSeat([0, 1, 2], 3, (idx) => idx !== 0);
    expect(result).toBe(1);
  });
});

describe('computeLegalActions', () => {
  it('uses the current bet and minimum raise to set the legal raise range', () => {
    const player = {
      seatIndex: 0,
      stack: 1200,
      betThisStreet: 0,
      totalBet: 0,
      folded: false,
      allIn: false,
    };

    const legalActions = computeLegalActions(player, [player], 200, 200, 'flop', noLimitConfig);
    const raise = legalActions.find((action) => action.type === 'raise');

    expect(raise).toMatchObject({
      minAmount: 400,
      maxAmount: 1200,
    });
  });

  it('does not expose a raise when the player cannot cover the minimum raise', () => {
    const player = {
      seatIndex: 0,
      stack: 100,
      betThisStreet: 150,
      totalBet: 150,
      folded: false,
      allIn: false,
    };

    const legalActions = computeLegalActions(player, [player], 200, 200, 'turn', noLimitConfig);

    expect(legalActions.some((action) => action.type === 'raise')).toBe(false);
    expect(legalActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'call', amount: 50 }),
        expect.objectContaining({ type: 'all_in', amount: 100 }),
      ])
    );
  });
});
