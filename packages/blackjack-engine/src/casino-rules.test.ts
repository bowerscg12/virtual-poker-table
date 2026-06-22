import { describe, it, expect } from 'vitest';
import type { Card } from '@vct/shared-types';
import { createRound, dealInitial, resolveInsurance } from './game.js';
import { applyHit, applyStand, applySurrender, applyInsurance, applyEvenMoney } from './actions.js';
import { runDealerAI } from './dealer.js';
import { resolveRound } from './settlement.js';
import { getLegalActions } from './legal-actions.js';
import { dealerShouldHit } from './dealer.js';
import { DEFAULT_BLACKJACK_RULES, type BlackjackRules, type BlackjackHand, type BlackjackTableState } from './types.js';

function c(s: string): Card { return s as Card; }

const RULES: BlackjackRules = { ...DEFAULT_BLACKJACK_RULES };

/** One-player round seeded then overwritten with a fixed shoe; bet placed for the player. */
function onePlayerWithShoe(shoe: Card[], bet = 100): BlackjackTableState {
  const s = createRound({ lobbyId: 't', roundNumber: 1, numDecks: 1, players: [{ userId: 'u1', seatIndex: 0, stack: 1000 }], seed: 'seed' });
  return { ...s, shoe: [...shoe, ...s.shoe], players: s.players.map((p) => ({ ...p, pendingBet: bet })) };
}

function play(state: BlackjackTableState, rules: BlackjackRules): BlackjackTableState {
  let st = state;
  while (st.phase === 'player_turn') {
    const p = st.players[st.activePlayerIndex]!;
    const r = applyStand(st, p.userId, p.hands[p.activeHandIndex]!.id);
    if ('error' in r) break;
    st = r;
  }
  if (st.phase === 'dealer_turn') st = runDealerAI(st, rules.dealerHitsSoft17 ? 'hit' : 'stand');
  return resolveRound(st, rules);
}

describe('insurance', () => {
  it('pays 2:1 when the dealer has a natural (offsetting the main-bet loss)', () => {
    // Deal order (1 player): p1c1, dealerUp, p1c2, dealerHole
    const dealt = dealInitial(onePlayerWithShoe([c('9h'), c('Ah'), c('9d'), c('Kh')]), RULES);
    if ('error' in dealt) throw new Error(dealt.error);
    expect(dealt.phase).toBe('insurance');

    const ins = applyInsurance(dealt, 'u1', 50);
    if ('error' in ins) throw new Error(ins.error);
    expect(ins.players[0]!.insuranceBet).toBe(50);

    const resolved = resolveInsurance(ins);
    expect(resolved.phase).toBe('dealer_turn'); // dealer natural ends the round

    const settled = resolveRound(resolved, RULES);
    const player = settled.players[0]!;
    expect(player.hands[0]!.result).toBe('loss');
    // 1000 - 100 (bet) - 50 (insurance) + 150 (2:1 + stake) = 1000
    expect(player.stack).toBe(1000);
  });

  it('loses the insurance bet when the dealer has no natural', () => {
    const dealt = dealInitial(onePlayerWithShoe([c('9h'), c('Ah'), c('9d'), c('5h')]), RULES);
    if ('error' in dealt) throw new Error(dealt.error);
    const ins = applyInsurance(dealt, 'u1', 50);
    if ('error' in ins) throw new Error(ins.error);
    const resolved = resolveInsurance(ins);
    expect(resolved.phase).toBe('player_turn'); // play continues
    const settled = play(resolved, RULES);
    // Insurance (50) was deducted and never returned.
    const player = settled.players[0]!;
    expect(player.insuranceBet).toBe(50);
    // Stack never exceeds 950 (1000 - 100 bet - 50 insurance + at most 200 on a main-bet win).
    expect(player.stack).toBeLessThanOrEqual(1050);
  });
});

describe('even money', () => {
  it('locks a 1:1 win on a natural facing a dealer Ace', () => {
    const dealt = dealInitial(onePlayerWithShoe([c('Ah'), c('Ad'), c('Kh'), c('5h')]), RULES);
    if ('error' in dealt) throw new Error(dealt.error);
    expect(dealt.phase).toBe('insurance');
    expect(dealt.players[0]!.hands[0]!.isBlackjack).toBe(true);

    const em = applyEvenMoney(dealt, 'u1');
    if ('error' in em) throw new Error(em.error);
    const resolved = resolveInsurance(em);
    const settled = resolveRound(resolved, RULES);
    const player = settled.players[0]!;
    expect(player.hands[0]!.result).toBe('win');
    // 1000 - 100 + 200 (1:1) = 1100, regardless of the dealer's hole card.
    expect(player.stack).toBe(1100);
  });
});

describe('surrender', () => {
  it('returns half the wager and ends the hand', () => {
    // Dealer up = 10 (no insurance window); player hard 16.
    const dealt = dealInitial(onePlayerWithShoe([c('Th'), c('Td'), c('6h'), c('7h')]), RULES);
    if ('error' in dealt) throw new Error(dealt.error);
    expect(dealt.phase).toBe('player_turn');

    const handId = dealt.players[0]!.hands[0]!.id;
    const surr = applySurrender(dealt, 'u1', handId, RULES);
    if ('error' in surr) throw new Error(surr.error);
    expect(surr.players[0]!.hands[0]!.isSurrendered).toBe(true);

    const afterDealer = surr.phase === 'dealer_turn' ? runDealerAI(surr, 'stand') : surr;
    const settled = resolveRound(afterDealer, RULES);
    const player = settled.players[0]!;
    expect(player.hands[0]!.result).toBe('surrender');
    // 1000 - 100 + 50 = 950
    expect(player.stack).toBe(950);
  });

  it('is illegal after a hit', () => {
    const dealt = dealInitial(onePlayerWithShoe([c('5h'), c('Td'), c('4h'), c('7h'), c('2h')]), RULES);
    if ('error' in dealt) throw new Error(dealt.error);
    const handId = dealt.players[0]!.hands[0]!.id;
    const afterHit = applyHit(dealt, 'u1', handId);
    if ('error' in afterHit) throw new Error(afterHit.error);
    const surr = applySurrender(afterHit, 'u1', handId, RULES);
    expect(surr).toHaveProperty('error');
  });
});

describe('configurable payout', () => {
  it('pays 6:5 on a natural when configured', () => {
    const rules: BlackjackRules = { ...RULES, insurance: false, blackjackPayout: '6:5' };
    // Player natural A,K; dealer up 9 (no insurance), no dealer BJ.
    const dealt = dealInitial(onePlayerWithShoe([c('Ah'), c('9h'), c('Kh'), c('5h')]), rules);
    if ('error' in dealt) throw new Error(dealt.error);
    const afterDealer = dealt.phase === 'dealer_turn' ? runDealerAI(dealt, 'stand') : dealt;
    const settled = resolveRound(afterDealer, rules);
    const player = settled.players[0]!;
    expect(player.hands[0]!.result).toBe('blackjack');
    // 1000 - 100 + (100 + floor(100*1.2)=120) = 1120
    expect(player.stack).toBe(1120);
  });
});

describe('legal actions — house rules', () => {
  function turnState(hand: BlackjackHand, handsLen = 1): BlackjackTableState {
    const hands = Array.from({ length: handsLen }, (_, i) => (i === 0 ? hand : { ...hand, id: `h${i}` }));
    return {
      lobbyId: 't', roundNumber: 1, phase: 'player_turn', shoe: [c('2h'), c('3h')], cutCardPosition: 39,
      players: [{ userId: 'u1', seatIndex: 0, stack: 1000, pendingBet: 0, hands, activeHandIndex: 0, status: 'acting', insuranceBet: 0 }],
      dealer: { cards: [c('6h'), c('5h')], holeCardRevealed: false },
      activePlayerIndex: 0, seed: 'x',
    };
  }
  const splitHand: BlackjackHand = {
    id: 'h0', cards: [c('5h'), c('5d')], wager: 100, isStanding: false, isBust: false,
    isBlackjack: false, isDoubled: false, isSplit: true,
  };

  it('omits double after split when DAS is off', () => {
    const noDas: BlackjackRules = { ...RULES, doubleAfterSplit: false };
    const types = getLegalActions(turnState(splitHand), 'u1', noDas).map((a) => a.type);
    expect(types).not.toContain('double_down');
  });

  it('allows double after split when DAS is on', () => {
    const types = getLegalActions(turnState(splitHand), 'u1', { ...RULES, doubleAfterSplit: true }).map((a) => a.type);
    expect(types).toContain('double_down');
  });

  it('omits split once max-split-hands is reached', () => {
    const pair: BlackjackHand = { ...splitHand, isSplit: false, cards: [c('8h'), c('8d')] };
    const types = getLegalActions(turnState(pair, 4), 'u1', { ...RULES, maxSplitHands: 4 }).map((a) => a.type);
    expect(types).not.toContain('split');
  });
});

describe('dealer soft 17', () => {
  it('hits soft 17 under h17 and stands under s17', () => {
    expect(dealerShouldHit(17, true, 'hit')).toBe(true);
    expect(dealerShouldHit(17, true, 'stand')).toBe(false);
    expect(dealerShouldHit(17, false, 'hit')).toBe(false); // hard 17 always stands
  });
});

describe('shoe exhaustion', () => {
  it('returns an error instead of throwing when hitting an empty shoe', () => {
    const hand: BlackjackHand = {
      id: 'h0', cards: [c('5h'), c('6d')], wager: 100, isStanding: false, isBust: false,
      isBlackjack: false, isDoubled: false, isSplit: false,
    };
    const state: BlackjackTableState = {
      lobbyId: 't', roundNumber: 1, phase: 'player_turn', shoe: [], cutCardPosition: 39,
      players: [{ userId: 'u1', seatIndex: 0, stack: 1000, pendingBet: 0, hands: [hand], activeHandIndex: 0, status: 'acting', insuranceBet: 0 }],
      dealer: { cards: [c('6h'), c('5h')], holeCardRevealed: false },
      activePlayerIndex: 0, seed: 'x',
    };
    expect(applyHit(state, 'u1', 'h0')).toEqual({ error: 'Shoe is empty' });
  });
});
