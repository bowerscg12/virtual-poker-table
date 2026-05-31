import { randomBytes } from 'crypto';
import type { Card, HandHistoryEntry, PlayerActionType, PublicTableState, VariantConfig } from '@vct/shared-types';
import { and, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import {
  applyAction,
  createInitialTable,
  getLegalActionsForSeat,
  type GameTableState,
} from '@vct/poker-engine';
import { getDb } from '../db/client.js';
import { tableSeats, users } from '../db/schema.js';
import { keys, redisGet, redisSet } from '../store/redis.js';
import { getMemoryLobby, isMemoryMode } from './lobby.js';
import { memoryStore } from '../store/memory-fallback.js';

interface SerializedGame extends Omit<GameTableState, 'processedActionIds' | 'seats'> {
  processedActionIds: string[];
  seats: Array<{
    seatIndex: number;
    userId: string;
    displayName: string;
    stack: number;
    betThisStreet: number;
    totalBet: number;
    folded: boolean;
    allIn: boolean;
    holeCards: Card[];
    shownCards?: Card[];
  }>;
}

const activeGames = new Map<string, GameTableState>();
const handHistories = new Map<string, HandHistoryEntry[]>();
let dealerRotations = new Map<string, number>();

/** ISO deadline strings keyed by lobbyId. Managed by handler.ts; read here for toPublicState. */
const actionDeadlines = new Map<string, string>();

export function getActionDeadline(lobbyId: string): string | null {
  return actionDeadlines.get(lobbyId) ?? null;
}

export function setActionDeadline(lobbyId: string, deadline: string): void {
  actionDeadlines.set(lobbyId, deadline);
}

export function clearActionDeadline(lobbyId: string): void {
  actionDeadlines.delete(lobbyId);
}

/** ISO deadline for next auto-hand start (between-hand intermission). Managed by handler.ts. */
const intermissionDeadlines = new Map<string, string>();

export function getIntermissionDeadline(lobbyId: string): string | null {
  return intermissionDeadlines.get(lobbyId) ?? null;
}

export function setIntermissionDeadline(lobbyId: string, deadline: string): void {
  intermissionDeadlines.set(lobbyId, deadline);
}

export function clearIntermissionDeadline(lobbyId: string): void {
  intermissionDeadlines.delete(lobbyId);
}

/** Returns 'check' if legal for the seat, otherwise 'fold'. Used by the action timer auto-action. */
export function getAutoAction(
  state: GameTableState,
  config: VariantConfig,
  seatIndex: number
): PlayerActionType {
  const legal = getLegalActionsForSeat(state, config, seatIndex);
  return legal.some((a) => a.type === 'check') ? 'check' : 'fold';
}

function serialize(state: GameTableState): SerializedGame {
  return {
    ...state,
    processedActionIds: [...state.processedActionIds],
    seats: state.seats.map((s) => ({ ...s, holeCards: s.holeCards })),
  };
}

function deserialize(data: SerializedGame): GameTableState {
  return {
    ...data,
    processedActionIds: new Set(data.processedActionIds),
    seats: data.seats.map((s) => ({ ...s })),
    pendingActionSeatIndices: data.pendingActionSeatIndices ?? [],
  };
}

async function persistGame(lobbyId: string, state: GameTableState): Promise<void> {
  const ser = serialize(state);
  await redisSet(keys.tableState(lobbyId), JSON.stringify(ser), 86400);
  activeGames.set(lobbyId, state);
}

async function loadGame(lobbyId: string): Promise<GameTableState | null> {
  if (activeGames.has(lobbyId)) return activeGames.get(lobbyId)!;
  const raw = await redisGet(keys.tableState(lobbyId));
  if (!raw) return null;
  return deserialize(JSON.parse(raw) as SerializedGame);
}

async function seatedPlayers(lobbyId: string) {
  if (isMemoryMode()) {
    const lobby = getMemoryLobby(lobbyId);
    if (!lobby) return [];
    return lobby.seats
      .filter((s) => s.userId && s.stack > 0)
      .map((s) => ({
        seatIndex: s.seatIndex,
        userId: s.userId!,
        displayName: memoryStore.users.get(s.userId!)?.displayName ?? 'Player',
        stack: s.stack,
      }));
  }

  const db = getDb();
  const seats = await db.select().from(tableSeats).where(and(eq(tableSeats.lobbyId, lobbyId), isNotNull(tableSeats.userId), gt(tableSeats.stack, 0)));
  if (seats.length === 0) return [];

  const userIds = [...new Set(seats.map((seat) => seat.userId).filter((id): id is string => !!id))];
  const dbUsers = await db.select().from(users).where(inArray(users.id, userIds));
  const displayNames = new Map(dbUsers.map((user) => [user.id, user.displayName]));

  return seats
    .filter((seat) => seat.userId)
    .map((seat) => ({
      seatIndex: seat.seatIndex,
      userId: seat.userId!,
      displayName: displayNames.get(seat.userId!) ?? 'Player',
      stack: seat.stack,
    }));
}

export async function startHand(lobbyId: string, config: VariantConfig): Promise<GameTableState | { error: string }> {
  const players = await seatedPlayers(lobbyId);
  if (players.length < 2) return { error: 'Need at least 2 players' };

  const prevDealer = dealerRotations.get(lobbyId) ?? -1;
  const indices = players.map((p) => p.seatIndex).sort((a, b) => a - b);
  const nextDealerIdx = indices.find((i) => i > prevDealer) ?? indices[0];
  dealerRotations.set(lobbyId, nextDealerIdx);

  const handNumber = (activeGames.get(lobbyId)?.handNumber ?? 0) + 1;
  const rng = () => randomBytes(4).readUInt32BE(0) / 0xffffffff;

  const state = createInitialTable(players, config, handNumber, nextDealerIdx, rng);
  await persistGame(lobbyId, state);
  syncStacksToLobby(lobbyId, state);
  return state;
}

function syncStacksToLobby(lobbyId: string, state: GameTableState): void {
  if (!isMemoryMode()) return;
  const lobby = getMemoryLobby(lobbyId);
  if (!lobby) return;
  for (const seat of state.seats) {
    const ls = lobby.seats.find((s) => s.seatIndex === seat.seatIndex);
    if (ls) ls.stack = seat.stack;
  }
}

function isSevenDeuceOffsuit(cards: Card[]): boolean {
  if (cards.length < 2) return false;
  const ranks = new Set(cards.map((card) => card[0]));
  if (!ranks.has('7') || !ranks.has('2')) return false;
  return cards[0][1] !== cards[1][1];
}

function applySevenDeuceRule(state: GameTableState, config: VariantConfig): GameTableState {
  if (config.game !== 'holdem' || !config.sevenDeuceRule) return state;
  const winners = new Set(state.lastWinningSeatIndices);
  const qualifyingWinner = state.seats.some((seat) => winners.has(seat.seatIndex) && isSevenDeuceOffsuit(seat.holeCards));
  if (!qualifyingWinner) return state;

  const donation = Math.max(1, Math.round(config.buyIn * 0.05));
  const nextState = { ...state, seats: state.seats.map((seat) => ({ ...seat })) };

  for (const seat of nextState.seats) {
    if (winners.has(seat.seatIndex)) continue;
    if (seat.stack >= donation) {
      seat.stack -= donation;
    }
  }

  return nextState;
}

export async function processGameAction(
  lobbyId: string,
  config: VariantConfig,
  userId: string,
  actionId: string,
  action: PlayerActionType,
  amount?: number
): Promise<{ state: GameTableState } | { error: string }> {
  let state = await loadGame(lobbyId);
  if (!state) return { error: 'No active hand' };

  const seat = state.seats.find((s) => s.userId === userId);
  if (!seat) return { error: 'Not seated' };

  const result = applyAction(state, config, seat.seatIndex, action, amount, actionId);
  if (!result.ok) return { error: result.error };

  state = result.state;
  if (state.street === 'complete') {
    state = applySevenDeuceRule(state, config);
  }
  await persistGame(lobbyId, state);
  syncStacksToLobby(lobbyId, state);

  if (state.street === 'complete') {
    await recordHandHistory(lobbyId, state);
  }

  return { state };
}

async function recordHandHistory(
  lobbyId: string,
  state: GameTableState,
): Promise<void> {
  const entry: HandHistoryEntry = {
    id: crypto.randomUUID(),
    lobbyId,
    handNumber: state.handNumber,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    board: state.board,
    winners: state.winnerPayouts,
    actions: [],
  };

  const list = handHistories.get(lobbyId) ?? [];
  list.push(entry);
  handHistories.set(lobbyId, list);

  if (isMemoryMode()) {
    memoryStore.handHistories.push({
      id: entry.id,
      lobbyId,
      handNumber: entry.handNumber,
      data: entry,
      createdAt: entry.endedAt,
    });
  }
}

export function getHandHistories(lobbyId: string): HandHistoryEntry[] {
  return handHistories.get(lobbyId) ?? [];
}

export function toPublicState(
  state: GameTableState,
  viewerUserId: string | null,
  isSpectator: boolean,
  config: VariantConfig,
  actionDeadline?: string | null,
  paused?: boolean,
  intermissionDeadline?: string | null,
): { public: PublicTableState; private?: { holeCards: Card[]; legalActions: import('@vct/shared-types').LegalAction[] } } {
  const viewerSeat = state.seats.find((s) => s.userId === viewerUserId);

  const publicState: PublicTableState = {
    lobbyId: '',
    handNumber: state.handNumber,
    street: state.street,
    board: state.board,
    seats: state.seats.map((s) => ({
      seatIndex: s.seatIndex,
      userId: s.userId,
      displayName: s.displayName,
      stack: s.stack,
      betThisStreet: s.betThisStreet,
      totalBet: s.totalBet,
      folded: s.folded,
      allIn: s.allIn,
      isDealer: s.seatIndex === state.dealerSeatIndex,
      isSmallBlind: false,
      isBigBlind: false,
      shownCards: state.street === 'showdown' || state.street === 'complete' ? s.shownCards : undefined,
    })),
    pots: state.pots.map((p) => ({ amount: p.amount, eligibleSeatIndices: p.eligibleSeatIndices })),
    dealerSeatIndex: state.dealerSeatIndex,
    actionSeatIndex: state.actionSeatIndex,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    actionDeadline: actionDeadline ?? undefined,
    intermissionDeadline: intermissionDeadline ?? undefined,
    paused: paused ?? false,
  };

  if (isSpectator || !viewerSeat) {
    return { public: publicState };
  }

  const legalActions =
    state.actionSeatIndex === viewerSeat.seatIndex
      ? getLegalActionsForSeat(state, config, viewerSeat.seatIndex)
      : [];

  return {
    public: publicState,
    private: {
      holeCards: viewerSeat.holeCards,
      legalActions,
    },
  };
}

export async function getActiveGame(lobbyId: string): Promise<GameTableState | null> {
  return loadGame(lobbyId);
}

/**
 * Update a seat's stack in the active game after a rebuy so the next broadcast
 * immediately reflects the new chip count. No-op if no game exists.
 */
export async function updateSeatStackAfterRebuy(lobbyId: string, userId: string, amount: number): Promise<void> {
  const state = activeGames.get(lobbyId);
  if (!state) return;
  const seat = state.seats.find((s) => s.userId === userId);
  if (!seat) return;
  seat.stack = amount;
  await persistGame(lobbyId, state);
}

/** Set shownCards on a seat so the next broadcastTableState reveals them. */
export async function setSeatShownCards(lobbyId: string, seatIndex: number, cards: Card[]): Promise<void> {
  const state = activeGames.get(lobbyId);
  if (!state) return;
  const seat = state.seats.find((s) => s.seatIndex === seatIndex);
  if (!seat) return;
  seat.shownCards = cards;
  await persistGame(lobbyId, state);
}

/** Annotate the last recorded hand history entry with fold-win reveal data.
 *  Always call with the winner's seatIndex; pass cards only if they chose to show.
 */
export function updateLastHandHistoryFoldWin(
  lobbyId: string,
  seatIndex: number,
  cards: Card[] | null
): void {
  const list = handHistories.get(lobbyId);
  if (!list || list.length === 0) return;
  const last = list[list.length - 1];
  last.shownAtFoldWin = cards ? { seatIndex, cards } : { seatIndex };
}

export function clearGame(lobbyId: string): void {
  activeGames.delete(lobbyId);
}
