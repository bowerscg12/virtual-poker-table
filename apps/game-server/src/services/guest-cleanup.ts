import { and, eq, gt, lt, notInArray } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { logger } from '../logger.js';
import { playerSessions, users } from '../db/schema.js';
import { memoryStore } from '../store/memory-fallback.js';
import { isMemoryMode } from './lobby.js';

/**
 * How old a guest account must be (with no active sessions) before it is eligible
 * for deletion. Defaults to 48 h — long enough for a 24 h session to expire plus a
 * safety buffer. Override with GUEST_EXPIRY_HOURS env var.
 */
const GUEST_EXPIRY_HOURS = parseInt(process.env.GUEST_EXPIRY_HOURS ?? '48', 10);

/**
 * Delete guest user accounts that have been inactive long enough to be considered
 * abandoned. Safe to call repeatedly — idempotent.
 *
 * A guest is eligible when ALL of:
 *   1. is_guest = true
 *   2. created_at < NOW() - GUEST_EXPIRY_HOURS
 *   3. No unexpired player_sessions row references them
 *
 * The FK constraints on lobbies.host_user_id (ON DELETE SET NULL) and
 * table_seats.user_id (ON DELETE SET NULL) handle referential integrity automatically,
 * so historical lobby and seat records survive with a NULL user reference.
 * player_sessions rows cascade-delete, so no orphans are left behind.
 *
 * @returns Number of guest accounts deleted.
 */
export async function cleanupExpiredGuests(): Promise<number> {
  if (isMemoryMode()) {
    return cleanupExpiredGuestsMemory();
  }

  const db = getDb();
  const now = new Date();
  const cutoff = new Date(Date.now() - GUEST_EXPIRY_HOURS * 60 * 60 * 1000);

  // Collect user IDs that still have at least one unexpired session — these must not be deleted.
  const activeSessions = await db
    .selectDistinct({ userId: playerSessions.userId })
    .from(playerSessions)
    .where(gt(playerSessions.expiresAt, now));

  const protectedIds = activeSessions.map((r) => r.userId);

  const whereConditions = [eq(users.isGuest, true), lt(users.createdAt, cutoff)];
  if (protectedIds.length > 0) {
    whereConditions.push(notInArray(users.id, protectedIds));
  }

  const deleted = await db
    .delete(users)
    .where(and(...whereConditions))
    .returning({ id: users.id });

  const count = deleted.length;
  if (count > 0) {
    logger.info({ count, cutoff: cutoff.toISOString() }, '[guest-cleanup] Deleted expired guest account(s)');
  }
  return count;
}

function cleanupExpiredGuestsMemory(): number {
  const cutoff = Date.now() - GUEST_EXPIRY_HOURS * 60 * 60 * 1000;

  const activeUserIds = new Set(
    [...memoryStore.sessions.values()]
      .filter((s) => new Date(s.expiresAt).getTime() > Date.now())
      .map((s) => s.userId),
  );

  let count = 0;
  for (const [id, user] of memoryStore.users) {
    if (user.isGuest && new Date(user.createdAt).getTime() < cutoff && !activeUserIds.has(id)) {
      memoryStore.users.delete(id);
      count++;
    }
  }

  if (count > 0) {
    logger.info({ count }, '[guest-cleanup] Deleted expired guest account(s) from memory store');
  }
  return count;
}
