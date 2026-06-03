import type { ActiveSeatInfo, AvatarConfig, CreateLobbyRequest, LobbySummary, TableSeat, VariantConfig } from '@vct/shared-types';
import { DEFAULT_VARIANT_CONFIG, RULES_PRESETS, TIMER_STEPS_SEC, getTableBuyIn } from '@vct/shared-types';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { lobbies, playerSessions, tableSeats, users } from '../db/schema.js';
import {
  memoryCreateLobby,
  memoryStore,
  type MemoryLobby,
} from '../store/memory-fallback.js';
import { initAuthStore } from './auth.js';

let useMemory = false;

const SEAT_RELEASE_MS = parseInt(process.env.SEAT_RELEASE_MS ?? '600000', 10);

/**
 * Per-lobby mutex to serialize concurrent entry attempts (name check + seat assignment).
 * Prevents two users from simultaneously passing the name uniqueness check.
 */
const lobbyEntryLocks = new Map<string, Promise<void>>();

export async function withLobbyEntryLock<T>(lobbyId: string, fn: () => Promise<T>): Promise<T> {
  const prev = lobbyEntryLocks.get(lobbyId) ?? Promise.resolve();
  let release!: () => void;
  const lock = new Promise<void>((res) => { release = res; });
  lobbyEntryLocks.set(lobbyId, lock);
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (lobbyEntryLocks.get(lobbyId) === lock) lobbyEntryLocks.delete(lobbyId);
  }
}

export async function initLobbyStore(): Promise<void> {
  await initAuthStore();
  try {
    const pool = (await import('../db/client.js')).getPool();
    await pool.query('SELECT 1');
    useMemory = false;
    // Apply any schema additions that may have been missed on older deployments.
    await applySchemaUpdates(pool);
  } catch {
    useMemory = true;
  }
}

async function applySchemaUpdates(pool: import('pg').Pool): Promise<void> {
  try {
    await pool.query(`
      ALTER TABLE table_seats ADD COLUMN IF NOT EXISTS sit_out_next_hand BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE table_seats ADD COLUMN IF NOT EXISTS sit_out_blind_owed BOOLEAN NOT NULL DEFAULT false;
    `);
  } catch (err) {
    console.error('[schema] Failed to apply column updates:', err);
  }

  // Guest-lifecycle: make lobbies.host_user_id nullable with ON DELETE SET NULL.
  try {
    await pool.query(`
      ALTER TABLE lobbies ALTER COLUMN host_user_id DROP NOT NULL;
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lobbies_host_user_id_fkey') THEN
          ALTER TABLE lobbies DROP CONSTRAINT lobbies_host_user_id_fkey;
        END IF;
      END $$;
      ALTER TABLE lobbies ADD CONSTRAINT lobbies_host_user_id_fkey
        FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE SET NULL;
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'table_seats_user_id_fkey') THEN
          ALTER TABLE table_seats DROP CONSTRAINT table_seats_user_id_fkey;
        END IF;
      END $$;
      ALTER TABLE table_seats ADD CONSTRAINT table_seats_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_users_guest_created ON users(created_at) WHERE is_guest = true;
    `);
  } catch (err) {
    console.error('[schema] Failed to apply guest-lifecycle FK updates:', err);
  }
}

function toSummary(lobby: MemoryLobby, connected: Set<string> = new Set()): LobbySummary {
  const hostDisplayName = (lobby.hostUserId ? memoryStore.users.get(lobby.hostUserId)?.displayName : undefined) ?? 'Host';
  return {
    id: lobby.id,
    inviteCode: lobby.inviteCode,
    hostUserId: lobby.hostUserId,
    hostDisplayName,
    status: lobby.status,
    settings: lobby.settings,
    seats: lobby.seats.map((s) => {
      const u = s.userId ? memoryStore.users.get(s.userId) : undefined;
      return {
        seatIndex: s.seatIndex,
        userId: s.userId,
        displayName: u?.displayName ?? null,
        avatar: u?.avatar,
        stack: s.stack,
        sittingOut: s.sittingOut,
        isConnected: s.userId ? connected.has(s.userId) : false,
        sitOutNextHand: s.sitOutNextHand,
        sitOutBlindOwed: s.sitOutBlindOwed,
      };
    }),
    createdAt: lobby.createdAt,
  };
}

function deserializeAvatar(value?: string | null): AvatarConfig | undefined {
  if (!value) return undefined;
  try {
    if (value.startsWith('{')) return JSON.parse(value) as AvatarConfig;
  } catch {
    // not JSON
  }
  return undefined;
}

async function pgToSummary(lobbyId: string, connected: Set<string> = new Set()): Promise<LobbySummary | null> {
  const db = getDb();
  const [lobby] = await db.select().from(lobbies).where(eq(lobbies.id, lobbyId)).limit(1);
  if (!lobby) return null;
  const [host] = lobby.hostUserId
    ? await db.select().from(users).where(eq(users.id, lobby.hostUserId)).limit(1)
    : [];
  const seats = await db.select().from(tableSeats).where(eq(tableSeats.lobbyId, lobbyId));
  const seatSummaries: TableSeat[] = [];
  for (const s of seats) {
    let displayName: string | null = null;
    let avatar: AvatarConfig | undefined;
    if (s.userId) {
      const [u] = await db.select().from(users).where(eq(users.id, s.userId)).limit(1);
      displayName = u?.displayName ?? null;
      avatar = deserializeAvatar(u?.avatarUrl);
    }
    seatSummaries.push({
      seatIndex: s.seatIndex,
      userId: s.userId,
      displayName,
      avatar,
      stack: s.stack,
      sittingOut: s.sittingOut,
      isConnected: s.userId ? connected.has(s.userId) : false,
      sitOutNextHand: s.sitOutNextHand,
      sitOutBlindOwed: s.sitOutBlindOwed,
    });
  }
  return {
    id: lobby.id,
    inviteCode: lobby.inviteCode,
    hostUserId: lobby.hostUserId,
    hostDisplayName: host?.displayName ?? 'Host',
    status: lobby.status as LobbySummary['status'],
    settings: lobby.settings as VariantConfig,
    seats: seatSummaries,
    createdAt: lobby.createdAt.toISOString(),
  };
}

function normalizeSettings(settings: VariantConfig): VariantConfig {
  const buyIn = settings.buyIn ?? settings.minBuyIn;
  const isHoldem = settings.game === 'holdem';
  const straddle = isHoldem ? !!settings.straddle : false;
  return {
    ...settings,
    buyIn,
    minBuyIn: buyIn,
    maxBuyIn: Math.max(buyIn, settings.maxBuyIn),
    straddle,
    straddleAmount: straddle ? Math.max(settings.blinds.big, settings.straddleAmount ?? settings.blinds.big * 2) : undefined,
    sevenDeuceRule: isHoldem ? !!settings.sevenDeuceRule : false,
  };
}

function isValidBuyIn(value: number): boolean {
  return Number.isInteger(value) && value >= 10 && value <= 10000 && value % 5 === 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function validateSettings(settings: VariantConfig): void {
  const buyIn = settings.buyIn ?? settings.minBuyIn;
  if (!isValidBuyIn(buyIn)) {
    throw new Error('Buy-in must be between 10 and 10000 in increments of 5');
  }
  // twelve_card_flip uses a bomb pot ante instead of blinds; skip blind validation
  if (settings.game !== 'twelve_card_flip') {
    if (!isPositiveInteger(settings.blinds.small) || !isPositiveInteger(settings.blinds.big)) {
      throw new Error('Blind amounts must be positive integers');
    }
    if (settings.blinds.ante !== undefined && !isPositiveInteger(settings.blinds.ante)) {
      throw new Error('Ante must be a positive integer');
    }
    if (settings.game === 'holdem' && settings.straddle) {
      const straddleAmount = settings.straddleAmount ?? settings.blinds.big;
      if (!isPositiveInteger(straddleAmount)) {
        throw new Error('Straddle amount must be a positive integer');
      }
      if (straddleAmount < settings.blinds.big) {
        throw new Error('Straddle amount must be at least the big blind');
      }
    }
  }
}

export async function createLobby(hostUserId: string, req: CreateLobbyRequest): Promise<LobbySummary> {
  let settings: VariantConfig = req.settings ?? DEFAULT_VARIANT_CONFIG;
  if (req.presetId) {
    const preset = RULES_PRESETS.find((p) => p.id === req.presetId);
    if (preset) settings = { ...preset.config, ...req.settings };
  }
  validateSettings(settings);
  settings = normalizeSettings(settings);

  if (useMemory) {
    const lobby = memoryCreateLobby(hostUserId, settings);
    const seated = await autoSeatPlayer(lobby.id, hostUserId);
    if (!seated || 'error' in seated) return toSummary(lobby);
    return seated;
  }

  const db = getDb();
  const { customAlphabet } = await import('nanoid');
  const code = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 5)();

  // Create lobby and its empty seats atomically so a failure never leaves an orphaned lobby row.
  const lobby = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(lobbies)
      .values({ hostUserId, inviteCode: code, settings, status: 'open' })
      .returning();
    const seatRows = Array.from({ length: settings.maxPlayers }, (_, i) => ({
      lobbyId: row.id,
      seatIndex: i,
      stack: 0,
    }));
    await tx.insert(tableSeats).values(seatRows);
    return row;
  });

  const seated = await autoSeatPlayer(lobby.id, hostUserId);
  if (!seated || 'error' in seated) return (await pgToSummary(lobby.id))!;
  return seated;
}

/** Seat player at first open seat with the table buy-in. */
export async function autoSeatPlayer(
  lobbyId: string,
  userId: string,
  displayName?: string
): Promise<LobbySummary | { error: string; code?: string } | null> {
  const lobby = await getLobbyById(lobbyId);
  if (!lobby) return null;
  // Already seated — reclaiming an existing seat; skip name check
  if (lobby.seats.some((s) => s.userId === userId)) return lobby;
  const empty = lobby.seats.find((s) => !s.userId);
  if (!empty) return lobby;
  const buyIn = getTableBuyIn(lobby.settings);
  return sitAtSeat(lobbyId, userId, empty.seatIndex, buyIn, displayName);
}

export async function setTableBuyIn(
  lobbyId: string,
  hostUserId: string,
  buyIn: number
): Promise<LobbySummary | { error: string }> {
  const lobby = await getLobbyById(lobbyId);
  if (!lobby) return { error: 'Lobby not found' };
  if (lobby.hostUserId !== hostUserId) return { error: 'Only host can set buy-in' };
  if (!isValidBuyIn(buyIn)) {
    return { error: 'Buy-in must be between 10 and 10000 in increments of 5' };
  }
  const settings = normalizeSettings({ ...lobby.settings, buyIn });

  if (useMemory) {
    const mem = memoryStore.lobbies.get(lobbyId);
    if (!mem) return { error: 'Lobby not found' };
    mem.settings = settings;
    return toSummary(mem);
  }

  const db = getDb();
  await db.update(lobbies).set({ settings }).where(eq(lobbies.id, lobbyId));
  return (await getLobbyById(lobbyId))!;
}

export async function setFlipAnte(
  lobbyId: string,
  hostUserId: string,
  ante: number
): Promise<LobbySummary | { error: string }> {
  const lobby = await getLobbyById(lobbyId);
  if (!lobby) return { error: 'Lobby not found' };
  if (lobby.hostUserId !== hostUserId) return { error: 'Only host can set ante' };
  if (!isValidBuyIn(ante)) {
    return { error: 'Ante must be between 10 and 10000 in increments of 5' };
  }
  const settings: VariantConfig = { ...lobby.settings, twelveCardFlipAnte: ante };

  if (useMemory) {
    const mem = memoryStore.lobbies.get(lobbyId);
    if (!mem) return { error: 'Lobby not found' };
    mem.settings = settings;
    return toSummary(mem);
  }

  const db = getDb();
  await db.update(lobbies).set({ settings }).where(eq(lobbies.id, lobbyId));
  return (await getLobbyById(lobbyId))!;
}

/**
 * Set (or clear) the host's pending next-hand Bomb Pot. Amount must be a positive integer;
 * players who cannot cover it go all-in at hand start via normal side-pot handling.
 */
export async function setNextHandBombPot(
  lobbyId: string,
  hostUserId: string,
  value: { amount: number; doubleBoard: boolean } | null
): Promise<LobbySummary | { error: string }> {
  const lobby = await getLobbyById(lobbyId);
  if (!lobby) return { error: 'Lobby not found' };
  if (lobby.hostUserId !== hostUserId) return { error: 'Only host can set Bomb Pot' };
  if (lobby.settings.game === 'twelve_card_flip') return { error: 'Bomb Pot is not available for this game' };
  if (value && !isPositiveInteger(value.amount)) {
    return { error: 'Bomb Pot amount must be a positive integer' };
  }

  const settings: VariantConfig = {
    ...lobby.settings,
    nextHandBombPot: value ? { amount: value.amount, doubleBoard: !!value.doubleBoard } : undefined,
  };

  if (useMemory) {
    const mem = memoryStore.lobbies.get(lobbyId);
    if (!mem) return { error: 'Lobby not found' };
    mem.settings = settings;
    return toSummary(mem);
  }

  const db = getDb();
  await db.update(lobbies).set({ settings }).where(eq(lobbies.id, lobbyId));
  return (await getLobbyById(lobbyId))!;
}

/** Clear the pending next-hand Bomb Pot without a host check (one-shot reset after a hand resolves). */
export async function clearNextHandBombPot(lobbyId: string): Promise<void> {
  const lobby = await getLobbyById(lobbyId);
  if (!lobby || !lobby.settings.nextHandBombPot) return;
  const settings: VariantConfig = { ...lobby.settings, nextHandBombPot: undefined };
  if (useMemory) {
    const mem = memoryStore.lobbies.get(lobbyId);
    if (mem) mem.settings = settings;
    return;
  }
  const db = getDb();
  await db.update(lobbies).set({ settings }).where(eq(lobbies.id, lobbyId));
}

export async function getLobbyByInvite(code: string): Promise<LobbySummary | null> {
  if (useMemory) {
    const id = memoryStore.inviteIndex.get(code.toUpperCase()) ?? memoryStore.inviteIndex.get(code);
    if (!id) return null;
    const lobby = memoryStore.lobbies.get(id);
    return lobby ? toSummary(lobby) : null;
  }
  const db = getDb();
  const [lobby] = await db.select().from(lobbies).where(eq(lobbies.inviteCode, code)).limit(1);
  if (!lobby) return null;
  return pgToSummary(lobby.id);
}

export async function getLobbyById(id: string, connected?: Set<string>): Promise<LobbySummary | null> {
  if (useMemory) {
    const lobby = memoryStore.lobbies.get(id);
    return lobby ? toSummary(lobby, connected) : null;
  }
  return pgToSummary(id, connected);
}

export async function sitAtSeat(
  lobbyId: string,
  userId: string,
  seatIndex: number,
  buyIn?: number,
  displayName?: string
): Promise<LobbySummary | { error: string; code?: string }> {
  const lobby = await getLobbyById(lobbyId);
  if (!lobby) return { error: 'Lobby not found' };
  const amount = buyIn ?? getTableBuyIn(lobby.settings);
  if (!isValidBuyIn(amount)) {
    return { error: 'Buy-in must be between 10 and 10000 in increments of 5' };
  }
  if (amount !== getTableBuyIn(lobby.settings)) {
    return { error: 'Buy-in is set by the host' };
  }

  if (useMemory) {
    const mem = memoryStore.lobbies.get(lobbyId);
    if (!mem) return { error: 'Lobby not found' };
    const seat = mem.seats.find((s) => s.seatIndex === seatIndex);
    if (!seat) return { error: 'Invalid seat' };
    if (seat.userId) return { error: 'Seat taken' };
    if (mem.seats.some((s) => s.userId === userId)) return { error: 'Already seated' };
    // Name uniqueness check — runs synchronously so check+write is one atomic microtask
    if (displayName) {
      const normalizedNew = displayName.toLowerCase().trim();
      const collision = mem.seats.some((s) => {
        if (!s.userId || s.userId === userId) return false;
        const u = memoryStore.users.get(s.userId);
        return u?.displayName.toLowerCase().trim() === normalizedNew;
      });
      if (collision) {
        return {
          error: 'That name is already taken at this table. Please choose another name.',
          code: 'NAME_TAKEN',
        };
      }
    }
    seat.userId = userId;
    seat.stack = amount;
    return toSummary(mem);
  }

  const db = getDb();
  const seats = await db.select().from(tableSeats).where(eq(tableSeats.lobbyId, lobbyId));
  const seat = seats.find((s) => s.seatIndex === seatIndex);
  if (!seat) return { error: 'Invalid seat' };
  if (seat.userId) return { error: 'Seat taken' };
  if (seats.some((s) => s.userId === userId)) return { error: 'Already seated' };
  // Name uniqueness check (Postgres path — best-effort before the write)
  if (displayName) {
    const otherUserIds = seats
      .filter((s) => s.userId && s.userId !== userId)
      .map((s) => s.userId as string);
    if (otherUserIds.length > 0) {
      const seated = await db.select({ displayName: users.displayName }).from(users).where(inArray(users.id, otherUserIds));
      const normalizedNew = displayName.toLowerCase().trim();
      if (seated.some((u) => u.displayName.toLowerCase().trim() === normalizedNew)) {
        return {
          error: 'That name is already taken at this table. Please choose another name.',
          code: 'NAME_TAKEN',
        };
      }
    }
  }
  await db.update(tableSeats).set({ userId, stack: amount }).where(eq(tableSeats.id, seat.id));
  return (await getLobbyById(lobbyId))!;
}

export async function updateLobbyStatus(lobbyId: string, status: MemoryLobby['status']): Promise<void> {
  if (useMemory) {
    const lobby = memoryStore.lobbies.get(lobbyId);
    if (lobby) lobby.status = status;
    return;
  }
  const db = getDb();
  await db.update(lobbies).set({ status }).where(eq(lobbies.id, lobbyId));
}

export async function kickSeat(lobbyId: string, seatIndex: number): Promise<LobbySummary | null> {
  if (useMemory) {
    const lobby = memoryStore.lobbies.get(lobbyId);
    if (!lobby) return null;
    const seat = lobby.seats.find((s) => s.seatIndex === seatIndex);
    if (seat) {
      seat.userId = null;
      seat.stack = 0;
      seat.sitOutNextHand = false;
      seat.sitOutBlindOwed = false;
    }
    return toSummary(lobby);
  }
  const db = getDb();
  const seats = await db.select().from(tableSeats).where(eq(tableSeats.lobbyId, lobbyId));
  const seat = seats.find((s) => s.seatIndex === seatIndex);
  if (seat) {
    await db.update(tableSeats).set({ userId: null, stack: 0, sitOutNextHand: false, sitOutBlindOwed: false }).where(eq(tableSeats.id, seat.id));
  }
  return getLobbyById(lobbyId);
}

export async function approveRebuy(
  lobbyId: string,
  seatIndex: number,
  amount: number
): Promise<LobbySummary | null> {
  if (useMemory) {
    const lobby = memoryStore.lobbies.get(lobbyId);
    if (!lobby) return null;
    const seat = lobby.seats.find((s) => s.seatIndex === seatIndex);
    if (seat) seat.stack += amount;
    return toSummary(lobby);
  }
  const db = getDb();
  const seats = await db.select().from(tableSeats).where(eq(tableSeats.lobbyId, lobbyId));
  const seat = seats.find((s) => s.seatIndex === seatIndex);
  if (seat) {
    await db.update(tableSeats).set({ stack: seat.stack + amount }).where(eq(tableSeats.id, seat.id));
  }
  return getLobbyById(lobbyId);
}

export async function setSittingOut(
  lobbyId: string,
  userId: string,
  sittingOut: boolean
): Promise<LobbySummary | null> {
  if (useMemory) {
    const mem = memoryStore.lobbies.get(lobbyId);
    if (!mem) return null;
    const seat = mem.seats.find((s) => s.userId === userId);
    if (seat) seat.sittingOut = sittingOut;
    return toSummary(mem);
  }
  const db = getDb();
  await db
    .update(tableSeats)
    .set({ sittingOut })
    .where(and(eq(tableSeats.lobbyId, lobbyId), eq(tableSeats.userId, userId)));
  return getLobbyById(lobbyId);
}

export async function setActionTimerSetting(
  lobbyId: string,
  hostUserId: string,
  seconds: number
): Promise<LobbySummary | { error: string }> {
  const lobby = await getLobbyById(lobbyId);
  if (!lobby) return { error: 'Lobby not found' };
  if (lobby.hostUserId !== hostUserId) return { error: 'Only the host can change the action timer' };
  if (!TIMER_STEPS_SEC.includes(seconds as (typeof TIMER_STEPS_SEC)[number])) {
    return { error: `Timer must be one of: ${TIMER_STEPS_SEC.join(', ')} seconds` };
  }

  const settings: VariantConfig = {
    ...lobby.settings,
    actionTimerSec: seconds > 0 ? seconds : undefined,
  };

  if (useMemory) {
    const mem = memoryStore.lobbies.get(lobbyId);
    if (!mem) return { error: 'Lobby not found' };
    mem.settings = settings;
    return toSummary(mem);
  }

  const db = getDb();
  await db.update(lobbies).set({ settings }).where(eq(lobbies.id, lobbyId));
  return (await getLobbyById(lobbyId))!;
}

/**
 * Add chips to a busted player's seat. Only valid when the player is at 0 chips.
 * In Postgres mode we set stack = amount directly since table_seats.stack lags behind the game engine.
 */
export async function rebuyPlayer(lobbyId: string, userId: string, amount: number): Promise<LobbySummary | null> {
  if (useMemory) {
    const lobby = memoryStore.lobbies.get(lobbyId);
    if (!lobby) return null;
    const seat = lobby.seats.find((s) => s.userId === userId);
    if (seat) seat.stack = amount;
    return toSummary(lobby);
  }
  const db = getDb();
  const seats = await db.select().from(tableSeats).where(eq(tableSeats.lobbyId, lobbyId));
  const seat = seats.find((s) => s.userId === userId);
  if (seat) {
    await db.update(tableSeats).set({ stack: amount }).where(eq(tableSeats.id, seat.id));
  }
  return getLobbyById(lobbyId);
}

export async function removeSeat(lobbyId: string, userId: string): Promise<LobbySummary | null> {
  if (useMemory) {
    const mem = memoryStore.lobbies.get(lobbyId);
    if (!mem) return null;
    const seat = mem.seats.find((s) => s.userId === userId);
    if (seat) {
      seat.userId = null;
      seat.stack = 0;
      seat.sittingOut = false;
      seat.sitOutNextHand = false;
      seat.sitOutBlindOwed = false;
    }
    return toSummary(mem);
  }
  const db = getDb();
  const seats = await db.select().from(tableSeats).where(eq(tableSeats.lobbyId, lobbyId));
  const seat = seats.find((s) => s.userId === userId);
  if (seat) {
    await db
      .update(tableSeats)
      .set({ userId: null, stack: 0, sittingOut: false, sitOutNextHand: false, sitOutBlindOwed: false })
      .where(eq(tableSeats.id, seat.id));
  }
  return getLobbyById(lobbyId);
}

export async function clearSitOutBlindOwed(lobbyId: string, userId: string): Promise<void> {
  if (useMemory) {
    const mem = memoryStore.lobbies.get(lobbyId);
    if (!mem) return;
    const seat = mem.seats.find((s) => s.userId === userId);
    if (seat) seat.sitOutBlindOwed = false;
    return;
  }
  const db = getDb();
  await db
    .update(tableSeats)
    .set({ sitOutBlindOwed: false })
    .where(and(eq(tableSeats.lobbyId, lobbyId), eq(tableSeats.userId, userId)));
}

export async function setSitOutNextHand(
  lobbyId: string,
  userId: string,
  enabled: boolean
): Promise<LobbySummary | null> {
  if (useMemory) {
    const mem = memoryStore.lobbies.get(lobbyId);
    if (!mem) return null;
    const seat = mem.seats.find((s) => s.userId === userId);
    if (seat) {
      seat.sitOutNextHand = enabled;
      // When enabling: set blindOwed so they post one final blind cycle first.
      // When disabling: clear both flags — player returns to normal rotation.
      seat.sitOutBlindOwed = enabled ? true : false;
    }
    return toSummary(mem);
  }
  const db = getDb();
  await db
    .update(tableSeats)
    .set({ sitOutNextHand: enabled, sitOutBlindOwed: enabled ? true : false })
    .where(and(eq(tableSeats.lobbyId, lobbyId), eq(tableSeats.userId, userId)));
  return getLobbyById(lobbyId);
}

/**
 * Find the active reserved seat for a user across all open/playing/paused lobbies.
 * Returns null if the user has no seat or their only seat is in a closed lobby.
 */
export async function getActiveSeatForUser(userId: string): Promise<ActiveSeatInfo | null> {
  if (useMemory) {
    for (const [lobbyId, lobby] of memoryStore.lobbies) {
      if (lobby.status === 'closed') continue;
      const seat = lobby.seats.find((s) => s.userId === userId);
      if (!seat) continue;

      // Find the most-recent disconnectedAt for this user+lobby from sessions
      let disconnectedAt: Date | null = null;
      for (const s of memoryStore.sessions.values()) {
        if (s.userId !== userId || s.lobbyId !== lobbyId || !s.disconnectedAt) continue;
        const dt = new Date(s.disconnectedAt);
        if (!disconnectedAt || dt > disconnectedAt) disconnectedAt = dt;
      }
      const expiresAt = disconnectedAt ? new Date(disconnectedAt.getTime() + SEAT_RELEASE_MS) : null;
      if (expiresAt && expiresAt < new Date()) return null;

      const host = lobby.hostUserId ? memoryStore.users.get(lobby.hostUserId) : undefined;
      return {
        lobbyId,
        inviteCode: lobby.inviteCode,
        hostDisplayName: host?.displayName ?? 'Host',
        seatIndex: seat.seatIndex,
        stack: seat.stack,
        disconnectedAt: disconnectedAt?.toISOString() ?? null,
        expiresAt: expiresAt?.toISOString() ?? null,
      };
    }
    return null;
  }

  const db = getDb();
  const rows = await db
    .select({
      lobbyId: tableSeats.lobbyId,
      seatIndex: tableSeats.seatIndex,
      stack: tableSeats.stack,
      inviteCode: lobbies.inviteCode,
      status: lobbies.status,
      hostUserId: lobbies.hostUserId,
    })
    .from(tableSeats)
    .innerJoin(lobbies, eq(tableSeats.lobbyId, lobbies.id))
    .where(and(eq(tableSeats.userId, userId), ne(lobbies.status, 'closed')))
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];

  const [host] = row.hostUserId
    ? await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, row.hostUserId)).limit(1)
    : [];

  const [sessRow] = await db
    .select({ disconnectedAt: playerSessions.disconnectedAt })
    .from(playerSessions)
    .where(and(eq(playerSessions.userId, userId), eq(playerSessions.lobbyId, row.lobbyId)))
    .orderBy(desc(playerSessions.createdAt))
    .limit(1);
  const disconnectedAt = sessRow?.disconnectedAt ?? null;
  const expiresAt = disconnectedAt ? new Date(disconnectedAt.getTime() + SEAT_RELEASE_MS) : null;
  if (expiresAt && expiresAt < new Date()) return null;

  return {
    lobbyId: row.lobbyId,
    inviteCode: row.inviteCode,
    hostDisplayName: host?.displayName ?? 'Host',
    seatIndex: row.seatIndex,
    stack: row.stack,
    disconnectedAt: disconnectedAt?.toISOString() ?? null,
    expiresAt: expiresAt?.toISOString() ?? null,
  };
}

export function isMemoryMode(): boolean {
  return useMemory;
}

export function getMemoryLobby(id: string): MemoryLobby | undefined {
  return memoryStore.lobbies.get(id);
}

/** Returns IDs of all lobbies currently in 'playing' or 'paused' status. */
export async function getActiveLobbyIds(): Promise<string[]> {
  if (useMemory) {
    return [...memoryStore.lobbies.values()]
      .filter((l) => l.status === 'playing' || l.status === 'paused')
      .map((l) => l.id);
  }
  const db = getDb();
  const rows = await db
    .select({ id: lobbies.id })
    .from(lobbies)
    .where(inArray(lobbies.status, ['playing', 'paused']));
  return rows.map((r) => r.id);
}

/**
 * Bulk-update seat stacks by userId for a lobby.
 * Used at startup to restore pre-hand chip counts after an interrupted hand is cancelled.
 */
export async function restorePreHandStacks(
  lobbyId: string,
  stacksByUserId: Map<string, number>
): Promise<void> {
  if (useMemory) {
    const mem = memoryStore.lobbies.get(lobbyId);
    if (!mem) return;
    for (const seat of mem.seats) {
      if (seat.userId && stacksByUserId.has(seat.userId)) {
        seat.stack = stacksByUserId.get(seat.userId)!;
      }
    }
    return;
  }
  const db = getDb();
  for (const [userId, stack] of stacksByUserId) {
    await db
      .update(tableSeats)
      .set({ stack })
      .where(and(eq(tableSeats.lobbyId, lobbyId), eq(tableSeats.userId, userId)));
  }
}
