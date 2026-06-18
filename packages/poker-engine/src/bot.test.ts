import { describe, expect, it } from 'vitest';
import type { BotDifficulty, BotStyle, Card, VariantConfig } from '@vct/shared-types';
import { boardWetness, decidePokerAction, drawStrength, estimateEquity, holdsCurrentNuts, preflopStrength, type BotBrain } from './bot.js';
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

  it('caps sized raises to keep chips behind instead of jamming on a low-SPR street', () => {
    // A bot betting for value into a pot that has outgrown its stack used to auto-shove every time
    // (a pot-fraction raise clamps to the full stack). The commitment cap should keep it a sized
    // raise that leaves chips behind in the large majority of those spots.
    const state = makeState({
      street: 'turn',
      board: ['Kh', '7d', '2c', '9s'], // dry-ish, bot flopped a set of 7s (strong, not the nuts)
      currentBet: 0, // checked to the bot
      minRaise: 10,
      seats: [
        seat(0, ['7h', '7s'], { betThisStreet: 0, totalBet: 600, stack: 700 }), // pot already > stack
        seat(1, ['As', 'Qd'], { betThisStreet: 0, totalBet: 600, stack: 700 }),
      ],
      actionSeatIndex: 0,
    });
    let raises = 0;
    let shoves = 0;
    const trials = 300;
    for (let s = 1; s <= trials; s++) {
      const d = decidePokerAction(state, holdem, 0, { style: 'lag', difficulty: 'pro' }, mulberry32(s));
      if (d.action === 'raise') {
        raises++;
        // A capped raise must leave chips behind — strictly below the all-in total.
        expect(d.amount!).toBeLessThan(700);
      } else if (d.action === 'all_in') {
        shoves++;
      }
    }
    // The bot still bets this set aggressively, but as a sized raise rather than a jam.
    expect(raises).toBeGreaterThan(0);
    expect(raises).toBeGreaterThan(shoves * 3);
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

  it('pro plays a borderline hand more often on the button than in early position', () => {
    // QQ sits near the tag entry cutoff, so the positional VPIP adjustment tips the decision.
    // Six live seats; only the dealer seat moves, changing seat 0's relative position.
    const mkState = (dealerSeatIndex: number) => makeState({
      street: 'preflop',
      board: [],
      currentBet: 30, // facing a raise
      minRaise: 20,
      dealerSeatIndex,
      seats: [
        seat(0, ['Qc', 'Qd'], { betThisStreet: 0, totalBet: 0 }),
        seat(1, ['2h', '7d'], { betThisStreet: 30, totalBet: 30 }),
        seat(2, ['3c', '8s'], { betThisStreet: 0, totalBet: 0 }),
        seat(3, ['4c', '9s'], { betThisStreet: 0, totalBet: 0 }),
        seat(4, ['5c', 'Td'], { betThisStreet: 0, totalBet: 0 }),
        seat(5, ['6c', 'Jd'], { betThisStreet: 0, totalBet: 0 }),
      ],
      actionSeatIndex: 0,
    });
    const playRate = (dealerSeatIndex: number): number => {
      let plays = 0;
      const trials = 200;
      for (let s = 1; s <= trials; s++) {
        const d = decidePokerAction(mkState(dealerSeatIndex), holdem, 0, { style: 'tag', difficulty: 'pro' }, mulberry32(s));
        if (d.action !== 'fold') plays++;
      }
      return plays / trials;
    };
    // dealer = 0 → seat 0 is the button (latest); dealer = 1 → seat 0 acts first (earliest).
    expect(playRate(0)).toBeGreaterThan(playRate(1));
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

describe('range-weighted equity', () => {
  it('lowers estimated equity against a stronger opponent range', () => {
    // A marginal made hand (second pair) on a coordinated board: narrowing opponents to stronger
    // starting hands should reduce our win equity versus assuming fully random holdings.
    const hole: Card[] = ['9h', '9d'];
    const board: Card[] = ['Ac', 'Kd', '7s'];
    const random = estimateEquity(hole, board, holdem, 2, 4000, mulberry32(42), 0);
    const weighted = estimateEquity(hole, board, holdem, 2, 4000, mulberry32(42), 0.4);
    expect(weighted).toBeLessThan(random);
  });

  it('matches the random model when the floor is zero', () => {
    const hole: Card[] = ['Ah', 'Kh'];
    const board: Card[] = ['Qd', 'Jc', '2s'];
    // Same seed + floor 0 must reproduce the unweighted result exactly (no behavior change off-pro).
    const a = estimateEquity(hole, board, holdem, 1, 1000, mulberry32(7), 0);
    const b = estimateEquity(hole, board, holdem, 1, 1000, mulberry32(7), 0);
    expect(a).toBe(b);
  });
});

describe('board texture', () => {
  it('rates a coordinated, suited board wetter than a rainbow disconnected one', () => {
    expect(boardWetness(['9h', '8h', '7h'])).toBeGreaterThan(boardWetness(['Kh', '8d', '2c']));
  });

  it('treats the preflop board as neutral', () => {
    expect(boardWetness([])).toBeCloseTo(0.3);
  });
});

describe('draw detection', () => {
  it('classifies a flush draw and an open-ended straight draw as strong', () => {
    expect(drawStrength(['Ah', 'Qh'], ['Kh', '7h', '2c'], holdem)).toBe('strong'); // four hearts
    expect(drawStrength(['9c', 'Td'], ['8d', '7s', '2c'], holdem)).toBe('strong'); // open-ended 7-8-9-T
  });

  it('classifies a gutshot as weak and air/made hands as none', () => {
    expect(drawStrength(['Jc', 'Td'], ['8d', '7s', '2c'], holdem)).toBe('weak'); // needs a 9 only
    expect(drawStrength(['2h', '3d'], ['Kh', '8s', 'Qc'], holdem)).toBe('none');
    expect(drawStrength(['9c', 'Td'], ['8d', '7s', '6c'], holdem)).toBe('none'); // made straight, not a draw
  });

  it('returns none on the river (no draws left to make)', () => {
    expect(drawStrength(['Ah', 'Qh'], ['Kh', '7h', '2c', '5d', '3s'], holdem)).toBe('none');
  });
});

describe('semi-bluffing draws', () => {
  it('a tight bot bets a strong draw far more often than air when checked to', () => {
    // A nit almost never bluffs air (bluffFreq 0.04); a flush draw should still get bet as a semi-bluff.
    const mkState = (hole: Card[]) => makeState({
      street: 'flop',
      board: ['Kh', '7h', '2c'],
      currentBet: 0, // checked to us
      minRaise: 10,
      seats: [
        seat(0, hole, { betThisStreet: 0, totalBet: 20 }),
        seat(1, ['Ks', 'Qd'], { betThisStreet: 0, totalBet: 20 }),
      ],
      actionSeatIndex: 0,
    });
    const betRate = (hole: Card[]): number => {
      let bets = 0;
      const trials = 300;
      for (let s = 1; s <= trials; s++) {
        const d = decidePokerAction(mkState(hole), holdem, 0, { style: 'nit', difficulty: 'pro' }, mulberry32(s));
        if (d.action === 'raise' || d.action === 'all_in') bets++;
      }
      return bets / trials;
    };
    const drawBets = betRate(['9h', '8h']); // flush draw + extra outs, not a made value hand
    const airBets = betRate(['4s', '3d']); // disconnected air, no draw
    expect(drawBets).toBeGreaterThan(0.1);
    expect(drawBets).toBeGreaterThan(airBets);
  });
});
