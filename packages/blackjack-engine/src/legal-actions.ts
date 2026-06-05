import type { BlackjackTableState, BlackjackLegalAction } from './types.js';
import { splitRankKey } from './hand.js';

export function getLegalActions(
  state: BlackjackTableState,
  userId: string,
): BlackjackLegalAction[] {
  if (state.phase !== 'player_turn') return [];

  const playerIdx = state.players.findIndex((p) => p.userId === userId);
  if (playerIdx !== state.activePlayerIndex) return [];

  const player = state.players[playerIdx]!;
  if (player.status !== 'acting') return [];

  const hand = player.hands[player.activeHandIndex];
  if (!hand || hand.isStanding || hand.isBust) return [];

  const actions: BlackjackLegalAction[] = [
    { type: 'hit', handId: hand.id },
    { type: 'stand', handId: hand.id },
  ];

  const isFirstTwoCards = hand.cards.length === 2;

  // Double down: first two cards only, player must have enough stack to match wager
  if (isFirstTwoCards && player.stack >= hand.wager) {
    actions.push({ type: 'double_down', handId: hand.id });
  }

  // Split: first two cards, same pip rank, player has enough stack, max 3 hands total
  if (
    isFirstTwoCards &&
    player.hands.length < 3 &&
    player.stack >= hand.wager &&
    hand.cards.length === 2 &&
    splitRankKey(hand.cards[0]!) === splitRankKey(hand.cards[1]!)
  ) {
    actions.push({ type: 'split', handId: hand.id });
  }

  return actions;
}
