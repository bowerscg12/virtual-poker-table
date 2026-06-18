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
  /**
   * Fraction of starting hands played when facing a preflop raise.
   * Tight styles fold all but strong hands; loose styles fold only genuine trash.
   */
  vpip: number;
  /**
   * Fraction of starting hands played in an unraised pot (limp/walk/blind).
   * Loose styles play almost any hand here; tight styles remain selective.
   */
  vpipUnraised: number;
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
  // Tight-Aggressive: few hands, played hard. Stays selective even in limped pots.
  tag: { vpip: 0.24, vpipUnraised: 0.32, pfrBias: 0.8, aggression: 0.66, bluffFreq: 0.16, callThreshold: 0.46, raiseThreshold: 0.62, betSizePot: 0.66 },
  // Loose-Aggressive: plays almost anything unraised; only folds real trash to a raise.
  lag: { vpip: 0.78, vpipUnraised: 0.90, pfrBias: 0.74, aggression: 0.78, bluffFreq: 0.36, callThreshold: 0.38, raiseThreshold: 0.55, betSizePot: 0.72 },
  // Rock / Nit: very few hands, rarely raises, and stays tight regardless of action.
  nit: { vpip: 0.14, vpipUnraised: 0.18, pfrBias: 0.5, aggression: 0.4, bluffFreq: 0.04, callThreshold: 0.54, raiseThreshold: 0.7, betSizePot: 0.58 },
  // Calling Station: limps almost every hand; folds only garbage to a raise.
  station: { vpip: 0.82, vpipUnraised: 0.93, pfrBias: 0.14, aggression: 0.2, bluffFreq: 0.04, callThreshold: 0.3, raiseThreshold: 0.74, betSizePot: 0.5 },
  // Maniac: plays everything unraised; almost never folds even to a raise.
  maniac: { vpip: 0.88, vpipUnraised: 0.97, pfrBias: 0.9, aggression: 0.9, bluffFreq: 0.6, callThreshold: 0.28, raiseThreshold: 0.46, betSizePot: 0.95 },
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

/**
 * Relative postflop position of `seatIndex` among players still in the hand, as a 0..1 factor.
 * 0 = earliest to act (the first live seat left of the button); 1 = latest (the button itself).
 * Used by skilled bots to widen late-position ranges and tighten early ones. Returns 1 when fewer
 * than two players remain (position is irrelevant).
 */
function relativePosition(state: GameTableState, seatIndex: number): number {
  const live = state.seats.filter((s) => !s.folded).map((s) => s.seatIndex);
  if (live.length <= 1) return 1;
  // Modulus larger than any seat index keeps clockwise ordering stable for sparse/arbitrary seats.
  const cycle = Math.max(...state.seats.map((s) => s.seatIndex)) + 1;
  // Clockwise distance from the button: the seat immediately after it acts first (key 0); button last.
  const posKey = (idx: number): number => (idx - state.dealerSeatIndex - 1 + cycle) % cycle;
  const ordered = [...live].sort((a, b) => posKey(a) - posKey(b));
  return ordered.indexOf(seatIndex) / (ordered.length - 1);
}

/**
 * Minimum {@link preflopStrength} (0..1) a contesting opponent's holding is assumed to clear, for
 * range-weighted equity. Players still in a postflop pot are stronger than two random cards, and a
 * larger bet relative to the pot narrows the range further. Returns 0 preflop / with no opponents,
 * deferring to a fully random model.
 */
function opponentRangeFloor(state: GameTableState, seatIndex: number): number {
  if (state.board.length === 0) return 0;
  const seat = state.seats.find((s) => s.seatIndex === seatIndex);
  const toCall = seat ? Math.max(0, state.currentBet - seat.betThisStreet) : 0;
  const pot = potSize(state);
  const betFrac = toCall > 0 ? toCall / (pot + toCall) : 0; // price of the call, 0 if checked to us
  // Baseline narrowing for having reached this street, plus more the bigger the bet we face.
  return clamp01(0.12 + 0.45 * betFrac);
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
 * Monte-Carlo win equity (0..1) of this seat's hole cards against `opponents` holdings, completing
 * the board to 5 cards. Ties split credit. `iterations` controls accuracy.
 *
 * `opponentFloor` (0..1) models opponents as stronger-than-random: each sampled opponent holding
 * must clear this minimum {@link preflopStrength} (rejection sampling, capped retries). 0 = fully
 * random opponents (the default, preserving prior behavior for non-pro bots). A higher floor
 * narrows opponent ranges, which lowers the hero's win equity — used so skilled bots stop
 * over-calling against players who have voluntarily committed chips.
 */
export function estimateEquity(
  hole: Card[],
  board: Card[],
  config: VariantConfig,
  opponents: number,
  iterations: number,
  rng: Rng = Math.random,
  opponentFloor = 0
): number {
  if (opponents <= 0) return 1;
  const omaha = isOmaha(config);
  const holeCount = omaha ? 4 : 2;
  const pool = unseenDeck([...hole, ...board]);
  // Omaha evaluation is far heavier (2-of-4 × 3-of-board), so cap its iteration budget.
  const iters = Math.max(40, omaha ? Math.round(iterations / 3) : iterations);
  const MAX_RANGE_TRIES = opponentFloor > 0 ? 6 : 1;

  let won = 0;
  for (let i = 0; i < iters; i++) {
    // Partial Fisher-Yates over a copy: draw opponent holes + board completion without collisions.
    // Drawn cards are swapped to the live boundary so a rejected hand can be returned via `undraw`.
    const deck = pool.slice();
    let top = deck.length;
    const draw = (): Card => {
      const j = Math.floor(rng() * top);
      const c = deck[j];
      deck[j] = deck[top - 1];
      deck[top - 1] = c;
      top--;
      return c;
    };
    // Return the `n` most recently drawn cards to the live region (they sit just past `top`).
    const undraw = (n: number): void => {
      top += n;
    };

    const oppHoles: Card[][] = [];
    for (let o = 0; o < opponents; o++) {
      let h: Card[] = [];
      for (let attempt = 0; attempt < MAX_RANGE_TRIES; attempt++) {
        h = [];
        for (let c = 0; c < holeCount; c++) h.push(draw());
        // Accept once the holding clears the range floor, or on the final try (bounds cost).
        if (opponentFloor <= 0 || attempt === MAX_RANGE_TRIES - 1 || preflopStrength(h, config) >= opponentFloor) {
          break;
        }
        undraw(holeCount);
      }
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
 * Board "wetness" (0..1): how many draws the board supports. Combines flush-ness (cards of one suit)
 * and straight-ness (rank connectivity). Used to size bets by texture rather than by hand strength,
 * so a big bet stops signalling a big hand. Returns a neutral mid value before the flop.
 */
export function boardWetness(board: Card[]): number {
  if (board.length < 3) return 0.3;
  const suitCounts = new Map<string, number>();
  for (const c of board) suitCounts.set(c[1], (suitCounts.get(c[1]) ?? 0) + 1);
  const maxSuit = Math.max(...suitCounts.values());
  const flushy = maxSuit >= 3 ? 1 : maxSuit === 2 ? 0.4 : 0;
  const ranks = [...new Set(board.map((c) => RANK_VAL[c[0]]))].sort((a, b) => a - b);
  const span = ranks[ranks.length - 1] - ranks[0];
  let straighty = 0;
  if (ranks.length >= 3 && span <= 4) straighty = 1;
  else if (ranks.length >= 2 && span <= 6) straighty = 0.5;
  return clamp01(0.6 * flushy + 0.6 * straighty);
}

/**
 * Bet/raise size as a fraction of the pot, shaped by board texture and jittered each call so two
 * identical spots don't always produce the same number. Wetter boards bet larger (charge draws);
 * a ±15% jitter de-correlates sizing from hand strength, which matters most for `pro` (otherwise
 * deterministic). Clamped to a sane 0.3–1.25 pot range.
 */
function textureBetFraction(style: StyleProfile, board: Card[], rng: Rng): number {
  const wet = boardWetness(board);
  const base = style.betSizePot * (0.8 + 0.5 * wet);
  const jitter = 1 + (rng() - 0.5) * 0.3;
  return Math.max(0.3, Math.min(1.25, base * jitter));
}

/** Count of distinct ranks whose arrival completes a 5-card straight (0 if none, or already made). */
function straightCompletingRanks(ranks: Set<number>): number {
  const ext = new Set(ranks);
  if (ranks.has(14)) ext.add(1); // ace plays low for the wheel
  const isStraight = (s: Set<number>): boolean => {
    for (let lo = 1; lo <= 10; lo++) {
      let run = true;
      for (let k = 0; k < 5; k++) if (!s.has(lo + k)) { run = false; break; }
      if (run) return true;
    }
    return false;
  };
  if (isStraight(ext)) return 0; // already a straight — not a draw
  let count = 0;
  for (let r = 2; r <= 14; r++) {
    if (ext.has(r)) continue;
    const test = new Set(ext);
    test.add(r);
    if (r === 14) test.add(1);
    if (isStraight(test)) count++;
  }
  return count;
}

/**
 * Classify the seat's draw on the current board: `strong` ≈ flush draw or open-ended straight (~8+
 * outs), `weak` ≈ gutshot (~4 outs), else `none`. Hold'em only (any two cards play); Omaha and the
 * river return `none` and fall back to made-hand equity. Drives semi-bluffing — betting/raising a
 * draw for its fold equity, which raw equity alone never chooses to do.
 */
export function drawStrength(hole: Card[], board: Card[], config: VariantConfig): 'strong' | 'weak' | 'none' {
  if (isOmaha(config) || board.length < 3 || board.length >= 5) return 'none';
  const cards = [...hole, ...board];
  const suitCounts = new Map<string, number>();
  for (const c of cards) suitCounts.set(c[1], (suitCounts.get(c[1]) ?? 0) + 1);
  const flushDraw = [...suitCounts.values()].some((n) => n === 4); // n=5 is a made flush, not a draw
  const straightOuts = straightCompletingRanks(new Set(cards.map((c) => RANK_VAL[c[0]])));
  if (flushDraw || straightOuts >= 2) return 'strong';
  if (straightOuts === 1) return 'weak';
  return 'none';
}

/**
 * A per-hand bluff "commitment" in [0,1), derived from a stable hash of the holding + hand number +
 * seat. Because it does not change between streets, a hand that starts bluffing keeps barrelling on
 * later streets (a planned line) instead of re-rolling an independent coin each decision — fixing
 * the "bet the flop, randomly give up the turn" tell. Opponents can't see the hole cards, so it
 * stays unpredictable to them while staying coherent for the bot.
 */
function handBluffRoll(hole: Card[], handNumber: number, seatIndex: number): number {
  let h = (handNumber * 2654435761 + seatIndex * 40503) | 0;
  for (const c of hole) {
    for (let k = 0; k < c.length; k++) h = (Math.imul(h, 31) + c.charCodeAt(k)) | 0;
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return ((h >>> 0) % 100000) / 100000;
}

/** Chance a nut hand slow-plays (trap) rather than betting — higher on dry/early streets, ~0 when
 *  the board is wet (where you'd rather charge draws) or on the river (last chance for value). */
function nutsTrapChance(state: GameTableState): number {
  let c = 0.32 * (1 - boardWetness(state.board));
  if (state.street === 'flop') c += 0.12;
  else if (state.street === 'river') c -= 0.12;
  return Math.max(0, Math.min(0.45, c));
}

/**
 * Probability of taking the value bet/raise line. `pro` mixes a smooth ramp around the threshold
 * (thin value just under it, occasional pot-control checks just over it) so its action is not a
 * deterministic read; other difficulties keep the original hard cutoff.
 */
function valueBetChance(equity: number, threshold: number, style: StyleProfile, difficulty: BotDifficulty): number {
  if (difficulty === 'pro') {
    return clamp01((equity - (threshold - 0.08)) / 0.16) * style.aggression;
  }
  return equity >= threshold ? style.aggression : 0;
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
 * Decide which of the 3 hole cards to discard during a pineapple discard phase.
 * Priority: keep a pocket pair if one exists; otherwise discard the lowest-ranked card.
 */
export function decidePineappleDiscard(holeCards: Card[]): number {
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      if (holeCards[i][0] === holeCards[j][0]) {
        return [0, 1, 2].find((k) => k !== i && k !== j)!;
      }
    }
  }
  // No pair — discard the lowest card
  let minIdx = 0;
  for (let i = 1; i < 3; i++) {
    if ((RANK_VAL[holeCards[i][0]] ?? 0) < (RANK_VAL[holeCards[minIdx][0]] ?? 0)) minIdx = i;
  }
  return minIdx;
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
    // Sometimes slow-play (trap) instead of always betting big — otherwise a big bet reads as the
    // nuts. When betting, size like a normal value bet (texture-based) so sizing doesn't leak. Never fold.
    const slowPlay = rng() < nutsTrapChance(state);
    if (canRaise && !slowPlay && rng() < Math.max(0.5, style.aggression)) {
      const frac = textureBetFraction(style, board, rng) * 1.05;
      return buildRaise(legal, state, seatIndex, frac, brain.style === 'maniac' ? 0.4 : 0.15, rng);
    }
    // Trap / pot-control line: stay in cheaply and let opponents catch up or bluff into us.
    if (toCall > 0 && find(legal, 'call')) return { action: 'call' };
    if (canCheck) return { action: 'check' };
    if (find(legal, 'call')) return { action: 'call' };
    return canRaise ? buildRaise(legal, state, seatIndex, textureBetFraction(style, board, rng), 0.15, rng) : { action: 'check' };
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
    // Pro bots model contesting opponents as stronger than random (range-weighted equity); others
    // assume fully random holdings (floor 0), preserving their prior, looser calling behavior.
    const floor = brain.difficulty === 'pro' ? opponentRangeFloor(state, seatIndex) : 0;
    equity = estimateEquity(hole, board, config, activeOpponentCount(state, seatIndex), diff.iterations, rng, floor);
  }
  equity = clamp01(equity + gaussianNoise(diff.equityNoise, rng));

  // ── Preflop: gate entry by VPIP, then choose raise vs call vs fold. ───────────────────────
  if (preflop) {
    // Distinguish a raised pot from a limped/walked pot so loose styles play wider unraised.
    const potIsRaised = state.currentBet > config.blinds.big;
    let effectiveVpip = potIsRaised ? style.vpip : style.vpipUnraised;
    // Pro bots adjust their entry range by position: tighter in early seats, wider on the button.
    if (brain.difficulty === 'pro') {
      effectiveVpip = clamp01(effectiveVpip * (0.75 + 0.5 * relativePosition(state, seatIndex)));
    }
    const playCutoff = 1 - effectiveVpip;
    const wantsToPlay = equity >= playCutoff;
    if (toCall === 0) {
      // In for free (BB walked or all limps): raise for value or check. Never fold.
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
  const draw = drawStrength(hole, board, config);
  // Stable across streets, so a bluff started on the flop is carried through (a planned barrel).
  const bluffCommitted = handBluffRoll(hole, state.handNumber, seatIndex) < style.bluffFreq;
  const betFrac = (): number => textureBetFraction(style, board, rng);

  if (toCall === 0) {
    // No bet to call: bet for value (mixed near threshold for pro), semi-bluff draws, or barrel.
    if (canRaise && rng() < valueBetChance(equity, style.raiseThreshold, style, brain.difficulty)) {
      return buildRaise(legal, state, seatIndex, betFrac(), 0.12, rng);
    }
    // Semi-bluff: bet a draw for its fold equity even though it isn't yet a made value hand.
    if (canRaise && draw !== 'none' && equity < style.raiseThreshold) {
      const sbChance = (draw === 'strong' ? 0.6 : 0.3) * Math.max(style.aggression, 0.4);
      if (rng() < sbChance) return buildRaise(legal, state, seatIndex, betFrac(), 0.12, rng);
    }
    // Planned bluff: a hand committed to bluffing keeps firing rather than randomly giving up.
    if (canRaise && equity < style.callThreshold && bluffCommitted) {
      return buildRaise(legal, state, seatIndex, betFrac(), 0.1, rng);
    }
    return canCheck ? { action: 'check' } : { action: 'fold' };
  }

  // Facing a bet: compare equity to the price, scaled by how much this bot respects pot odds.
  const potOdds = toCall / (pot + toCall); // break-even equity to call
  const callNeed = potOdds * diff.potOddsRespect + style.callThreshold * (1 - diff.potOddsRespect);

  if (canRaise && rng() < valueBetChance(equity, style.raiseThreshold, style, brain.difficulty)) {
    return buildRaise(legal, state, seatIndex, betFrac(), 0.12, rng);
  }
  // Semi-bluff raise with a strong draw: fold equity now plus outs if called.
  if (canRaise && draw === 'strong' && rng() < 0.35 * Math.max(style.aggression, 0.4)) {
    return buildRaise(legal, state, seatIndex, betFrac(), 0.12, rng);
  }
  // Call when the price is right; draws get an implied-odds discount on the break-even bar.
  const drawDiscount = draw === 'strong' ? 0.85 : draw === 'weak' ? 0.93 : 1;
  if (equity >= callNeed * drawDiscount) {
    return find(legal, 'call') ? { action: 'call' } : { action: 'check' };
  }
  // Weak: continue a planned bluff by raising, otherwise fold.
  if (canRaise && equity < style.callThreshold && bluffCommitted && rng() < 0.6) {
    return buildRaise(legal, state, seatIndex, betFrac(), 0.1, rng);
  }
  return { action: 'fold' };
}
