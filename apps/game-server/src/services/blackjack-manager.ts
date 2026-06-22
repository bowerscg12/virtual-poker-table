import { createHash, randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import type {
  AvatarConfig,
  BlackjackLegalAction,
  BlackjackRoundPlayerResult,
  PublicBlackjackHand,
  PublicBlackjackPlayer,
  PublicBlackjackState,
  VariantConfig,
} from '@vct/shared-types';
import {
  applyDouble,
  applyEvenMoney,
  applyHit,
  applyInsurance,
  applySplit,
  applyStand,
  applySurrender,
  allInsuranceDecided,
  blackjackRulesFromConfig,
  calculateTotal,
  createRound,
  dealInitial,
  getLegalActions,
  resolveInsurance,
  resolveRound,
  type BlackjackTableState,
  type BlackjackPlayer,
  type BlackjackHand,
} from '@vct/blackjack-engine';
import { getDb } from '../db/client.js';
import { tableSeats } from '../db/schema.js';
import { redisDel, redisGet, redisSet, keys } from '../store/redis.js';
import { isMemoryMode } from './lobby.js';
import { memoryStore } from '../store/memory-fallback.js';

// ── In-memory state ───────────────────────────────────────────────────────────

const activeGames = new Map<string, BlackjackTableState>();

// ── Persistence ───────────────────────────────────────────────────────────────

export async function getBjState(lobbyId: string): Promise<BlackjackTableState | null> {
  const mem = activeGames.get(lobbyId);
  if (mem) return mem;

  const raw = await redisGet(keys.bjState(lobbyId));
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as BlackjackTableState;
    activeGames.set(lobbyId, state);
    return state;
  } catch {
    return null;
  }
}

export async function persistBjState(lobbyId: string, state: BlackjackTableState): Promise<void> {
  activeGames.set(lobbyId, state);
  await redisSet(keys.bjState(lobbyId), JSON.stringify(state));
}

export async function clearBjState(lobbyId: string): Promise<void> {
  activeGames.delete(lobbyId);
  await redisDel(keys.bjState(lobbyId));
}

// ── Round lifecycle ───────────────────────────────────────────────────────────

export function generateBjSeed(): string {
  return randomBytes(16).toString('hex');
}

export function getBjSeedHash(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

export async function startBjRound(
  lobbyId: string,
  config: VariantConfig,
  players: { userId: string; seatIndex: number; stack: number }[],
  roundNumber: number,
): Promise<BlackjackTableState> {
  const seed = generateBjSeed();
  // Continue the prior round's shoe until the cut card is reached, then auto-reshuffle.
  const previous = await getBjState(lobbyId);
  const state = createRound({
    lobbyId,
    roundNumber,
    numDecks: config.blackjackNumDecks ?? 6,
    players,
    seed,
    previousShoe: previous?.shoe,
  });
  await persistBjState(lobbyId, state);
  return state;
}

/**
 * Place (or adjust) a bet during the betting phase.
 * Returns the updated state, or an error string.
 */
export async function placeBjBet(
  lobbyId: string,
  userId: string,
  amount: number,
  config: VariantConfig,
): Promise<BlackjackTableState | { error: string }> {
  const state = await getBjState(lobbyId);
  if (!state) return { error: 'No active round' };
  if (state.phase !== 'waiting_for_bets') return { error: 'Betting phase is closed' };

  const player = state.players.find((p) => p.userId === userId);
  if (!player) return { error: 'Not seated at this table' };

  const min = config.blackjackMinBet ?? 5;
  const max = config.blackjackMaxBet ?? 500;

  if (amount < min) return { error: `Minimum bet is ${min}` };
  if (amount > max) return { error: `Maximum bet is ${max}` };
  if (amount > player.stack) return { error: 'Insufficient chips' };

  const updated: BlackjackTableState = {
    ...state,
    players: state.players.map((p) =>
      p.userId === userId ? { ...p, pendingBet: amount } : p,
    ),
  };
  await persistBjState(lobbyId, updated);
  return updated;
}

export async function clearBjBet(
  lobbyId: string,
  userId: string,
): Promise<BlackjackTableState | { error: string }> {
  const state = await getBjState(lobbyId);
  if (!state) return { error: 'No active round' };
  if (state.phase !== 'waiting_for_bets') return { error: 'Betting phase is closed' };

  const updated: BlackjackTableState = {
    ...state,
    players: state.players.map((p) =>
      p.userId === userId ? { ...p, pendingBet: 0 } : p,
    ),
  };
  await persistBjState(lobbyId, updated);
  return updated;
}

/**
 * Remove a player from the live blackjack state (used when they cash out / leave).
 * Returns the updated state, or null if there was no state / player. Safe to call only
 * between hands — the caller is responsible for that check.
 */
export async function removeBjPlayer(
  lobbyId: string,
  userId: string,
): Promise<BlackjackTableState | null> {
  const state = await getBjState(lobbyId);
  if (!state) return null;
  if (!state.players.some((p) => p.userId === userId)) return null;

  const players = state.players.filter((p) => p.userId !== userId);
  // Keep activePlayerIndex sane even though removal only happens between hands.
  const updated: BlackjackTableState = {
    ...state,
    players,
    activePlayerIndex: -1,
  };
  await persistBjState(lobbyId, updated);
  return updated;
}

/** Close betting and deal initial cards. Returns the dealt state or an error. */
export async function closeBjBetting(
  lobbyId: string,
  config: VariantConfig,
): Promise<BlackjackTableState | { error: string }> {
  const state = await getBjState(lobbyId);
  if (!state) return { error: 'No active round' };
  if (state.phase !== 'waiting_for_bets') return { error: 'Not in betting phase' };

  const result = dealInitial(state, blackjackRulesFromConfig(config));
  if ('error' in result) return result;

  await persistBjState(lobbyId, result);
  return result;
}

/** Place or decline an insurance side bet during the insurance window. */
export async function placeBjInsurance(
  lobbyId: string,
  userId: string,
  amount: number,
): Promise<BlackjackTableState | { error: string }> {
  const state = await getBjState(lobbyId);
  if (!state) return { error: 'No active round' };
  const result = applyInsurance(state, userId, amount);
  if ('error' in result) return result;
  await persistBjState(lobbyId, result);
  return result;
}

/** Take even money on a natural during the insurance window. */
export async function takeBjEvenMoney(
  lobbyId: string,
  userId: string,
): Promise<BlackjackTableState | { error: string }> {
  const state = await getBjState(lobbyId);
  if (!state) return { error: 'No active round' };
  const result = applyEvenMoney(state, userId);
  if ('error' in result) return result;
  await persistBjState(lobbyId, result);
  return result;
}

/** True once every insurance-eligible player has decided (lets the handler close the window early). */
export async function bjInsuranceComplete(lobbyId: string): Promise<boolean> {
  const state = await getBjState(lobbyId);
  if (!state || state.phase !== 'insurance') return false;
  return allInsuranceDecided(state);
}

/** Close the insurance window: peek the hole card and begin play or settlement. */
export async function resolveBjInsurance(
  lobbyId: string,
): Promise<BlackjackTableState | { error: string }> {
  const state = await getBjState(lobbyId);
  if (!state) return { error: 'No active round' };
  if (state.phase !== 'insurance') return { error: 'Not in insurance phase' };
  const result = resolveInsurance(state);
  await persistBjState(lobbyId, result);
  return result;
}

/**
 * Apply a player action (hit, stand, double, split).
 * newHandId is only used for splits and must be a UUID generated by the caller.
 */
export async function applyBjAction(
  lobbyId: string,
  userId: string,
  action: 'hit' | 'stand' | 'double_down' | 'split' | 'surrender',
  handId: string,
  config: VariantConfig,
  newHandId?: string,
): Promise<BlackjackTableState | { error: string }> {
  const state = await getBjState(lobbyId);
  if (!state) return { error: 'No active round' };

  const rules = blackjackRulesFromConfig(config);
  let result: BlackjackTableState | { error: string };

  switch (action) {
    case 'hit':
      result = applyHit(state, userId, handId);
      break;
    case 'stand':
      result = applyStand(state, userId, handId);
      break;
    case 'double_down':
      result = applyDouble(state, userId, handId, rules);
      break;
    case 'split':
      result = applySplit(state, userId, handId, newHandId ?? crypto.randomUUID(), rules);
      break;
    case 'surrender':
      result = applySurrender(state, userId, handId, rules);
      break;
  }

  if ('error' in result) return result;
  await persistBjState(lobbyId, result);
  return result;
}

/**
 * Auto-stand the acting player (timer expiry or disconnect).
 * Silently no-ops if it's not that player's turn.
 */
export async function autoStandBjPlayer(
  lobbyId: string,
  userId: string,
): Promise<BlackjackTableState | null> {
  const state = await getBjState(lobbyId);
  if (!state || state.phase !== 'player_turn') return null;

  const player = state.players[state.activePlayerIndex];
  if (!player || player.userId !== userId) return null;

  const hand = player.hands[player.activeHandIndex];
  if (!hand) return null;

  const result = applyStand(state, userId, hand.id);
  if ('error' in result) return null;

  await persistBjState(lobbyId, result);
  return result;
}

/**
 * Run one step of the dealer AI (one card drawn).
 * Returns { state, drew: true } if a card was drawn, { state, drew: false } if dealer stood.
 * Caller should call repeatedly until drew === false, with 1s delay between steps.
 */
export async function stepBjDealer(
  lobbyId: string,
  config: VariantConfig,
): Promise<{ state: BlackjackTableState; drew: boolean } | { error: string }> {
  const state = await getBjState(lobbyId);
  if (!state) return { error: 'No active round' };
  if (state.phase !== 'dealer_turn') return { error: 'Not dealer turn' };

  const rule = config.blackjackDealerSoftSeventeen ?? 'stand';
  const { total, isSoft } = calculateTotal(state.dealer.cards);

  // Check if dealer should hit
  const shouldHit =
    total < 17 || (total === 17 && isSoft && rule === 'hit');

  if (!shouldHit) {
    // Dealer stands — transition to settlement
    await persistBjState(lobbyId, state);
    return { state, drew: false };
  }

  // Draw one card
  const shoeCard = state.shoe[0];
  if (!shoeCard) return { error: 'Shoe is empty' };

  const updated: BlackjackTableState = {
    ...state,
    shoe: state.shoe.slice(1),
    dealer: { ...state.dealer, cards: [...state.dealer.cards, shoeCard] },
  };

  await persistBjState(lobbyId, updated);
  return { state: updated, drew: true };
}

/**
 * Settle the round: compute payouts, update stacks in DB, return results.
 */
export async function settleBjRound(
  lobbyId: string,
  displayNames: Map<string, string>,
  config: VariantConfig,
): Promise<{ state: BlackjackTableState; results: BlackjackRoundPlayerResult[] } | { error: string }> {
  const state = await getBjState(lobbyId);
  if (!state) return { error: 'No active round' };

  const settled = resolveRound(state, blackjackRulesFromConfig(config));

  // Build per-player results for broadcast
  const results: BlackjackRoundPlayerResult[] = settled.players
    .filter((p) => p.status !== 'sitting_out' || p.hands.length > 0)
    .map((player) => {
      const originalPlayer = state.players.find((p) => p.userId === player.userId)!;
      // By settlement, bets/insurance are already deducted from the stack (pendingBet is 0), so the
      // net change is payouts received minus everything wagered this round (main wagers + insurance).
      const invested = player.hands.reduce((sum, h) => sum + h.wager, 0) + (player.insuranceBet ?? 0);
      const totalPayout = player.stack - originalPlayer.stack;
      const stackDelta = totalPayout - invested;
      return {
        userId: player.userId,
        seatIndex: player.seatIndex,
        displayName: displayNames.get(player.userId) ?? '',
        stackDelta,
        finalStack: player.stack,
        hands: player.hands.map((h) => ({
          handId: h.id,
          result: h.result ?? 'loss',
          payout: h.payout ?? 0,
          wager: h.wager,
        })),
      };
    });

  // Persist final stacks to DB
  await updateBjStacks(lobbyId, settled.players);

  const finalState: BlackjackTableState = { ...settled, phase: 'round_complete' };
  await persistBjState(lobbyId, finalState);

  return { state: finalState, results };
}

async function updateBjStacks(
  lobbyId: string,
  players: BlackjackPlayer[],
): Promise<void> {
  if (isMemoryMode()) {
    const lobby = memoryStore.lobbies.get(lobbyId);
    if (!lobby) return;
    for (const player of players) {
      const seat = lobby.seats.find((s) => s.userId === player.userId);
      if (seat) seat.stack = player.stack;
    }
    return;
  }
  try {
    const db = getDb();
    for (const player of players) {
      await db
        .update(tableSeats)
        .set({ stack: player.stack })
        .where(eq(tableSeats.userId, player.userId));
    }
  } catch {
    // Non-fatal — state is in Redis
  }
}

// ── Public state projection ───────────────────────────────────────────────────

/**
 * Build a `PublicBlackjackState` safe to broadcast to all clients.
 * Masks the dealer hole card unless holeCardRevealed is true.
 */
export function toPublicBjState(
  state: BlackjackTableState,
  displayNames: Map<string, string>,
  avatars: Map<string, AvatarConfig | undefined>,
  intermissionDeadline?: string,
): PublicBlackjackState {
  const shoeTotal = Math.round(state.cutCardPosition / 0.75);
  const shoePenetration = shoeTotal > 0 ? state.shoe.length / shoeTotal : 0;

  const publicPlayers: PublicBlackjackPlayer[] = state.players.map((p) => ({
    userId: p.userId,
    seatIndex: p.seatIndex,
    displayName: displayNames.get(p.userId) ?? p.userId,
    stack: p.stack,
    pendingBet: p.pendingBet,
    hands: p.hands.map((h) => toPublicHand(h)),
    activeHandIndex: p.activeHandIndex,
    status: p.status,
    avatar: avatars.get(p.userId),
    insuranceBet: p.insuranceBet || undefined,
    insuranceActed: p.insuranceActed || undefined,
  }));

  const { total: dealerTotal, isSoft: dealerSoft } = state.dealer.cards.length > 0
    ? calculateTotal(state.dealer.cards.filter((_, i) => state.dealer.holeCardRevealed || i === 0))
    : { total: 0, isSoft: false };

  const visibleDealerCards = state.dealer.cards.map((card, i) =>
    i === 1 && !state.dealer.holeCardRevealed ? null : card,
  );

  return {
    lobbyId: state.lobbyId,
    roundNumber: state.roundNumber,
    phase: state.phase,
    players: publicPlayers,
    dealer: {
      cards: visibleDealerCards,
      total: state.dealer.cards.length >= 2 ? dealerTotal : undefined,
      isSoft: dealerSoft || undefined,
      holeCardRevealed: state.dealer.holeCardRevealed,
    },
    activePlayerIndex: state.activePlayerIndex,
    betDeadline: state.betDeadline,
    actionDeadline: state.actionDeadline,
    insuranceDeadline: state.insuranceDeadline,
    intermissionDeadline,
    shoePenetration,
  };
}

function toPublicHand(h: BlackjackHand): PublicBlackjackHand {
  const { total, isSoft } = h.cards.length >= 2 ? calculateTotal(h.cards) : { total: undefined, isSoft: undefined };
  return {
    id: h.id,
    cards: h.cards,
    total,
    isSoft: isSoft || undefined,
    wager: h.wager,
    isStanding: h.isStanding,
    isBust: h.isBust,
    isBlackjack: h.isBlackjack,
    isDoubled: h.isDoubled,
    isSplit: h.isSplit,
    isSurrendered: h.isSurrendered || undefined,
    evenMoney: h.evenMoney || undefined,
    result: h.result,
    payout: h.payout,
  };
}

/** Return the legal actions for a given userId in the current round. */
export async function getBjLegalActions(
  lobbyId: string,
  userId: string,
  config: VariantConfig,
): Promise<BlackjackLegalAction[]> {
  const state = await getBjState(lobbyId);
  if (!state) return [];
  return getLegalActions(state, userId, blackjackRulesFromConfig(config));
}

/** Round number stored per lobby (persists across rounds). */
const roundNumbers = new Map<string, number>();

export function getNextBjRoundNumber(lobbyId: string): number {
  const n = (roundNumbers.get(lobbyId) ?? 0) + 1;
  roundNumbers.set(lobbyId, n);
  return n;
}

export function clearBjRoundNumber(lobbyId: string): void {
  roundNumbers.delete(lobbyId);
}
