import type { BlackjackTableState, BlackjackPlayer, HandResult, BlackjackRules } from './types.js';
import { DEFAULT_BLACKJACK_RULES } from './types.js';
import { calculateTotal, isBust, isNaturalBlackjack } from './hand.js';

/** Profit multiplier on a natural blackjack for the configured payout ratio (3:2 → 1.5, 6:5 → 1.2). */
function blackjackBonusMultiplier(rules: BlackjackRules): number {
  return rules.blackjackPayout === '6:5' ? 1.2 : 1.5;
}

export function resolveRound(
  state: BlackjackTableState,
  rules: BlackjackRules = DEFAULT_BLACKJACK_RULES,
): BlackjackTableState {
  const { total: dealerTotal } = calculateTotal(state.dealer.cards);
  const dealerBusted = isBust(state.dealer.cards);
  const dealerHasBlackjack = isNaturalBlackjack(state.dealer.cards);
  const bonus = blackjackBonusMultiplier(rules);

  const updatedPlayers: BlackjackPlayer[] = state.players.map((player) => {
    if (player.status === 'sitting_out') return player;

    let totalPayout = 0;
    const updatedHands = player.hands.map((hand) => {
      let result: HandResult;
      let payout: number;

      if (hand.isSurrendered) {
        // Forfeit half the wager (the other half was already deducted at deal time).
        result = 'surrender';
        payout = Math.floor(hand.wager / 2);
      } else if (hand.evenMoney) {
        // Even money locks a guaranteed 1:1 win on a natural facing a dealer Ace.
        result = 'win';
        payout = hand.wager * 2;
      } else if (hand.isBust) {
        result = 'loss';
        payout = 0;
      } else if (hand.isBlackjack && dealerHasBlackjack) {
        result = 'push';
        payout = hand.wager;
      } else if (hand.isBlackjack) {
        result = 'blackjack';
        payout = hand.wager + Math.floor(hand.wager * bonus);
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

    // Insurance pays 2:1 when the dealer has a natural (returns 3× the insurance bet).
    if (player.insuranceBet > 0 && dealerHasBlackjack) {
      totalPayout += player.insuranceBet * 3;
    }

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
