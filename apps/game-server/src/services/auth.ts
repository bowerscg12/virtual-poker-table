import bcrypt from 'bcryptjs';
import type { AuthResponse, AuthUser, AvatarConfig } from '@vct/shared-types';
import { getDb } from '../db/client.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { memoryCreateUser, memoryStore } from '../store/memory-fallback.js';

function serializeAvatar(avatar?: AvatarConfig): string | null {
  if (!avatar) return null;
  return JSON.stringify(avatar);
}

function deserializeAvatar(value?: string | null): AvatarConfig | undefined {
  if (!value) return undefined;
  try {
    if (value.startsWith('{')) return JSON.parse(value) as AvatarConfig;
  } catch {
    // not JSON — treat as a legacy URL string (ignore it)
  }
  return undefined;
}

let useMemory = false;

function assertDisplayName(displayName: string): string {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) throw new Error('Display name is required');
  if (trimmed.length > 10) throw new Error('Display name must be 10 characters or fewer');
  return trimmed;
}

export async function initAuthStore(): Promise<void> {
  // Test-only escape hatch: force the in-memory store even when a Postgres
  // service is reachable (e.g. CI), so memory-store unit tests stay deterministic.
  if (process.env.FORCE_MEMORY_STORE === '1') {
    useMemory = true;
    return;
  }
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
  const normalizedDisplayName = assertDisplayName(displayName);
  const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;
  if (useMemory) {
    const user = memoryCreateUser({ displayName: normalizedDisplayName, email, passwordHash, isGuest: false });
    return { id: user.id, displayName: user.displayName, isGuest: false };
  }
  const db = getDb();
  const [row] = await db
    .insert(users)
    .values({ displayName: normalizedDisplayName, email, passwordHash, isGuest: false })
    .returning();
  return { id: row.id, displayName: row.displayName, avatar: deserializeAvatar(row.avatarUrl), isGuest: false };
}

export async function loginUser(email: string, password: string): Promise<AuthUser | null> {
  if (useMemory) {
    const user = [...memoryStore.users.values()].find((u) => u.email === email);
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) return null;
    return { id: user.id, displayName: user.displayName, avatar: user.avatar, isGuest: false };
  }
  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row?.passwordHash || !(await bcrypt.compare(password, row.passwordHash))) return null;
  return { id: row.id, displayName: row.displayName, avatar: deserializeAvatar(row.avatarUrl), isGuest: false };
}

export async function guestLogin(displayName: string, avatar?: AvatarConfig): Promise<AuthUser> {
  const normalizedDisplayName = assertDisplayName(displayName);
  if (useMemory) {
    const user = memoryCreateUser({ displayName: normalizedDisplayName, isGuest: true, avatar });
    return { id: user.id, displayName: user.displayName, avatar: user.avatar, isGuest: true };
  }
  const db = getDb();
  const [row] = await db
    .insert(users)
    .values({ displayName: normalizedDisplayName, isGuest: true, avatarUrl: serializeAvatar(avatar) })
    .returning();
  return { id: row.id, displayName: row.displayName, avatar: deserializeAvatar(row.avatarUrl), isGuest: true };
}

export async function updateUserDisplayName(id: string, displayName: string): Promise<AuthUser | null> {
  const normalizedDisplayName = assertDisplayName(displayName);
  if (useMemory) {
    const u = memoryStore.users.get(id);
    if (!u) return null;
    u.displayName = normalizedDisplayName;
    return { id: u.id, displayName: u.displayName, avatar: u.avatar, isGuest: u.isGuest };
  }
  const db = getDb();
  const [row] = await db.update(users).set({ displayName: normalizedDisplayName }).where(eq(users.id, id)).returning();
  if (!row) return null;
  return { id: row.id, displayName: row.displayName, avatar: deserializeAvatar(row.avatarUrl), isGuest: row.isGuest };
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  if (useMemory) {
    const u = memoryStore.users.get(id);
    if (!u) return null;
    return { id: u.id, displayName: u.displayName, avatar: u.avatar, isGuest: u.isGuest };
  }
  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!row) return null;
  return { id: row.id, displayName: row.displayName, avatar: deserializeAvatar(row.avatarUrl), isGuest: row.isGuest };
}

export async function updateUserAvatar(id: string, avatar: AvatarConfig): Promise<void> {
  if (useMemory) {
    const u = memoryStore.users.get(id);
    if (u) u.avatar = avatar;
    return;
  }
  const db = getDb();
  await db.update(users).set({ avatarUrl: serializeAvatar(avatar) }).where(eq(users.id, id));
}

export function toAuthResponse(user: AuthUser, token: string): AuthResponse {
  return { user, token };
}
