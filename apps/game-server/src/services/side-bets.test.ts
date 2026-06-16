import { describe, it, expect, beforeEach } from 'vitest';
import type { Card } from '@vct/shared-types';
import type { GameTableState } from '@vct/poker-engine';
import {
  blackjackValue,
  evaluateSideBet,
  createChallenge,
  acceptChallenge,
  bindToHand,
  getSettlementsForHand,
  markSettled,
  userHasOpenBet,
  getActiveBetUserIdsForViewer,
  clearLobbySideBets,
} from './side-bets.js';

// ── Pure evaluator ────────────────────────────────────────────────────────────

describe('blackjackValue', () => {
  it('scores aces 11, faces/ten 10, pips face value', () => {
    expect(blackjackValue('As' as Card)).toBe(11);
    expect(blackjackValue('Kd' as Card)).toBe(10);
    expect(blackjackValue('Qh' as Card)).toBe(10);
    expect(blackjackValue('Jc' as Card)).toBe(10);
    expect(blackjackValue('Ts' as Card)).toBe(10);
    expect(blackjackValue('9h' as Card)).toBe(9);
    expect(blackjackValue('2c' as Card)).toBe(2);
  });
});

describe('evaluateSideBet — highest_suit', () => {
  it('A♠ beats K♠ (spec example)', () => {
    const r = evaluateSideBet('highest_suit', 's', ['As', '5d'] as Card[], ['Ks', 'Qh'] as Card[]);
    expect(r.winner).toBe('challenger');
    expect(r.challengerValue).toContain('A');
  });
  it('a player with none of the suit loses', () => {
    const r = evaluateSideBet('highest_suit', 's', ['As', '5d'] as Card[], ['Kh', 'Qh'] as Card[]);
    expect(r.winner).toBe('challenger');
    expect(r.targetValue).toBe('—');
  });
  it('neither holding the suit is a push', () => {
    const r = evaluateSideBet('highest_suit', 's', ['Ah', '5d'] as Card[], ['Kh', 'Qd'] as Card[]);
    expect(r.winner).toBe('push');
  });
  it('equal highest of suit is a push', () => {
    const r = evaluateSideBet('highest_suit', 'h', ['Ah', '2c'] as Card[], ['Ah', '3c'] as Card[]);
    expect(r.winner).toBe('push');
  });
});

describe('evaluateSideBet — lowest_suit', () => {
  it('2♣ beats 4♣ (spec example)', () => {
    const r = evaluateSideBet('lowest_suit', 'c', ['2c', '9h'] as Card[], ['4c', 'As'] as Card[]);
    expect(r.winner).toBe('challenger');
  });
  it('a player with none of the suit loses (worst = infinity)', () => {
    const r = evaluateSideBet('lowest_suit', 'c', ['2c', '9h'] as Card[], ['4d', 'As'] as Card[]);
    expect(r.winner).toBe('challenger');
    expect(r.targetValue).toBe('—');
  });
});

describe('evaluateSideBet — sums', () => {
  it('highest_sum: A♠K♦ (21) beats 8♣7♥ (15)', () => {
    const r = evaluateSideBet('highest_sum', undefined, ['As', 'Kd'] as Card[], ['8c', '7h'] as Card[]);
    expect(r.winner).toBe('challenger');
    expect(r.challengerValue).toBe('21');
    expect(r.targetValue).toBe('15');
  });
  it('lowest_sum: 2♣3♥ (5) beats 6♠8♦ (14)', () => {
    const r = evaluateSideBet('lowest_sum', undefined, ['2c', '3h'] as Card[], ['6s', '8d'] as Card[]);
    expect(r.winner).toBe('challenger');
    expect(r.challengerValue).toBe('5');
  });
  it('A♠K♦ vs A♥K♣ both 21 → push', () => {
    const r = evaluateSideBet('highest_sum', undefined, ['As', 'Kd'] as Card[], ['Ah', 'Kc'] as Card[]);
    expect(r.winner).toBe('push');
  });
});

// ── Lifecycle + settlement ────────────────────────────────────────────────────

function seat(userId: string, seatIndex: number, holeCards: Card[], stack: number) {
  return { userId, seatIndex, holeCards, stack } as unknown as GameTableState['seats'][number];
}

function fakeState(handNumber: number, seats: GameTableState['seats']): GameTableState {
  return { handNumber, seats } as unknown as GameTableState;
}

describe('side bet lifecycle', () => {
  const lobbyId = 'lobby-sb-test';
  beforeEach(() => clearLobbySideBets(lobbyId));

  function makeAcceptedBet(type: Parameters<typeof createChallenge>[1]['type'], suit?: 's' | 'h' | 'd' | 'c') {
    const created = createChallenge(lobbyId, {
      id: 'bet1',
      challengerUserId: 'A',
      challengerName: 'Alice',
      targetUserId: 'B',
      targetName: 'Bob',
      type,
      suit,
      wager: 100,
    });
    expect(created.ok).toBe(true);
    const accepted = acceptChallenge(lobbyId, 'bet1', 'B');
    expect(accepted.ok).toBe(true);
  }

  it('enforces one open bet per player', () => {
    makeAcceptedBet('highest_sum');
    const dup = createChallenge(lobbyId, {
      id: 'bet2',
      challengerUserId: 'C',
      challengerName: 'Carol',
      targetUserId: 'B', // Bob already in a bet
      targetName: 'Bob',
      type: 'highest_sum',
      wager: 50,
    });
    expect(dup.ok).toBe(false);
  });

  it('only the target can accept', () => {
    createChallenge(lobbyId, {
      id: 'bet1',
      challengerUserId: 'A',
      challengerName: 'Alice',
      targetUserId: 'B',
      targetName: 'Bob',
      type: 'highest_sum',
      wager: 100,
    });
    expect(acceptChallenge(lobbyId, 'bet1', 'A').ok).toBe(false);
    expect(acceptChallenge(lobbyId, 'bet1', 'B').ok).toBe(true);
  });

  it('binds to a hand and stores a hidden result; settles with clamped payout', () => {
    makeAcceptedBet('highest_sum');
    const state = fakeState(7, [
      seat('A', 0, ['As', 'Kd'] as Card[], 1000), // 21
      seat('B', 1, ['8c', '7h'] as Card[], 1000), // 15
    ]);
    const bound = bindToHand(lobbyId, state);
    expect(bound.activated).toHaveLength(1);
    expect(bound.expired).toHaveLength(0);

    const settlements = getSettlementsForHand(lobbyId, 7);
    expect(settlements).toHaveLength(1);
    expect(settlements[0].result.winnerUserId).toBe('A');
    expect(settlements[0].result.push).toBe(false);

    // Loser B busted to 40 chips → payout clamped to 40
    const finalized = markSettled(lobbyId, 'bet1', Math.min(100, 40));
    expect(finalized?.payout).toBe(40);

    // Idempotent — already settled
    expect(markSettled(lobbyId, 'bet1', 40)).toBeNull();
  });

  it('expires when a participant is not dealt in', () => {
    makeAcceptedBet('highest_sum');
    const state = fakeState(8, [
      seat('A', 0, ['As', 'Kd'] as Card[], 1000),
      // B is not in this hand
    ]);
    const bound = bindToHand(lobbyId, state);
    expect(bound.activated).toHaveLength(0);
    expect(bound.expired).toHaveLength(1);
    expect(getSettlementsForHand(lobbyId, 8)).toHaveLength(0);
  });

  it('indicator is participant-scoped unless table-wide', () => {
    makeAcceptedBet('highest_sum');
    bindToHand(
      lobbyId,
      fakeState(9, [
        seat('A', 0, ['As', 'Kd'] as Card[], 1000),
        seat('B', 1, ['8c', '7h'] as Card[], 1000),
      ]),
    );
    expect(getActiveBetUserIdsForViewer(lobbyId, 'A', 'participants').size).toBe(2);
    expect(getActiveBetUserIdsForViewer(lobbyId, 'C', 'participants').size).toBe(0);
    expect(getActiveBetUserIdsForViewer(lobbyId, 'C', 'table').size).toBe(2);
  });

  it('userHasOpenBet reflects active membership', () => {
    expect(userHasOpenBet(lobbyId, 'A')).toBe(false);
    makeAcceptedBet('highest_sum');
    expect(userHasOpenBet(lobbyId, 'A')).toBe(true);
    expect(userHasOpenBet(lobbyId, 'B')).toBe(true);
    expect(userHasOpenBet(lobbyId, 'Z')).toBe(false);
  });
});
