import { and, desc, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { handHistories, lobbies, playerSessions, tableSeats } from '../db/schema.js';
import { keys, redisDel } from '../store/redis.js';
import { memoryStore } from '../store/memory-fallback.js';
import { isMemoryMode } from './lobby.js';
import { logger } from '../logger.js';
import { deleteBotUsersForLobby, unregisterBotUser } from './bots.js';
import { SEAT_RELEASE_MS } from './session.js';

/**
 * Fully delete a lobby and all associated data: Redis keys, player sessions,
 * hand histories, seats (via cascade), and the lobby row itself.
 *
 * This is safe to call once the reconnect window has expired for all players.
 * The caller is responsible for cancelling any in-process timers (action timer,
 * intermission timer, etc.) before calling this.
 */
export async function deleteLobby(lobbyId: string): Promise<void> {
  // Remove the lobby's bot user rows first (while its seats still exist).
  await deleteBotUsersForLobby(lobbyId);

  await Promise.all([
    redisDel(keys.tableState(lobbyId)),
    redisDel(keys.presence(lobbyId)),
    redisDel(keys.chat(lobbyId)),
  ]);

  if (isMemoryMode()) {
    const lobby = memoryStore.lobbies.get(lobbyId);
    if (lobby) {
      memoryStore.inviteIndex.delete(lobby.inviteCode);
      memoryStore.lobbies.delete(lobbyId);
    }
    memoryStore.handHistories = memoryStore.handHistories.filter(h => h.lobbyId !== lobbyId);
    for (const [id, session] of memoryStore.sessions) {
      if (session.lobbyId === lobbyId) memoryStore.sessions.delete(id);
    }
    return;
  }

  const db = getDb();
  await db.delete(handHistories).where(eq(handHistories.lobbyId, lobbyId));
  await db.delete(playerSessions).where(eq(playerSessions.lobbyId, lobbyId));
  await db.delete(lobbies).where(eq(lobbies.id, lobbyId));
}

/**
 * Scan all lobbies and delete those that are clearly abandoned.
 *
 * A lobby is eligible for deletion when ALL of the following are true:
 *  - It was created at least SEAT_RELEASE_MS * 2 ago (20-min minimum age)
 *  - No seat has a player whose reconnect window is still open:
 *      disconnectedAt IS NOT NULL AND disconnectedAt + SEAT_RELEASE_MS < now
 *    If a session is missing entirely the seat is treated as stale (safe to delete).
 *    Sessions with disconnectedAt = null are treated as active (lobby is skipped).
 *
 * Lobbies with status 'closed' skip the session check and are always deleted —
 * they were already gracefully shut down in-process; this just removes the DB row.
 *
 * Safe to call at server startup and on a recurring maintenance interval.
 * Returns the number of lobbies deleted.
 */
export async function cleanupAbandonedLobbies(): Promise<number> {
  if (isMemoryMode()) {
    return cleanupAbandonedLobbiesMemory();
  }

  const db = getDb();
  const now = new Date();
  const minAge = new Date(now.getTime() - SEAT_RELEASE_MS * 2);

  const candidates = await db
    .select({ id: lobbies.id, status: lobbies.status })
    .from(lobbies)
    .where(lt(lobbies.createdAt, minAge));

  if (candidates.length === 0) return 0;

  const toDelete: string[] = [];

  for (const row of candidates) {
    if (row.status === 'closed') {
      toDelete.push(row.id);
      continue;
    }

    const occupied = await db
      .select({ userId: tableSeats.userId })
      .from(tableSeats)
      .where(and(eq(tableSeats.lobbyId, row.id), isNotNull(tableSeats.userId)));

    if (occupied.length === 0) {
      toDelete.push(row.id);
      continue;
    }

    let hasActiveWindow = false;
    for (const seat of occupied) {
      if (!seat.userId) continue;
      const [session] = await db
        .select({ disconnectedAt: playerSessions.disconnectedAt })
        .from(playerSessions)
        .where(and(eq(playerSessions.userId, seat.userId), eq(playerSessions.lobbyId, row.id)))
        .orderBy(desc(playerSessions.createdAt))
        .limit(1);

      if (!session) continue;
      if (!session.disconnectedAt) {
        hasActiveWindow = true;
        break;
      }
      const reconnectExpiry = new Date(session.disconnectedAt.getTime() + SEAT_RELEASE_MS);
      if (reconnectExpiry > now) {
        hasActiveWindow = true;
        break;
      }
    }

    if (!hasActiveWindow) toDelete.push(row.id);
  }

  if (toDelete.length === 0) return 0;

  const BATCH = 50;
  let count = 0;
  for (let i = 0; i < toDelete.length; i += BATCH) {
    const batch = toDelete.slice(i, i + BATCH);
    await Promise.all(batch.map((id) => deleteBotUsersForLobby(id)));
    await Promise.all(
      batch.flatMap(id => [
        redisDel(keys.tableState(id)),
        redisDel(keys.presence(id)),
        redisDel(keys.chat(id)),
      ])
    );
    await db.delete(handHistories).where(inArray(handHistories.lobbyId, batch));
    await db.delete(playerSessions).where(inArray(playerSessions.lobbyId, batch));
    const deleted = await db.delete(lobbies).where(inArray(lobbies.id, batch)).returning({ id: lobbies.id });
    count += deleted.length;
  }

  if (count > 0) {
    logger.info({ count }, '[lobby-cleanup] Deleted abandoned lobby/lobbies');
  }
  return count;
}

function cleanupAbandonedLobbiesMemory(): number {
  const now = Date.now();
  const minAge = now - SEAT_RELEASE_MS * 2;
  let count = 0;

  for (const [id, lobby] of memoryStore.lobbies) {
    if (new Date(lobby.createdAt).getTime() >= minAge) continue;

    if (lobby.status === 'closed') {
      purgeMemoryLobby(id, lobby.inviteCode);
      count++;
      continue;
    }

    const hasActiveWindow = lobby.seats.some(seat => {
      if (!seat.userId) return false;
      for (const session of memoryStore.sessions.values()) {
        if (session.userId !== seat.userId || session.lobbyId !== id) continue;
        if (!session.disconnectedAt) return true;
        const expiry = new Date(session.disconnectedAt).getTime() + SEAT_RELEASE_MS;
        if (expiry > now) return true;
      }
      return false;
    });

    if (!hasActiveWindow) {
      purgeMemoryLobby(id, lobby.inviteCode);
      count++;
    }
  }

  if (count > 0) {
    logger.info({ count }, '[lobby-cleanup] Deleted abandoned lobby/lobbies from memory');
  }
  return count;
}

function purgeMemoryLobby(lobbyId: string, inviteCode: string): void {
  // Remove the lobby's bot user rows (and their cache entries) before dropping the lobby.
  const lobby = memoryStore.lobbies.get(lobbyId);
  if (lobby) {
    for (const seat of lobby.seats) {
      if (seat.isBot && seat.userId) {
        unregisterBotUser(seat.userId);
        memoryStore.users.delete(seat.userId);
      }
    }
  }
  memoryStore.lobbies.delete(lobbyId);
  memoryStore.inviteIndex.delete(inviteCode);
  memoryStore.handHistories = memoryStore.handHistories.filter(h => h.lobbyId !== lobbyId);
  for (const [id, session] of memoryStore.sessions) {
    if (session.lobbyId === lobbyId) memoryStore.sessions.delete(id);
  }
}
