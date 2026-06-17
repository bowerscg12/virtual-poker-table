/**
 * AI opponent decision engine (pure).
 *
 * Given a {@link GameTableState}, the variant config, a seat index, and a bot brain
 * ({@link BotDifficulty} + {@link BotStyle}), returns a single legal action for that seat.
 * Pure and deterministic given an injected RNG, so it is fully unit-testable and never
 * touches I/O. The server's turn driver applies the returned action through the normal
 * `applyAction` path.
 *
 * Two hard guarantees, independent of difficulty:
 * 1. The returned action is always one of `getLegalActionsForSeat(...)`.
 * 2. A bot that holds the current nuts (best possible hand for the visible board) never folds.
 */
import type { BotDifficulty, BotStyle, Card, LegalAction, PlayerActionType, VariantConfig } from '@vct/shared-types';
import { createDeck } from './deck.js';
import { fastHandScore } from './evaluate.js';
import { getLegalActionsForSeat, type GameTableState } from './game-table.js';

export interface BotBrain {
  difficulty: BotDifficulty;
  style: BotStyle;
}

export interface BotDecision {
  action: PlayerActionType;
  amount?: number;
}

/** Personality parameters per playstyle. Difficulty layers execution quality on top of these. */
interface StyleProfile {
  /** Fraction of starting hands the bot is willing to play preflop (looseness). */
  vpip: number;
  /** When entering a pot, tendency to raise rather than just call (0..1). */
  pfrBias: number;
  /** Postflop tendency to bet/raise rather than check/call (0..1). */
  aggression: number;
  /** Tendency to bluff with a weak hand (0..1). */
  bluffFreq: number;
  /** Equity needed to call a bet under perfect discipline (0..1). */
  callThreshold: number;
  /** Equity needed to bet/raise for value (0..1). */
  raiseThreshold: number;
  /** Default bet/raise size as a fraction of the pot. */
  betSizePot: number;
}

const STYLE_PROFILES: Record<BotStyle, StyleProfile> = {
  // Tight-Aggressive: few hands, played hard.
  tag: { vpip: 0.24, pfrBias: 0.8, aggression: 0.66, bluffFreq: 0.16, callThreshold: 0.46, raiseThreshold: 0.62, betSizePot: 0.66 },
  // Loose-Aggressive: many hands, relentless pressure.
  lag: { vpip: 0.42, pfrBias: 0.74, aggression: 0.78, bluffFreq: 0.36, callThreshold: 0.38, raiseThreshold: 0.55, betSizePot: 0.72 },
  // Rock / Nit: very few hands, rarely raises.
  nit: { vpip: 0.14, pfrBias: 0.5, aggression: 0.4, bluffFreq: 0.04, callThreshold: 0.54, raiseThreshold: 0.7, betSizePot: 0.58 },
  // Calling Station: plays a lot, calls far too much, seldom raises.
  station: { vpip: 0.52, pfrBias: 0.14, aggression: 0.2, bluffFreq: 0.04, callThreshold: 0.3, raiseThreshold: 0.74, betSizePot: 0.5 },
  // Maniac: jams the gas, bluffs constantly.
  maniac: { vpip: 0.72, pfrBias: 0.9, aggression: 0.9, bluffFreq: 0.6, callThreshold: 0.28, raiseThreshold: 0.46, betSizePot: 0.95 },
};

/** Execution quality per difficulty. Beginners misread hands and ignore pot odds; Pros do not. */
interface DifficultyProfile {
  /** Monte-Carlo iterations for postflop equity (higher = more accurate). */
  iterations: number;
  /** Std-dev of gaussian noise added to estimated equity (higher = worse hand reading). */
  equityNoise: number;
  /** How strongly pot odds gate a call: 1 = perfect, 0 = calls on raw threshold regardless. */
  potOddsRespect: number;
  /** Chance of making a random (suboptimal) legal choice — never folds the nuts. */
  mistakeRate: number;
}

const DIFFICULTY_PROFILES: Record<BotDifficulty, DifficultyProfile> = {
  beginner: { iterations: 200, equityNoise: 0.18, potOddsRespect: 0.3, mistakeRate: 0.18 },
  intermediate: { iterations: 500, equityNoise: 0.08, potOddsRespect: 0.7, mistakeRate: 0.07 },
  pro: { iterations: 1200, equityNoise: 0.02, potOddsRespect: 1.0, mistakeRate: 0.0 },
};

type Rng = () => number;

const RANK_VAL: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14,
};

/** All k-card combinations of `arr`. */
function combos<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [...combos(rest, k - 1).map((c) => [first, ...c]), ...combos(rest, k)];
}

/** Box-Muller gaussian noise scaled by `sigma`, using the injected RNG. */
function gaussianNoise(sigma: number, rng: Rng): number {
  if (sigma <= 0) return 0;
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sigma;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Cards in the deck not yet visible to this seat (excludes the seat's hole cards and the board). */
function unseenDeck(known: Card[]): Card[] {
  const seen = new Set(known);
  return createDeck().filter((c) => !seen.has(c));
}

/** Number of opponents still contesting the pot (not folded), excluding this seat. */
function activeOpponentCount(state: GameTableState, seatIndex: number): number {
  return state.seats.filter((s) => s.seatIndex !== seatIndex && !s.folded).length;
}

function isOmaha(config: VariantConfig): boolean {
  return config.game === 'omaha' || config.game === 'plo8';
}

/** Best 5-card score from exactly 2 of `hole` + 3 of `board` (Omaha rule). board must have ≥3 cards. */
function bestOmahaScore(hole: Card[], board: Card[]): number {
  let best = -Infinity;
  for (const h of combos(hole, 2)) {
    for (const b of combos(board, 3)) {
      const s = fastHandScore([...h, ...b]);
      if (s > best) best = s;
    }
  }
  return best;
}

/** Best made-hand score for this seat on the current board (variant-aware). board must have ≥3 cards. */
function madeHandScore(hole: Card[], board: Card[], config: VariantConfig): number {
  return isOmaha(config) ? bestOmahaScore(hole, board) : fastHandScore([...hole, ...board]);
}

/**
 * Does this seat hold the current nuts — i.e. is there no two-card opponent holding that makes a
 * strictly better hand on the *visible* board? Returns false until at least 3 board cards exist
 * (a 5-card hand cannot otherwise be formed). Uses exactly-2-of-board+hole, matching how any
 * holding (Hold'em or Omaha) can combine with the board.
 */
export function holdsCurrentNuts(hole: Card[], board: Card[], config: VariantConfig): boolean {
  if (board.length < 3) return false;
  const mine = madeHandScore(hole, board, config);
  const pool = unseenDeck([...hole, ...board]);
  const boardTriples = combos(board, 3);
  for (const oppPair of combos(pool, 2)) {
    let oppBest = -Infinity;
    for (const b of boardTriples) {
      const s = fastHandScore([...oppPair, ...b]);
      if (s > oppBest) oppBest = s;
    }
    if (oppBest > mine) return false;
  }
  return true;
}

/**
 * Monte-Carlo win equity (0..1) of this seat's hole cards against `opponents` random holdings,
 * completing the board to 5 cards. Ties split credit. `iterations` controls accuracy.
 */
export function estimateEquity(
  hole: Card[],
  board: Card[],
  config: VariantConfig,
  opponents: number,
  iterations: number,
  rng: Rng = Math.random
): number {
  if (opponents <= 0) return 1;
  const omaha = isOmaha(config);
  const holeCount = omaha ? 4 : 2;
  const pool = unseenDeck([...hole, ...board]);
  // Omaha evaluation is far heavier (2-of-4 × 3-of-board), so cap its iteration budget.
  const iters = Math.max(40, omaha ? Math.round(iterations / 3) : iterations);

  let won = 0;
  for (let i = 0; i < iters; i++) {
    // Partial Fisher-Yates over a copy: draw opponent holes + board completion without collisions.
    const deck = pool.slice();
    let top = deck.length;
    const draw = (): Card => {
      const j = Math.floor(rng() * top);
      const c = deck[j];
      deck[j] = deck[top - 1];
      top--;
      return c;
    };

    const oppHoles: Card[][] = [];
    for (let o = 0; o < opponents; o++) {
      const h: Card[] = [];
      for (let c = 0; c < holeCount; c++) h.push(draw());
      oppHoles.push(h);
    }
    const fullBoard = board.slice();
    while (fullBoard.length < 5) fullBoard.push(draw());

    const mine = omaha ? bestOmahaScore(hole, fullBoard) : fastHandScore([...hole, ...fullBoard]);
    let bestOpp = -Infinity;
    let ties = 0;
    for (const oh of oppHoles) {
      const s = omaha ? bestOmahaScore(oh, fullBoard) : fastHandScore([...oh, ...fullBoard]);
      if (s > bestOpp) bestOpp = s;
    }
    if (mine > bestOpp) {
      won += 1;
    } else if (mine === bestOpp) {
      // Count how many opponents we tie with for split credit.
      for (const oh of oppHoles) {
        const s = omaha ? bestOmahaScore(oh, fullBoard) : fastHandScore([...oh, ...fullBoard]);
        if (s === mine) ties++;
      }
      won += 1 / (ties + 1);
    }
  }
  return won / iters;
}

/**
 * Rough preflop hand strength (0..1). Used to gate which starting hands a bot plays (VPIP) without
 * paying for a full Monte-Carlo run on every preflop decision.
 */
export function preflopStrength(hole: Card[], config: VariantConfig): number {
  const vals = hole.map((c) => RANK_VAL[c[0]]).sort((a, b) => b - a);
  const suits = hole.map((c) => c[1]);

  if (isOmaha(config)) {
    // Reward high cards, pairs, double-suitedness, and connectivity (coarse).
    const high = vals.reduce((a, v) => a + v, 0) / (14 * 4);
    const rankCounts = new Map<number, number>();
    for (const v of vals) rankCounts.set(v, (rankCounts.get(v) ?? 0) + 1);
    const pairs = [...rankCounts.values()].filter((n) => n >= 2).length;
    const suitCounts = new Map<string, number>();
    for (const s of suits) suitCounts.set(s, (suitCounts.get(s) ?? 0) + 1);
    const suitedness = [...suitCounts.values()].filter((n) => n >= 2).length; // 0..2 suited pairs
    const spread = vals[0] - vals[vals.length - 1];
    const connected = clamp01((14 - spread) / 14);
    return clamp01(0.5 * high + 0.18 * pairs + 0.14 * (suitedness / 2) + 0.18 * connected);
  }

  // Hold'em: Chen-style formula normalized to 0..1.
  const [hi, lo] = vals;
  let score: number;
  const highMap: Record<number, number> = { 14: 10, 13: 8, 12: 7, 11: 6 };
  score = highMap[hi] ?? hi / 2;
  if (hi === lo) {
    score = Math.max(5, score * 2); // pair
  }
  if (suits[0] === suits[1]) score += 2; // suited
  const gap = hi - lo;
  if (hi !== lo) {
    if (gap === 1) score += 0; // connectors: small implied bonus folded into straight potential below
    else if (gap === 2) score -= 1;
    else if (gap === 3) score -= 2;
    else if (gap >= 4) score -= 4;
    if (gap <= 2 && hi < 12) score += 1; // straight potential for lower connectors
  }
  // Chen ranges roughly -1.5 .. 20. Normalize.
  return clamp01((score + 2) / 22);
}

/** Sum of all chips wagered so far this hand (the current pot for sizing purposes). */
function potSize(state: GameTableState): number {
  return state.seats.reduce((a, s) => a + s.totalBet, 0);
}

function find(legal: LegalAction[], type: PlayerActionType): LegalAction | undefined {
  return legal.find((a) => a.type === type);
}

/**
 * Build a value/aggressive raise action sized at `fraction` of the (post-call) pot, clamped to the
 * legal raise range. Falls back to all-in when the target meets or exceeds the max, or to call/check
 * when no raise is available. `jamChance` lets aggressive styles/nut hands occasionally shove.
 */
function buildRaise(
  legal: LegalAction[],
  state: GameTableState,
  seatIndex: number,
  fraction: number,
  jamChance: number,
  rng: Rng
): BotDecision {
  const raise = find(legal, 'raise');
  const allIn = find(legal, 'all_in');
  const seat = state.seats.find((s) => s.seatIndex === seatIndex)!;
  const toCall = Math.max(0, state.currentBet - seat.betThisStreet);
  const pot = potSize(state);

  if (allIn && rng() < jamChance) return { action: 'all_in' };

  if (raise && raise.minAmount !== undefined && raise.maxAmount !== undefined) {
    const potAfterCall = pot + toCall;
    // Target total bet this street: current bet plus a pot-fraction sizing.
    const target = Math.round(state.currentBet + Math.max(state.minRaise, fraction * potAfterCall));
    const clamped = Math.max(raise.minAmount, Math.min(raise.maxAmount, target));
    if (clamped >= raise.maxAmount && allIn) return { action: 'all_in' };
    return { action: 'raise', amount: clamped };
  }
  if (allIn) return { action: 'all_in' };
  // No raise available — take the most aggressive non-folding line we can.
  if (find(legal, 'call')) return { action: 'call' };
  if (find(legal, 'check')) return { action: 'check' };
  return { action: 'fold' };
}

/** Pick a random non-fold legal action (used for beginner "mistakes" — never folds the nuts). */
function randomNonFold(legal: LegalAction[], state: GameTableState, seatIndex: number, rng: Rng): BotDecision {
  const choices = legal.filter((a) => a.type !== 'fold');
  if (choices.length === 0) return { action: 'fold' };
  const pick = choices[Math.floor(rng() * choices.length)];
  if (pick.type === 'raise') return buildRaise(legal, state, seatIndex, 0.6, 0.1, rng);
  return { action: pick.type };
}

/**
 * Decide an action for an AI seat. Always returns a legal action; never folds the current nuts, and
 * never folds when a check is available (folding for free is strictly dominated by checking).
 */
export function decidePokerAction(
  state: GameTableState,
  config: VariantConfig,
  seatIndex: number,
  brain: BotBrain,
  rng: Rng = Math.random
): BotDecision {
  const decision = decidePokerActionInner(state, config, seatIndex, brain, rng);
  // Hard rule: a bot never folds when it could check instead.
  if (decision.action === 'fold') {
    const legal = getLegalActionsForSeat(state, config, seatIndex);
    if (find(legal, 'check')) return { action: 'check' };
  }
  return decision;
}

function decidePokerActionInner(
  state: GameTableState,
  config: VariantConfig,
  seatIndex: number,
  brain: BotBrain,
  rng: Rng
): BotDecision {
  const legal = getLegalActionsForSeat(state, config, seatIndex);
  if (legal.length === 0) return { action: 'fold' };

  const seat = state.seats.find((s) => s.seatIndex === seatIndex);
  if (!seat) return find(legal, 'check') ? { action: 'check' } : { action: 'fold' };

  const style = STYLE_PROFILES[brain.style];
  const diff = DIFFICULTY_PROFILES[brain.difficulty];
  const board = state.board;
  const hole = seat.holeCards;
  const toCall = Math.max(0, state.currentBet - seat.betThisStreet);
  const canCheck = !!find(legal, 'check');
  const canRaise = !!find(legal, 'raise') || !!find(legal, 'all_in');
  const pot = potSize(state);

  // ── Hard rule: never fold the current nuts (any difficulty). ──────────────────────────────
  const nuts = holdsCurrentNuts(hole, board, config);
  if (nuts) {
    // Extract maximum value: raise/jam often, otherwise stay in (call or check). Never fold.
    if (canRaise && rng() < Math.max(0.6, style.aggression)) {
      return buildRaise(legal, state, seatIndex, Math.max(0.75, style.betSizePot), brain.style === 'maniac' ? 0.5 : 0.2, rng);
    }
    if (toCall > 0 && find(legal, 'call')) return { action: 'call' };
    if (canCheck) return { action: 'check' };
    if (find(legal, 'call')) return { action: 'call' };
    return canRaise ? buildRaise(legal, state, seatIndex, style.betSizePot, 0.2, rng) : { action: 'check' };
  }

  // ── Beginner mistakes: occasionally make a random (non-fold) play. ────────────────────────
  if (diff.mistakeRate > 0 && rng() < diff.mistakeRate) {
    return randomNonFold(legal, state, seatIndex, rng);
  }

  const preflop = board.length === 0;

  // ── Estimate how good our hand is (0..1), with difficulty-scaled hand-reading noise. ──────
  let equity: number;
  if (preflop) {
    equity = preflopStrength(hole, config);
  } else {
    equity = estimateEquity(hole, board, config, activeOpponentCount(state, seatIndex), diff.iterations, rng);
  }
  equity = clamp01(equity + gaussianNoise(diff.equityNoise, rng));

  // ── Preflop: gate entry by VPIP, then choose raise vs call vs fold. ───────────────────────
  if (preflop) {
    const playCutoff = 1 - style.vpip; // play hands at/above this strength percentile
    const wantsToPlay = equity >= playCutoff;
    if (toCall === 0) {
      // We're in for free (e.g. big blind / limped): raise for value or check. Never fold.
      if (canRaise && wantsToPlay && rng() < style.pfrBias) {
        return buildRaise(legal, state, seatIndex, style.betSizePot, brain.style === 'maniac' ? 0.15 : 0.05, rng);
      }
      return canCheck ? { action: 'check' } : { action: 'call' };
    }
    if (!wantsToPlay) return { action: 'fold' };
    if (canRaise && equity >= style.raiseThreshold && rng() < style.pfrBias) {
      return buildRaise(legal, state, seatIndex, style.betSizePot, 0.05, rng);
    }
    return find(legal, 'call') ? { action: 'call' } : canCheck ? { action: 'check' } : { action: 'fold' };
  }

  // ── Postflop. ─────────────────────────────────────────────────────────────────────────────
  if (toCall === 0) {
    // No bet to call: bet for value, occasionally bluff, otherwise check.
    if (canRaise && equity >= style.raiseThreshold && rng() < style.aggression) {
      return buildRaise(legal, state, seatIndex, style.betSizePot, 0.12, rng);
    }
    if (canRaise && equity < style.callThreshold && rng() < style.bluffFreq * style.aggression) {
      return buildRaise(legal, state, seatIndex, style.betSizePot, 0.1, rng);
    }
    return canCheck ? { action: 'check' } : { action: 'fold' };
  }

  // Facing a bet: compare equity to the price, scaled by how much this bot respects pot odds.
  const potOdds = toCall / (pot + toCall); // break-even equity to call
  const callNeed = potOdds * diff.potOddsRespect + style.callThreshold * (1 - diff.potOddsRespect);

  if (canRaise && equity >= style.raiseThreshold && rng() < style.aggression) {
    return buildRaise(legal, state, seatIndex, style.betSizePot, 0.12, rng);
  }
  if (equity >= callNeed) {
    return find(legal, 'call') ? { action: 'call' } : { action: 'check' };
  }
  // Weak: mostly fold, but semi-bluff-raise at the style's bluff frequency.
  if (canRaise && rng() < style.bluffFreq * style.aggression) {
    return buildRaise(legal, state, seatIndex, style.betSizePot, 0.1, rng);
  }
  return { action: 'fold' };
}
