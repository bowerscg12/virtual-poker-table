import { describe, it, expect } from 'vitest';
import { botStallCandidate } from './handler.js';

/** Build a minimal state object accepted by botStallCandidate. */
function state(over: Partial<Parameters<typeof botStallCandidate>[0] & object> = {}) {
  return {
    actionSeatIndex: 0,
    street: 'flop',
    pendingMultiRunout: false,
    seats: [
      { seatIndex: 0, userId: 'bot-1', folded: false, allIn: false },
      { seatIndex: 1, userId: 'human-1', folded: false, allIn: false },
    ],
    ...over,
  };
}

// Treat any userId starting with "bot-" as a bot.
const isBot = (userId: string) => userId.startsWith('bot-');

describe('botStallCandidate — bot-turn watchdog gating', () => {
  it('flags a bot that is on the clock during a live betting street', () => {
    expect(botStallCandidate(state(), isBot)).toEqual({ seatIndex: 0, userId: 'bot-1' });
  });

  it('ignores a human on the clock (humans have their own action/grace timer)', () => {
    expect(botStallCandidate(state({ actionSeatIndex: 1 }), isBot)).toBeNull();
  });

  it('ignores null state and a null action seat', () => {
    expect(botStallCandidate(null, isBot)).toBeNull();
    expect(botStallCandidate(state({ actionSeatIndex: null }), isBot)).toBeNull();
  });

  it.each(['complete', 'waiting', 'reveal'])('ignores non-betting street %s', (street) => {
    expect(botStallCandidate(state({ street }), isBot)).toBeNull();
  });

  it('ignores a pending multi-runout prompt (resolved by its own timer)', () => {
    expect(botStallCandidate(state({ pendingMultiRunout: true }), isBot)).toBeNull();
  });

  it('ignores a folded or all-in action seat', () => {
    expect(botStallCandidate(state({
      seats: [{ seatIndex: 0, userId: 'bot-1', folded: true, allIn: false }],
    }), isBot)).toBeNull();
    expect(botStallCandidate(state({
      seats: [{ seatIndex: 0, userId: 'bot-1', folded: false, allIn: true }],
    }), isBot)).toBeNull();
  });

  it('ignores an action seat index that maps to no seat', () => {
    expect(botStallCandidate(state({ actionSeatIndex: 9 }), isBot)).toBeNull();
  });
});
