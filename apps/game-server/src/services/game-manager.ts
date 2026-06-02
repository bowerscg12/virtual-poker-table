import { randomBytes } from 'crypto';
import type { BadgeType, Card, HandHistoryEntry, PlayerActionType, PublicTableState, ShowdownResult, VariantConfig } from '@vct/shared-types';
import { and, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import {
  applyAction,
  applyFlipCard,
  createInitialTable,
  createTwelveCardFlipState,
  getLegalActionsForSeat,
  getTwelveCardFlipLegalActions,
  getTwelveCardFlipRevealInfo,
  nextActiveSeat,
  type GameTableState,
} from '@vct/poker-engine';
import { getDb } from '../db/client.js';
import { tableSeats, users } from '../db/schema.js';
import { keys, redisGet, redisSet } from '../store/redis.js';
import { clearSitOutBlindOwed, getMemoryLobby, isMemoryMode } from './lobby.js';
import { memoryStore } from '../store/memory-fallback.js';
import { getSessionBadgeData } from './session-stats.js';

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

/** Per-seat last action, keyed lobbyId → seatIndex. Cleared on street advance and new hand. */
const seatLastActions = new Map<string, Map<number, { action: PlayerActionType; amount?: number }>>();

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
}

async function seatedPlayers(lobbyId: string): Promise<SeatedPlayer[]> {
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
        sitOutNextHand: s.sitOutNextHand,
        sitOutBlindOwed: s.sitOutBlindOwed,
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
      sitOutNextHand: seat.sitOutNextHand,
      sitOutBlindOwed: seat.sitOutBlindOwed,
    }));
}

export async function startHand(lobbyId: string, config: VariantConfig): Promise<GameTableState | { error: string }> {
  const allSeated = await seatedPlayers(lobbyId);

  // Separate fully-active, blind-owed, and fully-sitting-out players
  const fullyActive = allSeated.filter((p) => !p.sitOutNextHand);
  const blindOwed   = allSeated.filter((p) => p.sitOutNextHand && p.sitOutBlindOwed);
  // fullyOut = sitOutNextHand && !sitOutBlindOwed — excluded from all hands

  // Candidate pool for this hand: active players + those who still owe a blind
  const candidates = [...fullyActive, ...blindOwed];
  if (candidates.length < 2) return { error: 'Need at least 2 players' };

  if (config.game === 'twelve_card_flip' && candidates.length !== 2) {
    return { error: '12 Card Flip requires exactly 2 players' };
  }

  // Advance dealer through candidate seat indices
  const prevDealer = dealerRotations.get(lobbyId) ?? -1;
  const candidateIndices = candidates.map((p) => p.seatIndex).sort((a, b) => a - b);
  const nextDealerIdx = candidateIndices.find((i) => i > prevDealer) ?? candidateIndices[0];
  dealerRotations.set(lobbyId, nextDealerIdx);

  // Compute SB/BB positions from the candidate pool to determine which blind-owed seats must play
  const headsUp = candidates.length === 2;
  const sbSeat = headsUp
    ? nextDealerIdx
    : nextActiveSeat(candidateIndices, nextDealerIdx + 1, () => true)!;
  const bbSeat = nextActiveSeat(candidateIndices, sbSeat + 1, () => true)!;
  const blindSeats = new Set([sbSeat, bbSeat]);

  // Include blind-owed players only if they're in SB or BB position this hand
  const includedBlindOwed = blindOwed.filter((p) => blindSeats.has(p.seatIndex));

  const players = [...fullyActive, ...includedBlindOwed].sort((a, b) => a.seatIndex - b.seatIndex);
  if (players.length < 2) return { error: 'Need at least 2 players' };

  const handNumber = (activeGames.get(lobbyId)?.handNumber ?? 0) + 1;
  const rng = () => randomBytes(4).readUInt32BE(0) / 0xffffffff;

  const state =
    config.game === 'twelve_card_flip'
      ? createTwelveCardFlipState(players, config, handNumber, rng)
      : createInitialTable(players, config, handNumber, nextDealerIdx, rng);

  // Clear blind-owed flag for any sit-out player who just posted their final blind cycle
  for (const p of includedBlindOwed) {
    clearSitOutBlindOwed(lobbyId, p.userId).catch(() => {});
  }

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
): { public: PublicTableState; private?: { holeCards: Card[]; legalActions: import('@vct/shared-types').LegalAction[] } } {
  const viewerSeat = state.seats.find((s) => s.userId === viewerUserId);

  const isTwelveCardFlip = config.game === 'twelve_card_flip';
  const showCards = state.street === 'showdown' || state.street === 'complete';
  const lastActions = seatLastActions.get(lobbyId);
  const badges = computeBadges(lobbyId, state);

  let showdownResult: ShowdownResult | undefined;
  if (state.street === 'complete' && state.showdownHands && state.showdownHands.length > 0) {
    const winnerSeatIndices = new Set(state.lastWinningSeatIndices);
    const potWonBySeat = new Map<number, number>();
    for (const payout of state.winnerPayouts) {
      potWonBySeat.set(payout.seatIndex, (potWonBySeat.get(payout.seatIndex) ?? 0) + payout.amount);
    }
    const uniqueWinners = new Set(state.winnerPayouts.map((w) => w.seatIndex));
    showdownResult = {
      hands: state.showdownHands.map((h) => ({
        seatIndex: h.seatIndex,
        displayName: state.seats.find((s) => s.seatIndex === h.seatIndex)?.displayName ?? `Seat ${h.seatIndex + 1}`,
        handDescription: h.handDescription,
        bestFive: h.bestFive,
        isWinner: winnerSeatIndices.has(h.seatIndex),
        potWon: potWonBySeat.get(h.seatIndex) ?? 0,
      })),
      isSplit: uniqueWinners.size > 1,
    };
  }

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

  const publicState: PublicTableState = {
    lobbyId,
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
      isSmallBlind: s.seatIndex === sbSeatIndex,
      isBigBlind: s.seatIndex === bbSeatIndex,
      shownCards: showCards ? s.shownCards : undefined,
      lastAction: lastActions?.get(s.seatIndex),
      badges: badges.get(s.seatIndex),
    })),
    pots: state.pots.map((p) => ({ amount: p.amount, eligibleSeatIndices: p.eligibleSeatIndices })),
    dealerSeatIndex: state.dealerSeatIndex,
    actionSeatIndex: state.actionSeatIndex,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    actionDeadline: actionDeadline ?? undefined,
    intermissionDeadline: intermissionDeadline ?? undefined,
    paused: paused ?? false,
    showdownResult,
    flipReveal: isTwelveCardFlip && state.street !== 'waiting'
      ? getTwelveCardFlipRevealInfo(state)
      : undefined,
  };

  if (isSpectator || !viewerSeat) {
    return { public: publicState };
  }

  let legalActions: import('@vct/shared-types').LegalAction[] = [];
  if (state.actionSeatIndex === viewerSeat.seatIndex) {
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
  seatLastActions.delete(lobbyId);
  consecutiveWins.delete(lobbyId);
}
