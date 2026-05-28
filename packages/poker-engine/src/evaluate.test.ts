import { describe, expect, it } from 'vitest';
import { bestHand, compareHands, evaluateHoldem, evaluateOmaha } from './evaluate.js';
import type { Card } from '@vct/shared-types';

describe('evaluate', () => {
  it('detects royal flush', () => {
    const cards: Card[] = ['Ah', 'Kh', 'Qh', 'Jh', 'Th'];
    const hand = bestHand(cards);
    expect(hand.rank).toBe('royal_flush');
  });

  it('compares pair vs two pair', () => {
    const pair = bestHand(['Ah', 'Ad', '2c', '3h', '4s'] as Card[]);
    const twoPair = bestHand(['Ah', 'Ad', 'Kc', 'Kd', '4s'] as Card[]);
    expect(compareHands(twoPair, pair)).toBeGreaterThan(0);
  });

  it('evaluates holdem 7-card best', () => {
    const hand = evaluateHoldem(['As', 'Ks'] as Card[], ['Qs', 'Js', 'Ts', '2d', '3c'] as Card[]);
    expect(hand.rank).toBe('royal_flush');
  });

  it('evaluates omaha with exactly 2 hole', () => {
    const hand = evaluateOmaha(
      ['Ah', 'Kh', '2d', '3c'] as Card[],
      ['Qh', 'Jh', 'Th', '9d', '8c'] as Card[]
    );
    expect(['straight_flush', 'royal_flush', 'straight']).toContain(hand.rank);
  });
});
