import { describe, expect, it } from 'vitest';
import { evaluateOmaha } from './evaluate.js';
import { getVariantModule } from './variant-module.js';
import type { Card } from '@vct/shared-types';

describe('omaha module', () => {
  it('uses 4 hole cards', () => {
    const mod = getVariantModule({
      game: 'omaha',
      limit: 'pot_limit',
      maxPlayers: 9,
      blinds: { small: 5, big: 10 },
      buyIn: 500,
      minBuyIn: 100,
      maxBuyIn: 1000,
    });
    expect(mod.holeCardCount).toBe(4);
  });

  it('evaluates with exactly two hole cards', () => {
    const hand = evaluateOmaha(
      ['Ah', 'Kh', '2d', '3c'] as Card[],
      ['Qh', 'Jh', 'Th', '9d', '8c'] as Card[]
    );
    expect(hand.description).toBeTruthy();
  });
});
