import type { CreateLobbyRequest, LobbySummary, TableSeat, VariantConfig } from '@vct/shared-types';
import { DEFAULT_VARIANT_CONFIG, RULES_PRESETS, TIMER_STEPS_SEC, getTableBuyIn } from '@vct/shared-types';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { lobbies, tableSeats, users } from '../db/schema.js';
import {
  memoryCreateLobby,
  memoryStore,
  type MemoryLobby,
} from '../store/memory-fallback.js';
import { initAuthStore } from './auth.js';

let useMemory = false;

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
  } catch {
    useMemory = true;
  }
}

function toSummary(lobby: MemoryLobby, connected: Set<string> = new Set()): LobbySummary {
  const hostDisplayName = memoryStore.users.get(lobby.hostUserId)?.displayName ?? 'Host';
  return {
    id: lobby.id,
    inviteCode: lobby.inviteCode,
    hostUserId: lobby.hostUserId,
    hostDisplayName,
    status: lobby.status,
    settings: lobby.settings,
    seats: lobby.seats.map((s) => ({
      seatIndex: s.seatIndex,
      userId: s.userId,
      displayName: s.userId ? memoryStore.users.get(s.userId)?.displayName ?? null : null,
      stack: s.stack,
      sittingOut: s.sittingOut,
      isConnected: s.userId ? connected.has(s.userId) : false,
    })),
    createdAt: lobby.createdAt,
  };
}

async function pgToSummary(lobbyId: string, connected: Set<string> = new Set()): Promise<LobbySummary | null> {
  const db = getDb();
  const [lobby] = await db.select().from(lobbies).where(eq(lobbies.id, lobbyId)).limit(1);
  if (!lobby) return null;
  const [host] = await db.select().from(users).where(eq(users.id, lobby.hostUserId)).limit(1);
  const seats = await db.select().from(tableSeats).where(eq(tableSeats.lobbyId, lobbyId));
  const seatSummaries: TableSeat[] = [];
  for (const s of seats) {
    let displayName: string | null = null;
    if (s.userId) {
      const [u] = await db.select().from(users).where(eq(users.id, s.userId)).limit(1);
      displayName = u?.displayName ?? null;
    }
    seatSummaries.push({
      seatIndex: s.seatIndex,
      userId: s.userId,
      displayName,
      stack: s.stack,
      sittingOut: s.sittingOut,
      isConnected: s.userId ? connected.has(s.userId) : false,
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
  const [lobby] = await db
    .insert(lobbies)
    .values({ hostUserId, inviteCode: code, settings, status: 'open' })
    .returning();

  const seatRows = Array.from({ length: settings.maxPlayers }, (_, i) => ({
    lobbyId: lobby.id,
    seatIndex: i,
    stack: 0,
  }));
  await db.insert(tableSeats).values(seatRows);
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
    }
    return toSummary(lobby);
  }
  const db = getDb();
  const seats = await db.select().from(tableSeats).where(eq(tableSeats.lobbyId, lobbyId));
  const seat = seats.find((s) => s.seatIndex === seatIndex);
  if (seat) {
    await db.update(tableSeats).set({ userId: null, stack: 0 }).where(eq(tableSeats.id, seat.id));
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
    }
    return toSummary(mem);
  }
  const db = getDb();
  const seats = await db.select().from(tableSeats).where(eq(tableSeats.lobbyId, lobbyId));
  const seat = seats.find((s) => s.userId === userId);
  if (seat) {
    await db
      .update(tableSeats)
      .set({ userId: null, stack: 0, sittingOut: false })
      .where(eq(tableSeats.id, seat.id));
  }
  return getLobbyById(lobbyId);
}

export function isMemoryMode(): boolean {
  return useMemory;
}

export function getMemoryLobby(id: string): MemoryLobby | undefined {
  return memoryStore.lobbies.get(id);
}
