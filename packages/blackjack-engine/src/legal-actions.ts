import type { BlackjackTableState, BlackjackLegalAction, BlackjackRules } from './types.js';
import { DEFAULT_BLACKJACK_RULES } from './types.js';
import { splitRankKey } from './hand.js';

export function getLegalActions(
  state: BlackjackTableState,
  userId: string,
  rules: BlackjackRules = DEFAULT_BLACKJACK_RULES,
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
  if (isFirstTwoCards && player.stack >= hand.wager && (!hand.isSplit || rules.doubleAfterSplit)) {
    actions.push({ type: 'double_down', handId: hand.id });
  }

  // Split: first two cards, same pip rank, enough stack, under the max-hands limit
  if (
    isFirstTwoCards &&
    player.hands.length < rules.maxSplitHands &&
    player.stack >= hand.wager &&
    splitRankKey(hand.cards[0]!) === splitRankKey(hand.cards[1]!)
  ) {
    actions.push({ type: 'split', handId: hand.id });
  }

  // Late surrender: only on the initial two cards of an unsplit, single hand
  if (
    rules.surrender === 'late' &&
    isFirstTwoCards &&
    player.hands.length === 1 &&
    !hand.isSplit
  ) {
    actions.push({ type: 'surrender', handId: hand.id });
  }

  return actions;
}
