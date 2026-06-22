import { describe, it, expect, beforeEach } from 'vitest';
import type { BlackjackHand, BlackjackPlayer } from '@vct/blackjack-engine';
import {
  ensureBjRun,
  getBjRun,
  recordBjRoundForRuns,
  clearLobbyBjRuns,
} from './blackjack-session.js';

const LOBBY = 'lobby-test';
const USER = 'user-1';

function hand(result: BlackjackHand['result'], wager: number, payout: number): BlackjackHand {
  return {
    id: `${result}-${wager}-${payout}`,
    cards: [],
    wager,
    isStanding: true,
    isBust: result === 'loss',
    isBlackjack: result === 'blackjack',
    isDoubled: false,
    isSplit: false,
    result,
    payout,
  };
}

function player(stack: number, hands: BlackjackHand[]): BlackjackPlayer {
  return {
    userId: USER,
    seatIndex: 0,
    stack,
    pendingBet: 0,
    hands,
    activeHandIndex: 0,
    status: 'done',
    insuranceBet: 0,
  };
}

describe('recordBjRoundForRuns', () => {
  beforeEach(() => clearLobbyBjRuns(LOBBY));

  it('tracks win streak, biggest single-hand win, and rounds played across rounds', () => {
    ensureBjRun(LOBBY, USER, 500, 500);

    // Round 1: win 100 (payout 200 on a 100 wager → net +100).
    recordBjRoundForRuns(LOBBY, [player(600, [hand('win', 100, 200)])], 5);
    // Round 2: a bigger win, net +150 (wager 150, payout 300), streak continues.
    recordBjRoundForRuns(LOBBY, [player(750, [hand('win', 150, 300)])], 5);

    const run = getBjRun(LOBBY, USER)!;
    expect(run.currentWinStreak).toBe(2);
    expect(run.longestWinStreak).toBe(2);
    expect(run.biggestHandWin).toBe(150);
    expect(run.roundsPlayed).toBe(2);
    expect(run.peakChips).toBe(750);
  });

  it('resets the win streak on a losing hand but keeps the longest', () => {
    ensureBjRun(LOBBY, USER, 500, 500);
    recordBjRoundForRuns(LOBBY, [player(600, [hand('win', 100, 200)])], 5);
    recordBjRoundForRuns(LOBBY, [player(700, [hand('win', 100, 200)])], 5);
    recordBjRoundForRuns(LOBBY, [player(600, [hand('loss', 100, 0)])], 5);

    const run = getBjRun(LOBBY, USER)!;
    expect(run.longestWinStreak).toBe(2);
    expect(run.currentWinStreak).toBe(0);
  });

  it('counts split sub-hands toward the streak within a single round', () => {
    ensureBjRun(LOBBY, USER, 500, 500);
    recordBjRoundForRuns(
      LOBBY,
      [player(700, [hand('win', 100, 200), hand('blackjack', 100, 250)])],
      5,
    );

    const run = getBjRun(LOBBY, USER)!;
    expect(run.currentWinStreak).toBe(2);
    expect(run.longestWinStreak).toBe(2);
    expect(run.biggestHandWin).toBe(150); // blackjack net = 250 - 100
  });

  it('flags a bust when the stack falls below the table minimum and ends the run', () => {
    ensureBjRun(LOBBY, USER, 500, 500);
    const busts = recordBjRoundForRuns(LOBBY, [player(3, [hand('loss', 100, 0)])], 5);

    expect(busts).toHaveLength(1);
    expect(busts[0]!.userId).toBe(USER);
    expect(getBjRun(LOBBY, USER)!.ended).toBe(true);
  });
});
