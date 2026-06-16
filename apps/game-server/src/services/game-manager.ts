import { createHash, randomBytes } from 'crypto';
import type { BadgeType, Card, HandHistoryEntry, PlayerActionType, PublicTableState, ShowdownHandEntry, ShowdownResult, VariantConfig } from '@vct/shared-types';
import { and, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import {
  applyAction,
  applyFlipCard,
  buildSidePots,
  createBombPotTable,
  createInitialTable,
  createTwelveCardFlipState,
  dealMultipleRunouts,
  getLegalActionsForSeat,
  getTwelveCardFlipLegalActions,
  getTwelveCardFlipRevealInfo,
  nextActiveSeat,
  type GameTableState,
} from '@vct/poker-engine';
import { getDb } from '../db/client.js';
import { tableSeats, users } from '../db/schema.js';
import { keys, redisDel, redisGet, redisSet } from '../store/redis.js';
import { clearSitOutBlindOwed, getActiveLobbyIds, getMemoryLobby, isMemoryMode, restorePreHandStacks, setWaitingForReentryBlind } from './lobby.js';
import { memoryStore } from '../store/memory-fallback.js';
import { getSessionBadgeData, getLiveSessionStats } from './session-stats.js';

interface SerializedGame extends Omit<GameTableState, 'processedActionIds' | 'seats' | 'revealedCards'> {
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
  revealedCards?: Record<string, Card[]>;
}

const activeGames = new Map<string, GameTableState>();
const handHistories = new Map<string, HandHistoryEntry[]>();
let dealerRotations = new Map<string, number>();

/**
 * SHA-256 hex digest of the deck-shuffle seed for the most recently *completed* hand.
 * Published once the hand is over so players can verify card dealing was fair.
 */
const lastHandSeeds = new Map<string, string>();

/**
 * In-flight seed hash for the currently running hand.
 * Promoted to lastHandSeeds once the hand reaches 'complete'.
 */
const pendingHandSeeds = new Map<string, string>();

/** Per-seat last action, keyed lobbyId → seatIndex. Cleared on street advance and new hand. */
const seatLastActions = new Map<string, Map<number, { action: PlayerActionType; amount?: number }>>();

/** Seat indices playing blind this hand, keyed by lobbyId. Set at hand start, cleared at hand end. */
const blindHandSeats = new Map<string, Set<number>>();

export function setBlindHandSeats(lobbyId: string, seatIndices: number[]): void {
  if (seatIndices.length === 0) { blindHandSeats.delete(lobbyId); return; }
  blindHandSeats.set(lobbyId, new Set(seatIndices));
}

export function getBlindHandSeats(lobbyId: string): Set<number> {
  return blindHandSeats.get(lobbyId) ?? new Set();
}

export function clearBlindHandSeats(lobbyId: string): void {
  blindHandSeats.delete(lobbyId);
}

export function removeBlindHandSeat(lobbyId: string, seatIndex: number): void {
  const seats = blindHandSeats.get(lobbyId);
  if (!seats) return;
  seats.delete(seatIndex);
  if (seats.size === 0) blindHandSeats.delete(lobbyId);
}

/** Consecutive hand wins, keyed lobbyId → userId → streak count. Persists across hands. */
const consecutiveWins = new Map<string, Map<string, number>>();

function recordSeatLastAction(lobbyId: string, seatIndex: number, action: PlayerActionType, amount?: number): void {
  let m = seatLastActions.get(lobbyId);
  if (!m) { m = new Map(); seatLastActions.set(lobbyId, m); }
  m.set(seatIndex, amount !== undefined ? { action, amount } : { action });
}

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

/** Returns the auto action for a timer expiry. For twelve_card_flip, auto-flips. */
export function getAutoAction(
  state: GameTableState,
  config: VariantConfig,
  seatIndex: number
): PlayerActionType {
  if (config.game === 'twelve_card_flip') return 'flip_card';
  const legal = getLegalActionsForSeat(state, config, seatIndex);
  return legal.some((a) => a.type === 'check') ? 'check' : 'fold';
}

function serialize(state: GameTableState): SerializedGame {
  const revealedCards: Record<string, Card[]> | undefined = state.revealedCards
    ? Object.fromEntries(Object.entries(state.revealedCards).map(([k, v]) => [k, v]))
    : undefined;
  return {
    ...state,
    processedActionIds: [...state.processedActionIds],
    seats: state.seats.map((s) => ({ ...s, holeCards: s.holeCards })),
    revealedCards,
  };
}

function deserialize(data: SerializedGame): GameTableState {
  const revealedCards: Record<number, Card[]> | undefined = data.revealedCards
    ? Object.fromEntries(Object.entries(data.revealedCards).map(([k, v]) => [Number(k), v as Card[]]))
    : undefined;
  return {
    ...data,
    processedActionIds: new Set(data.processedActionIds),
    seats: data.seats.map((s) => ({ ...s })),
    pendingActionSeatIndices: data.pendingActionSeatIndices ?? [],
    revealedCards,
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

interface SeatedPlayer {
  seatIndex: number;
  userId: string;
  displayName: string;
  stack: number;
  sitOutNextHand: boolean;
  sitOutBlindOwed: boolean;
  waitingForReentryBlind: boolean;
}

async function seatedPlayers(lobbyId: string, excludeUserIds?: Set<string>): Promise<SeatedPlayer[]> {
  if (isMemoryMode()) {
    const lobby = getMemoryLobby(lobbyId);
    if (!lobby) return [];
    return lobby.seats
      .filter((s) => s.userId && s.stack > 0 && !excludeUserIds?.has(s.userId))
      .map((s) => ({
        seatIndex: s.seatIndex,
        userId: s.userId!,
        displayName: memoryStore.users.get(s.userId!)?.displayName ?? 'Player',
        stack: s.stack,
        sitOutNextHand: s.sitOutNextHand,
        sitOutBlindOwed: s.sitOutBlindOwed,
        waitingForReentryBlind: s.waitingForReentryBlind,
      }));
  }

  const db = getDb();
  const rawSeats = await db.select().from(tableSeats).where(and(eq(tableSeats.lobbyId, lobbyId), isNotNull(tableSeats.userId), gt(tableSeats.stack, 0)));
  const seats = excludeUserIds ? rawSeats.filter((s) => !s.userId || !excludeUserIds.has(s.userId)) : rawSeats;
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
      sitOutNextHand: seat.sitOutNextHand,
      sitOutBlindOwed: seat.sitOutBlindOwed,
      waitingForReentryBlind: seat.waitingForReentryBlind,
    }));
}

export async function startHand(
  lobbyId: string,
  config: VariantConfig,
  excludeUserIds?: Set<string>,
): Promise<GameTableState | { error: string }> {
  const allSeated = await seatedPlayers(lobbyId, excludeUserIds);

  // Separate fully-active, blind-owed, sitting-out, and reentry-waiting players
  const fullyActive    = allSeated.filter((p) => !p.sitOutNextHand && !p.waitingForReentryBlind);
  const blindOwed      = allSeated.filter((p) => p.sitOutNextHand && p.sitOutBlindOwed);
  const reentryWaiting = allSeated.filter((p) => p.waitingForReentryBlind);
  // fullyOut = sitOutNextHand && !sitOutBlindOwed — excluded from all hands

  // Reentry-blind deferral lets a player who just bought back in wait until they reach the
  // big blind before being dealt (so they can't rebuy in late position to dodge blinds).
  // That deferral is only safe when the rest of the table can already run a hand without
  // them. If there are fewer than 2 fully-active players, deferring would deadlock the table
  // (classic heads-up case: one player busts and rebuys, but is never the BB so never gets
  // dealt in). In that case promote reentry-waiting players to be dealt in immediately.
  const deferReentry = fullyActive.length >= 2;
  const immediateReentry  = deferReentry ? [] : reentryWaiting; // dealt in like fully-active
  const positionalReentry = deferReentry ? reentryWaiting : []; // dealt in only when in BB
  const activePlayers = [...fullyActive, ...immediateReentry];

  // Candidate pool for dealer rotation: active + blind-owed + positional reentry-waiting
  // (positional reentry-waiting players join the rotation so the table doesn't stall)
  const candidates = [...activePlayers, ...blindOwed, ...positionalReentry];
  if (candidates.length < 2) return { error: 'Need at least 2 players' };

  if (config.game === 'twelve_card_flip' && candidates.length !== 2) {
    return { error: '12 Card Flip requires exactly 2 players' };
  }

  // Advance dealer through candidate seat indices; randomize on first hand
  const candidateIndices = candidates.map((p) => p.seatIndex).sort((a, b) => a - b);
  let nextDealerIdx: number;
  if (!dealerRotations.has(lobbyId)) {
    const randomOffset = randomBytes(4).readUInt32BE(0) % candidateIndices.length;
    nextDealerIdx = candidateIndices[randomOffset];
  } else {
    const prevDealer = dealerRotations.get(lobbyId)!;
    nextDealerIdx = candidateIndices.find((i) => i > prevDealer) ?? candidateIndices[0];
  }
  dealerRotations.set(lobbyId, nextDealerIdx);

  // Compute SB/BB positions from the candidate pool
  const headsUp = candidates.length === 2;
  const sbSeat = headsUp
    ? nextDealerIdx
    : nextActiveSeat(candidateIndices, nextDealerIdx + 1, () => true)!;
  const bbSeat = nextActiveSeat(candidateIndices, sbSeat + 1, () => true)!;
  const blindSeats = new Set([sbSeat, bbSeat]);

  // Include blind-owed players only if they're in SB or BB position this hand
  const includedBlindOwed = blindOwed.filter((p) => blindSeats.has(p.seatIndex));

  // Include positional reentry-waiting players only when they land in the BB (their reentry cost)
  const includedReentry = positionalReentry.filter((p) => p.seatIndex === bbSeat);

  const players = [...activePlayers, ...includedBlindOwed, ...includedReentry].sort((a, b) => a.seatIndex - b.seatIndex);
  if (players.length < 2) return { error: 'Need at least 2 players' };

  const handNumber = (activeGames.get(lobbyId)?.handNumber ?? 0) + 1;
  // Generate a fixed seed buffer and derive all random draws from it so we can
  // publish its hash after the hand for provably-fair verification.
  // Generate a fixed 32-byte seed, hash it, and derive all RNG draws from it so we
  // can publish the hash after the hand ends for provably-fair verification.
  const seedBuf = randomBytes(32);
  const seedHash = createHash('sha256').update(seedBuf).digest('hex');
  // Clear last hand's published seed for this lobby while the new hand runs.
  lastHandSeeds.delete(lobbyId);
  pendingHandSeeds.set(lobbyId, seedHash);
  let seedOffset = 0;
  const rng = () => {
    const val = seedBuf.readUInt32BE(seedOffset % 28) / 0xffffffff;
    seedOffset = (seedOffset + 4) % 32;
    return val;
  };

  const state =
    config.game === 'twelve_card_flip'
      ? createTwelveCardFlipState(players, config, handNumber, rng)
      : createInitialTable(players, config, handNumber, nextDealerIdx, rng);

  // Clear blind-owed flag for any sit-out player who just posted their final blind cycle
  for (const p of includedBlindOwed) {
    clearSitOutBlindOwed(lobbyId, p.userId).catch(() => {});
  }

  // Clear reentry flag for players who just entered: those who posted their entry big blind
  // (positional) and those force-dealt because the table couldn't otherwise reach 2 players.
  for (const p of [...includedReentry, ...immediateReentry]) {
    setWaitingForReentryBlind(lobbyId, p.userId, false).catch(() => {});
  }

  seatLastActions.delete(lobbyId);
  await persistGame(lobbyId, state);
  syncStacksToLobby(lobbyId, state);
  return state;
}

/**
 * Start a Bomb Pot hand with the given opted-in participants. Advances the dealer through
 * the participant seats, deals/collects/runs the board(s) via createBombPotTable, and persists.
 */
export async function startBombPotHand(
  lobbyId: string,
  config: VariantConfig,
  amount: number,
  doubleBoard: boolean,
  participantUserIds: string[]
): Promise<GameTableState | { error: string }> {
  const allSeated = await seatedPlayers(lobbyId);
  const idSet = new Set(participantUserIds);
  const participants = allSeated.filter((p) => idSet.has(p.userId) && p.stack > 0).sort((a, b) => a.seatIndex - b.seatIndex);
  if (participants.length < 2) return { error: 'Need at least 2 participants' };

  const prevDealer = dealerRotations.get(lobbyId) ?? -1;
  const seatIndices = participants.map((p) => p.seatIndex);
  const nextDealerIdx = seatIndices.find((i) => i > prevDealer) ?? seatIndices[0];
  dealerRotations.set(lobbyId, nextDealerIdx);

  const handNumber = (activeGames.get(lobbyId)?.handNumber ?? 0) + 1;
  const seedBuf = randomBytes(32);
  const seedHash = createHash('sha256').update(seedBuf).digest('hex');
  lastHandSeeds.delete(lobbyId);
  pendingHandSeeds.set(lobbyId, seedHash);
  let seedOffset = 0;
  const rng = () => {
    const val = seedBuf.readUInt32BE(seedOffset % 28) / 0xffffffff;
    seedOffset = (seedOffset + 4) % 32;
    return val;
  };

  const state = createBombPotTable(participants, config, handNumber, nextDealerIdx, amount, doubleBoard, rng);

  seatLastActions.delete(lobbyId);
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

  // Capture all-in total before state mutation (engine uses betThisStreet + stack as target)
  const allInTotal = action === 'all_in' ? seat.betThisStreet + seat.stack : undefined;
  const actingSeatIndex = seat.seatIndex;

  let result: { ok: true; state: GameTableState } | { ok: false; error: string };

  if (config.game === 'twelve_card_flip') {
    if (action !== 'flip_card') return { error: 'Only flip_card is allowed in 12 Card Flip' };
    result = applyFlipCard(state, seat.seatIndex, actionId);
  } else {
    result = applyAction(state, config, seat.seatIndex, action, amount, actionId);
  }

  if (!result.ok) return { error: result.error };

  // Clear action badges when the street advances; update win streaks when hand ends.
  // state.street is still the pre-action street here (reassignment happens below).
  if (result.state.street !== state.street) {
    seatLastActions.delete(lobbyId);
    if (result.state.street === 'complete') updateConsecutiveWins(lobbyId, result.state);
  } else if (action !== 'flip_card') {
    const badgeAmount = action === 'all_in' ? allInTotal : amount;
    recordSeatLastAction(lobbyId, actingSeatIndex, action, badgeAmount);
  }

  state = result.state;
  if (state.street === 'complete') {
    state = applySevenDeuceRule(state, config);
  }
  await persistGame(lobbyId, state);
  syncStacksToLobby(lobbyId, state);

  if (state.street === 'complete') {
    // Promote the in-flight seed hash to the published map so clients can verify fairness.
    const seedHash = pendingHandSeeds.get(lobbyId);
    if (seedHash) {
      lastHandSeeds.set(lobbyId, seedHash);
      pendingHandSeeds.delete(lobbyId);
    }
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

/** Called when a hand completes; updates each player's consecutive-win streak. */
function updateConsecutiveWins(lobbyId: string, state: GameTableState): void {
  let m = consecutiveWins.get(lobbyId);
  if (!m) { m = new Map(); consecutiveWins.set(lobbyId, m); }
  const winners = new Set(state.lastWinningSeatIndices ?? []);
  for (const seat of state.seats) {
    if (winners.has(seat.seatIndex)) {
      m.set(seat.userId, (m.get(seat.userId) ?? 0) + 1);
    } else {
      m.set(seat.userId, 0);
    }
  }
}

/**
 * Computes which superlative badges each seat currently earns.
 * Only awards a badge when there is a single clear leader — ties are never awarded.
 */
function computeBadges(lobbyId: string, state: GameTableState): Map<number, BadgeType[]> {
  const result = new Map<number, BadgeType[]>();

  function award(seatIndex: number, badge: BadgeType) {
    const existing = result.get(seatIndex) ?? [];
    result.set(seatIndex, [...existing, badge]);
  }

  // ── Stack-based (live, no session history needed) ─────────────────────────
  if (state.seats.length >= 2) {
    const maxStack = Math.max(...state.seats.map((s) => s.stack));
    const bigStackers = state.seats.filter((s) => s.stack === maxStack);
    if (bigStackers.length === 1) award(bigStackers[0].seatIndex, 'big_stack');

    const withChips = state.seats.filter((s) => s.stack > 0);
    if (withChips.length >= 2) {
      const minStack = Math.min(...withChips.map((s) => s.stack));
      const shortStackers = withChips.filter((s) => s.stack === minStack);
      if (shortStackers.length === 1) award(shortStackers[0].seatIndex, 'short_stack');
    }
  }

  // ── Hot streak (individual threshold, not comparative — multiple players can hold) ──
  const streaks = consecutiveWins.get(lobbyId);
  if (streaks) {
    for (const seat of state.seats) {
      if ((streaks.get(seat.userId) ?? 0) >= 3) award(seat.seatIndex, 'hot_streak');
    }
  }

  // ── Session-based (require ≥2 seated players with data; ties → no badge) ──
  const badgeData = getSessionBadgeData(lobbyId);
  const seatedIds = new Set(state.seats.map((s) => s.userId));
  const seated = badgeData.filter((d) => seatedIds.has(d.userId));
  if (seated.length < 2) return result;

  function seatIdxFor(userId: string): number | undefined {
    return state.seats.find((s) => s.userId === userId)?.seatIndex;
  }

  /** Awards badge to the sole leader of a numeric score; skips if tied or all at minScore. */
  function awardLeader(
    scoreFn: (d: typeof seated[0]) => number,
    minScore: number,
    badge: BadgeType,
    subset: typeof seated = seated,
  ) {
    if (subset.length < 2) return;
    const scores = subset.map((d) => ({ userId: d.userId, score: scoreFn(d) }));
    const max = Math.max(...scores.map((s) => s.score));
    if (max <= minScore) return;
    const leaders = scores.filter((s) => s.score === max);
    if (leaders.length !== 1) return;
    const si = seatIdxFor(leaders[0].userId);
    if (si !== undefined) award(si, badge);
  }

  const withHands = seated.filter((d) => d.handsPlayed > 0);

  // calling_station: highest calls per hand
  awardLeader((d) => d.callCount / d.handsPlayed, 0, 'calling_station', withHands);

  // charlie: highest preflop fold rate
  awardLeader((d) => d.preflopFoldsCount / d.handsPlayed, 0, 'charlie', withHands);

  // maniac: most total raises (raise + all_in)
  awardLeader((d) => d.totalRaises, 0, 'maniac');

  // loose_cannon: highest VPIP rate
  awardLeader((d) => d.vpipHands / d.handsPlayed, 0, 'loose_cannon', withHands);

  // most_blind_wins: most hands won while playing blind (minimum 1 to qualify)
  awardLeader((d) => d.handsWonBlind, 0, 'most_blind_wins');

  // whale: largest net chip loss (total invested − current stack)
  const withLoss = seated.map((d) => {
    const currentStack = state.seats.find((s) => s.userId === d.userId)?.stack ?? 0;
    return { userId: d.userId, score: d.totalChipsPurchased - currentStack };
  });
  const maxLoss = Math.max(...withLoss.map((w) => w.score));
  if (maxLoss > 0) {
    const whales = withLoss.filter((w) => w.score === maxLoss);
    if (whales.length === 1) {
      const si = seatIdxFor(whales[0].userId);
      if (si !== undefined) award(si, 'whale');
    }
  }

  return result;
}

export function toPublicState(
  lobbyId: string,
  state: GameTableState,
  viewerUserId: string | null,
  isSpectator: boolean,
  config: VariantConfig,
  actionDeadline?: string | null,
  paused?: boolean,
  intermissionDeadline?: string | null,
  runoutVisibleBoardCount?: number,
  runoutActive?: boolean,
  revealAllHoleCards?: boolean,
  runoutCurrentRun?: number,
  runoutTotalRuns?: number,
  suppressLegalActions?: boolean,
): { public: PublicTableState; private?: { holeCards: Card[]; legalActions: import('@vct/shared-types').LegalAction[] } } {
  const viewerSeat = state.seats.find((s) => s.userId === viewerUserId);

  const isTwelveCardFlip = config.game === 'twelve_card_flip';
  const showCards = state.street === 'showdown' || state.street === 'complete';
  // During a runout the engine state is already 'complete', so gate hole-card reveal on the
  // runout flag instead: all-in runouts reveal throughout; bomb-pot runouts hide until the flop.
  const revealHole = runoutActive ? !!revealAllHoleCards : showCards;
  const lastActions = seatLastActions.get(lobbyId);
  const badges = computeBadges(lobbyId, state);
  const currentStacks = new Map(state.seats.map((s) => [s.userId, s.stack]));
  const liveStats = getLiveSessionStats(lobbyId, currentStacks);

  const displayNameFor = (seatIndex: number) =>
    state.seats.find((s) => s.seatIndex === seatIndex)?.displayName ?? `Seat ${seatIndex + 1}`;

  let showdownResult: ShowdownResult | undefined;
  if (state.street === 'complete' && state.showdownHands && state.showdownHands.length > 0) {
    const isDoubleBoard = state.isDoubleBoardBombPot && !!state.secondShowdownHands;
    const isMultiRunout = !!state.runoutBoards && state.runoutBoards.length > 1;

    // Build ShowdownHandEntry[] from raw hands + a filtered payout set.
    const buildHandsFromPayouts = (
      hands: { seatIndex: number; handDescription: string; bestFive: Card[] }[],
      payouts: GameTableState['winnerPayouts'],
    ): ShowdownHandEntry[] => {
      const contestedBySeat = new Map<number, number>();
      const returnedBySeat = new Map<number, number>();
      for (const payout of payouts) {
        if (payout.isContested) {
          contestedBySeat.set(payout.seatIndex, (contestedBySeat.get(payout.seatIndex) ?? 0) + payout.amount);
        } else {
          returnedBySeat.set(payout.seatIndex, (returnedBySeat.get(payout.seatIndex) ?? 0) + payout.amount);
        }
      }
      return hands.map((h) => ({
        seatIndex: h.seatIndex,
        displayName: displayNameFor(h.seatIndex),
        handDescription: h.handDescription,
        bestFive: h.bestFive,
        isWinner: contestedBySeat.has(h.seatIndex),
        potWon: contestedBySeat.get(h.seatIndex) ?? 0,
        chipsReturned: returnedBySeat.get(h.seatIndex),
      }));
    };

    if (isMultiRunout) {
      // Multi-runout: build per-run board sections + combined summary hands.
      const runoutBoards = state.runoutBoards!.map((board, runIdx) => {
        const runData = state.runoutShowdownHands?.[runIdx];
        const runPayouts = state.winnerPayouts.filter((p) => p.runIndex === runIdx);
        return {
          board,
          hands: buildHandsFromPayouts(runData?.hands ?? [], runPayouts),
        };
      });

      // Combined summary: total pots won across all runs.
      const contestedWinners = new Set(state.winnerPayouts.filter((p) => p.isContested).map((p) => p.seatIndex));
      const isSplit = contestedWinners.size > 1;
      const soloWinner = contestedWinners.size === 1 ? displayNameFor([...contestedWinners][0]) : undefined;

      showdownResult = {
        hands: buildHandsFromPayouts(state.showdownHands, state.winnerPayouts),
        isSplit,
        soloWinner: isSplit ? undefined : soloWinner,
        runoutBoards,
      };
    } else {
      // For a double board, winners/pots are tracked per board via the payout's `board` tag.
      const buildHands = (
        hands: { seatIndex: number; handDescription: string; bestFive: Card[] }[],
        board: 'A' | 'B' | null,
      ) => {
        const payouts = board ? state.winnerPayouts.filter((p) => p.board === board) : state.winnerPayouts;
        return buildHandsFromPayouts(hands, payouts);
      };

      // Only count winners of contested pots (2+ eligible players) to distinguish a true split
      // from an uncalled-chip return in a short-stack all-in scenario.
      const contestedWinnerIndices = new Set(
        state.winnerPayouts.filter((p) => p.isContested).map((p) => p.seatIndex)
      );
      const isSplit = contestedWinnerIndices.size > 1;
      const soloWinner =
        !isDoubleBoard && contestedWinnerIndices.size === 1
          ? displayNameFor([...contestedWinnerIndices][0])
          : undefined;

      showdownResult = {
        hands: buildHands(state.showdownHands, isDoubleBoard ? 'A' : null),
        isSplit,
        soloWinner,
        ...(isDoubleBoard
          ? { board: state.board, secondBoard: state.secondBoard, secondHands: buildHands(state.secondShowdownHands!, 'B') }
          : {}),
      };
    }
  }

  // Compute pots for display. state.pots is only populated at showdown; during an active hand
  // we derive a live pot from each seat's total committed chips so the center always shows the
  // correct amount. After the hand is complete (fold win) pots is empty but we don't show it.
  const handInProgress = state.street !== 'complete' && state.street !== 'waiting';
  const displayPots =
    state.pots.length > 0
      ? state.pots
      : handInProgress
        ? buildSidePots(state.seats.map((s) => ({ seatIndex: s.seatIndex, amount: s.totalBet })))
        : [];

  const activeIndices = state.seats.map((s) => s.seatIndex).sort((a, b) => a - b);
  const headsUp = activeIndices.length === 2;
  const sbSeatIndex = activeIndices.length >= 2
    ? (headsUp
        ? state.dealerSeatIndex
        : (nextActiveSeat(activeIndices, state.dealerSeatIndex + 1, () => true) ?? -1))
    : -1;
  const bbSeatIndex = activeIndices.length >= 2
    ? (nextActiveSeat(activeIndices, sbSeatIndex + 1, () => true) ?? -1)
    : -1;

  // During a runout, truncate the board(s) to the currently-revealed count and hide the winner.
  const visibleBoard =
    runoutVisibleBoardCount !== undefined
      ? state.board.slice(0, runoutVisibleBoardCount)
      : state.board;
  const visibleSecondBoard = state.secondBoard
    ? (runoutVisibleBoardCount !== undefined ? state.secondBoard.slice(0, runoutVisibleBoardCount) : state.secondBoard)
    : undefined;
  const effectiveShowdownResult = runoutActive ? undefined : showdownResult;

  const publicState: PublicTableState = {
    lobbyId,
    handNumber: state.handNumber,
    street: state.street,
    board: visibleBoard,
    secondBoard: visibleSecondBoard,
    bombPot: state.isBombPot ? { amount: state.bombPotAmount, doubleBoard: state.isDoubleBoardBombPot } : undefined,
    seats: state.seats.map((s) => ({
      seatIndex: s.seatIndex,
      userId: s.userId,
      displayName: s.displayName,
      stack: s.stack,
      betThisStreet: s.betThisStreet,
      totalBet: s.totalBet,
      folded: s.folded,
      allIn: s.allIn,
      isDealer: state.street === 'preflop' && s.seatIndex === state.dealerSeatIndex,
      isSmallBlind: state.street === 'preflop' && s.seatIndex === sbSeatIndex,
      isBigBlind: state.street === 'preflop' && s.seatIndex === bbSeatIndex,
      shownCards: revealHole ? s.shownCards : undefined,
      lastAction: lastActions?.get(s.seatIndex),
      badges: badges.get(s.seatIndex),
      isBlindThisHand: blindHandSeats.get(lobbyId)?.has(s.seatIndex) || undefined,
      sessionStats: liveStats.get(s.userId),
    })),
    pots: displayPots.map((p) => ({ amount: p.amount, eligibleSeatIndices: p.eligibleSeatIndices })),
    dealerSeatIndex: state.dealerSeatIndex,
    actionSeatIndex: state.actionSeatIndex,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    actionDeadline: actionDeadline ?? undefined,
    intermissionDeadline: intermissionDeadline ?? undefined,
    paused: paused ?? false,
    showdownResult: effectiveShowdownResult,
    runout: runoutActive ? { active: true, currentRun: runoutCurrentRun, totalRuns: runoutTotalRuns } : undefined,
    flipReveal: isTwelveCardFlip && state.street !== 'waiting'
      ? getTwelveCardFlipRevealInfo(state)
      : undefined,
    // Publish the seed hash only once the hand is over so players can verify fairness.
    lastHandSeed: state.street === 'complete' ? lastHandSeeds.get(lobbyId) : undefined,
  };

  if (isSpectator || !viewerSeat) {
    return { public: publicState };
  }

  let legalActions: import('@vct/shared-types').LegalAction[] = [];
  if (!suppressLegalActions && state.actionSeatIndex === viewerSeat.seatIndex) {
    if (isTwelveCardFlip) {
      legalActions = getTwelveCardFlipLegalActions(state, viewerSeat.seatIndex);
    } else {
      legalActions = getLegalActionsForSeat(state, config, viewerSeat.seatIndex);
    }
  }

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
 * Remove the card at `cardIndex` from a player's hole cards during the Pineapple discard phase.
 * No-op if the game, seat, or index is invalid.
 */
export async function removePineappleCard(lobbyId: string, userId: string, cardIndex: number): Promise<boolean> {
  const state = activeGames.get(lobbyId);
  if (!state) return false;
  const seat = state.seats.find((s) => s.userId === userId);
  if (!seat || cardIndex < 0 || cardIndex >= seat.holeCards.length) return false;
  seat.holeCards = seat.holeCards.filter((_, i) => i !== cardIndex);
  await persistGame(lobbyId, state);
  return true;
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

/**
 * Apply a chip donation to the active engine state so the next broadcastTableState
 * reflects the updated stacks immediately. No-op when no hand is in progress.
 */
export async function transferChipsBetweenSeats(
  lobbyId: string,
  donorUserId: string,
  recipientUserId: string,
  amount: number,
): Promise<void> {
  const state = activeGames.get(lobbyId);
  if (!state) return;
  const donorSeat = state.seats.find((s) => s.userId === donorUserId);
  const recipientSeat = state.seats.find((s) => s.userId === recipientUserId);
  if (donorSeat) donorSeat.stack = Math.max(0, donorSeat.stack - amount);
  if (recipientSeat) recipientSeat.stack += amount;
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
  seatLastActions.delete(lobbyId);
  consecutiveWins.delete(lobbyId);
  blindHandSeats.delete(lobbyId);
}

/**
 * Deal N run-out boards on the paused multi-runout state, resolve the showdown, persist
 * the result, and return the completed GameTableState. `state` must have `pendingMultiRunout`.
 */
export async function applyMultipleRunouts(
  lobbyId: string,
  config: VariantConfig,
  state: GameTableState,
  numRuns: number,
): Promise<GameTableState> {
  const finalState = dealMultipleRunouts(state, config, numRuns);
  if (finalState.street === 'complete') {
    updateConsecutiveWins(lobbyId, finalState);
    const sevenDeuceState = applySevenDeuceRule(finalState, config);
    await persistGame(lobbyId, sevenDeuceState);
    syncStacksToLobby(lobbyId, sevenDeuceState);
    await recordHandHistory(lobbyId, sevenDeuceState);
    return sevenDeuceState;
  }
  await persistGame(lobbyId, finalState);
  return finalState;
}

/** Streets that indicate a hand is actively in progress and has not yet completed. */
const INTERRUPTED_HAND_STREETS = new Set(['preflop', 'flop', 'turn', 'river', 'showdown', 'reveal']);

/**
 * Cancel an interrupted hand from a previous server instance and restore pre-hand chip counts.
 *
 * Only acts on game states that exist in Redis but are NOT tracked by the current server instance
 * (i.e., `activeGames` does not contain them — the server restarted before they could complete).
 *
 * Stack restoration formula: for each seat, `restoredStack = seat.stack + seat.totalBet`.
 * `totalBet` accumulates every chip the player committed this hand across all streets, so
 * adding it back to their remaining stack yields their exact pre-hand chip count.
 *
 * Returns true if an interrupted hand was found and cancelled.
 */
export async function cancelInterruptedHand(lobbyId: string): Promise<boolean> {
  // If this server instance already tracks the game, it was started here — don't cancel it.
  if (activeGames.has(lobbyId)) return false;

  const raw = await redisGet(keys.tableState(lobbyId));
  if (!raw) return false;

  let state: GameTableState;
  try {
    state = deserialize(JSON.parse(raw) as SerializedGame);
  } catch {
    console.warn(`[recovery] Could not parse persisted game state for lobby ${lobbyId} — skipping`);
    return false;
  }

  if (!INTERRUPTED_HAND_STREETS.has(state.street)) return false;

  console.log(
    `[recovery] Interrupted hand detected — lobby=${lobbyId} hand=#${state.handNumber} ` +
    `street=${state.street} players=${state.seats.length} ` +
    `at=${new Date().toISOString()}`
  );

  // Each player's pre-hand stack = chips still held + all chips committed to the pot this hand.
  const stacksByUserId = new Map<string, number>();
  for (const seat of state.seats) {
    stacksByUserId.set(seat.userId, seat.stack + seat.totalBet);
  }

  console.log(`[recovery] Cancelling interrupted hand and restoring pre-hand stacks for lobby ${lobbyId}`);

  await restorePreHandStacks(lobbyId, stacksByUserId);

  activeGames.delete(lobbyId);
  seatLastActions.delete(lobbyId);
  blindHandSeats.delete(lobbyId);
  await redisDel(keys.tableState(lobbyId));

  console.log(`[recovery] Lobby ${lobbyId} returned to waiting state`);
  return true;
}

/**
 * Startup recovery pass: scan every active lobby for a hand that was in progress when the
 * previous server instance stopped. Each interrupted hand is cancelled and pre-hand stacks
 * are restored so the host can simply press "Start Hand" to begin a fresh hand.
 *
 * In memory mode this is a no-op — nothing survives a restart, so there is nothing to recover.
 */
export async function recoverInterruptedHands(): Promise<void> {
  if (isMemoryMode()) return;

  let lobbyIds: string[];
  try {
    lobbyIds = await getActiveLobbyIds();
  } catch (err) {
    console.error('[recovery] Failed to query active lobbies at startup:', err);
    return;
  }

  if (lobbyIds.length === 0) return;

  console.log(`[recovery] Startup: scanning ${lobbyIds.length} active lobby/lobbies for interrupted hands`);

  let cancelledCount = 0;
  for (const lobbyId of lobbyIds) {
    try {
      const cancelled = await cancelInterruptedHand(lobbyId);
      if (cancelled) cancelledCount++;
    } catch (err) {
      console.error(`[recovery] Error checking lobby ${lobbyId}:`, err);
    }
  }

  if (cancelledCount > 0) {
    console.log(`[recovery] Startup recovery complete: cancelled ${cancelledCount} interrupted hand(s)`);
  } else {
    console.log('[recovery] Startup: no interrupted hands found');
  }
}
