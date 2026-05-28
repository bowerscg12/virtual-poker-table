import { describe, expect, it } from 'vitest';
import { buildSidePots } from './pots.js';

describe('side pots', () => {
  it('builds single pot when equal', () => {
    const pots = buildSidePots([
      { seatIndex: 0, amount: 100 },
      { seatIndex: 1, amount: 100 },
    ]);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(200);
  });

  it('builds side pot for short stack', () => {
    const pots = buildSidePots([
      { seatIndex: 0, amount: 50 },
      { seatIndex: 1, amount: 100 },
      { seatIndex: 2, amount: 100 },
    ]);
    expect(pots.length).toBeGreaterThanOrEqual(2);
    const total = pots.reduce((s, p) => s + p.amount, 0);
    expect(total).toBe(250);
  });
});
