/**
 * Blackjack high-score "run" tracking. Each buy-in is its own run: peak chips and winning hands
 * reset whenever a player buys in fresh. A run ends when the player can no longer cover the table
 * minimum bet ("bust"). Purely in-memory — like the rest of live blackjack state.
 */
import type { BlackjackPlayer } from '@vct/blackjack-engine';

export interface BjRun {
  buyIn: number;
  peakChips: number;
  handsWon: number;
  handsPlayed: number;
  /** Rounds (deals) played this run — used for the "most hands survived per run" stat. */
  roundsPlayed: number;
  /** Running streak of consecutive winning hands; reset to 0 on a losing/surrendered hand. */
  currentWinStreak: number;
  /** Longest consecutive-win streak reached this run. */
  longestWinStreak: number;
  /** Largest net chips won on a single hand this run. */
  biggestHandWin: number;
  /** Set once the run has busted so we never emit a second recap for it. */
  ended: boolean;
}

function freshRun(buyIn: number, peakChips: number): BjRun {
  return {
    buyIn,
    peakChips,
    handsWon: 0,
    handsPlayed: 0,
    roundsPlayed: 0,
    currentWinStreak: 0,
    longestWinStreak: 0,
    biggestHandWin: 0,
    ended: false,
  };
}

/** lobbyId → userId → current run. */
const runs = new Map<string, Map<string, BjRun>>();

function lobbyRuns(lobbyId: string): Map<string, BjRun> {
  let m = runs.get(lobbyId);
  if (!m) { m = new Map(); runs.set(lobbyId, m); }
  return m;
}

/** Start a run for a player if they don't have a live one (called as they enter a betting phase). */
export function ensureBjRun(lobbyId: string, userId: string, stack: number, buyIn: number): void {
  const m = lobbyRuns(lobbyId);
  const existing = m.get(userId);
  if (existing && !existing.ended) return;
  m.set(userId, freshRun(buyIn, stack));
}

/** Reset a player's run to a fresh buy-in (used on "Play Again"). */
export function resetBjRun(lobbyId: string, userId: string, buyIn: number): void {
  lobbyRuns(lobbyId).set(userId, freshRun(buyIn, buyIn));
}

export function getBjRun(lobbyId: string, userId: string): BjRun | undefined {
  return runs.get(lobbyId)?.get(userId);
}

export function clearLobbyBjRuns(lobbyId: string): void {
  runs.delete(lobbyId);
}

/** Drop a single player's run (used when they cash out / leave the table). */
export function clearBjRunForUser(lobbyId: string, userId: string): void {
  runs.get(lobbyId)?.delete(userId);
}

/** A player whose run just busted, with the final recap figures. */
export interface BjBust {
  userId: string;
  buyIn: number;
  peakChips: number;
  handsWon: number;
  handsPlayed: number;
}

/**
 * Fold a settled round into each active player's run: bump peak chips, count winning hands
 * (split hands counted separately; `win`/`blackjack` results only), and flag busts.
 * Returns the players whose run ended this round (stack can no longer cover the minimum bet).
 */
export function recordBjRoundForRuns(
  lobbyId: string,
  settledPlayers: BlackjackPlayer[],
  minBet: number,
): BjBust[] {
  const m = lobbyRuns(lobbyId);
  const busts: BjBust[] = [];

  for (const player of settledPlayers) {
    if (player.status === 'sitting_out') continue;
    const run = m.get(player.userId);
    if (!run || run.ended) continue;

    run.handsPlayed += player.hands.length;
    run.handsWon += player.hands.filter((h) => h.result === 'win' || h.result === 'blackjack').length;
    run.peakChips = Math.max(run.peakChips, player.stack);
    run.roundsPlayed += 1;

    // Walk the settled hands in order to track the win streak and biggest single-hand win.
    // Pushes are neutral (streak preserved); wins extend it; losses/surrenders reset it.
    for (const hand of player.hands) {
      if (hand.result === 'win' || hand.result === 'blackjack') {
        run.currentWinStreak += 1;
        run.longestWinStreak = Math.max(run.longestWinStreak, run.currentWinStreak);
        const netWin = (hand.payout ?? 0) - hand.wager;
        run.biggestHandWin = Math.max(run.biggestHandWin, netWin);
      } else if (hand.result === 'loss' || hand.result === 'surrender') {
        run.currentWinStreak = 0;
      }
    }

    if (player.stack < minBet) {
      run.ended = true;
      busts.push({
        userId: player.userId,
        buyIn: run.buyIn,
        peakChips: run.peakChips,
        handsWon: run.handsWon,
        handsPlayed: run.handsPlayed,
      });
    }
  }

  return busts;
}
