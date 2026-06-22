import type { Card } from '@vct/shared-types';
import type { BlackjackTableState, BlackjackPlayer, BlackjackHand, BlackjackRules } from './types.js';
import { DEFAULT_BLACKJACK_RULES } from './types.js';
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
  /** Carry an existing shoe forward (continuation across rounds). Reshuffled if past the cut card. */
  previousShoe?: Card[];
}

/** Create a fresh round state in the betting phase. */
export function createRound(opts: CreateRoundOptions): BlackjackTableState {
  const { lobbyId, roundNumber, numDecks, players, seed, rng, previousShoe } = opts;

  // Build a seeded RNG from the seed string so the shoe is deterministic for fairness proofs.
  // We use a simple mulberry32 implementation — no external deps.
  const seededRng = rng ?? mulberry32(hashSeed(seed));
  const cutCardPosition = getCutCardPosition(numDecks);

  // Continue the previous shoe when one is supplied and the cut card hasn't been reached;
  // otherwise build and shuffle a fresh shoe.
  const shoe =
    previousShoe && previousShoe.length > cutCardPosition
      ? previousShoe
      : shuffleShoe(buildShoe(numDecks), seededRng);

  return {
    lobbyId,
    roundNumber,
    phase: 'waiting_for_bets',
    shoe,
    cutCardPosition,
    players: players.map((p) => ({
      userId: p.userId,
      seatIndex: p.seatIndex,
      stack: p.stack,
      pendingBet: 0,
      hands: [],
      activeHandIndex: 0,
      status: 'betting',
      insuranceBet: 0,
    })),
    dealer: { cards: [], holeCardRevealed: false },
    activePlayerIndex: -1,
    seed,
  };
}

/**
 * Called when the betting phase closes.
 * Deducts bets from stacks, deals cards in casino order, then either opens the insurance window
 * (dealer up-card is an Ace and insurance is enabled) or peeks for a dealer natural and starts play.
 */
export function dealInitial(
  state: BlackjackTableState,
  rules: BlackjackRules = DEFAULT_BLACKJACK_RULES,
): BlackjackTableState | { error: string } {
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
      insuranceBet: 0,
      insuranceActed: false,
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
    return { ...p, hands: [{ ...hand, isBlackjack: isNaturalBlackjack(hand.cards) }] };
  });

  // Insurance window: dealer shows an Ace and insurance is enabled.
  if (rules.insurance && dealerCard1[0] === 'A') {
    return {
      ...state,
      shoe,
      players,
      dealer: { cards: dealerCards, holeCardRevealed: false },
      phase: 'insurance' as const,
      activePlayerIndex: -1,
    };
  }

  return enterPlayerTurnOrSettle({ ...state, shoe, players }, dealerCards);
}

/**
 * Resolve the insurance window: peek the dealer hole card, then either settle (dealer natural)
 * or begin player turns. Insurance/even-money payouts are computed at settlement.
 */
export function resolveInsurance(state: BlackjackTableState): BlackjackTableState {
  return enterPlayerTurnOrSettle(state, state.dealer.cards);
}

/**
 * Shared post-peek branching used by both the direct-deal and post-insurance paths.
 * Peeks the dealer's two cards (without revealing the hole card to clients unless it's a natural)
 * and routes to dealer settlement or the first acting player.
 */
function enterPlayerTurnOrSettle(
  state: BlackjackTableState,
  dealerCards: Card[],
): BlackjackTableState {
  const dealerHasBlackjack = isNaturalBlackjack(dealerCards);

  // Players who took even money settle immediately as a 1:1 win regardless of the peek.
  let players = state.players;

  if (dealerHasBlackjack) {
    // Reveal hole card, skip player turns, settlement resolves all hands.
    return {
      ...state,
      players: players.map((p) => (p.status === 'sitting_out' ? p : { ...p, status: 'done' as const })),
      dealer: { cards: dealerCards, holeCardRevealed: true },
      phase: 'dealer_turn' as const,
      activePlayerIndex: -1,
    };
  }

  // No dealer natural — players with a natural (and not declined via even money) are done as winners.
  players = players.map((p) => {
    if (p.status === 'sitting_out') return p;
    if (p.hands[0]?.isBlackjack) return { ...p, status: 'done' as const };
    return p;
  });

  const firstActingIdx = players.findIndex((p) => p.status === 'waiting');

  if (firstActingIdx === -1) {
    // Everyone has a natural or is sitting out — skip straight to the dealer turn.
    return {
      ...state,
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
