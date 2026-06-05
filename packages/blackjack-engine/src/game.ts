import type { Card } from '@vct/shared-types';
import type { BlackjackTableState, BlackjackPlayer, BlackjackHand } from './types.js';
import { buildShoe, shuffleShoe, getCutCardPosition } from './shoe.js';
import { isNaturalBlackjack } from './hand.js';

export interface CreateRoundOptions {
  lobbyId: string;
  roundNumber: number;
  numDecks: number;
  players: { userId: string; seatIndex: number; stack: number }[];
  seed: string;
  /** Override the RNG (for tests). Defaults to Math.random seeded by the seed string. */
  rng?: () => number;
}

/** Create a fresh round state in the betting phase. */
export function createRound(opts: CreateRoundOptions): BlackjackTableState {
  const { lobbyId, roundNumber, numDecks, players, seed, rng } = opts;

  // Build a seeded RNG from the seed string so the shoe is deterministic for fairness proofs.
  // We use a simple mulberry32 implementation — no external deps.
  const seededRng = rng ?? mulberry32(hashSeed(seed));
  const rawShoe = buildShoe(numDecks);
  const shoe = shuffleShoe(rawShoe, seededRng);

  return {
    lobbyId,
    roundNumber,
    phase: 'waiting_for_bets',
    shoe,
    cutCardPosition: getCutCardPosition(numDecks),
    players: players.map((p) => ({
      userId: p.userId,
      seatIndex: p.seatIndex,
      stack: p.stack,
      pendingBet: 0,
      hands: [],
      activeHandIndex: 0,
      status: 'betting',
    })),
    dealer: { cards: [], holeCardRevealed: false },
    activePlayerIndex: -1,
    seed,
  };
}

/**
 * Called when the betting phase closes.
 * Deducts bets from stacks, deals cards in casino order, checks for dealer peek.
 * Returns updated state in 'player_turn' or 'dealer_turn' phase (if dealer has BJ).
 */
export function dealInitial(state: BlackjackTableState): BlackjackTableState | { error: string } {
  const activePlayers = state.players.filter((p) => p.pendingBet > 0);
  if (activePlayers.length === 0) return { error: 'No bets placed' };

  let shoe = [...state.shoe];

  function drawCard(): Card {
    const card = shoe.shift();
    if (!card) throw new Error('Shoe is empty');
    return card;
  }

  // Deduct bets, create initial hands
  let players: BlackjackPlayer[] = state.players.map((p) => {
    if (p.pendingBet === 0) return { ...p, status: 'sitting_out' as const };
    const handId = `${p.seatIndex}-0`;
    return {
      ...p,
      stack: p.stack - p.pendingBet,
      pendingBet: 0,
      status: 'waiting' as const,
      hands: [
        {
          id: handId,
          cards: [],
          wager: p.pendingBet,
          isStanding: false,
          isBust: false,
          isBlackjack: false,
          isDoubled: false,
          isSplit: false,
        } satisfies BlackjackHand,
      ],
      activeHandIndex: 0,
    };
  });

  // Casino deal order: one card to each player left-to-right, one face-up to dealer,
  // then one more card to each player, then one face-down (hole) to dealer.
  const dealingPlayers = players.filter((p) => p.status === 'waiting');

  // Round 1 of deal
  for (const p of dealingPlayers) {
    const card = drawCard();
    players = players.map((pl) =>
      pl.userId === p.userId
        ? { ...pl, hands: [{ ...pl.hands[0]!, cards: [card] }] }
        : pl,
    );
  }
  const dealerCard1 = drawCard();

  // Round 2 of deal
  for (const p of dealingPlayers) {
    const card = drawCard();
    players = players.map((pl) =>
      pl.userId === p.userId
        ? { ...pl, hands: [{ ...pl.hands[0]!, cards: [...pl.hands[0]!.cards, card] }] }
        : pl,
    );
  }
  const dealerCard2 = drawCard();

  const dealerCards: Card[] = [dealerCard1, dealerCard2];

  // Mark player natural blackjacks
  players = players.map((p) => {
    if (p.hands.length === 0) return p;
    const hand = p.hands[0]!;
    const bj = isNaturalBlackjack(hand.cards);
    return { ...p, hands: [{ ...hand, isBlackjack: bj }] };
  });

  // Dealer peek: check hole card before players act
  const dealerHasBlackjack = isNaturalBlackjack(dealerCards);

  if (dealerHasBlackjack) {
    // Reveal hole card, skip player turns, go straight to settlement
    const settledPlayers = players.map((p) => ({
      ...p,
      status: 'done' as const,
    }));
    return {
      ...state,
      shoe,
      players: settledPlayers,
      dealer: { cards: dealerCards, holeCardRevealed: true },
      phase: 'dealer_turn' as const,
      activePlayerIndex: -1,
    };
  }

  // Find first player who needs to act
  const firstActiveIdx = players.findIndex((p) => p.status === 'waiting');

  if (firstActiveIdx === -1) {
    // All players have blackjack or sitting out — go to dealer
    return {
      ...state,
      shoe,
      players,
      dealer: { cards: dealerCards, holeCardRevealed: true },
      phase: 'dealer_turn' as const,
      activePlayerIndex: -1,
    };
  }

  // Players with natural BJ are immediately done (dealer didn't have BJ so they win)
  players = players.map((p) => {
    if (p.hands[0]?.isBlackjack) return { ...p, status: 'done' as const };
    return p;
  });

  // Re-find first active player after marking BJ players as done
  const firstActingIdx = players.findIndex((p) => p.status === 'waiting');

  if (firstActingIdx === -1) {
    // Everyone has BJ or is sitting out — skip to dealer turn
    return {
      ...state,
      shoe,
      players,
      dealer: { cards: dealerCards, holeCardRevealed: true },
      phase: 'dealer_turn' as const,
      activePlayerIndex: -1,
    };
  }

  players = players.map((p, i) =>
    i === firstActingIdx ? { ...p, status: 'acting' as const } : p,
  );

  return {
    ...state,
    shoe,
    players,
    dealer: { cards: dealerCards, holeCardRevealed: false },
    phase: 'player_turn' as const,
    activePlayerIndex: firstActingIdx,
  };
}

// ── Seeded RNG helpers ────────────────────────────────────────────────────────

/** Hash a seed string to a 32-bit unsigned integer. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (Math.imul(h, 0x01000193) >>> 0);
  }
  return h >>> 0;
}

/** Mulberry32 — fast, good-quality 32-bit RNG. */
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

// Re-export advanceToNextHand so the index can barrel it
export { advanceToNextHand } from './actions.js';
