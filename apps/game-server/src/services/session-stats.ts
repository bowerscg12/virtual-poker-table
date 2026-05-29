import type { Card, CashOutSummary, PlayerActionType, VariantConfig } from '@vct/shared-types';
import type { EvaluatedHand, GameTableState } from '@vct/poker-engine';
import { compareHands, getVariantModule, parseCard, rankValue } from '@vct/poker-engine';

interface StatsAccumulator {
  userId: string;
  displayName: string;
  startingStack: number;
  startedAt: number;
  handsPlayed: number;
  handsWon: number;
  biggestPotWon: number;
  biggestLoss: number;
  bestHand: EvaluatedHand | null;
  startingHandCounts: Map<string, number>;
  actionCounts: { fold: number; check: number; call: number; raise: number; all_in: number };
  totalPotsWon: number;
  potsWonCount: number;
}

/** lobbyId → userId → accumulator */
const sessions = new Map<string, Map<string, StatsAccumulator>>();

/** lobbyId → userId → stack at start of current hand */
const handStartStacks = new Map<string, Map<string, number>>();

function normalizeStartingHand(holeCards: Card[]): string {
  if (holeCards.length === 2) {
    const p1 = parseCard(holeCards[0]);
    const p2 = parseCard(holeCards[1]);
    const v1 = rankValue(p1.rank);
    const v2 = rankValue(p2.rank);
    const [hiRank, loRank, hiSuit, loSuit] =
      v1 >= v2 ? [p1.rank, p2.rank, p1.suit, p2.suit] : [p2.rank, p1.rank, p2.suit, p1.suit];
    if (hiRank === loRank) return `${hiRank}${loRank}`;
    return `${hiRank}${loRank}${hiSuit === loSuit ? 's' : 'o'}`;
  }
  // Omaha / other: sorted rank string
  return holeCards
    .map((c) => parseCard(c))
    .sort((a, b) => rankValue(b.rank) - rankValue(a.rank))
    .map((p) => p.rank)
    .join('');
}

/** Call when a player sits at a table. Idempotent — subsequent calls for the same user are no-ops. */
export function initSession(
  lobbyId: string,
  userId: string,
  displayName: string,
  startingStack: number
): void {
  if (!sessions.has(lobbyId)) sessions.set(lobbyId, new Map());
  const lobbyMap = sessions.get(lobbyId)!;
  if (lobbyMap.has(userId)) return;
  lobbyMap.set(userId, {
    userId,
    displayName,
    startingStack,
    startedAt: Date.now(),
    handsPlayed: 0,
    handsWon: 0,
    biggestPotWon: 0,
    biggestLoss: 0,
    bestHand: null,
    startingHandCounts: new Map(),
    actionCounts: { fold: 0, check: 0, call: 0, raise: 0, all_in: 0 },
    totalPotsWon: 0,
    potsWonCount: 0,
  });
}

/** Call immediately after startHand() to snapshot stacks and record hole card combos. */
export function recordHandStart(lobbyId: string, state: GameTableState): void {
  const lobbyMap = sessions.get(lobbyId);
  const startMap = new Map<string, number>();

  for (const seat of state.seats) {
    startMap.set(seat.userId, seat.stack);
    if (lobbyMap && seat.holeCards.length >= 2) {
      const acc = lobbyMap.get(seat.userId);
      if (acc) {
        const key = normalizeStartingHand(seat.holeCards);
        acc.startingHandCounts.set(key, (acc.startingHandCounts.get(key) ?? 0) + 1);
      }
    }
  }

  handStartStacks.set(lobbyId, startMap);
}

/** Call after each successful processGameAction. */
export function recordAction(lobbyId: string, userId: string, action: PlayerActionType): void {
  const acc = sessions.get(lobbyId)?.get(userId);
  if (!acc) return;
  acc.actionCounts[action] = (acc.actionCounts[action] ?? 0) + 1;
}

/** Call when street === 'complete' to update all seated players' stats. */
export function recordHandEnd(
  lobbyId: string,
  state: GameTableState,
  config: VariantConfig
): void {
  const lobbyMap = sessions.get(lobbyId);
  if (!lobbyMap) return;

  const startStacks = handStartStacks.get(lobbyId);
  const winners = new Set(state.lastWinningSeatIndices);
  const variantModule = getVariantModule(config);

  for (const seat of state.seats) {
    const acc = lobbyMap.get(seat.userId);
    if (!acc) continue;

    const stackBefore = startStacks?.get(seat.userId) ?? seat.stack;
    const delta = seat.stack - stackBefore;
    acc.handsPlayed++;

    if (winners.has(seat.seatIndex)) {
      acc.handsWon++;
      if (delta > 0) {
        if (delta > acc.biggestPotWon) acc.biggestPotWon = delta;
        acc.totalPotsWon += delta;
        acc.potsWonCount++;
      }
    } else if (delta < 0 && -delta > acc.biggestLoss) {
      acc.biggestLoss = -delta;
    }

    // Evaluate best hand (skip if folded or board too short)
    if (!seat.folded && state.board.length >= 3 && seat.holeCards.length >= 2) {
      try {
        const evaluated = variantModule.evaluateHand(seat.holeCards, state.board);
        if (!acc.bestHand || compareHands(evaluated, acc.bestHand) > 0) {
          acc.bestHand = evaluated;
        }
      } catch {
        // ignore evaluation errors (e.g., Omaha needing exactly 3 board cards)
      }
    }
  }

  handStartStacks.delete(lobbyId);
}

/** Compute the final CashOutSummary and clean up the player's stats entry. */
export function finalizeCashOut(
  lobbyId: string,
  userId: string,
  finalStack: number
): CashOutSummary {
  const lobbyMap = sessions.get(lobbyId);
  const acc = lobbyMap?.get(userId);

  const sessionDurationMs = acc ? Date.now() - acc.startedAt : 0;
  const startingStack = acc?.startingStack ?? finalStack;
  const handsPlayed = acc?.handsPlayed ?? 0;
  const handsWon = acc?.handsWon ?? 0;

  let mostCommonStartingHand: CashOutSummary['mostCommonStartingHand'] = null;
  if (acc && acc.startingHandCounts.size > 0) {
    let maxCount = 0;
    let maxKey = '';
    for (const [key, count] of acc.startingHandCounts) {
      if (count > maxCount) {
        maxCount = count;
        maxKey = key;
      }
    }
    mostCommonStartingHand = {
      key: maxKey,
      count: maxCount,
      frequency: handsPlayed > 0 ? maxCount / handsPlayed : 0,
    };
  }

  const summary: CashOutSummary = {
    userId,
    displayName: acc?.displayName ?? 'Player',
    startingStack,
    finalStack,
    netProfit: finalStack - startingStack,
    handsPlayed,
    handsWon,
    winPercentage: handsPlayed > 0 ? handsWon / handsPlayed : 0,
    biggestPotWon: acc?.biggestPotWon ?? 0,
    biggestLoss: acc?.biggestLoss ?? 0,
    bestHandDescription: acc?.bestHand?.description ?? null,
    bestHandRank: acc?.bestHand?.rank ?? null,
    bestHandCards: acc?.bestHand?.bestFive ?? null,
    mostCommonStartingHand,
    actionCounts: acc?.actionCounts ?? { fold: 0, check: 0, call: 0, raise: 0, all_in: 0 },
    sessionDurationMs,
    averagePotWon: acc && acc.potsWonCount > 0 ? acc.totalPotsWon / acc.potsWonCount : 0,
  };

  // Clean up
  lobbyMap?.delete(userId);
  if (lobbyMap?.size === 0) sessions.delete(lobbyId);

  return summary;
}

/** Remove all stats for a lobby (e.g., lobby closed). */
export function clearLobbyStats(lobbyId: string): void {
  sessions.delete(lobbyId);
  handStartStacks.delete(lobbyId);
}
