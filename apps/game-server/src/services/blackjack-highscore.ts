/**
 * Persistent personal-best for blackjack high-score mode: the best peak chips and best winning-hands
 * count a player has reached in any single buy-in. Backed by Postgres; falls back to an in-memory
 * map when the DB is unavailable (matching the rest of the app's memory-mode behaviour).
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { blackjackHighScores } from '../db/schema.js';
import { isMemoryMode } from './lobby.js';

export interface BjHighScore {
  bestPeak: number;
  bestHandsWon: number;
  longestWinStreak: number;
  bestRunHands: number;
  biggestHandWin: number;
}

export interface BjHighScoreUpdate extends BjHighScore {
  isPeakRecord: boolean;
  isHandsRecord: boolean;
}

/** Run aggregates folded into the persistent personal bests at the end of a round/run. */
export interface BjRunSnapshot {
  peakChips: number;
  handsWon: number;
  longestWinStreak: number;
  runHands: number;
  biggestHandWin: number;
}

const EMPTY: BjHighScore = {
  bestPeak: 0,
  bestHandsWon: 0,
  longestWinStreak: 0,
  bestRunHands: 0,
  biggestHandWin: 0,
};

const memory = new Map<string, BjHighScore>();

export async function getBjHighScore(userId: string): Promise<BjHighScore> {
  if (isMemoryMode()) {
    return memory.get(userId) ?? { ...EMPTY };
  }
  try {
    const db = getDb();
    const rows = await db.select().from(blackjackHighScores).where(eq(blackjackHighScores.userId, userId));
    const row = rows[0];
    return row
      ? {
          bestPeak: row.bestPeakChips,
          bestHandsWon: row.bestHandsWon,
          longestWinStreak: row.longestWinStreak,
          bestRunHands: row.bestRunHands,
          biggestHandWin: row.biggestHandWin,
        }
      : { ...EMPTY };
  } catch {
    return memory.get(userId) ?? { ...EMPTY };
  }
}

/**
 * Fold a run snapshot into a player's persistent personal bests; bumps each stat if beaten.
 * Safe to call every settled round (idempotent maxes), so stats accrue even for players who
 * cash out or leave without busting. Returns the post-update bests plus flags for the peak/hands
 * records (used to flag a new personal best in the bust recap).
 */
export async function recordBjHighScore(
  userId: string,
  snapshot: BjRunSnapshot,
): Promise<BjHighScoreUpdate> {
  const prev = await getBjHighScore(userId);
  const isPeakRecord = snapshot.peakChips > prev.bestPeak;
  const isHandsRecord = snapshot.handsWon > prev.bestHandsWon;

  const next: BjHighScore = {
    bestPeak: Math.max(prev.bestPeak, snapshot.peakChips),
    bestHandsWon: Math.max(prev.bestHandsWon, snapshot.handsWon),
    longestWinStreak: Math.max(prev.longestWinStreak, snapshot.longestWinStreak),
    bestRunHands: Math.max(prev.bestRunHands, snapshot.runHands),
    biggestHandWin: Math.max(prev.biggestHandWin, snapshot.biggestHandWin),
  };

  const changed =
    next.bestPeak !== prev.bestPeak ||
    next.bestHandsWon !== prev.bestHandsWon ||
    next.longestWinStreak !== prev.longestWinStreak ||
    next.bestRunHands !== prev.bestRunHands ||
    next.biggestHandWin !== prev.biggestHandWin;

  if (changed) {
    if (isMemoryMode()) {
      memory.set(userId, next);
    } else {
      try {
        const db = getDb();
        await db
          .insert(blackjackHighScores)
          .values({
            userId,
            bestPeakChips: next.bestPeak,
            bestHandsWon: next.bestHandsWon,
            longestWinStreak: next.longestWinStreak,
            bestRunHands: next.bestRunHands,
            biggestHandWin: next.biggestHandWin,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: blackjackHighScores.userId,
            set: {
              bestPeakChips: next.bestPeak,
              bestHandsWon: next.bestHandsWon,
              longestWinStreak: next.longestWinStreak,
              bestRunHands: next.bestRunHands,
              biggestHandWin: next.biggestHandWin,
              updatedAt: new Date(),
            },
          });
      } catch {
        memory.set(userId, next);
      }
    }
  }

  return { ...next, isPeakRecord, isHandsRecord };
}
