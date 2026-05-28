import type { CreateLobbyRequest, LobbySummary, TableSeat, VariantConfig } from '@vct/shared-types';
import { DEFAULT_VARIANT_CONFIG, RULES_PRESETS } from '@vct/shared-types';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { lobbies, tableSeats, users } from '../db/schema.js';
import {
  memoryCreateLobby,
  memoryStore,
  type MemoryLobby,
} from '../store/memory-fallback.js';
import { initAuthStore } from './auth.js';

let useMemory = false;

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
  return {
    id: lobby.id,
    inviteCode: lobby.inviteCode,
    hostUserId: lobby.hostUserId,
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
    status: lobby.status as LobbySummary['status'],
    settings: lobby.settings as VariantConfig,
    seats: seatSummaries,
    createdAt: lobby.createdAt.toISOString(),
  };
}

export async function createLobby(hostUserId: string, req: CreateLobbyRequest): Promise<LobbySummary> {
  let settings: VariantConfig = req.settings ?? DEFAULT_VARIANT_CONFIG;
  if (req.presetId) {
    const preset = RULES_PRESETS.find((p) => p.id === req.presetId);
    if (preset) settings = preset.config;
  }

  if (useMemory) {
    const lobby = memoryCreateLobby(hostUserId, settings);
    return toSummary(lobby);
  }

  const db = getDb();
  const { customAlphabet } = await import('nanoid');
  const code = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8)();
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
  return (await pgToSummary(lobby.id))!;
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
  buyIn: number
): Promise<LobbySummary | { error: string }> {
  if (useMemory) {
    const lobby = memoryStore.lobbies.get(lobbyId);
    if (!lobby) return { error: 'Lobby not found' };
    const seat = lobby.seats.find((s) => s.seatIndex === seatIndex);
    if (!seat) return { error: 'Invalid seat' };
    if (seat.userId) return { error: 'Seat taken' };
    if (buyIn < lobby.settings.minBuyIn || buyIn > lobby.settings.maxBuyIn) {
      return { error: 'Buy-in out of range' };
    }
    if (lobby.seats.some((s) => s.userId === userId)) return { error: 'Already seated' };
    seat.userId = userId;
    seat.stack = buyIn;
    return toSummary(lobby);
  }

  const db = getDb();
  const summary = await getLobbyById(lobbyId);
  if (!summary) return { error: 'Lobby not found' };
  if (buyIn < summary.settings.minBuyIn || buyIn > summary.settings.maxBuyIn) {
    return { error: 'Buy-in out of range' };
  }
  await db
    .update(tableSeats)
    .set({ userId, stack: buyIn })
    .where(eq(tableSeats.lobbyId, lobbyId));
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

export function isMemoryMode(): boolean {
  return useMemory;
}

export function getMemoryLobby(id: string): MemoryLobby | undefined {
  return memoryStore.lobbies.get(id);
}
