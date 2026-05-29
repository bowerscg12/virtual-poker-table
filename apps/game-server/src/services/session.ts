import { randomUUID } from 'crypto';
import { eq, lt } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { playerSessions } from '../db/schema.js';
import { memoryStore, type MemorySession } from '../store/memory-fallback.js';
import { isMemoryMode } from './lobby.js';

/** Configurable via env. Default: 3 minutes. */
export const GRACE_PERIOD_MS = parseInt(process.env.DISCONNECT_GRACE_PERIOD_MS ?? '180000', 10);

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
