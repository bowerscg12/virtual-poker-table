import { randomUUID } from 'crypto';
import { and, eq, lt } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { playerSessions } from '../db/schema.js';
import { memoryStore, type MemorySession } from '../store/memory-fallback.js';
import { isMemoryMode } from './lobby.js';

/** Auto-act timeout: how long to wait on a disconnected player's turn before folding. Default: 3 minutes. */
export const GRACE_PERIOD_MS = parseInt(process.env.DISCONNECT_GRACE_PERIOD_MS ?? '180000', 10);

/** Seat reservation period: how long to hold a disconnected player's seat before releasing it. Default: 10 minutes. */
export const SEAT_RELEASE_MS = parseInt(process.env.SEAT_RELEASE_MS ?? '600000', 10);

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface PlayerSession {
  id: string;
  userId: string;
  lobbyId: string | null;
  disconnectedAt: Date | null;
  expiresAt: Date;
}

export async function createSession(userId: string, lobbyId: string | null): Promise<string> {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  if (isMemoryMode()) {
    const s: MemorySession = {
      id,
      userId,
      lobbyId,
      disconnectedAt: null,
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
    };
    memoryStore.sessions.set(id, s);
    return id;
  }

  const db = getDb();
  await db.insert(playerSessions).values({ id, userId, lobbyId, expiresAt });
  return id;
}

export async function getSession(sessionId: string): Promise<PlayerSession | null> {
  if (isMemoryMode()) {
    const s = memoryStore.sessions.get(sessionId);
    if (!s) return null;
    if (new Date(s.expiresAt) < new Date()) {
      memoryStore.sessions.delete(sessionId);
      return null;
    }
    return {
      id: s.id,
      userId: s.userId,
      lobbyId: s.lobbyId,
      disconnectedAt: s.disconnectedAt ? new Date(s.disconnectedAt) : null,
      expiresAt: new Date(s.expiresAt),
    };
  }

  const db = getDb();
  const [row] = await db.select().from(playerSessions).where(eq(playerSessions.id, sessionId)).limit(1);
  if (!row) return null;
  if (row.expiresAt < new Date()) {
    await db.delete(playerSessions).where(eq(playerSessions.id, sessionId));
    return null;
  }
  return {
    id: row.id,
    userId: row.userId,
    lobbyId: row.lobbyId ?? null,
    disconnectedAt: row.disconnectedAt ?? null,
    expiresAt: row.expiresAt,
  };
}

export async function updateSessionLobby(sessionId: string, lobbyId: string): Promise<void> {
  if (isMemoryMode()) {
    const s = memoryStore.sessions.get(sessionId);
    if (s) s.lobbyId = lobbyId;
    return;
  }
  const db = getDb();
  await db.update(playerSessions).set({ lobbyId }).where(eq(playerSessions.id, sessionId));
}

export async function markSessionDisconnected(sessionId: string): Promise<void> {
  const now = new Date();
  if (isMemoryMode()) {
    const s = memoryStore.sessions.get(sessionId);
    if (s) s.disconnectedAt = now.toISOString();
    return;
  }
  const db = getDb();
  await db.update(playerSessions).set({ disconnectedAt: now }).where(eq(playerSessions.id, sessionId));
}

export async function markSessionConnected(sessionId: string): Promise<void> {
  if (isMemoryMode()) {
    const s = memoryStore.sessions.get(sessionId);
    if (s) s.disconnectedAt = null;
    return;
  }
  const db = getDb();
  await db.update(playerSessions).set({ disconnectedAt: null }).where(eq(playerSessions.id, sessionId));
}

export async function deleteSession(sessionId: string): Promise<void> {
  if (isMemoryMode()) {
    memoryStore.sessions.delete(sessionId);
    return;
  }
  const db = getDb();
  await db.delete(playerSessions).where(eq(playerSessions.id, sessionId));
}

export async function deleteSessionsByUserId(userId: string): Promise<void> {
  if (isMemoryMode()) {
    for (const [id, s] of memoryStore.sessions) {
      if (s.userId === userId) memoryStore.sessions.delete(id);
    }
    return;
  }
  const db = getDb();
  await db.delete(playerSessions).where(eq(playerSessions.userId, userId));
}

/** Delete only the sessions for a specific user+lobby pair, leaving any other sessions (e.g. the current WS session) intact. */
export async function deleteSessionsByUserAndLobby(userId: string, lobbyId: string): Promise<void> {
  if (isMemoryMode()) {
    for (const [id, s] of memoryStore.sessions) {
      if (s.userId === userId && s.lobbyId === lobbyId) memoryStore.sessions.delete(id);
    }
    return;
  }
  const db = getDb();
  await db.delete(playerSessions).where(
    and(eq(playerSessions.userId, userId), eq(playerSessions.lobbyId, lobbyId))
  );
}

/** Find the most-recently-created active session for a user in a specific lobby. */
export async function getSessionByUserAndLobby(userId: string, lobbyId: string): Promise<PlayerSession | null> {
  if (isMemoryMode()) {
    let best: MemorySession | null = null;
    for (const s of memoryStore.sessions.values()) {
      if (s.userId !== userId || s.lobbyId !== lobbyId) continue;
      if (new Date(s.expiresAt) < new Date()) continue;
      if (!best || s.createdAt > best.createdAt) best = s;
    }
    if (!best) return null;
    return {
      id: best.id,
      userId: best.userId,
      lobbyId: best.lobbyId,
      disconnectedAt: best.disconnectedAt ? new Date(best.disconnectedAt) : null,
      expiresAt: new Date(best.expiresAt),
    };
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(playerSessions)
    .where(and(eq(playerSessions.userId, userId), eq(playerSessions.lobbyId, lobbyId)))
    .limit(1);
  const row = rows[0];
  if (!row || row.expiresAt < new Date()) return null;
  return {
    id: row.id,
    userId: row.userId,
    lobbyId: row.lobbyId ?? null,
    disconnectedAt: row.disconnectedAt ?? null,
    expiresAt: row.expiresAt,
  };
}

export async function cleanExpiredSessions(): Promise<void> {
  if (isMemoryMode()) {
    const now = new Date();
    for (const [id, s] of memoryStore.sessions) {
      if (new Date(s.expiresAt) < now) memoryStore.sessions.delete(id);
    }
    return;
  }
  const db = getDb();
  await db.delete(playerSessions).where(lt(playerSessions.expiresAt, new Date()));
}
