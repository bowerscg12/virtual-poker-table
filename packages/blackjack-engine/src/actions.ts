import type { Card } from '@vct/shared-types';
import type { BlackjackTableState, BlackjackPlayer, BlackjackHand } from './types.js';
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

  const [card, ...remainingShoe] = state.shoe as [Card, ...Card[]];
  const newCards = [...hand.cards, card];
  const bust = isBust(newCards);

  let s = { ...state, shoe: remainingShoe };
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
): BlackjackTableState | { error: string } {
  const validated = validateTurn(state, userId, handId);
  if ('error' in validated) return validated;
  const { playerIdx, player, hand } = validated;

  if (hand.cards.length !== 2) return { error: 'Can only double on first two cards' };
  if (player.stack < hand.wager) return { error: 'Insufficient stack to double' };

  const [card, ...remainingShoe] = state.shoe as [Card, ...Card[]];
  const newCards = [...hand.cards, card];
  const bust = isBust(newCards);

  let s: BlackjackTableState = {
    ...state,
    shoe: remainingShoe,
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
): BlackjackTableState | { error: string } {
  const validated = validateTurn(state, userId, handId);
  if ('error' in validated) return validated;
  const { playerIdx, player, hand } = validated;

  if (hand.cards.length !== 2) return { error: 'Can only split on two cards' };
  if (player.hands.length >= 3) return { error: 'Maximum of 3 hands from splits' };
  if (player.stack < hand.wager) return { error: 'Insufficient stack to split' };

  const [c1, c2] = hand.cards as [Card, Card];
  if (splitRankKey(c1) !== splitRankKey(c2)) return { error: 'Cards must match to split' };

  const isAceSplit = c1[0] === 'A';

  const shoe = [...state.shoe];
  const cardForCurrent = shoe.shift()!;
  const cardForNew = shoe.shift()!;

  const updatedCurrentHand: BlackjackHand = {
    ...hand,
    cards: [c1, cardForCurrent],
    isSplit: true,
    isStanding: isAceSplit,
    isBlackjack: false,
  };

  const newHand: BlackjackHand = {
    id: newHandId,
    cards: [c2, cardForNew],
    wager: hand.wager,
    isStanding: isAceSplit,
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

  // Ace splits auto-stand both halves — skip directly to next player
  if (isAceSplit) {
    return advanceToNextHand(s, playerIdx);
  }

  return s;
}
