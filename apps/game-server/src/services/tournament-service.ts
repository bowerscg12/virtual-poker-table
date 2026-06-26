import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import {
  tournaments,
  tournamentRegistrations,
  tournamentTemplates,
  users,
} from '../db/schema.js';
import type {
  BlindLevel,
  LeaderboardEntry,
  PublicTournamentState,
  TournamentSettings,
  TournamentSummary,
  TournamentTemplate,
  CreateTournamentTemplateRequest,
} from '@vct/shared-types';
import { memoryStore } from '../store/memory-fallback.js';
import { isMemoryMode } from './lobby.js';
import { randomUUID } from 'crypto';
import { customAlphabet } from 'nanoid';

const nanoidTournament = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 6);

export const MAX_TOURNAMENT_TEMPLATES = 20;
export const MIN_PLAYERS_TO_START = 6;

// ── In-memory fallback stores ──────────────────────────────────────────────

interface MemoryTournament {
  id: string;
  hostUserId: string;
  inviteCode: string;
  status: 'waiting' | 'running' | 'finished' | 'cancelled';
  variant: string;
  buyIn: number;
  startingStack: number;
  numTables: number;
  seatsPerTable: number;
  scheduledStart: Date;
  blindSchedule: BlindLevel[];
  prizePool: number;
  currentBlindLevel: number;
  blindLevelStartedAt: Date | null;
  createdAt: Date;
}

interface MemoryRegistration {
  id: string;
  tournamentId: string;
  userId: string;
  displayName: string;
  registrationOrder: number;
  tableLobbyId: string | null;
  seatIndex: number | null;
  currentStack: number | null;
  bustPosition: number | null;
  prizeAwarded: number | null;
  status: 'registered' | 'active' | 'eliminated';
  registeredAt: Date;
}

interface MemoryTournamentTemplate {
  id: string;
  userId: string;
  name: string;
  settings: TournamentSettings;
  createdAt: Date;
}

export const memoryTournaments = new Map<string, MemoryTournament>();
export const memoryRegistrations = new Map<string, MemoryRegistration[]>();
export const memoryTournamentTemplates = new Map<string, MemoryTournamentTemplate[]>();

// ── Chip wallet ─────────────────────────────────────────────────────────────

export async function getChipBalance(userId: string): Promise<{ chipBalance: number; lastDailyClaim: string | null }> {
  if (isMemoryMode()) {
    const u = memoryStore.users.get(userId);
    return { chipBalance: u?.chipBalance ?? 5000, lastDailyClaim: u?.lastDailyClaim ?? null };
  }
  const db = getDb();
  const [row] = await db
    .select({ chipBalance: users.chipBalance, lastDailyClaim: users.lastDailyClaim })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return {
    chipBalance: row?.chipBalance ?? 5000,
    lastDailyClaim: row?.lastDailyClaim?.toISOString() ?? null,
  };
}

export async function claimDailyChips(userId: string): Promise<{ chipBalance: number } | { error: string }> {
  const now = new Date();
  const todayUTC = now.toISOString().slice(0, 10);

  if (isMemoryMode()) {
    const u = memoryStore.users.get(userId);
    if (!u) return { error: 'User not found' };
    if (u.lastDailyClaim) {
      const claimDay = u.lastDailyClaim.slice(0, 10);
      if (claimDay === todayUTC) return { error: 'Already claimed today' };
    }
    u.chipBalance = (u.chipBalance ?? 5000) + 1000;
    u.lastDailyClaim = now.toISOString();
    return { chipBalance: u.chipBalance };
  }

  const db = getDb();
  const [row] = await db.select({ chipBalance: users.chipBalance, lastDailyClaim: users.lastDailyClaim }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) return { error: 'User not found' };
  if (row.lastDailyClaim) {
    const claimDay = row.lastDailyClaim.toISOString().slice(0, 10);
    if (claimDay === todayUTC) return { error: 'Already claimed today' };
  }
  const [updated] = await db
    .update(users)
    .set({ chipBalance: (row.chipBalance ?? 5000) + 1000, lastDailyClaim: now })
    .where(eq(users.id, userId))
    .returning({ chipBalance: users.chipBalance });
  return { chipBalance: updated.chipBalance };
}

export async function deductChips(userId: string, amount: number): Promise<boolean> {
  if (isMemoryMode()) {
    const u = memoryStore.users.get(userId);
    if (!u || u.chipBalance < amount) return false;
    u.chipBalance -= amount;
    return true;
  }
  const db = getDb();
  const [row] = await db.select({ chipBalance: users.chipBalance }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row || row.chipBalance < amount) return false;
  await db.update(users).set({ chipBalance: row.chipBalance - amount }).where(eq(users.id, userId));
  return true;
}

export async function addChips(userId: string, amount: number): Promise<void> {
  if (isMemoryMode()) {
    const u = memoryStore.users.get(userId);
    if (u) u.chipBalance += amount;
    return;
  }
  const db = getDb();
  const [row] = await db.select({ chipBalance: users.chipBalance }).from(users).where(eq(users.id, userId)).limit(1);
  if (row) {
    await db.update(users).set({ chipBalance: row.chipBalance + amount }).where(eq(users.id, userId));
  }
}

export const LOW_CHIP_THRESHOLD = 1000;
export const LOW_CHIP_BONUS = 2000;
export const LOW_CHIP_COOLDOWN_DAYS = 7;

export async function claimLowChipBonus(userId: string): Promise<{ chipBalance: number } | { error: string }> {
  const now = new Date();

  if (isMemoryMode()) {
    const u = memoryStore.users.get(userId);
    if (!u) return { error: 'User not found' };
    if ((u.chipBalance ?? 5000) >= LOW_CHIP_THRESHOLD) return { error: 'Balance is above the low-chip threshold' };
    if (u.lastLowChipClaim) {
      const daysSince = (now.getTime() - new Date(u.lastLowChipClaim).getTime()) / 86_400_000;
      if (daysSince < LOW_CHIP_COOLDOWN_DAYS) {
        const daysLeft = Math.ceil(LOW_CHIP_COOLDOWN_DAYS - daysSince);
        return { error: `Recovery bonus available again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` };
      }
    }
    u.chipBalance = (u.chipBalance ?? 0) + LOW_CHIP_BONUS;
    u.lastLowChipClaim = now.toISOString();
    return { chipBalance: u.chipBalance };
  }

  const db = getDb();
  const [row] = await db.select({ chipBalance: users.chipBalance, lastLowChipClaim: users.lastLowChipClaim }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) return { error: 'User not found' };
  if (row.chipBalance >= LOW_CHIP_THRESHOLD) return { error: 'Balance is above the low-chip threshold' };
  if (row.lastLowChipClaim) {
    const daysSince = (now.getTime() - row.lastLowChipClaim.getTime()) / 86_400_000;
    if (daysSince < LOW_CHIP_COOLDOWN_DAYS) {
      const daysLeft = Math.ceil(LOW_CHIP_COOLDOWN_DAYS - daysSince);
      return { error: `Recovery bonus available again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` };
    }
  }
  const [updated] = await db
    .update(users)
    .set({ chipBalance: row.chipBalance + LOW_CHIP_BONUS, lastLowChipClaim: now })
    .where(eq(users.id, userId))
    .returning({ chipBalance: users.chipBalance });
  return { chipBalance: updated.chipBalance };
}

export interface TournamentStatsUpdate {
  played: boolean;
  cashed: boolean;
  won: boolean;
  finish: number;
  earnings: number;
}

export async function updateTournamentStats(userId: string, update: TournamentStatsUpdate): Promise<void> {
  if (isMemoryMode()) {
    const u = memoryStore.users.get(userId);
    if (!u) return;
    if (update.played) u.tournamentsPlayed = (u.tournamentsPlayed ?? 0) + 1;
    if (update.cashed) u.tournamentCashes = (u.tournamentCashes ?? 0) + 1;
    if (update.won) u.tournamentWins = (u.tournamentWins ?? 0) + 1;
    if (u.bestTournamentFinish === null || update.finish < u.bestTournamentFinish) u.bestTournamentFinish = update.finish;
    u.totalTournamentEarnings = (u.totalTournamentEarnings ?? 0) + update.earnings;
    return;
  }
  const db = getDb();
  const [row] = await db.select({
    tournamentsPlayed: users.tournamentsPlayed,
    tournamentCashes: users.tournamentCashes,
    tournamentWins: users.tournamentWins,
    bestTournamentFinish: users.bestTournamentFinish,
    totalTournamentEarnings: users.totalTournamentEarnings,
  }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) return;
  await db.update(users).set({
    tournamentsPlayed: row.tournamentsPlayed + (update.played ? 1 : 0),
    tournamentCashes: row.tournamentCashes + (update.cashed ? 1 : 0),
    tournamentWins: row.tournamentWins + (update.won ? 1 : 0),
    bestTournamentFinish: (row.bestTournamentFinish === null || update.finish < row.bestTournamentFinish)
      ? update.finish
      : row.bestTournamentFinish,
    totalTournamentEarnings: row.totalTournamentEarnings + update.earnings,
  }).where(eq(users.id, userId));
}

export interface TournamentUserStats {
  tournamentsPlayed: number;
  tournamentCashes: number;
  tournamentWins: number;
  bestTournamentFinish: number | null;
  totalTournamentEarnings: number;
  itmPercent: number;
}

export async function getTournamentStats(userId: string): Promise<TournamentUserStats> {
  if (isMemoryMode()) {
    const u = memoryStore.users.get(userId);
    const played = u?.tournamentsPlayed ?? 0;
    const cashes = u?.tournamentCashes ?? 0;
    return {
      tournamentsPlayed: played,
      tournamentCashes: cashes,
      tournamentWins: u?.tournamentWins ?? 0,
      bestTournamentFinish: u?.bestTournamentFinish ?? null,
      totalTournamentEarnings: u?.totalTournamentEarnings ?? 0,
      itmPercent: played > 0 ? Math.round((cashes / played) * 100) : 0,
    };
  }
  const db = getDb();
  const [row] = await db.select({
    tournamentsPlayed: users.tournamentsPlayed,
    tournamentCashes: users.tournamentCashes,
    tournamentWins: users.tournamentWins,
    bestTournamentFinish: users.bestTournamentFinish,
    totalTournamentEarnings: users.totalTournamentEarnings,
  }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) return { tournamentsPlayed: 0, tournamentCashes: 0, tournamentWins: 0, bestTournamentFinish: null, totalTournamentEarnings: 0, itmPercent: 0 };
  const played = row.tournamentsPlayed;
  const cashes = row.tournamentCashes;
  return {
    tournamentsPlayed: played,
    tournamentCashes: cashes,
    tournamentWins: row.tournamentWins,
    bestTournamentFinish: row.bestTournamentFinish,
    totalTournamentEarnings: row.totalTournamentEarnings,
    itmPercent: played > 0 ? Math.round((cashes / played) * 100) : 0,
  };
}

export interface LeaderboardUser {
  rank: number;
  userId: string;
  displayName: string;
  chipBalance: number;
}

export async function getGlobalLeaderboard(): Promise<LeaderboardUser[]> {
  if (isMemoryMode()) {
    return [...memoryStore.users.values()]
      .filter((u) => !u.isGuest && !u.isBot)
      .sort((a, b) => (b.chipBalance ?? 0) - (a.chipBalance ?? 0))
      .slice(0, 25)
      .map((u, i) => ({ rank: i + 1, userId: u.id, displayName: u.displayName, chipBalance: u.chipBalance ?? 0 }));
  }
  const db = getDb();
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, chipBalance: users.chipBalance })
    .from(users)
    .where(and(eq(users.isGuest, false), eq(users.isBot, false)))
    .orderBy(desc(users.chipBalance))
    .limit(25);
  return rows.map((r, i) => ({ rank: i + 1, userId: r.id, displayName: r.displayName, chipBalance: r.chipBalance }));
}

// ── Prize calculation ────────────────────────────────────────────────────────

export function calcNumPrizeSpots(playerCount: number): number {
  return Math.max(1, Math.floor(playerCount * 0.15));
}

export function calcPrizePool(playerCount: number, buyIn: number): number {
  return Math.floor(playerCount * buyIn * 1.5);
}

export function calcPrize(prizePool: number, numSpots: number, placement: number): number {
  if (numSpots <= 0 || placement > numSpots) return 0;
  if (numSpots === 1) return prizePool;
  if (numSpots === 2) return placement === 1 ? Math.floor(prizePool * 0.75) : Math.floor(prizePool * 0.25);
  // 3+ spots: 50% to 1st, 30% to 2nd, remaining 20% split evenly among spots 3+
  if (placement === 1) return Math.floor(prizePool * 0.50);
  if (placement === 2) return Math.floor(prizePool * 0.30);
  const remainingSpots = numSpots - 2;
  return Math.floor((prizePool * 0.20) / remainingSpots);
}

// ── Tournament CRUD ──────────────────────────────────────────────────────────

export async function createTournament(hostUserId: string, settings: TournamentSettings): Promise<{ id: string; inviteCode: string }> {
  const inviteCode = nanoidTournament();

  if (isMemoryMode()) {
    const t: MemoryTournament = {
      id: randomUUID(),
      hostUserId,
      inviteCode,
      status: 'waiting',
      variant: settings.variant,
      buyIn: settings.buyIn,
      startingStack: settings.startingStack,
      numTables: settings.numTables,
      seatsPerTable: settings.seatsPerTable,
      scheduledStart: new Date(settings.scheduledStart),
      blindSchedule: settings.blindSchedule,
      prizePool: 0,
      currentBlindLevel: 0,
      blindLevelStartedAt: null,
      createdAt: new Date(),
    };
    memoryTournaments.set(t.id, t);
    memoryRegistrations.set(t.id, []);
    return { id: t.id, inviteCode };
  }

  const db = getDb();
  const [row] = await db
    .insert(tournaments)
    .values({
      hostUserId,
      inviteCode,
      status: 'waiting',
      variant: settings.variant,
      buyIn: settings.buyIn,
      startingStack: settings.startingStack,
      numTables: settings.numTables,
      seatsPerTable: settings.seatsPerTable,
      scheduledStart: new Date(settings.scheduledStart),
      blindSchedule: settings.blindSchedule,
      prizePool: 0,
      currentBlindLevel: 0,
    })
    .returning({ id: tournaments.id, inviteCode: tournaments.inviteCode });
  return { id: row.id, inviteCode: row.inviteCode };
}

export async function getTournamentById(id: string): Promise<(MemoryTournament & { registrations: MemoryRegistration[] }) | null> {
  if (isMemoryMode()) {
    const t = memoryTournaments.get(id);
    if (!t) return null;
    return { ...t, registrations: memoryRegistrations.get(id) ?? [] };
  }
  const db = getDb();
  const [row] = await db.select().from(tournaments).where(eq(tournaments.id, id)).limit(1);
  if (!row) return null;
  const regs = await db.select().from(tournamentRegistrations).where(eq(tournamentRegistrations.tournamentId, id));
  return {
    id: row.id,
    hostUserId: row.hostUserId,
    inviteCode: row.inviteCode,
    status: row.status as MemoryTournament['status'],
    variant: row.variant,
    buyIn: row.buyIn,
    startingStack: row.startingStack,
    numTables: row.numTables,
    seatsPerTable: row.seatsPerTable,
    scheduledStart: row.scheduledStart,
    blindSchedule: row.blindSchedule as BlindLevel[],
    prizePool: row.prizePool,
    currentBlindLevel: row.currentBlindLevel,
    blindLevelStartedAt: row.blindLevelStartedAt,
    createdAt: row.createdAt,
    registrations: regs.map((r) => ({
      id: r.id,
      tournamentId: r.tournamentId,
      userId: r.userId,
      displayName: r.displayName,
      registrationOrder: r.registrationOrder,
      tableLobbyId: r.tableLobbyId,
      seatIndex: r.seatIndex,
      currentStack: r.currentStack,
      bustPosition: r.bustPosition,
      prizeAwarded: r.prizeAwarded,
      status: r.status as MemoryRegistration['status'],
      registeredAt: r.registeredAt,
    })),
  };
}

export async function getTournamentByInviteCode(code: string): Promise<string | null> {
  if (isMemoryMode()) {
    for (const [id, t] of memoryTournaments) {
      if (t.inviteCode === code.toUpperCase()) return id;
    }
    return null;
  }
  const db = getDb();
  const [row] = await db.select({ id: tournaments.id }).from(tournaments).where(eq(tournaments.inviteCode, code.toUpperCase())).limit(1);
  return row?.id ?? null;
}

export async function listWaitingTournaments(): Promise<TournamentSummary[]> {
  if (isMemoryMode()) {
    return [...memoryTournaments.values()]
      .filter((t) => t.status === 'waiting')
      .map((t) => ({
        id: t.id,
        inviteCode: t.inviteCode,
        status: t.status,
        variant: t.variant,
        buyIn: t.buyIn,
        startingStack: t.startingStack,
        scheduledStart: t.scheduledStart.toISOString(),
        registeredCount: (memoryRegistrations.get(t.id) ?? []).length,
        maxPlayers: t.numTables * t.seatsPerTable,
      }));
  }
  const db = getDb();
  const rows = await db.select().from(tournaments).where(eq(tournaments.status, 'waiting'));
  const result: TournamentSummary[] = [];
  for (const row of rows) {
    const regs = await db
      .select({ count: tournamentRegistrations.id })
      .from(tournamentRegistrations)
      .where(eq(tournamentRegistrations.tournamentId, row.id));
    result.push({
      id: row.id,
      inviteCode: row.inviteCode,
      status: row.status,
      variant: row.variant,
      buyIn: row.buyIn,
      startingStack: row.startingStack,
      scheduledStart: row.scheduledStart.toISOString(),
      registeredCount: regs.length,
      maxPlayers: row.numTables * row.seatsPerTable,
    });
  }
  return result;
}

export async function registerForTournament(
  tournamentId: string,
  userId: string,
  displayName: string
): Promise<{ ok: true } | { error: string }> {
  if (isMemoryMode()) {
    const t = memoryTournaments.get(tournamentId);
    if (!t) return { error: 'Tournament not found' };
    if (t.status !== 'waiting') return { error: 'Tournament is not open for registration' };
    const regs = memoryRegistrations.get(tournamentId) ?? [];
    if (regs.some((r) => r.userId === userId)) return { error: 'Already registered' };
    if (regs.length >= t.numTables * t.seatsPerTable) return { error: 'Tournament is full' };
    const deducted = await deductChips(userId, t.buyIn);
    if (!deducted) return { error: 'Insufficient chips' };
    regs.push({
      id: randomUUID(),
      tournamentId,
      userId,
      displayName,
      registrationOrder: regs.length + 1,
      tableLobbyId: null,
      seatIndex: null,
      currentStack: null,
      bustPosition: null,
      prizeAwarded: null,
      status: 'registered',
      registeredAt: new Date(),
    });
    memoryRegistrations.set(tournamentId, regs);
    return { ok: true };
  }
  const db = getDb();
  const [t] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1);
  if (!t) return { error: 'Tournament not found' };
  if (t.status !== 'waiting') return { error: 'Tournament is not open for registration' };
  const existing = await db
    .select({ id: tournamentRegistrations.id })
    .from(tournamentRegistrations)
    .where(and(eq(tournamentRegistrations.tournamentId, tournamentId), eq(tournamentRegistrations.userId, userId)))
    .limit(1);
  if (existing.length > 0) return { error: 'Already registered' };
  const regCount = await db
    .select({ id: tournamentRegistrations.id })
    .from(tournamentRegistrations)
    .where(eq(tournamentRegistrations.tournamentId, tournamentId));
  if (regCount.length >= t.numTables * t.seatsPerTable) return { error: 'Tournament is full' };
  const deducted = await deductChips(userId, t.buyIn);
  if (!deducted) return { error: 'Insufficient chips' };
  await db.insert(tournamentRegistrations).values({
    tournamentId,
    userId,
    displayName,
    registrationOrder: regCount.length + 1,
    status: 'registered',
  });
  return { ok: true };
}

export async function unregisterFromTournament(
  tournamentId: string,
  userId: string
): Promise<{ ok: true } | { error: string }> {
  if (isMemoryMode()) {
    const t = memoryTournaments.get(tournamentId);
    if (!t) return { error: 'Tournament not found' };
    if (t.status !== 'waiting') return { error: 'Cannot leave a tournament that has already started' };
    const regs = memoryRegistrations.get(tournamentId) ?? [];
    const idx = regs.findIndex((r) => r.userId === userId);
    if (idx === -1) return { error: 'Not registered' };
    regs.splice(idx, 1);
    await addChips(userId, t.buyIn);
    return { ok: true };
  }
  const db = getDb();
  const [t] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1);
  if (!t) return { error: 'Tournament not found' };
  if (t.status !== 'waiting') return { error: 'Cannot leave a tournament that has already started' };
  const result = await db
    .delete(tournamentRegistrations)
    .where(and(eq(tournamentRegistrations.tournamentId, tournamentId), eq(tournamentRegistrations.userId, userId)))
    .returning({ id: tournamentRegistrations.id });
  if (result.length === 0) return { error: 'Not registered' };
  await addChips(userId, t.buyIn);
  return { ok: true };
}

export async function updateTournamentStatus(
  tournamentId: string,
  status: MemoryTournament['status']
): Promise<void> {
  if (isMemoryMode()) {
    const t = memoryTournaments.get(tournamentId);
    if (t) t.status = status;
    return;
  }
  const db = getDb();
  await db.update(tournaments).set({ status }).where(eq(tournaments.id, tournamentId));
}

export async function updateTournamentPrizePool(tournamentId: string, prizePool: number): Promise<void> {
  if (isMemoryMode()) {
    const t = memoryTournaments.get(tournamentId);
    if (t) t.prizePool = prizePool;
    return;
  }
  const db = getDb();
  await db.update(tournaments).set({ prizePool }).where(eq(tournaments.id, tournamentId));
}

export async function updateTournamentBlindLevel(
  tournamentId: string,
  level: number,
  startedAt: Date
): Promise<void> {
  if (isMemoryMode()) {
    const t = memoryTournaments.get(tournamentId);
    if (t) { t.currentBlindLevel = level; t.blindLevelStartedAt = startedAt; }
    return;
  }
  const db = getDb();
  await db
    .update(tournaments)
    .set({ currentBlindLevel: level, blindLevelStartedAt: startedAt })
    .where(eq(tournaments.id, tournamentId));
}

export async function updateRegistration(
  tournamentId: string,
  userId: string,
  update: Partial<Pick<MemoryRegistration, 'tableLobbyId' | 'seatIndex' | 'currentStack' | 'bustPosition' | 'prizeAwarded' | 'status'>>
): Promise<void> {
  if (isMemoryMode()) {
    const regs = memoryRegistrations.get(tournamentId) ?? [];
    const reg = regs.find((r) => r.userId === userId);
    if (reg) Object.assign(reg, update);
    return;
  }
  const db = getDb();
  await db
    .update(tournamentRegistrations)
    .set(update)
    .where(and(eq(tournamentRegistrations.tournamentId, tournamentId), eq(tournamentRegistrations.userId, userId)));
}

export async function bulkUpdateRegistrations(
  tournamentId: string,
  updates: Array<{ userId: string } & Partial<Pick<MemoryRegistration, 'tableLobbyId' | 'seatIndex' | 'currentStack' | 'status'>>>
): Promise<void> {
  for (const u of updates) {
    await updateRegistration(tournamentId, u.userId, u);
  }
}

export async function getRegistrations(tournamentId: string): Promise<MemoryRegistration[]> {
  if (isMemoryMode()) {
    return memoryRegistrations.get(tournamentId) ?? [];
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(tournamentRegistrations)
    .where(eq(tournamentRegistrations.tournamentId, tournamentId));
  return rows.map((r) => ({
    id: r.id,
    tournamentId: r.tournamentId,
    userId: r.userId,
    displayName: r.displayName,
    registrationOrder: r.registrationOrder,
    tableLobbyId: r.tableLobbyId,
    seatIndex: r.seatIndex,
    currentStack: r.currentStack,
    bustPosition: r.bustPosition,
    prizeAwarded: r.prizeAwarded,
    status: r.status as MemoryRegistration['status'],
    registeredAt: r.registeredAt,
  }));
}

/** Build the public tournament state for broadcasting */
export function buildPublicTournamentState(
  tournament: MemoryTournament,
  registrations: MemoryRegistration[],
  blindLevelRemainingMs: number
): PublicTournamentState {
  const active = registrations.filter((r) => r.status === 'active');
  const eliminated = registrations
    .filter((r) => r.status === 'eliminated')
    .sort((a, b) => (a.bustPosition ?? 0) - (b.bustPosition ?? 0));

  // Sort active by stack descending, then name for tie-break
  const activeLeaderboard: LeaderboardEntry[] = active
    .sort((a, b) => (b.currentStack ?? 0) - (a.currentStack ?? 0))
    .map((r) => ({
      userId: r.userId,
      displayName: r.displayName,
      stack: r.currentStack,
      tableNumber: null, // caller can fill if needed
      bustPosition: null,
      prizeAwarded: null,
      isEliminated: false,
    }));

  const eliminatedLeaderboard: LeaderboardEntry[] = eliminated.map((r) => ({
    userId: r.userId,
    displayName: r.displayName,
    stack: null,
    tableNumber: null,
    bustPosition: r.bustPosition,
    prizeAwarded: r.prizeAwarded,
    isEliminated: true,
  }));

  const totalPlayers = registrations.length;
  const numPrizeSpots = calcNumPrizeSpots(totalPlayers);

  return {
    id: tournament.id,
    inviteCode: tournament.inviteCode,
    status: tournament.status,
    variant: tournament.variant,
    buyIn: tournament.buyIn,
    startingStack: tournament.startingStack,
    prizePool: tournament.prizePool,
    numPrizeSpots,
    currentBlindLevel: tournament.currentBlindLevel,
    blindSchedule: tournament.blindSchedule,
    blindLevelRemainingMs,
    totalPlayers,
    remainingPlayers: active.length,
    leaderboard: [...activeLeaderboard, ...eliminatedLeaderboard],
    scheduledStart: tournament.scheduledStart.toISOString(),
    hostUserId: tournament.hostUserId,
  };
}

export async function getAllWaitingTournaments(): Promise<MemoryTournament[]> {
  if (isMemoryMode()) {
    return [...memoryTournaments.values()].filter((t) => t.status === 'waiting');
  }
  const db = getDb();
  const rows = await db.select().from(tournaments).where(eq(tournaments.status, 'waiting'));
  return rows.map((r) => ({
    id: r.id,
    hostUserId: r.hostUserId,
    inviteCode: r.inviteCode,
    status: r.status as MemoryTournament['status'],
    variant: r.variant,
    buyIn: r.buyIn,
    startingStack: r.startingStack,
    numTables: r.numTables,
    seatsPerTable: r.seatsPerTable,
    scheduledStart: r.scheduledStart,
    blindSchedule: r.blindSchedule as BlindLevel[],
    prizePool: r.prizePool,
    currentBlindLevel: r.currentBlindLevel,
    blindLevelStartedAt: r.blindLevelStartedAt,
    createdAt: r.createdAt,
  }));
}

// ── Tournament templates ─────────────────────────────────────────────────────

export async function getTournamentTemplatesForUser(userId: string): Promise<TournamentTemplate[]> {
  if (isMemoryMode()) {
    return (memoryTournamentTemplates.get(userId) ?? []).map((t) => ({
      id: t.id,
      userId: t.userId,
      name: t.name,
      settings: t.settings,
      createdAt: t.createdAt.toISOString(),
    }));
  }
  const db = getDb();
  const rows = await db.select().from(tournamentTemplates).where(eq(tournamentTemplates.userId, userId));
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    name: r.name,
    settings: r.settings as TournamentSettings,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function createTournamentTemplate(
  userId: string,
  req: CreateTournamentTemplateRequest
): Promise<TournamentTemplate | { error: string }> {
  if (isMemoryMode()) {
    const existing = memoryTournamentTemplates.get(userId) ?? [];
    if (existing.length >= MAX_TOURNAMENT_TEMPLATES) return { error: `Template limit reached (max ${MAX_TOURNAMENT_TEMPLATES})` };
    const t: MemoryTournamentTemplate = { id: randomUUID(), userId, name: req.name.trim(), settings: req.settings, createdAt: new Date() };
    existing.push(t);
    memoryTournamentTemplates.set(userId, existing);
    return { id: t.id, userId, name: t.name, settings: t.settings, createdAt: t.createdAt.toISOString() };
  }
  const db = getDb();
  const existing = await db.select({ id: tournamentTemplates.id }).from(tournamentTemplates).where(eq(tournamentTemplates.userId, userId));
  if (existing.length >= MAX_TOURNAMENT_TEMPLATES) return { error: `Template limit reached (max ${MAX_TOURNAMENT_TEMPLATES})` };
  const name = req.name.trim();
  if (!name || name.length > 64) return { error: 'Template name must be 1–64 characters' };
  const [row] = await db.insert(tournamentTemplates).values({ userId, name, settings: req.settings }).returning();
  return { id: row.id, userId: row.userId, name: row.name, settings: row.settings as TournamentSettings, createdAt: row.createdAt.toISOString() };
}

export async function deleteTournamentTemplate(userId: string, templateId: string): Promise<boolean> {
  if (isMemoryMode()) {
    const templates = memoryTournamentTemplates.get(userId) ?? [];
    const idx = templates.findIndex((t) => t.id === templateId);
    if (idx === -1) return false;
    templates.splice(idx, 1);
    return true;
  }
  const db = getDb();
  const result = await db
    .delete(tournamentTemplates)
    .where(and(eq(tournamentTemplates.id, templateId), eq(tournamentTemplates.userId, userId)))
    .returning({ id: tournamentTemplates.id });
  return result.length > 0;
}

export type { MemoryTournament, MemoryRegistration };
