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
  processedActionIds: Set<string>;
  bombPotActive: boolean;
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

  const bombPot =
    config.bombPot && handNumber > 0 && handNumber % config.bombPot.everyNHands === 0;

  let remaining = deck;
  for (const seat of seats) {
    const { drawn, remaining: r } = drawCards(remaining, module.holeCardCount);
    seat.holeCards = drawn;
    remaining = r;
  }

  const activeIndices = seats.map((s) => s.seatIndex);
  const sbSeat = nextActiveSeat(activeIndices, dealerSeatIndex + 1, () => true)!;
  const bbSeat = nextActiveSeat(activeIndices, sbSeat + 1, () => true)!;

  const sb = config.blinds.small;
  const bb = config.blinds.big;
  postBlind(seats, sbSeat, sb);
  postBlind(seats, bbSeat, bb);

  let lastAggressorSeat = bbSeat;
  let actionSeatStart = bbSeat + 1;
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

  if (bombPot && config.bombPot) {
    const ante = config.blinds.big * config.bombPot.multiplier;
    for (const seat of seats) {
      postBlind(seats, seat.seatIndex, Math.min(ante, seat.stack));
    }
  }

  const currentBet = Math.max(...seats.map((s) => s.betThisStreet));
  const actionSeat = nextActiveSeat(
    activeIndices,
    actionSeatStart,
    (idx) => !getSeat(seats, idx)!.folded && !getSeat(seats, idx)!.allIn
  );

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
    processedActionIds: new Set(),
    bombPotActive: !!bombPot,
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

  return advanceAfterAction(newState, config);
}

function advanceAfterAction(
  state: GameTableState,
  config: VariantConfig
): { ok: true; state: GameTableState } | { ok: false; error: string } {
  const active = state.seats.filter((s) => !s.folded && (s.stack > 0 || s.betThisStreet > 0));
  if (active.length === 1) {
    return { ok: true, state: awardToWinner(state, active[0].seatIndex) };
  }

  const canAct = (s: InternalSeat) => !s.folded && !s.allIn && s.stack > 0;
  const needAction = state.seats.filter(
    (s) => !s.folded && !s.allIn && s.betThisStreet < state.currentBet
  );

  if (needAction.length > 0) {
    const next = nextActiveSeat(
      state.seats.map((s) => s.seatIndex),
      state.actionSeatIndex! + 1,
      (idx) => {
        const seat = getSeat(state.seats, idx);
        return !!seat && canAct(seat) && seat.betThisStreet < state.currentBet;
      }
    );
    return { ok: true, state: { ...state, actionSeatIndex: next } };
  }

  const matched = state.seats
    .filter((s) => !s.folded && !s.allIn)
    .every((s) => s.betThisStreet === state.currentBet || s.stack === 0);

  if (!matched) {
    const next = nextActiveSeat(
      state.seats.map((s) => s.seatIndex),
      state.actionSeatIndex! + 1,
      (idx) => !!getSeat(state.seats, idx) && canAct(getSeat(state.seats, idx)!)
    );
    return { ok: true, state: { ...state, actionSeatIndex: next } };
  }

  return advanceStreet(state, config);
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

  const firstToAct = nextActiveSeat(
    state.seats.map((s) => s.seatIndex),
    state.dealerSeatIndex + 1,
    (idx) => {
      const s = getSeat(state.seats, idx);
      return !!s && !s.folded && !s.allIn;
    }
  );

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
    },
  };
}

function runShowdown(state: GameTableState, config: VariantConfig): { ok: true; state: GameTableState } {
  const module = getVariantModule(config);
  const contributions = state.seats.map((s) => ({ seatIndex: s.seatIndex, amount: s.totalBet }));
  const pots = buildSidePots(contributions);

  for (const seat of state.seats) {
    if (!seat.folded) seat.shownCards = [...seat.holeCards];
  }

  const winners: { seatIndex: number; amount: number; hand: EvaluatedHand }[] = [];

  for (const pot of pots) {
    const eligible = state.seats.filter(
      (s) => pot.eligibleSeatIndices.includes(s.seatIndex) && !s.folded
    );
    if (eligible.length === 0) continue;

    let best: EvaluatedHand | null = null;
    const bestSeats: number[] = [];

    for (const s of eligible) {
      const hand = module.evaluateHand(s.holeCards, state.board);
      if (!best || compareHands(hand, best) > 0) {
        best = hand;
        bestSeats.length = 0;
        bestSeats.push(s.seatIndex);
      } else if (best && compareHands(hand, best) === 0) {
        bestSeats.push(s.seatIndex);
      }
    }

    const share = Math.floor(pot.amount / bestSeats.length);
    for (const idx of bestSeats) {
      const seat = getSeat(state.seats, idx)!;
      seat.stack += share;
      winners.push({ seatIndex: idx, amount: share, hand: best! });
    }
  }

  return {
    ok: true,
    state: {
      ...state,
      street: 'complete',
      pots,
      actionSeatIndex: null,
      lastWinningSeatIndices: Array.from(new Set(winners.map((w) => w.seatIndex))),
    },
  };
}

function awardToWinner(state: GameTableState, seatIndex: number): GameTableState {
  const total = state.seats.reduce((s, seat) => s + seat.totalBet, 0);
  const seat = getSeat(state.seats, seatIndex)!;
  seat.stack += total;
  return { ...state, street: 'complete', actionSeatIndex: null, lastWinningSeatIndices: [seatIndex] };
}

export function getLegalActionsForSeat(state: GameTableState, config: VariantConfig, seatIndex: number) {
  const seat = getSeat(state.seats, seatIndex);
  if (!seat) return [];
  return computeLegalActions(seat, state.seats, state.currentBet, state.minRaise, state.street, config);
}
