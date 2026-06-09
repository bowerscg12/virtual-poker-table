import type { Card, PlayerActionType, Street, VariantConfig } from '@vct/shared-types';
import { createDeck, drawCards, shuffleDeck } from './deck.js';
import { compareHands, type EvaluatedHand } from './evaluate.js';
import { buildSidePots, type SidePot } from './pots.js';
import { computeLegalActions, nextActiveSeat, type BettingPlayer } from './holdem.js';
import { getVariantModule } from './variant-module.js';

export interface InternalSeat extends BettingPlayer {
  userId: string;
  displayName: string;
  holeCards: Card[];
  shownCards?: Card[];
}

export interface GameTableState {
  handNumber: number;
  street: Street;
  deck: Card[];
  board: Card[];
  seats: InternalSeat[];
  pots: SidePot[];
  dealerSeatIndex: number;
  actionSeatIndex: number | null;
  currentBet: number;
  minRaise: number;
  lastAggressorSeat: number | null;
  lastWinningSeatIndices: number[];
  /** `board` tags which board a payout came from in a Double Board Bomb Pot ('A'/'B'); absent otherwise.
   *  `runIndex` (0-based) tags which run a payout came from in a multi-runout hand; absent otherwise.
   *  `isContested` is true when 2+ players were eligible for the pot (false = uncalled chips returned uncontested). */
  winnerPayouts: { seatIndex: number; amount: number; handDescription: string; board?: 'A' | 'B'; runIndex?: number; isContested: boolean }[];
  processedActionIds: Set<string>;
  bombPotActive: boolean;
  /** True when this hand is a per-hand Bomb Pot (forced ante, no betting, auto runout). */
  isBombPot: boolean;
  /** Forced contribution per participant for a Bomb Pot hand (0 otherwise). */
  bombPotAmount: number;
  /** True when this Bomb Pot deals two boards and splits the pot 50/50. */
  isDoubleBoardBombPot: boolean;
  /** Board B — only populated for a Double Board Bomb Pot hand. */
  secondBoard?: Card[];
  pendingActionSeatIndices: number[];
  /** Evaluated hand per non-folded seat at showdown — only set when street becomes 'complete' via showdown */
  showdownHands?: { seatIndex: number; handDescription: string; bestFive: Card[] }[];
  /** Board B evaluated hands — only set for a Double Board Bomb Pot showdown. */
  secondShowdownHands?: { seatIndex: number; handDescription: string; bestFive: Card[] }[];
  /** Revealed cards per seat (keyed by seatIndex) — only used for twelve_card_flip */
  revealedCards?: Record<number, Card[]>;
  /** Set when all players are all-in and config.runItOut > 1; engine paused before dealing runout cards. */
  pendingMultiRunout?: boolean;
  /** All dealt boards for a run-it-out hand (2 or 3 runs). Board 0 is also stored in `board`. */
  runoutBoards?: Card[][];
  /** Per-run showdown hands for a run-it-out hand, parallel to runoutBoards. */
  runoutShowdownHands?: { board: Card[]; hands: { seatIndex: number; handDescription: string; bestFive: Card[] }[] }[];
}

export function createInitialTable(
  seated: { seatIndex: number; userId: string; displayName: string; stack: number }[],
  config: VariantConfig,
  handNumber: number,
  dealerSeatIndex: number,
  rng: () => number = Math.random
): GameTableState {
  const module = getVariantModule(config);
  const deck = shuffleDeck(createDeck(), rng);
  const seats: InternalSeat[] = seated.map((s) => ({
    ...s,
    betThisStreet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    holeCards: [],
  }));

  const holeCount = (config.pineapple && config.game === 'holdem') ? 3 : module.holeCardCount;
  let remaining = deck;
  for (const seat of seats) {
    const { drawn, remaining: r } = drawCards(remaining, holeCount);
    seat.holeCards = drawn;
    remaining = r;
  }

  const activeIndices = seats.map((s) => s.seatIndex);
  const headsUp = activeIndices.length === 2;
  const sbSeat = headsUp ? dealerSeatIndex : nextActiveSeat(activeIndices, dealerSeatIndex + 1, () => true)!;
  const bbSeat = nextActiveSeat(activeIndices, sbSeat + 1, () => true)!;

  const sb = config.blinds.small;
  const bb = config.blinds.big;
  postBlind(seats, sbSeat, sb);
  postBlind(seats, bbSeat, bb);

  let lastAggressorSeat = bbSeat;
  let actionSeatStart = headsUp ? sbSeat : bbSeat + 1;
  let minRaise = bb;

  if (config.game === 'holdem' && config.straddle) {
    const straddleSeat = nextActiveSeat(activeIndices, bbSeat + 1, () => true);
    if (straddleSeat !== null) {
      const straddleAmount = Math.max(bb, config.straddleAmount ?? bb * 2);
      postBlind(seats, straddleSeat, straddleAmount);
      lastAggressorSeat = straddleSeat;
      actionSeatStart = straddleSeat + 1;
      minRaise = Math.max(bb, straddleAmount - bb);
    }
  }

  const currentBet = Math.max(...seats.map((s) => s.betThisStreet));
  const pendingActionSeatIndices = buildActionQueue(seats, actionSeatStart);
  const actionSeat = pendingActionSeatIndices[0] ?? null;

  return {
    handNumber,
    street: 'preflop',
    deck: remaining,
    board: [],
    seats,
    pots: [],
    dealerSeatIndex,
    actionSeatIndex: actionSeat,
    currentBet,
    minRaise,
    lastAggressorSeat,
    lastWinningSeatIndices: [],
    winnerPayouts: [],
    processedActionIds: new Set(),
    bombPotActive: false,
    isBombPot: false,
    bombPotAmount: 0,
    isDoubleBoardBombPot: false,
    pendingActionSeatIndices,
  };
}

function getSeat(seats: InternalSeat[], idx: number): InternalSeat | undefined {
  return seats.find((s) => s.seatIndex === idx);
}

function postBlind(seats: InternalSeat[], seatIndex: number, amount: number): void {
  const seat = getSeat(seats, seatIndex);
  if (!seat) return;
  const pay = Math.min(amount, seat.stack);
  seat.stack -= pay;
  seat.betThisStreet += pay;
  seat.totalBet += pay;
  if (seat.stack === 0) seat.allIn = true;
}

function isLiveSeat(seat: InternalSeat): boolean {
  return !seat.folded && !seat.allIn && seat.stack > 0;
}

function buildActionQueue(seats: InternalSeat[], fromSeatIndex: number): number[] {
  if (seats.length === 0) return [];
  const seatIndices = [...seats.map((seat) => seat.seatIndex)].sort((a, b) => a - b);
  const start = seatIndices.findIndex((seatIndex) => seatIndex >= fromSeatIndex);
  const startIndex = start === -1 ? 0 : start;
  const queue: number[] = [];
  for (let offset = 0; offset < seatIndices.length; offset++) {
    const seatIndex = seatIndices[(startIndex + offset) % seatIndices.length];
    const seat = getSeat(seats, seatIndex);
    if (seat && isLiveSeat(seat)) {
      queue.push(seatIndex);
    }
  }
  return queue;
}

export function applyAction(
  state: GameTableState,
  config: VariantConfig,
  seatIndex: number,
  action: PlayerActionType,
  amount: number | undefined,
  actionId: string
): { ok: true; state: GameTableState } | { ok: false; error: string } {
  if (state.processedActionIds.has(actionId)) {
    return { ok: true, state };
  }
  if (state.actionSeatIndex !== seatIndex) {
    return { ok: false, error: 'Not your turn' };
  }

  const seat = getSeat(state.seats, seatIndex);
  if (!seat || seat.folded || seat.allIn) {
    return { ok: false, error: 'Cannot act' };
  }

  const legal = computeLegalActions(
    seat,
    state.seats,
    state.currentBet,
    state.minRaise,
    state.street,
    config
  );
  if (!legal.some((a) => a.type === action)) {
    return { ok: false, error: 'Illegal action' };
  }

  const toCall = state.currentBet - seat.betThisStreet;
  let newState = { ...state, seats: state.seats.map((s) => ({ ...s })) };
  const s = getSeat(newState.seats, seatIndex)!;
  const previousCurrentBet = state.currentBet;

  switch (action) {
    case 'fold':
      s.folded = true;
      break;
    case 'check':
      if (toCall > 0) return { ok: false, error: 'Cannot check' };
      break;
    case 'call': {
      const pay = Math.min(toCall, s.stack);
      s.stack -= pay;
      s.betThisStreet += pay;
      s.totalBet += pay;
      if (s.stack === 0) s.allIn = true;
      break;
    }
    case 'raise':
    case 'all_in': {
      const target = action === 'all_in' ? s.betThisStreet + s.stack : (amount ?? 0);
      const add = target - s.betThisStreet;
      if (add > s.stack) return { ok: false, error: 'Insufficient stack' };
      const raiseBy = target - state.currentBet;
      if (action === 'raise' && raiseBy < newState.minRaise && target < s.betThisStreet + s.stack) {
        return { ok: false, error: 'Raise too small' };
      }
      s.stack -= add;
      s.betThisStreet += add;
      s.totalBet += add;
      if (s.stack === 0) s.allIn = true;
      newState.currentBet = Math.max(newState.currentBet, s.betThisStreet);
      newState.minRaise = Math.max(newState.minRaise, raiseBy);
      newState.lastAggressorSeat = seatIndex;
      break;
    }
  }

  newState.processedActionIds = new Set(state.processedActionIds);
  newState.processedActionIds.add(actionId);

  const raisedBet = newState.currentBet > previousCurrentBet;

  return advanceAfterAction(newState, config, raisedBet);
}

function advanceAfterAction(
  state: GameTableState,
  config: VariantConfig,
  resetBettingRound: boolean
): { ok: true; state: GameTableState } | { ok: false; error: string } {
  const active = state.seats.filter((s) => !s.folded && (s.stack > 0 || s.betThisStreet > 0));
  if (active.length === 1) {
    return { ok: true, state: awardToWinner(state, active[0].seatIndex) };
  }

  const actorSeatIndex = state.actionSeatIndex;
  if (actorSeatIndex === null) {
    return { ok: false, error: 'No active player' };
  }

  const baseQueue =
    state.pendingActionSeatIndices.length > 0
      ? state.pendingActionSeatIndices
      : buildActionQueue(state.seats, actorSeatIndex);
  const nextQueue = resetBettingRound
    ? buildActionQueue(state.seats, actorSeatIndex + 1).filter((seatIndex) => seatIndex !== actorSeatIndex)
    : baseQueue.filter((seatIndex) => seatIndex !== actorSeatIndex);

  if (nextQueue.length === 0) {
    return advanceStreet(state, config);
  }

  return {
    ok: true,
    state: {
      ...state,
      actionSeatIndex: nextQueue[0],
      pendingActionSeatIndices: nextQueue,
    },
  };
}

function advanceStreet(
  state: GameTableState,
  config: VariantConfig
): { ok: true; state: GameTableState } {
  const module = getVariantModule(config);
  let { deck, board, street } = state;

  for (const s of state.seats) {
    s.betThisStreet = 0;
  }

  // Multi-runout: stop before dealing any runout cards so the server can orchestrate N boards.
  // Only applies for holdem/omaha when runItOut > 1, and only before the river is already dealt.
  if (
    (config.runItOut ?? 1) > 1 &&
    (config.game === 'holdem' || config.game === 'omaha') &&
    state.street !== 'river' &&
    state.seats.filter(isLiveSeat).length < 2
  ) {
    return {
      ok: true,
      state: { ...state, actionSeatIndex: null, pendingActionSeatIndices: [], pendingMultiRunout: true },
    };
  }

  const stillIn = state.seats.filter((s) => !s.folded);
  if (stillIn.length === 1) {
    return { ok: true, state: awardToWinner(state, stillIn[0].seatIndex) };
  }

  if (street === 'preflop') {
    const flopCount = module.flopCardCount(config);
    const burn1 = drawCards(deck, 1);
    const flop = drawCards(burn1.remaining, flopCount);
    deck = flop.remaining;
    board = flop.drawn;
    street = 'flop';
  } else if (street === 'flop') {
    const burn = drawCards(deck, 1);
    const turn = drawCards(burn.remaining, 1);
    deck = turn.remaining;
    board = [...board, ...turn.drawn];
    street = 'turn';
  } else if (street === 'turn') {
    const burn = drawCards(deck, 1);
    const river = drawCards(burn.remaining, 1);
    deck = river.remaining;
    board = [...board, ...river.drawn];
    street = 'river';
  } else if (street === 'river') {
    return runShowdown({ ...state, board, deck, street: 'showdown' }, config);
  }

  // Betting can only continue when at least two seats can still act. When one or
  // fewer players are live (e.g. an all-in has been called and only the covering
  // player has chips left), there is nothing left to bet — deal out the remaining
  // board to showdown with no action.
  const liveSeatCount = state.seats.filter((s) => isLiveSeat(s)).length;
  const firstToAct =
    liveSeatCount >= 2
      ? nextActiveSeat(
          state.seats.map((s) => s.seatIndex),
          state.dealerSeatIndex + 1,
          (idx) => {
            const s = getSeat(state.seats, idx);
            return !!s && isLiveSeat(s);
          }
        )
      : null;

  if (firstToAct === null) {
    return advanceStreet(
      {
        ...state,
        deck,
        board,
        street,
        currentBet: 0,
        minRaise: config.blinds.big,
        actionSeatIndex: null,
        lastAggressorSeat: null,
        pendingActionSeatIndices: [],
      },
      config
    );
  }

  return {
    ok: true,
    state: {
      ...state,
      deck,
      board,
      street,
      currentBet: 0,
      minRaise: config.blinds.big,
      actionSeatIndex: firstToAct,
      lastAggressorSeat: null,
      pendingActionSeatIndices: buildActionQueue(state.seats, firstToAct),
    },
  };
}

/**
 * Award each side pot to the best hand(s) among its eligible, non-folded seats.
 * Mutates seat stacks and returns one payout entry per (pot, winner). Ties split with
 * floor + remainder chips going to the first winning seat (existing odd-chip convention).
 */
function awardPots(
  seats: InternalSeat[],
  pots: SidePot[],
  evaluatedHands: Map<number, EvaluatedHand>
): { seatIndex: number; amount: number; handDescription: string; isContested: boolean }[] {
  const payouts: { seatIndex: number; amount: number; handDescription: string; isContested: boolean }[] = [];

  for (const pot of pots) {
    const eligible = seats.filter(
      (s) => pot.eligibleSeatIndices.includes(s.seatIndex) && !s.folded && evaluatedHands.has(s.seatIndex)
    );
    if (eligible.length === 0) continue;

    let best: EvaluatedHand | null = null;
    const bestSeats: number[] = [];

    for (const s of eligible) {
      const hand = evaluatedHands.get(s.seatIndex)!;
      if (!best || compareHands(hand, best) > 0) {
        best = hand;
        bestSeats.length = 0;
        bestSeats.push(s.seatIndex);
      } else if (best && compareHands(hand, best) === 0) {
        bestSeats.push(s.seatIndex);
      }
    }

    const share = Math.floor(pot.amount / bestSeats.length);
    const remainder = pot.amount - share * bestSeats.length;
    bestSeats.forEach((idx, i) => {
      const amount = share + (i === 0 ? remainder : 0);
      const seat = getSeat(seats, idx)!;
      seat.stack += amount;
      payouts.push({ seatIndex: idx, amount, handDescription: best!.description, isContested: eligible.length > 1 });
    });
  }

  return payouts;
}

function runShowdown(state: GameTableState, config: VariantConfig): { ok: true; state: GameTableState } {
  const module = getVariantModule(config);
  const pots = buildSidePots(state.seats.map((s) => ({ seatIndex: s.seatIndex, amount: s.totalBet })));
  const chipsBefore = state.seats.reduce((s, seat) => s + seat.stack + seat.totalBet, 0);

  for (const seat of state.seats) {
    if (!seat.folded) seat.shownCards = [...seat.holeCards];
  }

  // Pre-evaluate all non-folded players once so we can reuse across pots and store for display.
  const evaluatedHands = new Map<number, EvaluatedHand>();
  for (const seat of state.seats) {
    if (!seat.folded) {
      evaluatedHands.set(seat.seatIndex, module.evaluateHand(seat.holeCards, state.board));
    }
  }

  const payouts = awardPots(state.seats, pots, evaluatedHands);
  const chipsAfter = state.seats.reduce((s, seat) => s + seat.stack, 0);
  if (chipsBefore !== chipsAfter) {
    console.error(`[chip-conservation] VIOLATION in showdown: before=${chipsBefore} after=${chipsAfter}`);
  }

  const showdownHands = [...evaluatedHands.entries()].map(([seatIndex, hand]) => ({
    seatIndex,
    handDescription: hand.description,
    bestFive: hand.bestFive,
  }));

  return {
    ok: true,
    state: {
      ...state,
      street: 'complete',
      pots,
      actionSeatIndex: null,
      lastWinningSeatIndices: Array.from(new Set(payouts.map((p) => p.seatIndex))),
      winnerPayouts: payouts,
      showdownHands,
      pendingActionSeatIndices: [],
    },
  };
}

/**
 * Showdown for a Double Board Bomb Pot. Each side pot is halved: one half decided by
 * Board A, the other by Board B (odd chip → Board A). Reuses awardPots for each board so
 * ties, multiple winners, side pots, and odd-chip distribution all follow normal rules.
 */
function runDoubleBoardShowdown(
  state: GameTableState,
  config: VariantConfig
): { ok: true; state: GameTableState } {
  const module = getVariantModule(config);
  const boardB = state.secondBoard ?? [];
  const pots = buildSidePots(state.seats.map((s) => ({ seatIndex: s.seatIndex, amount: s.totalBet })));
  const chipsBefore = state.seats.reduce((s, seat) => s + seat.stack + seat.totalBet, 0);

  for (const seat of state.seats) {
    if (!seat.folded) seat.shownCards = [...seat.holeCards];
  }

  const handsA = new Map<number, EvaluatedHand>();
  const handsB = new Map<number, EvaluatedHand>();
  for (const seat of state.seats) {
    if (seat.folded) continue;
    handsA.set(seat.seatIndex, module.evaluateHand(seat.holeCards, state.board));
    handsB.set(seat.seatIndex, module.evaluateHand(seat.holeCards, boardB));
  }

  // Split every side pot in half, awarding each half by its board.
  const potsA: SidePot[] = [];
  const potsB: SidePot[] = [];
  for (const pot of pots) {
    const halfA = Math.ceil(pot.amount / 2); // odd chip favors Board A
    potsA.push({ amount: halfA, eligibleSeatIndices: pot.eligibleSeatIndices });
    potsB.push({ amount: pot.amount - halfA, eligibleSeatIndices: pot.eligibleSeatIndices });
  }

  const winnerPayouts = [
    ...awardPots(state.seats, potsA, handsA).map((p) => ({ ...p, board: 'A' as const, isContested: p.isContested })),
    ...awardPots(state.seats, potsB, handsB).map((p) => ({ ...p, board: 'B' as const, isContested: p.isContested })),
  ];
  const chipsAfter = state.seats.reduce((s, seat) => s + seat.stack, 0);
  if (chipsBefore !== chipsAfter) {
    console.error(`[chip-conservation] VIOLATION in double-board showdown: before=${chipsBefore} after=${chipsAfter}`);
  }

  const toEntries = (m: Map<number, EvaluatedHand>) =>
    [...m.entries()].map(([seatIndex, hand]) => ({
      seatIndex,
      handDescription: hand.description,
      bestFive: hand.bestFive,
    }));

  return {
    ok: true,
    state: {
      ...state,
      street: 'complete',
      pots,
      actionSeatIndex: null,
      lastWinningSeatIndices: Array.from(new Set(winnerPayouts.map((p) => p.seatIndex))),
      winnerPayouts,
      showdownHands: toEntries(handsA),
      secondShowdownHands: toEntries(handsB),
      pendingActionSeatIndices: [],
    },
  };
}

/**
 * Showdown for a multi-runout hand (2 or 3 runs). Each side pot is split into numRuns equal
 * parts; each share is awarded to the best hand on its respective board. Remainder chip goes
 * to the first run's winner (lowest runIndex).
 */
function runMultiBoardShowdown(
  state: GameTableState,
  config: VariantConfig,
  boards: Card[][],
): GameTableState {
  const module = getVariantModule(config);
  const numRuns = boards.length;
  const pots = buildSidePots(state.seats.map((s) => ({ seatIndex: s.seatIndex, amount: s.totalBet })));
  const chipsBefore = state.seats.reduce((s, seat) => s + seat.stack + seat.totalBet, 0);

  for (const seat of state.seats) {
    if (!seat.folded) seat.shownCards = [...seat.holeCards];
  }

  const boardEvals = boards.map((board) => {
    const map = new Map<number, EvaluatedHand>();
    for (const seat of state.seats) {
      if (!seat.folded) {
        map.set(seat.seatIndex, module.evaluateHand(seat.holeCards, board));
      }
    }
    return map;
  });

  const winnerPayouts: GameTableState['winnerPayouts'] = [];

  for (const pot of pots) {
    const share = Math.floor(pot.amount / numRuns);
    const remainder = pot.amount - share * numRuns;

    for (let runIdx = 0; runIdx < numRuns; runIdx++) {
      const runAmount = share + (runIdx === 0 ? remainder : 0);
      if (runAmount === 0) continue;

      const eligible = state.seats.filter(
        (s) => pot.eligibleSeatIndices.includes(s.seatIndex) && !s.folded && boardEvals[runIdx].has(s.seatIndex),
      );
      if (eligible.length === 0) continue;

      let best: EvaluatedHand | null = null;
      const bestSeats: number[] = [];
      for (const s of eligible) {
        const hand = boardEvals[runIdx].get(s.seatIndex)!;
        if (!best || compareHands(hand, best) > 0) {
          best = hand;
          bestSeats.length = 0;
          bestSeats.push(s.seatIndex);
        } else if (best && compareHands(hand, best) === 0) {
          bestSeats.push(s.seatIndex);
        }
      }

      const runShare = Math.floor(runAmount / bestSeats.length);
      const runRemainder = runAmount - runShare * bestSeats.length;
      bestSeats.forEach((idx, i) => {
        const amount = runShare + (i === 0 ? runRemainder : 0);
        getSeat(state.seats, idx)!.stack += amount;
        winnerPayouts.push({ seatIndex: idx, amount, handDescription: best!.description, isContested: eligible.length > 1, runIndex: runIdx });
      });
    }
  }

  const chipsAfter = state.seats.reduce((s, seat) => s + seat.stack, 0);
  if (chipsBefore !== chipsAfter) {
    console.error(`[chip-conservation] VIOLATION in multi-runout showdown: before=${chipsBefore} after=${chipsAfter}`);
  }

  const runoutShowdownHands = boards.map((board, i) => ({
    board,
    hands: [...boardEvals[i].entries()].map(([seatIndex, hand]) => ({
      seatIndex,
      handDescription: hand.description,
      bestFive: hand.bestFive,
    })),
  }));

  return {
    ...state,
    street: 'complete',
    board: boards[0],
    pots,
    actionSeatIndex: null,
    lastWinningSeatIndices: [...new Set(winnerPayouts.map((p) => p.seatIndex))],
    winnerPayouts,
    showdownHands: runoutShowdownHands[0].hands,
    pendingMultiRunout: false,
    runoutBoards: boards,
    runoutShowdownHands,
    pendingActionSeatIndices: [],
  };
}

/**
 * Deal numRuns boards from the deck in `state` (each run consumes cards from where the previous
 * left off) and resolve the showdown, splitting pots equally across runs.
 * For numRuns === 1 deals a single board and runs the normal showdown (no runoutBoards set).
 * Called by the server after the player chooses how many times to run it out.
 */
export function dealMultipleRunouts(
  state: GameTableState,
  config: VariantConfig,
  numRuns: number,
): GameTableState {
  const module = getVariantModule(config);
  const resolvedRuns = Math.max(1, numRuns);

  // Helper: deal remaining community cards onto a partial board from the given deck.
  const dealBoard = (partialBoard: Card[], deck: Card[]): { board: Card[]; deck: Card[] } => {
    let remaining = deck;
    let board = [...partialBoard];

    if (board.length < 3) {
      const burn1 = drawCards(remaining, 1); remaining = burn1.remaining;
      const flopCount = module.flopCardCount(config);
      const flop = drawCards(remaining, flopCount); remaining = flop.remaining;
      board = [...board, ...flop.drawn];
    }
    if (board.length < 4) {
      const burn = drawCards(remaining, 1); remaining = burn.remaining;
      const turn = drawCards(remaining, 1); remaining = turn.remaining;
      board = [...board, ...turn.drawn];
    }
    if (board.length < 5) {
      const burn = drawCards(remaining, 1); remaining = burn.remaining;
      const river = drawCards(remaining, 1); remaining = river.remaining;
      board = [...board, ...river.drawn];
    }

    return { board, deck: remaining };
  };

  if (resolvedRuns === 1) {
    const { board, deck } = dealBoard(state.board, state.deck);
    return runShowdown({ ...state, board, deck, street: 'showdown', pendingMultiRunout: false }, config).state;
  }

  let remaining = state.deck;
  const boards: Card[][] = [];
  for (let i = 0; i < resolvedRuns; i++) {
    const result = dealBoard(state.board, remaining);
    boards.push(result.board);
    remaining = result.deck;
  }

  return runMultiBoardShowdown({ ...state, pendingMultiRunout: false }, config, boards);
}

/**
 * Build a completed Bomb Pot hand: deal hole cards, collect the forced contribution from
 * every participant (all-in if short), deal the full board(s), and resolve the showdown.
 * No betting round exists — the server reveals the board progressively then completes the hand.
 */
export function createBombPotTable(
  seated: { seatIndex: number; userId: string; displayName: string; stack: number }[],
  config: VariantConfig,
  handNumber: number,
  dealerSeatIndex: number,
  amount: number,
  doubleBoard: boolean,
  rng: () => number = Math.random
): GameTableState {
  const module = getVariantModule(config);
  const deck = shuffleDeck(createDeck(), rng);
  const seats: InternalSeat[] = seated.map((s) => ({
    ...s,
    betThisStreet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    holeCards: [],
  }));

  let remaining = deck;
  for (const seat of seats) {
    const { drawn, remaining: r } = drawCards(remaining, module.holeCardCount);
    seat.holeCards = drawn;
    remaining = r;
  }

  // Forced contribution per participant — all-in if they cannot cover the full amount.
  for (const seat of seats) {
    postBlind(seats, seat.seatIndex, Math.min(amount, seat.stack));
  }

  const flopCount = module.flopCardCount(config);
  const dealBoard = (): Card[] => {
    const cards: Card[] = [];
    let step = drawCards(remaining, 1); remaining = step.remaining; // burn
    step = drawCards(remaining, flopCount); remaining = step.remaining; cards.push(...step.drawn);
    step = drawCards(remaining, 1); remaining = step.remaining; // burn
    step = drawCards(remaining, 1); remaining = step.remaining; cards.push(...step.drawn); // turn
    step = drawCards(remaining, 1); remaining = step.remaining; // burn
    step = drawCards(remaining, 1); remaining = step.remaining; cards.push(...step.drawn); // river
    return cards;
  };

  const board = dealBoard();
  const secondBoard = doubleBoard ? dealBoard() : undefined;

  const baseState: GameTableState = {
    handNumber,
    street: 'river',
    deck: remaining,
    board,
    secondBoard,
    seats,
    pots: [],
    dealerSeatIndex,
    actionSeatIndex: null,
    currentBet: 0,
    minRaise: 0,
    lastAggressorSeat: null,
    lastWinningSeatIndices: [],
    winnerPayouts: [],
    processedActionIds: new Set(),
    bombPotActive: true,
    isBombPot: true,
    bombPotAmount: amount,
    isDoubleBoardBombPot: doubleBoard,
    pendingActionSeatIndices: [],
  };

  return (doubleBoard ? runDoubleBoardShowdown(baseState, config) : runShowdown(baseState, config)).state;
}

function awardToWinner(state: GameTableState, seatIndex: number): GameTableState {
  const total = state.seats.reduce((s, seat) => s + seat.totalBet, 0);
  const chipsBefore = state.seats.reduce((s, seat) => s + seat.stack + seat.totalBet, 0);
  const seat = getSeat(state.seats, seatIndex)!;
  seat.stack += total;
  const chipsAfter = state.seats.reduce((s, seat) => s + seat.stack, 0);
  if (chipsBefore !== chipsAfter) {
    console.error(`[chip-conservation] VIOLATION in fold win: before=${chipsBefore} after=${chipsAfter}`);
  }
  return {
    ...state,
    street: 'complete',
    actionSeatIndex: null,
    lastWinningSeatIndices: [seatIndex],
    winnerPayouts: [{ seatIndex, amount: total, handDescription: '', isContested: false }],
    pendingActionSeatIndices: [],
  };
}

export function getLegalActionsForSeat(state: GameTableState, config: VariantConfig, seatIndex: number) {
  const seat = getSeat(state.seats, seatIndex);
  if (!seat) return [];
  return computeLegalActions(seat, state.seats, state.currentBet, state.minRaise, state.street, config);
}
