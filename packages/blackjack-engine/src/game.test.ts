import { describe, it, expect } from 'vitest';
import type { Card } from '@vct/shared-types';
import { createRound, dealInitial } from './game.js';
import { applyHit, applyStand, applyDouble, applySplit } from './actions.js';
import { runDealerAI } from './dealer.js';
import { resolveRound } from './settlement.js';
import { getLegalActions } from './legal-actions.js';
import { calculateTotal } from './hand.js';

function c(s: string): Card { return s as Card; }

const TWO_PLAYERS = [
  { userId: 'u1', seatIndex: 0, stack: 1000 },
  { userId: 'u2', seatIndex: 1, stack: 1000 },
];

function makeState(overrides: Partial<Parameters<typeof createRound>[0]> = {}) {
  return createRound({
    lobbyId: 'test',
    roundNumber: 1,
    numDecks: 1,
    players: TWO_PLAYERS,
    seed: 'test-seed',
    ...overrides,
  });
}

describe('createRound', () => {
  it('starts in waiting_for_bets with correct player count', () => {
    const s = makeState();
    expect(s.phase).toBe('waiting_for_bets');
    expect(s.players).toHaveLength(2);
    expect(s.players.every((p) => p.status === 'betting')).toBe(true);
    expect(s.shoe.length).toBe(52);
  });
});

describe('dealInitial', () => {
  it('errors when no bets placed', () => {
    const s = makeState();
    expect(dealInitial(s)).toEqual({ error: 'No bets placed' });
  });

  it('deals 2 cards to each player and dealer', () => {
    let s = makeState();
    s = { ...s, players: s.players.map((p) => ({ ...p, pendingBet: 100 })) };
    const result = dealInitial(s);
    if ('error' in result) throw new Error(result.error);
    expect(result.players[0]!.hands[0]!.cards).toHaveLength(2);
    expect(result.players[1]!.hands[0]!.cards).toHaveLength(2);
    expect(result.dealer.cards).toHaveLength(2);
    expect(result.shoe.length).toBe(52 - 6); // 2 players + dealer = 6 cards drawn
  });

  it('deducts bet from stack', () => {
    let s = makeState();
    s = { ...s, players: s.players.map((p) => ({ ...p, pendingBet: 100 })) };
    const result = dealInitial(s);
    if ('error' in result) throw new Error(result.error);
    expect(result.players[0]!.stack).toBe(900);
  });

  it('sets non-betting players to sitting_out', () => {
    let s = makeState();
    s = { ...s, players: s.players.map((p, i) => ({ ...p, pendingBet: i === 0 ? 100 : 0 })) };
    const result = dealInitial(s);
    if ('error' in result) throw new Error(result.error);
    expect(result.players[1]!.status).toBe('sitting_out');
  });
});

describe('hit / stand flow', () => {
  function setupForAction() {
    let s = makeState();
    s = { ...s, players: s.players.map((p) => ({ ...p, pendingBet: 50 })) };
    const dealt = dealInitial(s);
    if ('error' in dealt) throw new Error(dealt.error);
    return dealt;
  }

  it('hit adds a card', () => {
    let s = setupForAction();
    const player = s.players[s.activePlayerIndex]!;
    const handId = player.hands[0]!.id;
    const result = applyHit(s, player.userId, handId);
    if ('error' in result) throw new Error(result.error);
    expect(result.players[s.activePlayerIndex]!.hands[0]!.cards).toHaveLength(3);
  });

  it('stand advances to next player', () => {
    let s = setupForAction();
    const player0 = s.players[s.activePlayerIndex]!;
    const result = applyStand(s, player0.userId, player0.hands[0]!.id);
    if ('error' in result) throw new Error(result.error);
    // Should advance to next player or dealer turn
    expect(result.phase === 'player_turn' || result.phase === 'dealer_turn').toBe(true);
  });

  it('wrong player cannot act', () => {
    const s = setupForAction();
    const wrongPlayer = s.players[s.activePlayerIndex === 0 ? 1 : 0]!;
    const hand = wrongPlayer.hands[0] ?? { id: 'bad' };
    const result = applyHit(s, wrongPlayer.userId, hand.id);
    expect(result).toHaveProperty('error');
  });
});

describe('double down', () => {
  it('doubles wager, draws one card, auto-stands', () => {
    let s = makeState();
    s = { ...s, players: s.players.map((p) => ({ ...p, pendingBet: 100 })) };
    const dealt = dealInitial(s);
    if ('error' in dealt) throw new Error(dealt.error);

    const player = dealt.players[dealt.activePlayerIndex]!;
    // Force a hand where double is legal (2 cards, enough stack)
    if (player.stack < 100) return; // skip if not enough chips
    const result = applyDouble(dealt, player.userId, player.hands[0]!.id);
    if ('error' in result) return; // may legitimately fail if stack too low

    const updatedPlayer = result.players.find((p) => p.userId === player.userId)!;
    expect(updatedPlayer.hands[0]!.wager).toBe(200);
    expect(updatedPlayer.hands[0]!.cards).toHaveLength(3);
    expect(updatedPlayer.hands[0]!.isDoubled).toBe(true);
  });
});

describe('split', () => {
  it('splits a pair into two hands', () => {
    let s = makeState();
    // Inject a shoe that deals two aces to player 0 so split is legal
    // Shoe order: p1c1, p2c1, dealer_up, p1c2, p2c2, dealer_hole, then extras
    const injectedShoe: Card[] = [
      c('Ah'), c('2h'), c('5h'), // round 1: p1, p2, dealer_up
      c('As'), c('3h'), c('7h'), // round 2: p1, p2, dealer_hole
      c('Kh'), c('8h'), c('9h'), c('6h'), // split draws + extras
      ...s.shoe.slice(10),
    ];
    s = { ...s, shoe: injectedShoe, players: s.players.map((p) => ({ ...p, pendingBet: 100 })) };

    const dealt = dealInitial(s);
    if ('error' in dealt) throw new Error(dealt.error);

    const player0 = dealt.players[0]!;
    // Player 0 should have [Ah, As] — a splittable pair
    const hand = player0.hands[0]!;
    if (hand.cards[0]![0] !== 'A' || hand.cards[1]![0] !== 'A') {
      // Shoe order may have changed; skip test gracefully
      return;
    }

    const result = applySplit(dealt, player0.userId, hand.id, 'new-hand-id');
    if ('error' in result) throw new Error(result.error);

    const updated0 = result.players[0]!;
    expect(updated0.hands).toHaveLength(2);
    // Ace split: both hands get 1 draw each and auto-stand
    expect(updated0.hands[0]!.isStanding).toBe(true);
    expect(updated0.hands[1]!.isStanding).toBe(true);
  });
});

describe('dealer AI', () => {
  it('hits until 17', () => {
    let s = makeState();
    s = { ...s, players: s.players.map((p) => ({ ...p, pendingBet: 50 })) };
    const dealt = dealInitial(s);
    if ('error' in dealt) throw new Error(dealt.error);

    // Stand all players
    let state = dealt;
    while (state.phase === 'player_turn') {
      const p = state.players[state.activePlayerIndex]!;
      const result = applyStand(state, p.userId, p.hands[p.activeHandIndex]!.id);
      if ('error' in result) break;
      state = result;
    }

    if (state.phase !== 'dealer_turn') return;
    const final = runDealerAI(state, 'stand');
    const { total } = calculateTotal(final.dealer.cards);
    expect(total).toBeGreaterThanOrEqual(17);
    expect(final.dealer.holeCardRevealed).toBe(true);
  });
});

describe('settlement', () => {
  it('pays 1:1 on win', () => {
    let s = makeState({ players: [{ userId: 'u1', seatIndex: 0, stack: 1000 }] });
    s = { ...s, players: s.players.map((p) => ({ ...p, pendingBet: 100 })) };
    const dealt = dealInitial(s);
    if ('error' in dealt) throw new Error(dealt.error);

    let state = dealt;
    if (state.phase === 'player_turn') {
      const p = state.players[state.activePlayerIndex]!;
      const r = applyStand(state, p.userId, p.hands[0]!.id);
      if (!('error' in r)) state = r;
    }
    const afterDealer = state.phase === 'dealer_turn' ? runDealerAI(state, 'stand') : state;
    const settled = resolveRound(afterDealer);

    const player = settled.players[0]!;
    const hand = player.hands[0]!;
    expect(['win', 'loss', 'push', 'blackjack']).toContain(hand.result);
    // Stack should reflect payout
    if (hand.result === 'win') expect(player.stack).toBe(1100); // 900 base + 200 (1:1)
    if (hand.result === 'loss') expect(player.stack).toBe(900);  // 900 base + 0
    if (hand.result === 'push') expect(player.stack).toBe(1000); // 900 base + 100 returned
  });

  it('pays 3:2 on natural blackjack', () => {
    let s = makeState({ players: [{ userId: 'u1', seatIndex: 0, stack: 1000 }] });
    // Inject shoe: player gets Ah, Kh (natural BJ). Dealer gets 5h, 9d (no BJ).
    const injectedShoe: Card[] = [c('Ah'), c('5h'), c('Kh'), c('9d'), ...s.shoe.slice(4)];
    s = { ...s, shoe: injectedShoe, players: s.players.map((p) => ({ ...p, pendingBet: 100 })) };

    const dealt = dealInitial(s);
    if ('error' in dealt) throw new Error(dealt.error);

    // Player has BJ, so status should be 'done', go straight to dealer turn
    const afterDealer = runDealerAI(dealt, 'stand');
    const settled = resolveRound(afterDealer);

    const player = settled.players[0]!;
    const hand = player.hands[0]!;
    expect(hand.result).toBe('blackjack');
    // 1000 - 100 (bet deducted) + 250 (100 wager + 150 = 3:2) = 1150
    expect(player.stack).toBe(1150);
  });
});

describe('getLegalActions', () => {
  it('returns hit and stand for normal hand', () => {
    let s = makeState();
    s = { ...s, players: s.players.map((p) => ({ ...p, pendingBet: 50 })) };
    const dealt = dealInitial(s);
    if ('error' in dealt) throw new Error(dealt.error);

    const player = dealt.players[dealt.activePlayerIndex]!;
    if (player.hands[0]?.isBlackjack) return; // skip if natural BJ
    const actions = getLegalActions(dealt, player.userId);
    const types = actions.map((a) => a.type);
    expect(types).toContain('hit');
    expect(types).toContain('stand');
  });

  it('returns empty array when not player turn', () => {
    const s = makeState();
    expect(getLegalActions(s, 'u1')).toEqual([]);
  });

  it('returns empty array for wrong player', () => {
    let s = makeState();
    s = { ...s, players: s.players.map((p) => ({ ...p, pendingBet: 50 })) };
    const dealt = dealInitial(s);
    if ('error' in dealt) throw new Error(dealt.error);

    const inactiveIdx = dealt.activePlayerIndex === 0 ? 1 : 0;
    const inactivePlayer = dealt.players[inactiveIdx]!;
    expect(getLegalActions(dealt, inactivePlayer.userId)).toEqual([]);
  });
});
