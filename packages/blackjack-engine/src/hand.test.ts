import { describe, it, expect } from 'vitest';
import { calculateTotal, isNaturalBlackjack, isBust, splitRankKey } from './hand.js';
import type { Card } from '@vct/shared-types';

function c(s: string): Card { return s as Card; }

describe('calculateTotal', () => {
  it('simple hand', () => {
    expect(calculateTotal([c('5h'), c('9d')])).toEqual({ total: 14, isSoft: false });
  });

  it('soft ace counted as 11', () => {
    expect(calculateTotal([c('Ah'), c('6c')])).toEqual({ total: 17, isSoft: true });
  });

  it('ace reduces to 1 on bust', () => {
    expect(calculateTotal([c('Ah'), c('6c'), c('9d')])).toEqual({ total: 16, isSoft: false });
  });

  it('two aces: one 11, one 1', () => {
    expect(calculateTotal([c('Ah'), c('Ac'), c('5h')])).toEqual({ total: 17, isSoft: true });
  });

  it('three aces: all reduce to 1 except one', () => {
    const { total, isSoft } = calculateTotal([c('Ah'), c('Ac'), c('As'), c('5h')]);
    expect(total).toBe(18);
    expect(isSoft).toBe(true);
  });

  it('bust hand stays bust', () => {
    const { total } = calculateTotal([c('Th'), c('Tc'), c('5h')]);
    expect(total).toBe(25);
  });

  it('21 with T+A', () => {
    expect(calculateTotal([c('Th'), c('Ah')])).toEqual({ total: 21, isSoft: true });
  });
});

describe('isNaturalBlackjack', () => {
  it('ace + king = BJ', () => expect(isNaturalBlackjack([c('Ah'), c('Kh')])).toBe(true));
  it('ace + ten = BJ', () => expect(isNaturalBlackjack([c('As'), c('Th')])).toBe(true));
  it('6 + 5 + T = not BJ (3 cards)', () => expect(isNaturalBlackjack([c('6h'), c('5h'), c('Th')])).toBe(false));
  it('K + Q = not BJ', () => expect(isNaturalBlackjack([c('Kh'), c('Qh')])).toBe(false));
  it('A + 9 = not BJ', () => expect(isNaturalBlackjack([c('Ah'), c('9h')])).toBe(false));
});

describe('isBust', () => {
  it('22 is bust', () => expect(isBust([c('Th'), c('Tc'), c('2h')])).toBe(true));
  it('21 is not bust', () => expect(isBust([c('Th'), c('Ac')])).toBe(false));
  it('soft 17 not bust', () => expect(isBust([c('Ah'), c('6c')])).toBe(false));
});

describe('splitRankKey', () => {
  it('T, J, Q, K all map to "10"', () => {
    expect(splitRankKey(c('Th'))).toBe('10');
    expect(splitRankKey(c('Jh'))).toBe('10');
    expect(splitRankKey(c('Qh'))).toBe('10');
    expect(splitRankKey(c('Kh'))).toBe('10');
  });
  it('numeric ranks map to themselves', () => {
    expect(splitRankKey(c('5h'))).toBe('5');
  });
  it('aces map to "A"', () => {
    expect(splitRankKey(c('Ah'))).toBe('A');
  });
});
