/**
 * Persistent lifetime statistics for authenticated (non-guest) players.
 * All writes are fire-and-forget — errors are logged but never propagate.
 */
import type { Card, CareerStats, HoleHandStat } from '@vct/shared-types';
import type { VariantConfig } from '@vct/shared-types';
import type { CashOutSummary } from '@vct/shared-types';
import type { GameTableState } from '@vct/poker-engine';
import { parseCard, rankValue } from '@vct/poker-engine';
import { getDb } from '../db/client.js';
import {
  playerLifetimeStats,
  playerHoleHandStats,
  playerGameModeStats,
} from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { getUserById } from './auth.js';
import { isMemoryMode } from './lobby.js';

// ── Hand rank utilities ───────────────────────────────────────────────────────

/** Maps engine HandRank string → 0-9 integer for DB storage and comparison. */
const HAND_RANK_INT: Record<string, number> = {
  high_card: 0,
  pair: 1,
  two_pair: 2,
  three_kind: 3,
  straight: 4,
  flush: 5,
  full_house: 6,
  four_kind: 7,
  straight_flush: 8,
  royal_flush: 9,
};

// ── Archetype calculation ─────────────────────────────────────────────────────

type ArchetypeRow = {
  handsPlayed: number;
  vpipHands: number;
  raiseHands: number;
  callHands: number;
};

function computeArchetype(row: ArchetypeRow): string | null {
  const { handsPlayed, vpipHands, raiseHands, callHands } = row;
  if (handsPlayed < 20) return null;

  const vpip = vpipHands / handsPlayed;
  const aggDenom = callHands + raiseHands;
  const agg = aggDenom > 0 ? raiseHands / aggDenom : 0;

  if (vpip > 0.55 && agg > 0.75) return 'Maniac';
  if (vpip > 0.40 && agg > 0.55) return 'LAG';
  if (vpip > 0.35 && agg < 0.25) return 'Calling Station';
  if (vpip < 0.10) return 'Rock';
  if (vpip < 0.15) return 'Nit';
  if (vpip < 0.25 && agg <= 0.40) return 'Conservative';
  if (vpip >= 0.25 && agg > 0.60) return 'Aggressive';
  return 'Neutral';
}

// ── Starting hand normalisation (mirrors session-stats.ts) ────────────────────

function normalizeHand(holeCards: Card[]): string | null {
  if (holeCards.length !== 2) return null;
  const a = parseCard(holeCards[0]);
  const b = parseCard(holeCards[1]);
  const va = rankValue(a.rank);
  const vb = rankValue(b.rank);
  const [hiRank, loRank, hiSuit, loSuit] =
    va >= vb ? [a.rank, b.rank, a.suit, b.suit] : [b.rank, a.rank, b.suit, a.suit];
  if (hiRank === loRank) return `${hiRank}${loRank}`;
  return `${hiRank}${loRank}${hiSuit === loSuit ? 's' : 'o'}`;
}

// ── Guest-status cache ────────────────────────────────────────────────────────

const guestCache = new Map<string, boolean>();

async function isGuest(userId: string): Promise<boolean> {
  if (guestCache.has(userId)) return guestCache.get(userId)!;
  const user = await getUserById(userId);
  const guest = user?.isGuest ?? true;
  guestCache.set(userId, guest);
  return guest;
}

// ── Per-hand update ───────────────────────────────────────────────────────────

/**
 * Called after each hand completes. Updates hands_played, hands_won, pot stats,
 * best hand, hole hand stats, and game mode stats for all non-guest seated players.
 */
export async function persistHandStats(
  state: GameTableState,
  config: VariantConfig,
): Promise<void> {
  if (isMemoryMode()) return;
  const db = getDb();

  const gameMode = config.game;

  // Build received-chips map from winnerPayouts
  const receivedBySeat = new Map<number, number>();
  for (const p of state.winnerPayouts) {
    receivedBySeat.set(p.seatIndex, (receivedBySeat.get(p.seatIndex) ?? 0) + p.amount);
  }

  const winners = new Set(state.lastWinningSeatIndices);

  for (const seat of state.seats) {
    const userId = seat.userId;
    if (await isGuest(userId)) continue;

    const received = receivedBySeat.get(seat.seatIndex) ?? 0;
    const netDelta = received - seat.totalBet;
    const isWinner = winners.has(seat.seatIndex);

    const potWonDelta = isWinner && netDelta > 0 ? netDelta : 0;
    const potLostDelta = !isWinner && seat.totalBet > 0 ? seat.totalBet : 0;

    // Hole-hand canonical key (2-card holdem/plo only, skip for 12-card-flip etc.)
    const canonicalHand = seat.holeCards.length === 2 ? normalizeHand(seat.holeCards) : null;

    // ── Upsert lifetime stats (hands_played, hands_won, pot sizes) ────────────
    await db
      .insert(playerLifetimeStats)
      .values({
        userId,
        handsPlayed: 1,
        handsWon: isWinner ? 1 : 0,
        biggestPotWon: potWonDelta,
        biggestPotLost: potLostDelta,
      })
      .onConflictDoUpdate({
        target: playerLifetimeStats.userId,
        set: {
          handsPlayed: sql`${playerLifetimeStats.handsPlayed} + 1`,
          handsWon: sql`${playerLifetimeStats.handsWon} + ${isWinner ? 1 : 0}`,
          biggestPotWon: sql`GREATEST(${playerLifetimeStats.biggestPotWon}, ${potWonDelta})`,
          biggestPotLost: sql`GREATEST(${playerLifetimeStats.biggestPotLost}, ${potLostDelta})`,
          updatedAt: sql`NOW()`,
        },
      });

    // ── Upsert best hand if we have a description via winnerPayouts ──────────
    // For folded/non-showdown seats we skip — session-stats handles best hand
    // more accurately via evaluateHand(), which is expensive to replicate here.
    // Best hand is updated more accurately at persistSessionEnd from CashOutSummary.

    // ── Upsert game mode stats ────────────────────────────────────────────────
    await db
      .insert(playerGameModeStats)
      .values({ userId, gameMode, handsPlayed: 1 })
      .onConflictDoUpdate({
        target: [playerGameModeStats.userId, playerGameModeStats.gameMode],
        set: { handsPlayed: sql`${playerGameModeStats.handsPlayed} + 1` },
      });

    // ── Upsert hole hand stats ────────────────────────────────────────────────
    if (canonicalHand) {
      await db
        .insert(playerHoleHandStats)
        .values({
          userId,
          canonicalHand,
          timesDealt: 1,
          timesWon: isWinner ? 1 : 0,
        })
        .onConflictDoUpdate({
          target: [playerHoleHandStats.userId, playerHoleHandStats.canonicalHand],
          set: {
            timesDealt: sql`${playerHoleHandStats.timesDealt} + 1`,
            timesWon: sql`${playerHoleHandStats.timesWon} + ${isWinner ? 1 : 0}`,
          },
        });
    }

    // ── Update favorite game mode ─────────────────────────────────────────────
    await updateFavoriteGameMode(userId);
  }
}

async function updateFavoriteGameMode(userId: string): Promise<void> {
  const db = getDb();
  // Find the game mode with the most hands played for this user
  const rows = await db
    .select()
    .from(playerGameModeStats)
    .where(eq(playerGameModeStats.userId, userId));
  if (rows.length === 0) return;
  let bestMode = rows[0].gameMode;
  let bestCount = rows[0].handsPlayed;
  for (const r of rows) {
    if (r.handsPlayed > bestCount) {
      bestCount = r.handsPlayed;
      bestMode = r.gameMode;
    }
  }
  await db
    .update(playerLifetimeStats)
    .set({ favoriteGameMode: bestMode, updatedAt: sql`NOW()` })
    .where(eq(playerLifetimeStats.userId, userId));
}

// ── Per-session update (called at cash-out) ───────────────────────────────────

/**
 * Called when a player cashes out. Updates session-level stats: profit/loss,
 * winning/losing sessions, biggest gains/losses, best hand, and archetype.
 * Accepts the full CashOutSummary from session-stats.ts finalizeCashOut.
 */
export async function persistSessionEnd(
  userId: string,
  summary: CashOutSummary,
): Promise<void> {
  if (isMemoryMode()) return;
  if (await isGuest(userId)) return;
  const db = getDb();

  const sessionNet = summary.netProfit;
  const isWinningSession = sessionNet > 0;
  const isLosingSession = sessionNet < 0;
  const sessionGain = isWinningSession ? sessionNet : 0;
  const sessionLoss = isLosingSession ? Math.abs(sessionNet) : 0;

  // Best hand rank
  const handRankInt = summary.bestHandRank ? (HAND_RANK_INT[summary.bestHandRank] ?? -1) : -1;
  const bestHandDesc = summary.bestHandDescription;
  const bestHandCards = summary.bestHandCards;
  const bestHandCardsJson = bestHandCards ? JSON.stringify(bestHandCards) : null;

  // Archetype inputs from this session's action counts.
  // CashOutSummary doesn't expose vpipHands directly; use pfrHandsRaised as a conservative proxy.
  const raiseCount = (summary.actionCounts.raise ?? 0) + (summary.actionCounts.all_in ?? 0);
  const callCount = summary.actionCounts.call ?? 0;
  const foldCount = summary.actionCounts.fold ?? 0;
  const vpipIncrement = summary.pfrHandsRaised;

  await db
    .insert(playerLifetimeStats)
    .values({
      userId,
      lifetimeProfit: sessionNet,
      winningSessions: isWinningSession ? 1 : 0,
      losingSessions: isLosingSession ? 1 : 0,
      handsPlayed: summary.handsPlayed,
      handsWon: summary.handsWon,
      biggestPotWon: summary.biggestPotWon,
      biggestPotLost: summary.biggestLoss,
      biggestSessionGain: sessionGain,
      biggestSessionLoss: sessionLoss,
      bestHandRank: handRankInt,
      bestHandDescription: bestHandDesc ?? undefined,
      bestHandCards: bestHandCards ?? undefined,
      vpipHands: vpipIncrement,
      raiseHands: raiseCount,
      callHands: callCount,
      foldHands: foldCount,
    })
    .onConflictDoUpdate({
      target: playerLifetimeStats.userId,
      set: {
        lifetimeProfit: sql`${playerLifetimeStats.lifetimeProfit} + ${sessionNet}`,
        winningSessions: sql`${playerLifetimeStats.winningSessions} + ${isWinningSession ? 1 : 0}`,
        losingSessions: sql`${playerLifetimeStats.losingSessions} + ${isLosingSession ? 1 : 0}`,
        biggestPotWon: sql`GREATEST(${playerLifetimeStats.biggestPotWon}, ${summary.biggestPotWon})`,
        biggestPotLost: sql`GREATEST(${playerLifetimeStats.biggestPotLost}, ${summary.biggestLoss})`,
        biggestSessionGain: sql`GREATEST(${playerLifetimeStats.biggestSessionGain}, ${sessionGain})`,
        biggestSessionLoss: sql`GREATEST(${playerLifetimeStats.biggestSessionLoss}, ${sessionLoss})`,
        bestHandRank: sql`GREATEST(${playerLifetimeStats.bestHandRank}, ${handRankInt})`,
        bestHandDescription: sql`CASE WHEN ${handRankInt} > ${playerLifetimeStats.bestHandRank} THEN ${bestHandDesc} ELSE ${playerLifetimeStats.bestHandDescription} END`,
        bestHandCards: sql`CASE WHEN ${handRankInt} > ${playerLifetimeStats.bestHandRank} THEN ${bestHandCardsJson}::jsonb ELSE ${playerLifetimeStats.bestHandCards} END`,
        vpipHands: sql`${playerLifetimeStats.vpipHands} + ${vpipIncrement}`,
        raiseHands: sql`${playerLifetimeStats.raiseHands} + ${raiseCount}`,
        callHands: sql`${playerLifetimeStats.callHands} + ${callCount}`,
        foldHands: sql`${playerLifetimeStats.foldHands} + ${foldCount}`,
        updatedAt: sql`NOW()`,
      },
    });

  // Recompute archetype from fresh totals
  const [row] = await db
    .select()
    .from(playerLifetimeStats)
    .where(eq(playerLifetimeStats.userId, userId))
    .limit(1);

  if (row) {
    const archetype = computeArchetype({
      handsPlayed: row.handsPlayed,
      vpipHands: row.vpipHands,
      raiseHands: row.raiseHands,
      callHands: row.callHands,
    });
    if (archetype !== row.archetype) {
      await db
        .update(playerLifetimeStats)
        .set({ archetype, updatedAt: sql`NOW()` })
        .where(eq(playerLifetimeStats.userId, userId));
    }
  }
}

// ── Read stats ────────────────────────────────────────────────────────────────

const EMPTY_CAREER_STATS: CareerStats = {
  lifetimeProfit: 0,
  winningSessions: 0,
  losingSessions: 0,
  handsPlayed: 0,
  handsWon: 0,
  biggestPotWon: 0,
  biggestPotLost: 0,
  biggestSessionGain: 0,
  biggestSessionLoss: 0,
  bestHandRank: -1,
  bestHandDescription: null,
  bestHandCards: null,
  favoriteGameMode: null,
  archetype: null,
  mostCommonHoleHand: null,
  bestHoleHand: null,
};

export async function getCareerStats(userId: string): Promise<CareerStats> {
  if (isMemoryMode()) return EMPTY_CAREER_STATS;
  const db = getDb();

  let row: typeof playerLifetimeStats.$inferSelect | undefined;
  try {
    [row] = await db
      .select()
      .from(playerLifetimeStats)
      .where(eq(playerLifetimeStats.userId, userId))
      .limit(1);
  } catch {
    return EMPTY_CAREER_STATS;
  }

  if (!row) return EMPTY_CAREER_STATS;

  // Hole hand stats
  let holeRows: (typeof playerHoleHandStats.$inferSelect)[] = [];
  try {
    holeRows = await db
      .select()
      .from(playerHoleHandStats)
      .where(eq(playerHoleHandStats.userId, userId));
  } catch {
    // Non-fatal — return lifetime stats without hole-hand breakdown
  }

  let mostCommonHoleHand: HoleHandStat | null = null;
  let bestHoleHand: HoleHandStat | null = null;

  for (const h of holeRows) {
    const stat: HoleHandStat = {
      hand: h.canonicalHand,
      timesDealt: h.timesDealt,
      timesWon: h.timesWon,
      winRate: h.timesDealt > 0 ? h.timesWon / h.timesDealt : 0,
    };

    if (!mostCommonHoleHand || stat.timesDealt > mostCommonHoleHand.timesDealt) {
      mostCommonHoleHand = stat;
    }

    if (h.timesDealt >= 20) {
      if (!bestHoleHand || stat.winRate > bestHoleHand.winRate) {
        bestHoleHand = stat;
      }
    }
  }

  return {
    lifetimeProfit: row.lifetimeProfit,
    winningSessions: row.winningSessions,
    losingSessions: row.losingSessions,
    handsPlayed: row.handsPlayed,
    handsWon: row.handsWon,
    biggestPotWon: row.biggestPotWon,
    biggestPotLost: row.biggestPotLost,
    biggestSessionGain: row.biggestSessionGain,
    biggestSessionLoss: row.biggestSessionLoss,
    bestHandRank: row.bestHandRank,
    bestHandDescription: row.bestHandDescription ?? null,
    bestHandCards: (row.bestHandCards as Card[] | null) ?? null,
    favoriteGameMode: row.favoriteGameMode ?? null,
    archetype: row.archetype ?? null,
    mostCommonHoleHand,
    bestHoleHand,
  };
}
