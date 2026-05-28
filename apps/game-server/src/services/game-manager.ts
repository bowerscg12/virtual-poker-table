import { randomBytes } from 'crypto';
import type { Card, HandHistoryEntry, PlayerActionType, PublicTableState, VariantConfig } from '@vct/shared-types';
import {
  applyAction,
  createInitialTable,
  getLegalActionsForSeat,
  type GameTableState,
} from '@vct/poker-engine';
import { getVariantModule } from '@vct/poker-engine';
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

function seatedPlayers(lobbyId: string) {
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
  return [];
}

export async function startHand(lobbyId: string, config: VariantConfig): Promise<GameTableState | { error: string }> {
  const players = seatedPlayers(lobbyId);
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
  await persistGame(lobbyId, state);
  syncStacksToLobby(lobbyId, state);

  if (state.street === 'complete') {
    await recordHandHistory(lobbyId, state, config);
  }

  return { state };
}

async function recordHandHistory(
  lobbyId: string,
  state: GameTableState,
  config: VariantConfig
): Promise<void> {
  const module = getVariantModule(config);
  const entry: HandHistoryEntry = {
    id: crypto.randomUUID(),
    lobbyId,
    handNumber: state.handNumber,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    board: state.board,
    winners: state.seats
      .filter((s) => s.shownCards)
      .map((s) => ({
        seatIndex: s.seatIndex,
        amount: 0,
        handDescription: module.evaluateHand(s.holeCards, state.board).description,
      })),
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
  config: VariantConfig
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
    paused: false,
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

export function clearGame(lobbyId: string): void {
  activeGames.delete(lobbyId);
}
