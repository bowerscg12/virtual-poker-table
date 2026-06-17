import { describe, expect, it } from 'vitest';
import type { BotDifficulty, BotStyle, Card, VariantConfig } from '@vct/shared-types';
import { decidePokerAction, holdsCurrentNuts, preflopStrength, type BotBrain } from './bot.js';
import { getLegalActionsForSeat, type GameTableState, type InternalSeat } from './game-table.js';

const holdem: VariantConfig = {
  game: 'holdem', limit: 'no_limit', maxPlayers: 6,
  blinds: { small: 5, big: 10 }, buyIn: 1000, minBuyIn: 1000, maxBuyIn: 4000,
};

const DIFFICULTIES: BotDifficulty[] = ['beginner', 'intermediate', 'pro'];
const STYLES: BotStyle[] = ['tag', 'lag', 'nit', 'station', 'maniac'];

/** Deterministic RNG so tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seat(seatIndex: number, holeCards: Card[], over: Partial<InternalSeat> = {}): InternalSeat {
  return {
    seatIndex, userId: `u${seatIndex}`, displayName: `P${seatIndex}`, stack: 1000,
    betThisStreet: 0, totalBet: 0, folded: false, allIn: false, holeCards, ...over,
  };
}

function makeState(over: Partial<GameTableState> & { seats: InternalSeat[] }): GameTableState {
  return {
    handNumber: 1, street: 'flop', deck: [], board: [], pots: [], dealerSeatIndex: 0,
    actionSeatIndex: over.seats[0].seatIndex, currentBet: 0, minRaise: 10, lastAggressorSeat: null,
    lastWinningSeatIndices: [], winnerPayouts: [], processedActionIds: new Set(),
    bombPotActive: false, isBombPot: false, bombPotAmount: 0, isDoubleBoardBombPot: false,
    pendingActionSeatIndices: [], ...over,
  };
}

describe('holdsCurrentNuts', () => {
  it('detects the nut straight on a rainbow board', () => {
    const board: Card[] = ['Ac', 'Kd', 'Qh', 'Js', '2c'];
    // Broadway (A-K-Q-J-T) is the nuts; no flush possible on this rainbow board.
    expect(holdsCurrentNuts(['Th', 'Td'], board, holdem)).toBe(true);
  });

  it('rejects a non-nut holding', () => {
    const board: Card[] = ['Ac', 'Kd', 'Qh', 'Js', '2c'];
    expect(holdsCurrentNuts(['2h', '7d'], board, holdem)).toBe(false);
  });

  it('detects the nut full house over a lower boat', () => {
    const board: Card[] = ['Ah', 'As', 'Kd', 'Kc', '2c'];
    // Pocket aces = quad aces, unbeatable here.
    expect(holdsCurrentNuts(['Ad', 'Ac'], board, holdem)).toBe(true);
    // Kings full of aces loses to AA quads.
    expect(holdsCurrentNuts(['Kh', 'Ks'], board, holdem)).toBe(false);
  });

  it('returns false before a 5-card hand can be formed', () => {
    expect(holdsCurrentNuts(['Ah', 'Ad'], ['Kh', 'Qd'], holdem)).toBe(false);
  });
});

describe('decidePokerAction — legality & nut rule', () => {
  it('always returns a legal action across styles, difficulties, and seeds', () => {
    for (let s = 1; s <= 60; s++) {
      const rng = mulberry32(s);
      const state = makeState({
        street: 'flop',
        board: ['7h', '8d', '2c'],
        currentBet: 40,
        minRaise: 30,
        seats: [
          seat(0, ['Ah', 'Kd'], { betThisStreet: 0, totalBet: 10 }),
          seat(1, ['9c', 'Tc'], { betThisStreet: 40, totalBet: 50 }),
        ],
        actionSeatIndex: 0,
      });
      for (const style of STYLES) {
        for (const difficulty of DIFFICULTIES) {
          const brain: BotBrain = { style, difficulty };
          const decision = decidePokerAction(state, holdem, 0, brain, rng);
          const legal = getLegalActionsForSeat(state, holdem, 0);
          const match = legal.find((a) => a.type === decision.action);
          expect(match, `${style}/${difficulty} chose illegal ${decision.action}`).toBeTruthy();
          if (decision.action === 'raise') {
            expect(decision.amount).toBeGreaterThanOrEqual(match!.minAmount!);
            expect(decision.amount).toBeLessThanOrEqual(match!.maxAmount!);
          }
        }
      }
    }
  });

  it('never folds the current nuts facing a bet — any difficulty or style', () => {
    const state = makeState({
      street: 'river',
      board: ['Ac', 'Kd', 'Qh', 'Js', '2c'],
      currentBet: 200,
      minRaise: 100,
      seats: [
        seat(0, ['Th', 'Td'], { betThisStreet: 0, totalBet: 50, stack: 2000 }), // broadway = nuts
        seat(1, ['Ad', 'As'], { betThisStreet: 200, totalBet: 250 }),
      ],
      actionSeatIndex: 0,
    });
    for (const style of STYLES) {
      for (const difficulty of DIFFICULTIES) {
        for (let s = 1; s <= 20; s++) {
          const decision = decidePokerAction(state, holdem, 0, { style, difficulty }, mulberry32(s * 7 + 1));
          expect(decision.action, `${style}/${difficulty} folded the nuts`).not.toBe('fold');
        }
      }
    }
  });

  it('never folds a weak hand when a check is available (checks instead)', () => {
    // Trash hand, no bet to call → folding is strictly dominated by checking.
    const state = makeState({
      street: 'flop',
      board: ['Ac', 'Kd', 'Qh'],
      currentBet: 0,
      minRaise: 10,
      seats: [
        seat(0, ['2h', '7d'], { betThisStreet: 0, totalBet: 10 }),
        seat(1, ['9c', 'Tc'], { betThisStreet: 0, totalBet: 10 }),
      ],
      actionSeatIndex: 0,
    });
    for (const style of STYLES) {
      for (const difficulty of DIFFICULTIES) {
        for (let s = 1; s <= 20; s++) {
          const decision = decidePokerAction(state, holdem, 0, { style, difficulty }, mulberry32(s * 13 + 5));
          expect(decision.action, `${style}/${difficulty} folded when it could check`).not.toBe('fold');
        }
      }
    }
  });

  it('never folds the nuts even when it could check (bets/stays in)', () => {
    const state = makeState({
      street: 'river',
      board: ['Ac', 'Kd', 'Qh', 'Js', '2c'],
      currentBet: 0,
      minRaise: 10,
      seats: [
        seat(0, ['Th', 'Td'], { totalBet: 50 }),
        seat(1, ['Ad', 'As'], { totalBet: 50 }),
      ],
      actionSeatIndex: 0,
    });
    for (const style of STYLES) {
      const decision = decidePokerAction(state, holdem, 0, { style, difficulty: 'pro' }, mulberry32(99));
      expect(decision.action).not.toBe('fold');
    }
  });
});

describe('preflop strength & style looseness', () => {
  it('ranks premium hands above trash', () => {
    expect(preflopStrength(['Ah', 'As'], holdem)).toBeGreaterThan(preflopStrength(['7h', '2d'], holdem));
    expect(preflopStrength(['Ah', 'Kh'], holdem)).toBeGreaterThan(preflopStrength(['9h', '4d'], holdem));
  });

  it('a nit folds a marginal hand more often than a maniac', () => {
    const mkState = () => makeState({
      street: 'preflop',
      board: [],
      currentBet: 30, // facing a raise
      minRaise: 20,
      seats: [
        seat(0, ['Qh', 'Jh'], { betThisStreet: 0, totalBet: 0 }), // mid suited: maniac plays, nit folds
        seat(1, ['Ac', 'Ad'], { betThisStreet: 30, totalBet: 30 }),
      ],
      actionSeatIndex: 0,
    });
    const foldRate = (style: BotStyle): number => {
      let folds = 0;
      const trials = 300;
      for (let s = 1; s <= trials; s++) {
        const d = decidePokerAction(mkState(), holdem, 0, { style, difficulty: 'pro' }, mulberry32(s));
        if (d.action === 'fold') folds++;
      }
      return folds / trials;
    };
    expect(foldRate('nit')).toBeGreaterThan(foldRate('maniac'));
  });
});
