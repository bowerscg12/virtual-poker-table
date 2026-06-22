import type { Card } from '@vct/shared-types';
import type { BlackjackTableState, BlackjackPlayer, BlackjackHand, BlackjackRules } from './types.js';
import { DEFAULT_BLACKJACK_RULES } from './types.js';
import { isBust, splitRankKey } from './hand.js';

function updatePlayer(
  state: BlackjackTableState,
  playerIdx: number,
  patch: Partial<BlackjackPlayer>,
): BlackjackTableState {
  return {
    ...state,
    players: state.players.map((p, i) => (i === playerIdx ? { ...p, ...patch } : p)),
  };
}

function updateActiveHand(
  state: BlackjackTableState,
  playerIdx: number,
  patch: Partial<BlackjackHand>,
): BlackjackTableState {
  const player = state.players[playerIdx]!;
  const hands = player.hands.map((h, i) =>
    i === player.activeHandIndex ? { ...h, ...patch } : h,
  );
  return updatePlayer(state, playerIdx, { hands });
}

function validateTurn(
  state: BlackjackTableState,
  userId: string,
  handId: string,
): { playerIdx: number; player: BlackjackPlayer; hand: BlackjackHand } | { error: string } {
  if (state.phase !== 'player_turn') return { error: 'Not in player turn phase' };
  const playerIdx = state.players.findIndex((p) => p.userId === userId);
  if (playerIdx === -1) return { error: 'Player not found' };
  if (playerIdx !== state.activePlayerIndex) return { error: 'Not your turn' };
  const player = state.players[playerIdx]!;
  if (player.status !== 'acting') return { error: 'Not your turn' };
  const hand = player.hands[player.activeHandIndex];
  if (!hand) return { error: 'No active hand' };
  if (hand.id !== handId) return { error: 'Wrong hand' };
  if (hand.isStanding || hand.isBust) return { error: 'Hand already resolved' };
  return { playerIdx, player, hand };
}

/** Draw the top card of the shoe, returning a typed error if the shoe is exhausted. */
function drawTop(shoe: Card[]): { card: Card; rest: Card[] } | { error: string } {
  if (shoe.length === 0) return { error: 'Shoe is empty' };
  const [card, ...rest] = shoe as [Card, ...Card[]];
  return { card, rest };
}

/**
 * Advance past the current hand: try next hand for same player,
 * then next player, then transition to dealer_turn.
 */
export function advanceToNextHand(
  state: BlackjackTableState,
  playerIdx: number,
): BlackjackTableState {
  const player = state.players[playerIdx]!;
  const nextHandIdx = player.activeHandIndex + 1;

  // More hands remain for this player
  if (nextHandIdx < player.hands.length) {
    const nextHand = player.hands[nextHandIdx]!;
    // Skip already-resolved hands (e.g. ace-split auto-stands)
    if (!nextHand.isStanding && !nextHand.isBust) {
      return updatePlayer(state, playerIdx, {
        activeHandIndex: nextHandIdx,
        status: 'acting',
      });
    }
    // All remaining hands are resolved — fall through to next player
  }

  // Mark this player done
  let s = updatePlayer(state, playerIdx, { status: 'done' });

  // Find the next player who still needs to act
  for (let i = playerIdx + 1; i < s.players.length; i++) {
    const p = s.players[i]!;
    if (p.status === 'waiting') {
      return { ...s, activePlayerIndex: i, players: s.players.map((pl, idx) =>
        idx === i ? { ...pl, status: 'acting' } : pl,
      )};
    }
  }

  // No more players — start dealer turn
  return {
    ...s,
    phase: 'dealer_turn',
    activePlayerIndex: -1,
    dealer: { ...s.dealer, holeCardRevealed: true },
  };
}

export function applyHit(
  state: BlackjackTableState,
  userId: string,
  handId: string,
): BlackjackTableState | { error: string } {
  const validated = validateTurn(state, userId, handId);
  if ('error' in validated) return validated;
  const { playerIdx, hand } = validated;

  const draw = drawTop(state.shoe);
  if ('error' in draw) return draw;
  const newCards = [...hand.cards, draw.card];
  const bust = isBust(newCards);

  let s = { ...state, shoe: draw.rest };
  s = updateActiveHand(s, playerIdx, { cards: newCards, isBust: bust });

  if (bust) {
    return advanceToNextHand(s, playerIdx);
  }
  return s;
}

export function applyStand(
  state: BlackjackTableState,
  userId: string,
  handId: string,
): BlackjackTableState | { error: string } {
  const validated = validateTurn(state, userId, handId);
  if ('error' in validated) return validated;
  const { playerIdx } = validated;

  const s = updateActiveHand(state, playerIdx, { isStanding: true });
  return advanceToNextHand(s, playerIdx);
}

export function applyDouble(
  state: BlackjackTableState,
  userId: string,
  handId: string,
  rules: BlackjackRules = DEFAULT_BLACKJACK_RULES,
): BlackjackTableState | { error: string } {
  const validated = validateTurn(state, userId, handId);
  if ('error' in validated) return validated;
  const { playerIdx, player, hand } = validated;

  if (hand.cards.length !== 2) return { error: 'Can only double on first two cards' };
  if (hand.isSplit && !rules.doubleAfterSplit) return { error: 'Double after split not allowed' };
  if (player.stack < hand.wager) return { error: 'Insufficient stack to double' };

  const draw = drawTop(state.shoe);
  if ('error' in draw) return draw;
  const newCards = [...hand.cards, draw.card];
  const bust = isBust(newCards);

  let s: BlackjackTableState = {
    ...state,
    shoe: draw.rest,
    players: state.players.map((p, i) =>
      i === playerIdx ? { ...p, stack: p.stack - hand.wager } : p,
    ),
  };
  s = updateActiveHand(s, playerIdx, {
    cards: newCards,
    wager: hand.wager * 2,
    isDoubled: true,
    isBust: bust,
    isStanding: !bust,
  });

  return advanceToNextHand(s, playerIdx);
}

export function applySplit(
  state: BlackjackTableState,
  userId: string,
  handId: string,
  newHandId: string,
  rules: BlackjackRules = DEFAULT_BLACKJACK_RULES,
): BlackjackTableState | { error: string } {
  const validated = validateTurn(state, userId, handId);
  if ('error' in validated) return validated;
  const { playerIdx, player, hand } = validated;

  if (hand.cards.length !== 2) return { error: 'Can only split on two cards' };
  if (player.hands.length >= rules.maxSplitHands) {
    return { error: `Maximum of ${rules.maxSplitHands} hands from splits` };
  }
  if (player.stack < hand.wager) return { error: 'Insufficient stack to split' };

  const [c1, c2] = hand.cards as [Card, Card];
  if (splitRankKey(c1) !== splitRankKey(c2)) return { error: 'Cards must match to split' };

  const isAceSplit = c1[0] === 'A';
  // Split aces normally take one card each and auto-stand, unless re-split aces is enabled.
  const aceAutoStand = isAceSplit && !rules.resplitAces;

  const draw1 = drawTop(state.shoe);
  if ('error' in draw1) return draw1;
  const draw2 = drawTop(draw1.rest);
  if ('error' in draw2) return draw2;
  const shoe = draw2.rest;
  const cardForCurrent = draw1.card;
  const cardForNew = draw2.card;

  const updatedCurrentHand: BlackjackHand = {
    ...hand,
    cards: [c1, cardForCurrent],
    isSplit: true,
    isStanding: aceAutoStand,
    isBlackjack: false,
  };

  const newHand: BlackjackHand = {
    id: newHandId,
    cards: [c2, cardForNew],
    wager: hand.wager,
    isStanding: aceAutoStand,
    isBust: false,
    isBlackjack: false,
    isDoubled: false,
    isSplit: true,
  };

  const idx = player.activeHandIndex;
  const newHands: BlackjackHand[] = [
    ...player.hands.slice(0, idx),
    updatedCurrentHand,
    newHand,
    ...player.hands.slice(idx + 1),
  ];

  let s: BlackjackTableState = {
    ...state,
    shoe,
    players: state.players.map((p, i) =>
      i === playerIdx ? { ...p, stack: p.stack - hand.wager, hands: newHands } : p,
    ),
  };

  // Split aces that auto-stand skip directly to the next hand/player.
  if (aceAutoStand) {
    return advanceToNextHand(s, playerIdx);
  }

  return s;
}

/**
 * Late surrender: forfeit half the wager and end the hand. Legal only on the initial two cards
 * of an unsplit hand (enforced in legal-actions and re-checked here).
 */
export function applySurrender(
  state: BlackjackTableState,
  userId: string,
  handId: string,
  rules: BlackjackRules = DEFAULT_BLACKJACK_RULES,
): BlackjackTableState | { error: string } {
  if (rules.surrender !== 'late') return { error: 'Surrender not allowed' };
  const validated = validateTurn(state, userId, handId);
  if ('error' in validated) return validated;
  const { playerIdx, player, hand } = validated;

  if (player.hands.length !== 1 || hand.isSplit) return { error: 'Cannot surrender after splitting' };
  if (hand.cards.length !== 2) return { error: 'Can only surrender on the first two cards' };

  const s = updateActiveHand(state, playerIdx, { isStanding: true, isSurrendered: true });
  return advanceToNextHand(s, playerIdx);
}

// ── Insurance window actions ────────────────────────────────────────────────────

/**
 * Place (or decline) an insurance side bet during the insurance window.
 * `amount` is capped at half the player's main wager; pass 0 to decline.
 */
export function applyInsurance(
  state: BlackjackTableState,
  userId: string,
  amount: number,
): BlackjackTableState | { error: string } {
  if (state.phase !== 'insurance') return { error: 'Insurance window is closed' };
  const playerIdx = state.players.findIndex((p) => p.userId === userId);
  if (playerIdx === -1) return { error: 'Player not found' };
  const player = state.players[playerIdx]!;
  if (player.status !== 'waiting') return { error: 'Not eligible for insurance' };
  if (player.insuranceActed) return { error: 'Insurance already decided' };

  const mainWager = player.hands[0]?.wager ?? 0;
  const maxInsurance = Math.floor(mainWager / 2);
  const bet = Math.max(0, Math.min(Math.floor(amount), maxInsurance));
  if (bet > player.stack) return { error: 'Insufficient chips for insurance' };

  return updatePlayer(state, playerIdx, {
    stack: player.stack - bet,
    insuranceBet: bet,
    insuranceActed: true,
  });
}

/**
 * Take even money: a player holding a natural facing a dealer Ace locks in a 1:1 payout.
 * Mechanically equivalent to a full insurance bet, but settled directly on the hand.
 */
export function applyEvenMoney(
  state: BlackjackTableState,
  userId: string,
): BlackjackTableState | { error: string } {
  if (state.phase !== 'insurance') return { error: 'Insurance window is closed' };
  const playerIdx = state.players.findIndex((p) => p.userId === userId);
  if (playerIdx === -1) return { error: 'Player not found' };
  const player = state.players[playerIdx]!;
  if (player.status !== 'waiting') return { error: 'Not eligible for even money' };
  if (!player.hands[0]?.isBlackjack) return { error: 'Even money requires a natural blackjack' };

  const hands = player.hands.map((h, i) => (i === 0 ? { ...h, evenMoney: true } : h));
  return updatePlayer(state, playerIdx, { hands, insuranceActed: true });
}

/** True once every insurance-eligible player has made a decision (used to close the window early). */
export function allInsuranceDecided(state: BlackjackTableState): boolean {
  return state.players.every((p) => p.status !== 'waiting' || p.insuranceActed === true);
}
