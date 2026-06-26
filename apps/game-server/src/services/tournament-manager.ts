import type { GameTableState } from '@vct/poker-engine';
import type { VariantConfig } from '@vct/shared-types';
import { logger } from '../logger.js';
import {
  addChips,
  buildPublicTournamentState,
  calcNumPrizeSpots,
  calcPrize,
  calcPrizePool,
  getAllWaitingTournaments,
  getRegistrations,
  getTournamentById,
  MIN_PLAYERS_TO_START,
  updateRegistration,
  updateTournamentBlindLevel,
  updateTournamentPrizePool,
  updateTournamentStats,
  updateTournamentStatus,
} from './tournament-service.js';
import { addSystemChatMessage } from './chat.js';
import {
  createTournamentLobby,
  getLobbyById,
  removeSeat,
  sitTournamentPlayer,
  updateLobbyStatus,
} from './lobby.js';
import {
  startTournamentTable,
  updateTournamentTableBlinds,
} from '../ws/handler.js';
import { broadcastRawToLobby, sendToUser } from '../ws/connection.js';

// ── Runtime state ────────────────────────────────────────────────────────────

interface TournamentRuntimeState {
  tournamentId: string;
  /** tableNumber (1-indexed) → lobbyId */
  tableLobbies: Map<number, string>;
  blindLevelTimer: ReturnType<typeof setTimeout> | null;
  scheduledStartTimer: ReturnType<typeof setTimeout> | null;
  /** userId → { toTableNumber } for in-flight seat moves */
  pendingMoves: Map<string, { toTableNumber: number }>;
}

const activeTournaments = new Map<string, TournamentRuntimeState>();

/**
 * UserIds subscribed to a tournament for waiting-room broadcasts (pre-start).
 * Key: userId, Value: tournamentId
 */
const waitingRoomSubs = new Map<string, string>();

// ── Helpers ──────────────────────────────────────────────────────────────────

function getRuntime(tournamentId: string): TournamentRuntimeState {
  let rt = activeTournaments.get(tournamentId);
  if (!rt) {
    rt = {
      tournamentId,
      tableLobbies: new Map(),
      blindLevelTimer: null,
      scheduledStartTimer: null,
      pendingMoves: new Map(),
    };
    activeTournaments.set(tournamentId, rt);
  }
  return rt;
}

function clearRuntime(tournamentId: string): void {
  const rt = activeTournaments.get(tournamentId);
  if (!rt) return;
  if (rt.blindLevelTimer) clearTimeout(rt.blindLevelTimer);
  if (rt.scheduledStartTimer) clearTimeout(rt.scheduledStartTimer);
  activeTournaments.delete(tournamentId);
}

async function broadcastTournamentState(tournamentId: string): Promise<void> {
  const data = await getTournamentById(tournamentId);
  if (!data) return;
  const rt = activeTournaments.get(tournamentId);
  const remainingMs = calcBlindLevelRemainingMs(data);
  const state = buildPublicTournamentState(data, data.registrations, remainingMs);

  // Fill in table numbers on leaderboard from runtime map
  if (rt) {
    for (const entry of state.leaderboard) {
      if (entry.isEliminated) continue;
      const reg = data.registrations.find((r) => r.userId === entry.userId);
      if (reg?.tableLobbyId) {
        for (const [tableNum, lobbyId] of rt.tableLobbies) {
          if (lobbyId === reg.tableLobbyId) { entry.tableNumber = tableNum; break; }
        }
      }
    }
  }

  const msg = { type: 'tournament_state' as const, tournament: state };

  // Broadcast to all active table clients
  if (rt) {
    for (const lobbyId of rt.tableLobbies.values()) {
      broadcastRawToLobby(lobbyId, msg);
    }
  }
  // Broadcast to waiting-room subscribers
  for (const [userId, tId] of waitingRoomSubs) {
    if (tId === tournamentId) sendToUser(userId, msg);
  }
}

function calcBlindLevelRemainingMs(data: { blindLevelStartedAt: Date | null; blindSchedule: { durationMinutes: number }[]; currentBlindLevel: number }): number {
  if (!data.blindLevelStartedAt || data.blindSchedule.length === 0) return 0;
  const levelIdx = Math.min(data.currentBlindLevel, data.blindSchedule.length - 1);
  const durationMs = data.blindSchedule[levelIdx].durationMinutes * 60_000;
  const elapsed = Date.now() - data.blindLevelStartedAt.getTime();
  return Math.max(0, durationMs - elapsed);
}

// ── Waiting room subscriptions ────────────────────────────────────────────────

export function subscribeToTournament(userId: string, tournamentId: string): void {
  waitingRoomSubs.set(userId, tournamentId);
}

export function unsubscribeFromTournament(userId: string): void {
  waitingRoomSubs.delete(userId);
}

// ── Start scheduling ─────────────────────────────────────────────────────────

export function scheduleTournamentStart(tournamentId: string, scheduledStart: Date): void {
  const rt = getRuntime(tournamentId);
  if (rt.scheduledStartTimer) clearTimeout(rt.scheduledStartTimer);
  const delayMs = scheduledStart.getTime() - Date.now();
  if (delayMs <= 0) {
    startTournament(tournamentId).catch((err) => logger.error({ err }, '[tournament] auto-start error'));
    return;
  }
  rt.scheduledStartTimer = setTimeout(() => {
    startTournament(tournamentId).catch((err) => logger.error({ err }, '[tournament] auto-start error'));
  }, delayMs);
}

// ── Start tournament ─────────────────────────────────────────────────────────

export async function startTournament(tournamentId: string): Promise<{ ok: true } | { error: string }> {
  const data = await getTournamentById(tournamentId);
  if (!data) return { error: 'Tournament not found' };
  if (data.status !== 'waiting') return { error: 'Tournament already started' };

  const registrations = data.registrations.filter((r) => r.status === 'registered');
  if (registrations.length < MIN_PLAYERS_TO_START) {
    return { error: `Need at least ${MIN_PLAYERS_TO_START} players to start` };
  }

  const rt = getRuntime(tournamentId);
  if (rt.scheduledStartTimer) { clearTimeout(rt.scheduledStartTimer); rt.scheduledStartTimer = null; }

  // Calculate prize pool (buy-ins were already deducted at registration)
  const prizePool = calcPrizePool(registrations.length, data.buyIn);
  await updateTournamentPrizePool(tournamentId, prizePool);

  // Determine table count — use tournament's numTables or compute from players
  const numTables = Math.max(1, Math.min(data.numTables, Math.ceil(registrations.length / data.seatsPerTable)));
  const firstBlind = data.blindSchedule[0];

  // Create one lobby per table
  const tableLobbies: Array<{ tableNumber: number; lobbyId: string }> = [];
  for (let t = 1; t <= numTables; t++) {
    const settings: VariantConfig = {
      game: data.variant as 'holdem' | 'omaha',
      limit: 'no_limit',
      maxPlayers: data.seatsPerTable as 2 | 6 | 8,
      blinds: { small: firstBlind.small, big: firstBlind.big },
      buyIn: data.startingStack,
      minBuyIn: data.startingStack,
      maxBuyIn: data.startingStack,
      actionTimerSec: 30,
    };
    const lobbyId = await createTournamentLobby(data.hostUserId, tournamentId, settings);
    tableLobbies.push({ tableNumber: t, lobbyId });
    rt.tableLobbies.set(t, lobbyId);
  }

  // Assign players in registration order
  const sorted = [...registrations].sort((a, b) => a.registrationOrder - b.registrationOrder);
  const tableAssignments: Array<{ userId: string; tableNumber: number; lobbyId: string; seatIndex: number }> = [];

  for (let i = 0; i < sorted.length; i++) {
    const tableNumber = (i % numTables) + 1;
    const { lobbyId } = tableLobbies[tableNumber - 1];
    const lobby = await getLobbyById(lobbyId);
    if (!lobby) continue;
    const seatIndex = lobby.seats.findIndex((s) => !s.userId);
    if (seatIndex === -1) continue;
    await sitTournamentPlayer(lobbyId, sorted[i].userId, seatIndex, data.startingStack);
    tableAssignments.push({ userId: sorted[i].userId, tableNumber, lobbyId, seatIndex });
  }

  // Persist seat assignments in registrations
  for (const { userId, lobbyId, seatIndex } of tableAssignments) {
    await updateRegistration(tournamentId, userId, {
      tableLobbyId: lobbyId,
      seatIndex,
      currentStack: data.startingStack,
      status: 'active',
    });
  }

  // Update tournament status
  await updateTournamentStatus(tournamentId, 'running');
  await updateTournamentBlindLevel(tournamentId, 0, new Date());

  // Start blind level timer
  scheduleBlindLevelAdvance(tournamentId, firstBlind.durationMinutes);

  // Notify each player of their table assignment + start the tables
  for (const { userId, lobbyId, seatIndex } of tableAssignments) {
    sendToUser(userId, { type: 'tournament_started', tournamentId, tableLobbyId: lobbyId, seatIndex });
  }
  // Notify waiting-room subscribers (spectators / not-yet-connected)
  for (const [userId, tId] of waitingRoomSubs) {
    if (tId === tournamentId) sendToUser(userId, { type: 'tournament_started', tournamentId, tableLobbyId: '', seatIndex: -1 });
  }

  await broadcastTournamentState(tournamentId);

  // Start hands on all tables (async, do not await to avoid blocking)
  for (const { lobbyId } of tableLobbies) {
    await updateLobbyStatus(lobbyId, 'playing');
    startTournamentTable(lobbyId).catch((err) => logger.error({ err }, '[tournament] startTable error'));
  }

  logger.info({ tournamentId, players: registrations.length, numTables, prizePool }, '[tournament] started');
  return { ok: true };
}

// ── Blind level management ────────────────────────────────────────────────────

function scheduleBlindLevelAdvance(tournamentId: string, durationMinutes: number): void {
  const rt = activeTournaments.get(tournamentId);
  if (!rt) return;
  if (rt.blindLevelTimer) clearTimeout(rt.blindLevelTimer);
  rt.blindLevelTimer = setTimeout(() => {
    advanceBlindLevel(tournamentId, false).catch((err) => logger.error({ err }, '[tournament] blind advance error'));
  }, durationMinutes * 60_000);
}

export async function advanceBlindLevel(tournamentId: string, _forced = false): Promise<void> {
  const data = await getTournamentById(tournamentId);
  if (!data || data.status !== 'running') return;

  const nextLevel = Math.min(data.currentBlindLevel + 1, data.blindSchedule.length - 1);
  const now = new Date();
  await updateTournamentBlindLevel(tournamentId, nextLevel, now);

  const blind = data.blindSchedule[nextLevel];

  // Update blinds on all active table lobbies
  const rt = activeTournaments.get(tournamentId);
  if (rt) {
    for (const lobbyId of rt.tableLobbies.values()) {
      await updateTournamentTableBlinds(lobbyId, blind.small, blind.big);
    }
  }

  // Broadcast the level change to all tables + waiting room
  const levelMsg = { type: 'tournament_blind_level_changed' as const, level: blind, levelNumber: nextLevel + 1 };
  if (rt) {
    for (const lobbyId of rt.tableLobbies.values()) {
      broadcastRawToLobby(lobbyId, levelMsg);
    }
  }
  for (const [userId, tId] of waitingRoomSubs) {
    if (tId === tournamentId) sendToUser(userId, levelMsg);
  }

  // Announce in all table chats
  if (rt) {
    const announcement = `🔔 Blinds increased to ${blind.small.toLocaleString()}/${blind.big.toLocaleString()} (Level ${nextLevel + 1})`;
    for (const lobbyId of rt.tableLobbies.values()) {
      const chatMsg = addSystemChatMessage(lobbyId, announcement);
      broadcastRawToLobby(lobbyId, { type: 'chat', message: chatMsg });
    }
  }

  await broadcastTournamentState(tournamentId);

  // Schedule next advance if not at last level
  if (nextLevel < data.blindSchedule.length - 1 && rt) {
    scheduleBlindLevelAdvance(tournamentId, blind.durationMinutes);
  } else if (rt) {
    rt.blindLevelTimer = null;
  }
}

// ── After-hand processing ─────────────────────────────────────────────────────

/**
 * Called by handler.ts after every hand completes on a tournament table.
 * Syncs stacks, handles busts/prizes, and triggers rebalancing.
 */
export async function afterHandComplete(
  tournamentId: string,
  _lobbyId: string,
  state: GameTableState
): Promise<void> {
  const data = await getTournamentById(tournamentId);
  if (!data || data.status !== 'running') return;

  const regs = await getRegistrations(tournamentId);
  const activeRegs = regs.filter((r) => r.status === 'active');

  // Sync stacks from engine state for players at this table
  const stacksFromEngine = new Map<string, number>();
  for (const seat of state.seats) {
    if (seat.userId) stacksFromEngine.set(seat.userId, seat.stack);
  }

  // Detect busted players (stack === 0 after hand)
  const busted: string[] = [];
  for (const [userId, stack] of stacksFromEngine) {
    await updateRegistration(tournamentId, userId, { currentStack: stack });
    if (stack === 0) busted.push(userId);
  }

  if (busted.length > 0) {
    await handleEliminations(tournamentId, busted, activeRegs.length, data.prizePool, data.blindSchedule.length > 0 ? calcNumPrizeSpots(regs.length) : 0, regs.length);

    // Reload data after eliminations to get fresh counts
    const freshData = await getTournamentById(tournamentId);
    if (!freshData) return;
    const freshActive = (await getRegistrations(tournamentId)).filter((r) => r.status === 'active');

    if (freshActive.length <= 1) {
      await finalizeTournament(tournamentId, freshActive, freshData.prizePool, regs.length);
      return;
    }
  }

  await broadcastTournamentState(tournamentId);
  await checkRebalance(tournamentId);
}

async function handleEliminations(
  tournamentId: string,
  bustedUserIds: string[],
  remainingBefore: number,
  prizePool: number,
  numPrizeSpots: number,
  totalPlayers: number
): Promise<void> {
  // Simultaneous busts: all share bust position = remainingBefore - bustedUserIds.length + 1
  const bustPosition = remainingBefore - bustedUserIds.length + 1;
  const eligibleBusted = bustedUserIds.filter((_uid, idx) => {
    const position = bustPosition + idx;
    return position <= numPrizeSpots;
  });

  let prizePerElim = 0;
  if (eligibleBusted.length > 0) {
    // If multiple simultaneous busts in prize positions, average their prizes
    const prizes = eligibleBusted.map((_, idx) => calcPrize(prizePool, numPrizeSpots, bustPosition + idx));
    const totalPrize = prizes.reduce((a, b) => a + b, 0);
    prizePerElim = Math.floor(totalPrize / eligibleBusted.length);
  }

  // Get display names for chat announcements
  const rt = activeTournaments.get(tournamentId);
  const regs = await getRegistrations(tournamentId);
  const displayNames = new Map(regs.map((r) => [r.userId, r.displayName]));

  for (let i = 0; i < bustedUserIds.length; i++) {
    const userId = bustedUserIds[i];
    const isEligible = eligibleBusted.includes(userId);
    const prize = isEligible ? prizePerElim : null;
    const position = bustPosition + i;

    await updateRegistration(tournamentId, userId, {
      status: 'eliminated',
      bustPosition: position,
      currentStack: 0,
      prizeAwarded: prize,
    });

    if (prize && prize > 0) {
      await addChips(userId, prize);
    }

    await updateTournamentStats(userId, {
      played: true,
      cashed: (prize ?? 0) > 0,
      won: false,
      finish: position,
      earnings: prize ?? 0,
    });

    sendToUser(userId, {
      type: 'tournament_elimination_result',
      bustPosition: position,
      prizeAwarded: prize,
      totalPlayers,
    });

    // Announce elimination in all table chats
    if (rt) {
      const name = displayNames.get(userId) ?? 'A player';
      const ordinal = (n: number) => { const s = ['th','st','nd','rd']; const v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); };
      const prizeText = prize && prize > 0 ? ` (+${prize.toLocaleString()} chips)` : '';
      const announcement = `💀 ${name} has been eliminated in ${ordinal(position)} place${prizeText}`;
      for (const lobbyId of rt.tableLobbies.values()) {
        const chatMsg = addSystemChatMessage(lobbyId, announcement);
        broadcastRawToLobby(lobbyId, { type: 'chat', message: chatMsg });
      }
    }
  }
}

// ── Rebalancing ───────────────────────────────────────────────────────────────

async function checkRebalance(tournamentId: string): Promise<void> {
  const rt = activeTournaments.get(tournamentId);
  if (!rt) return;

  const regs = await getRegistrations(tournamentId);
  const active = regs.filter((r) => r.status === 'active');

  if (active.length === 0) return;

  // Group active players by table
  const byTable = new Map<number, typeof active>();
  for (const [tableNum, lobbyId] of rt.tableLobbies) {
    const players = active.filter((r) => r.tableLobbyId === lobbyId);
    byTable.set(tableNum, players);
  }

  // Check if we should consolidate to a final table (≤8 players, multiple tables)
  const activeTables = [...byTable.entries()].filter(([, players]) => players.length > 0);
  if (active.length <= 8 && activeTables.length > 1) {
    await consolidateToFinalTable(tournamentId, active, activeTables, rt);
    return;
  }

  // Check for imbalance: largest - smallest ≥ 2
  if (activeTables.length <= 1) return;
  const sizes = activeTables.map(([tableNum, players]) => ({ tableNum, count: players.length }));
  const maxTable = sizes.reduce((a, b) => (a.count >= b.count ? a : b));
  const minTable = sizes.reduce((a, b) => (a.count <= b.count ? a : b));

  if (maxTable.count - minTable.count < 2) return;
  if (rt.pendingMoves.size > 0) return; // Already a move in progress

  // Pick a random player from the largest table
  const fromPlayers = byTable.get(maxTable.tableNum) ?? [];
  const player = fromPlayers[Math.floor(Math.random() * fromPlayers.length)];
  if (!player) return;

  const toTableNumber = minTable.tableNum;
  rt.pendingMoves.set(player.userId, { toTableNumber });

  const MOVE_DELAY_MS = 5000;
  sendToUser(player.userId, {
    type: 'tournament_seat_change_warning',
    newTableNumber: toTableNumber,
    deadline: new Date(Date.now() + MOVE_DELAY_MS).toISOString(),
  });

  setTimeout(async () => {
    await executeMove(tournamentId, player.userId, toTableNumber);
  }, MOVE_DELAY_MS);
}

async function consolidateToFinalTable(
  tournamentId: string,
  active: Array<{ userId: string; tableLobbyId: string | null; currentStack: number | null }>,
  activeTables: Array<[number, typeof active]>,
  rt: TournamentRuntimeState
): Promise<void> {
  // Keep table 1 (lowest number), move everyone else to it
  const finalTableNumber = activeTables[0][0];
  const finalLobbyId = rt.tableLobbies.get(finalTableNumber)!;

  for (const [tableNum, players] of activeTables) {
    if (tableNum === finalTableNumber) continue;
    for (const player of players) {
      if (rt.pendingMoves.has(player.userId)) continue;
      rt.pendingMoves.set(player.userId, { toTableNumber: finalTableNumber });
      sendToUser(player.userId, {
        type: 'tournament_seat_change_warning',
        newTableNumber: finalTableNumber,
        deadline: new Date(Date.now() + 5000).toISOString(),
      });
    }
  }

  // Execute all moves with a 5s delay
  setTimeout(async () => {
    const regs = await getRegistrations(tournamentId);
    for (const [tableNum, players] of activeTables) {
      if (tableNum === finalTableNumber) continue;
      for (const player of players) {
        const freshReg = regs.find((r) => r.userId === player.userId);
        if (!freshReg || freshReg.status !== 'active') continue;
        await executeMoveToLobby(tournamentId, player.userId, finalTableNumber, finalLobbyId, freshReg.currentStack ?? 0, freshReg.tableLobbyId);
      }
    }
    // Remove empty tables from runtime (keep final table)
    for (const [tableNum] of activeTables) {
      if (tableNum !== finalTableNumber) rt.tableLobbies.delete(tableNum);
    }

    // Final table announcement
    const announcement = `🎯 Final table! ${active.length} players remain.`;
    const chatMsg = addSystemChatMessage(finalLobbyId, announcement);
    broadcastRawToLobby(finalLobbyId, { type: 'chat', message: chatMsg });

    await broadcastTournamentState(tournamentId);
  }, 5000);
}

async function executeMove(tournamentId: string, userId: string, toTableNumber: number): Promise<void> {
  const rt = activeTournaments.get(tournamentId);
  if (!rt) return;
  rt.pendingMoves.delete(userId);

  const regs = await getRegistrations(tournamentId);
  const reg = regs.find((r) => r.userId === userId);
  if (!reg || reg.status !== 'active') return;

  const toLobbyId = rt.tableLobbies.get(toTableNumber);
  if (!toLobbyId) return;

  await executeMoveToLobby(tournamentId, userId, toTableNumber, toLobbyId, reg.currentStack ?? 0, reg.tableLobbyId);
  await broadcastTournamentState(tournamentId);
}

async function executeMoveToLobby(
  tournamentId: string,
  userId: string,
  toTableNumber: number,
  toLobbyId: string,
  stack: number,
  fromLobbyId: string | null
): Promise<void> {
  // Remove from current table
  if (fromLobbyId) await removeSeat(fromLobbyId, userId);

  // Find open seat in new table
  const newLobby = await getLobbyById(toLobbyId);
  if (!newLobby) return;
  const openSeat = newLobby.seats.find((s) => !s.userId);
  if (!openSeat) return;

  // Seat at new table
  await sitTournamentPlayer(toLobbyId, userId, openSeat.seatIndex, stack);

  // Update registration
  await updateRegistration(tournamentId, userId, {
    tableLobbyId: toLobbyId,
    seatIndex: openSeat.seatIndex,
  });

  sendToUser(userId, {
    type: 'tournament_seat_changed',
    newLobbyId: toLobbyId,
    newSeatIndex: openSeat.seatIndex,
  });

  logger.info({ userId, toTableNumber, toLobbyId }, '[tournament] Moved player to table');
}

// ── Finalize ──────────────────────────────────────────────────────────────────

async function finalizeTournament(
  tournamentId: string,
  remaining: Array<{ userId: string; currentStack: number | null }>,
  prizePool: number,
  totalPlayers: number
): Promise<void> {
  // Award first place to the last player standing
  if (remaining.length === 1) {
    const winner = remaining[0];
    const prize = calcPrize(prizePool, calcNumPrizeSpots(totalPlayers), 1);
    if (prize > 0) await addChips(winner.userId, prize);
    await updateRegistration(tournamentId, winner.userId, {
      status: 'eliminated',
      bustPosition: 1,
      prizeAwarded: prize,
    });
    await updateTournamentStats(winner.userId, {
      played: true,
      cashed: prize > 0,
      won: true,
      finish: 1,
      earnings: prize,
    });
    sendToUser(winner.userId, {
      type: 'tournament_elimination_result',
      bustPosition: 1,
      prizeAwarded: prize,
      totalPlayers,
    });

    // Announce winner in all table chats
    const rt2 = activeTournaments.get(tournamentId);
    if (rt2) {
      const regs2 = await getRegistrations(tournamentId);
      const winnerName = regs2.find((r) => r.userId === winner.userId)?.displayName ?? 'A player';
      const announcement = `🏆 ${winnerName} wins the tournament!`;
      for (const lobbyId of rt2.tableLobbies.values()) {
        const chatMsg = addSystemChatMessage(lobbyId, announcement);
        broadcastRawToLobby(lobbyId, { type: 'chat', message: chatMsg });
      }
    }
  }

  await updateTournamentStatus(tournamentId, 'finished');

  // Build final leaderboard
  const data = await getTournamentById(tournamentId);
  if (!data) return;
  const finalState = buildPublicTournamentState(data, data.registrations, 0);
  const completeMsg = { type: 'tournament_complete' as const, finalLeaderboard: finalState.leaderboard };

  const rt = activeTournaments.get(tournamentId);
  if (rt) {
    for (const lobbyId of rt.tableLobbies.values()) {
      broadcastRawToLobby(lobbyId, completeMsg);
    }
  }
  for (const [userId, tId] of waitingRoomSubs) {
    if (tId === tournamentId) sendToUser(userId, completeMsg);
  }

  clearRuntime(tournamentId);
  logger.info({ tournamentId }, '[tournament] finished');
}

// ── Cancel ────────────────────────────────────────────────────────────────────

export async function cancelTournament(tournamentId: string): Promise<void> {
  const data = await getTournamentById(tournamentId);
  if (!data) return;

  // Refund buy-ins for all non-eliminated registrations
  const regs = await getRegistrations(tournamentId);
  for (const reg of regs) {
    if (reg.status !== 'eliminated') await addChips(reg.userId, data.buyIn);
  }

  await updateTournamentStatus(tournamentId, 'cancelled');

  const cancelMsg = { type: 'tournament_cancelled' as const, tournamentId };
  const rt = activeTournaments.get(tournamentId);
  if (rt) {
    for (const lobbyId of rt.tableLobbies.values()) {
      broadcastRawToLobby(lobbyId, cancelMsg);
    }
  }
  for (const [userId, tId] of waitingRoomSubs) {
    if (tId === tournamentId) sendToUser(userId, cancelMsg);
  }

  clearRuntime(tournamentId);
}

// ── Boot recovery ─────────────────────────────────────────────────────────────

export async function recoverTournamentTimers(): Promise<void> {
  const waiting = await getAllWaitingTournaments();
  for (const t of waiting) {
    logger.info({ tournamentId: t.id, scheduledStart: t.scheduledStart.toISOString() }, '[tournament] Recovering scheduled start');
    scheduleTournamentStart(t.id, t.scheduledStart);
  }
}

// ── Exported singleton ────────────────────────────────────────────────────────

export const tournamentManager = {
  scheduleTournamentStart,
  startTournament,
  advanceBlindLevel,
  afterHandComplete,
  cancelTournament,
  recoverTournamentTimers,
  subscribeToTournament,
  unsubscribeFromTournament,
};
