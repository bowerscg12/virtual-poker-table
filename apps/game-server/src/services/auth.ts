import bcrypt from 'bcryptjs';
import type { AuthResponse, AuthUser } from '@vct/shared-types';
import { getDb } from '../db/client.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { memoryCreateUser, memoryStore } from '../store/memory-fallback.js';

let useMemory = false;

export async function initAuthStore(): Promise<void> {
  try {
    const pool = (await import('../db/client.js')).getPool();
    await pool.query('SELECT 1');
    useMemory = false;
  } catch {
    useMemory = true;
    console.warn('Postgres unavailable — using in-memory store');
  }
}

export async function registerUser(
  displayName: string,
  email?: string,
  password?: string
): Promise<AuthUser> {
  const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;
  if (useMemory) {
    const user = memoryCreateUser({ displayName, email, passwordHash, isGuest: false });
    return { id: user.id, displayName: user.displayName, isGuest: false };
  }
  const db = getDb();
  const [row] = await db
    .insert(users)
    .values({ displayName, email, passwordHash, isGuest: false })
    .returning();
  return { id: row.id, displayName: row.displayName, avatarUrl: row.avatarUrl ?? undefined, isGuest: false };
}

export async function loginUser(email: string, password: string): Promise<AuthUser | null> {
  if (useMemory) {
    const user = [...memoryStore.users.values()].find((u) => u.email === email);
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) return null;
    return { id: user.id, displayName: user.displayName, isGuest: false };
  }
  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row?.passwordHash || !(await bcrypt.compare(password, row.passwordHash))) return null;
  return { id: row.id, displayName: row.displayName, avatarUrl: row.avatarUrl ?? undefined, isGuest: false };
}

export async function guestLogin(displayName: string): Promise<AuthUser> {
  if (useMemory) {
    const user = memoryCreateUser({ displayName, isGuest: true });
    return { id: user.id, displayName: user.displayName, isGuest: true };
  }
  const db = getDb();
  const [row] = await db.insert(users).values({ displayName, isGuest: true }).returning();
  return { id: row.id, displayName: row.displayName, isGuest: true };
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  if (useMemory) {
    const u = memoryStore.users.get(id);
    if (!u) return null;
    return { id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl, isGuest: u.isGuest };
  }
  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!row) return null;
  return { id: row.id, displayName: row.displayName, avatarUrl: row.avatarUrl ?? undefined, isGuest: row.isGuest };
}

export function toAuthResponse(user: AuthUser, token: string): AuthResponse {
  return { user, token };
}
