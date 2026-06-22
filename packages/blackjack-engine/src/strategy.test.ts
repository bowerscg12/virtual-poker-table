import { describe, it, expect } from 'vitest';
import type { Card } from '@vct/shared-types';
import { decideBlackjackAction } from './strategy.js';

function c(s: string): Card { return s as Card; }
const ALL = { canDouble: true, canSplit: true, canSurrender: true };
const NO_EXTRAS = { canDouble: false, canSplit: false, canSurrender: false };

describe('decideBlackjackAction — pairs', () => {
  it('always splits aces', () => {
    expect(decideBlackjackAction([c('Ah'), c('Ad')], c('6h'), ALL)).toBe('split');
    expect(decideBlackjackAction([c('Ah'), c('Ad')], c('Ts'), ALL)).toBe('split');
  });
  it('always splits eights', () => {
    expect(decideBlackjackAction([c('8h'), c('8d')], c('Ts'), ALL)).toBe('split');
  });
  it('never splits tens (stands)', () => {
    expect(decideBlackjackAction([c('Th'), c('Td')], c('6h'), ALL)).toBe('stand');
  });
  it('treats 5,5 as hard 10 (doubles vs 6, not split)', () => {
    expect(decideBlackjackAction([c('5h'), c('5d')], c('6h'), ALL)).toBe('double_down');
  });
});

describe('decideBlackjackAction — hard totals', () => {
  it('stands on hard 17+', () => {
    expect(decideBlackjackAction([c('Th'), c('7d')], c('Ts'), ALL)).toBe('stand');
  });
  it('hard 16 stands vs 6, hits vs 7', () => {
    expect(decideBlackjackAction([c('Th'), c('6d')], c('6h'), NO_EXTRAS)).toBe('stand');
    expect(decideBlackjackAction([c('Th'), c('6d')], c('7h'), NO_EXTRAS)).toBe('hit');
  });
  it('doubles 11 when allowed, hits when not', () => {
    expect(decideBlackjackAction([c('6h'), c('5d')], c('Ts'), ALL)).toBe('double_down');
    expect(decideBlackjackAction([c('6h'), c('5d')], c('Ts'), NO_EXTRAS)).toBe('hit');
  });
  it('hard 12 hits vs 2, stands vs 4', () => {
    expect(decideBlackjackAction([c('Th'), c('2d')], c('2h'), NO_EXTRAS)).toBe('hit');
    expect(decideBlackjackAction([c('Th'), c('2d')], c('4h'), NO_EXTRAS)).toBe('stand');
  });
});

describe('decideBlackjackAction — soft totals', () => {
  it('soft 18 doubles vs 6, stands vs 2, hits vs 9', () => {
    expect(decideBlackjackAction([c('Ah'), c('7d')], c('6h'), ALL)).toBe('double_down');
    expect(decideBlackjackAction([c('Ah'), c('7d')], c('2h'), ALL)).toBe('stand');
    expect(decideBlackjackAction([c('Ah'), c('7d')], c('9h'), ALL)).toBe('hit');
  });
  it('soft 18 stands vs 6 when doubling is not allowed', () => {
    expect(decideBlackjackAction([c('Ah'), c('7d')], c('6h'), NO_EXTRAS)).toBe('stand');
  });
});

describe('decideBlackjackAction — surrender', () => {
  it('surrenders hard 16 vs 10 only when allowed', () => {
    expect(decideBlackjackAction([c('Th'), c('6d')], c('Ts'), { ...NO_EXTRAS, canSurrender: true })).toBe('surrender');
    expect(decideBlackjackAction([c('Th'), c('6d')], c('Ts'), NO_EXTRAS)).toBe('hit');
  });
});
