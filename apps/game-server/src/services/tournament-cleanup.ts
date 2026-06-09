import { and, inArray, lt } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { tournaments } from '../db/schema.js';
import { isMemoryMode } from './lobby.js';
import { memoryRegistrations, memoryTournaments } from './tournament-service.js';

/**
 * How old a finished/cancelled tournament must be before it is deleted.
 * Defaults to 72 h. Override with TOURNAMENT_EXPIRY_HOURS env var.
 */
const TOURNAMENT_EXPIRY_HOURS = parseInt(process.env.TOURNAMENT_EXPIRY_HOURS ?? '24', 10);

/**
 * Delete tournaments (and their registrations via CASCADE) whose status is
 * 'finished' or 'cancelled' and that were created more than TOURNAMENT_EXPIRY_HOURS ago.
 *
 * Safe to call repeatedly — idempotent.
 * @returns Number of tournaments deleted.
 */
export async function cleanupExpiredTournaments(): Promise<number> {
  if (isMemoryMode()) {
    return cleanupExpiredTournamentsMemory();
  }

  const db = getDb();
  const cutoff = new Date(Date.now() - TOURNAMENT_EXPIRY_HOURS * 60 * 60 * 1000);

  const deleted = await db
    .delete(tournaments)
    .where(
      and(
        inArray(tournaments.status, ['finished', 'cancelled']),
        lt(tournaments.createdAt, cutoff)
      )
    )
    .returning({ id: tournaments.id });

  const count = deleted.length;
  if (count > 0) {
    console.log(`[tournament-cleanup] Deleted ${count} expired tournament(s) (cutoff: ${cutoff.toISOString()})`);
  }
  return count;
}

function cleanupExpiredTournamentsMemory(): number {
  const cutoff = Date.now() - TOURNAMENT_EXPIRY_HOURS * 60 * 60 * 1000;
  let count = 0;

  for (const [id, t] of memoryTournaments) {
    if ((t.status === 'finished' || t.status === 'cancelled') && t.createdAt.getTime() < cutoff) {
      memoryTournaments.delete(id);
      memoryRegistrations.delete(id);
      count++;
    }
  }

  if (count > 0) {
    console.log(`[tournament-cleanup] Deleted ${count} expired tournament(s) from memory`);
  }
  return count;
}
