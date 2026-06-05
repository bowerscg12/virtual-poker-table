import type { BlackjackTableState, BlackjackPlayer, HandResult } from './types.js';
import { calculateTotal, isBust } from './hand.js';

export function resolveRound(state: BlackjackTableState): BlackjackTableState {
  const { total: dealerTotal } = calculateTotal(state.dealer.cards);
  const dealerBusted = isBust(state.dealer.cards);
  const dealerHasBlackjack = state.dealer.cards.length === 2 && dealerTotal === 21;

  const updatedPlayers: BlackjackPlayer[] = state.players.map((player) => {
    if (player.status === 'sitting_out') return player;

    let totalPayout = 0;
    const updatedHands = player.hands.map((hand) => {
      let result: HandResult;
      let payout: number;

      if (hand.isBust) {
        result = 'loss';
        payout = 0;
      } else if (hand.isBlackjack && dealerHasBlackjack) {
        // Both have natural blackjack → push
        result = 'push';
        payout = hand.wager;
      } else if (hand.isBlackjack) {
        // Natural blackjack pays 3:2
        result = 'blackjack';
        payout = hand.wager + Math.floor(hand.wager * 1.5);
      } else if (dealerHasBlackjack) {
        result = 'loss';
        payout = 0;
      } else if (dealerBusted) {
        result = 'win';
        payout = hand.wager * 2;
      } else {
        const { total: handTotal } = calculateTotal(hand.cards);
        if (handTotal > dealerTotal) {
          result = 'win';
          payout = hand.wager * 2;
        } else if (handTotal === dealerTotal) {
          result = 'push';
          payout = hand.wager;
        } else {
          result = 'loss';
          payout = 0;
        }
      }

      totalPayout += payout;
      return { ...hand, result, payout };
    });

    return {
      ...player,
      stack: player.stack + totalPayout,
      hands: updatedHands,
      status: 'done' as const,
    };
  });

  return {
    ...state,
    players: updatedPlayers,
    phase: 'settlement',
  };
}
