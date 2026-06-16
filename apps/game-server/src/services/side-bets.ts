/**
 * 1v1 hole-card side bets — private wagers between two seated players.
 *
 * State is in-memory and per-lobby, mirroring the transient bomb-pot / run-it-out pattern.
 * Side bets are completely independent of the poker pot, side pots, hand evaluation, and
 * showdown. A bet is evaluated the moment cards are dealt (result stored internally) and only
 * revealed to clients after the poker hand fully concludes. Settlement transfers chips directly
 * between the two players, clamped to the loser's remaining stack.
 *
 * Rule (per product decision): a player may hold at most ONE non-terminal side bet at a time.
 */
import type {
  Card,
  Suit,
  SideBetChallenge,
  SideBetResult,
  SideBetType,
} from '@vct/shared-types';
import { cardToString } from '@vct/shared-types';
import { parseCard, rankValue, type GameTableState } from '@vct/poker-engine';

// ── Internal state ──────────────────────────────────────────────────────────

interface ActiveSideBet extends SideBetChallenge {
  /** Hand number this bet was bound to (set when status becomes 'active'). */
  boundHandNumber?: number;
  /** Result computed at bind time, revealed only at settlement. */
  result?: SideBetResult;
}

/** lobbyId → bets (including terminal ones until cleaned up on settle/expire). */
const lobbyBets = new Map<string, ActiveSideBet[]>();

/**
 * One-shot queue of bind notifications. Populated by `bindToHand` (called from game-manager at
 * deal time) and drained by the handler on the next table_state broadcast — keeps socket I/O in
 * the handler while the bind itself stays at the engine-adjacent hand-start choke point.
 */
const notifyQueue = new Map<string, BindOutcome>();

const NON_TERMINAL: ReadonlySet<string> = new Set(['pending', 'accepted', 'active']);

function bets(lobbyId: string): ActiveSideBet[] {
  let arr = lobbyBets.get(lobbyId);
  if (!arr) {
    arr = [];
    lobbyBets.set(lobbyId, arr);
  }
  return arr;
}

/** True if the user already holds a pending/accepted/active bet in this lobby. */
export function userHasOpenBet(lobbyId: string, userId: string): boolean {
  return bets(lobbyId).some(
    (b) =>
      NON_TERMINAL.has(b.status) &&
      (b.challengerUserId === userId || b.targetUserId === userId),
  );
}

// ── Evaluation (pure) ───────────────────────────────────────────────────────

/** Blackjack value of a rank: A=11, K/Q/J/T=10, 2–9 face value. */
export function blackjackValue(card: Card): number {
  const { rank } = parseCard(card);
  if (rank === 'A') return 11;
  if (rank === 'K' || rank === 'Q' || rank === 'J' || rank === 'T') return 10;
  return rankValue(rank); // 2–9
}

/** Best (highest) rank value among a player's cards of the given suit, or null if none. */
function bestOfSuit(cards: Card[], suit: Suit, highest: boolean): { value: number; card: Card } | null {
  let best: { value: number; card: Card } | null = null;
  for (const c of cards) {
    const p = parseCard(c);
    if (p.suit !== suit) continue;
    const v = rankValue(p.rank);
    if (best === null || (highest ? v > best.value : v < best.value)) {
      best = { value: v, card: c };
    }
  }
  return best;
}

function sumValue(cards: Card[]): number {
  return cards.reduce((acc, c) => acc + blackjackValue(c), 0);
}

export interface SideBetEvaluation {
  /** 'challenger' | 'target' | 'push' */
  winner: 'challenger' | 'target' | 'push';
  challengerValue: string;
  targetValue: string;
}

/**
 * Pure evaluation of a side bet from two players' hole cards. Higher numeric metric wins for
 * `highest_*`, lower wins for `lowest_*`; equal metrics push.
 */
export function evaluateSideBet(
  type: SideBetType,
  suit: Suit | undefined,
  challengerCards: Card[],
  targetCards: Card[],
): SideBetEvaluation {
  if (type === 'highest_suit' || type === 'lowest_suit') {
    const highest = type === 'highest_suit';
    if (!suit) throw new Error('suit required for suit side bet');
    const c = bestOfSuit(challengerCards, suit, highest);
    const t = bestOfSuit(targetCards, suit, highest);
    // A player holding none of the suit is the worst possible: lose unless both lack it.
    const cMetric = c ? c.value : highest ? -Infinity : Infinity;
    const tMetric = t ? t.value : highest ? -Infinity : Infinity;
    let winner: SideBetEvaluation['winner'];
    if (cMetric === tMetric) winner = 'push';
    else if (highest) winner = cMetric > tMetric ? 'challenger' : 'target';
    else winner = cMetric < tMetric ? 'challenger' : 'target';
    return {
      winner,
      challengerValue: c ? cardToString(c.card) : '—',
      targetValue: t ? cardToString(t.card) : '—',
    };
  }

  // Sum bets
  const highest = type === 'highest_sum';
  const cSum = sumValue(challengerCards);
  const tSum = sumValue(targetCards);
  let winner: SideBetEvaluation['winner'];
  if (cSum === tSum) winner = 'push';
  else if (highest) winner = cSum > tSum ? 'challenger' : 'target';
  else winner = cSum < tSum ? 'challenger' : 'target';
  return { winner, challengerValue: String(cSum), targetValue: String(tSum) };
}

// ── Challenge lifecycle ─────────────────────────────────────────────────────

export type CreateChallengeResult =
  | { ok: true; challenge: SideBetChallenge }
  | { ok: false; reason: string };

export function createChallenge(
  lobbyId: string,
  params: {
    id: string;
    challengerUserId: string;
    challengerName: string;
    targetUserId: string;
    targetName: string;
    type: SideBetType;
    suit?: Suit;
    wager: number;
  },
): CreateChallengeResult {
  if (userHasOpenBet(lobbyId, params.challengerUserId)) {
    return { ok: false, reason: 'You already have an active side bet' };
  }
  if (userHasOpenBet(lobbyId, params.targetUserId)) {
    return { ok: false, reason: 'That player already has an active side bet' };
  }
  const challenge: ActiveSideBet = { ...params, status: 'pending' };
  bets(lobbyId).push(challenge);
  return { ok: true, challenge };
}

export type AcceptResult =
  | { ok: true; challenge: SideBetChallenge }
  | { ok: false; reason: string };

/** Target accepts a pending challenge. Only the target user may accept. */
export function acceptChallenge(lobbyId: string, challengeId: string, userId: string): AcceptResult {
  const bet = bets(lobbyId).find((b) => b.id === challengeId);
  if (!bet || bet.status !== 'pending') return { ok: false, reason: 'Challenge no longer available' };
  if (bet.targetUserId !== userId) return { ok: false, reason: 'Not your challenge to accept' };
  bet.status = 'accepted';
  return { ok: true, challenge: bet };
}

/** Target declines (or either party cancels) a pending challenge. Removes it. */
export function declineChallenge(lobbyId: string, challengeId: string, userId: string): SideBetChallenge | null {
  const arr = bets(lobbyId);
  const idx = arr.findIndex((b) => b.id === challengeId && b.status === 'pending');
  if (idx === -1) return null;
  const bet = arr[idx];
  if (bet.targetUserId !== userId && bet.challengerUserId !== userId) return null;
  arr.splice(idx, 1);
  return bet;
}

// ── Bind to a hand (evaluate-at-deal, store internally) ──────────────────────

export interface BindOutcome {
  activated: { bet: SideBetChallenge; participantUserIds: [string, string]; opponentNameByUser: Record<string, string> }[];
  expired: { bet: SideBetChallenge; participantUserIds: [string, string]; reason: string }[];
}

/**
 * Called right after a hand is dealt. Binds every `accepted` bet to this hand if both
 * participants were dealt in (≥2 hole cards); evaluates and stores the result internally.
 * Bets where a participant isn't in the hand expire.
 */
export function bindToHand(lobbyId: string, state: GameTableState): BindOutcome {
  const outcome: BindOutcome = { activated: [], expired: [] };
  const seatByUser = new Map<string, GameTableState['seats'][number]>();
  for (const s of state.seats) seatByUser.set(s.userId, s);

  for (const bet of bets(lobbyId)) {
    if (bet.status !== 'accepted') continue;
    const cSeat = seatByUser.get(bet.challengerUserId);
    const tSeat = seatByUser.get(bet.targetUserId);
    const participantUserIds: [string, string] = [bet.challengerUserId, bet.targetUserId];

    if (!cSeat || !tSeat || cSeat.holeCards.length < 2 || tSeat.holeCards.length < 2) {
      bet.status = 'expired';
      outcome.expired.push({
        bet,
        participantUserIds,
        reason: 'A participant was not dealt into the hand',
      });
      continue;
    }

    const evalResult = evaluateSideBet(bet.type, bet.suit, cSeat.holeCards, tSeat.holeCards);
    const push = evalResult.winner === 'push';
    const winnerUserId = push
      ? null
      : evalResult.winner === 'challenger'
        ? bet.challengerUserId
        : bet.targetUserId;

    bet.status = 'active';
    bet.boundHandNumber = state.handNumber;
    bet.result = {
      betId: bet.id,
      type: bet.type,
      suit: bet.suit,
      wager: bet.wager,
      winnerUserId,
      push,
      payout: 0, // filled at settlement (clamped)
      challenger: {
        userId: bet.challengerUserId,
        name: bet.challengerName,
        cards: [...cSeat.holeCards],
        value: evalResult.challengerValue,
      },
      target: {
        userId: bet.targetUserId,
        name: bet.targetName,
        cards: [...tSeat.holeCards],
        value: evalResult.targetValue,
      },
    };

    outcome.activated.push({
      bet,
      participantUserIds,
      opponentNameByUser: {
        [bet.challengerUserId]: bet.targetName,
        [bet.targetUserId]: bet.challengerName,
      },
    });
  }

  // Queue notifications for the handler to deliver on the next broadcast.
  if (outcome.activated.length > 0 || outcome.expired.length > 0) {
    const existing = notifyQueue.get(lobbyId);
    if (existing) {
      existing.activated.push(...outcome.activated);
      existing.expired.push(...outcome.expired);
    } else {
      notifyQueue.set(lobbyId, outcome);
    }
  }

  return outcome;
}

/** Drain queued bind notifications for the handler to deliver (one-shot). */
export function drainBindNotifications(lobbyId: string): BindOutcome | null {
  const o = notifyQueue.get(lobbyId);
  if (!o) return null;
  notifyQueue.delete(lobbyId);
  return o;
}

// ── Settlement ──────────────────────────────────────────────────────────────

export interface PendingSettlement {
  bet: ActiveSideBet;
  result: SideBetResult;
}

/** Returns active bets bound to the just-completed hand, ready for chip transfer. */
export function getSettlementsForHand(lobbyId: string, handNumber: number): PendingSettlement[] {
  return bets(lobbyId)
    .filter((b) => b.status === 'active' && b.boundHandNumber === handNumber && b.result)
    .map((b) => ({ bet: b, result: b.result! }));
}

/**
 * Finalize a settled bet: record the actual (clamped) payout, mark settled, and return the
 * completed result. Idempotent — returns null if already settled.
 */
export function markSettled(lobbyId: string, betId: string, payout: number): SideBetResult | null {
  const bet = bets(lobbyId).find((b) => b.id === betId);
  if (!bet || bet.status !== 'active' || !bet.result) return null;
  bet.status = 'settled';
  bet.result.payout = payout;
  return bet.result;
}

// ── Reconnect resync helpers ─────────────────────────────────────────────────

/** Pending challenges where the user is the target (need an incoming-challenge prompt). */
export function getPendingChallengesForTarget(lobbyId: string, userId: string): SideBetChallenge[] {
  return bets(lobbyId).filter((b) => b.status === 'pending' && b.targetUserId === userId);
}

/** Accepted/active bets the user participates in (for the "accepted" notice resync). */
export function getOpenAcceptedBetsForUser(lobbyId: string, userId: string): SideBetChallenge[] {
  return bets(lobbyId).filter(
    (b) =>
      (b.status === 'accepted' || b.status === 'active') &&
      (b.challengerUserId === userId || b.targetUserId === userId),
  );
}

// ── Per-seat indicator ───────────────────────────────────────────────────────

/**
 * User ids that should show the active-side-bet indicator for a given viewer.
 * 'participants' → only bets the viewer is part of; 'table' → all active bets.
 */
export function getActiveBetUserIdsForViewer(
  lobbyId: string,
  viewerUserId: string | null,
  visibility: 'participants' | 'table' | undefined,
): Set<string> {
  const result = new Set<string>();
  const tableWide = visibility === 'table';
  for (const b of bets(lobbyId)) {
    if (b.status !== 'active') continue;
    const viewerInvolved =
      viewerUserId !== null &&
      (b.challengerUserId === viewerUserId || b.targetUserId === viewerUserId);
    if (tableWide || viewerInvolved) {
      result.add(b.challengerUserId);
      result.add(b.targetUserId);
    }
  }
  return result;
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

/** Drop terminal bets to keep arrays small; called after settlement broadcasts. */
export function pruneTerminal(lobbyId: string): void {
  const arr = lobbyBets.get(lobbyId);
  if (!arr) return;
  const kept = arr.filter((b) => NON_TERMINAL.has(b.status));
  if (kept.length === 0) lobbyBets.delete(lobbyId);
  else lobbyBets.set(lobbyId, kept);
}

/** Remove all side-bet state for a lobby (lobby closed/cleared). */
export function clearLobbySideBets(lobbyId: string): void {
  lobbyBets.delete(lobbyId);
}
