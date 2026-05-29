import { describe, expect, it } from 'vitest';
import { nextActiveSeat } from './holdem.js';

describe('nextActiveSeat', () => {
  it('wraps around after the last seat', () => {
    const result = nextActiveSeat([0, 1], 2, () => true);
    expect(result).toBe(0);
  });

  it('skips inactive seats while wrapping', () => {
    const result = nextActiveSeat([0, 1, 2], 2, (idx) => idx !== 0);
    expect(result).toBe(1);
  });
});
