export type GameVariant = 'holdem' | 'omaha' | 'plo8' | 'stud' | 'twelve_card_flip' | 'blackjack';
export type BettingLimit = 'no_limit' | 'pot_limit' | 'fixed';
export type MaxPlayers = 2 | 6 | 8;

/** Multi-Card Flip per-player card count bounds (2 players must fit in 52 cards). */
export const FLIP_MIN_CARDS = 5;
export const FLIP_MAX_CARDS = 26;
export const FLIP_DEFAULT_CARDS = 12;

/** Clamp a requested Multi-Card Flip per-player card count into the legal range. */
export function clampFlipCardCount(count: number | undefined): number {
  const n = Math.floor(count ?? FLIP_DEFAULT_CARDS);
  if (!Number.isFinite(n)) return FLIP_DEFAULT_CARDS;
  return Math.max(FLIP_MIN_CARDS, Math.min(FLIP_MAX_CARDS, n));
}

/** Valid action timer durations in seconds. 0 = no timer. */
export const TIMER_STEPS_SEC = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180] as const;
export type TimerStepSec = (typeof TIMER_STEPS_SEC)[number];

export function formatTimerLabel(sec: number): string {
  if (sec === 0) return 'No Timer';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

export interface BlindsConfig {
  small: number;
  big: number;
  ante?: number;
}

/** Host's pending per-hand Bomb Pot selection. Applies to the next hand only, then resets. */
export interface NextHandBombPot {
  /** Forced contribution per participating player. */
  amount: number;
  /** When true, two boards are dealt and the pot is split 50/50. */
  doubleBoard: boolean;
}

export interface VariantConfig {
  game: GameVariant;
  limit: BettingLimit;
  maxPlayers: MaxPlayers;
  blinds: BlindsConfig;
  /** Set by the host to run the next hand as a Bomb Pot. Cleared once that hand resolves. */
  nextHandBombPot?: NextHandBombPot;
  /** Number of times to run out the board when all players are all-in (1 = once, 2 = twice, 3 = three times). Only for holdem/omaha. */
  runItOut?: number;
  straddle?: boolean;
  straddleAmount?: number;
  sevenDeuceRule?: boolean;
  /** Host-set stack size for each player when they join */
  buyIn: number;
  minBuyIn: number;
  maxBuyIn: number;
  actionTimerSec?: number;
  /** When true, each player is dealt 3 hole cards and must discard one before preflop betting. holdem only. */
  pineapple?: boolean;
  /** Extra community cards dealt in one street (house preset) */
  extraFlopCards?: number;
  /** When set (>0), the big blind player posts this ante into the pot before each hand. */
  bigBlindAnte?: number;
  /** When set (>0), the small blind player posts this ante into the pot before each hand. */
  smallBlindAnte?: number;
  /** Bomb pot ante per player for twelve_card_flip (defaults to buyIn) */
  twelveCardFlipAnte?: number;
  /**
   * Number of private cards dealt to each player in Multi-Card Flip (formerly
   * "12 Card Flip"). 2 players × this count must fit in a 52-card deck, so the
   * range is {@link FLIP_MIN_CARDS}–{@link FLIP_MAX_CARDS}. Defaults to {@link FLIP_DEFAULT_CARDS}.
   */
  twelveCardFlipCardCount?: number;
  /**
   * Who sees 1v1 side-bet results when a bet settles. 'participants' (default) reveals
   * only to the two players; 'table' broadcasts the result to everyone.
   */
  sideBetResultVisibility?: 'participants' | 'table';

  // ── Blackjack-specific settings ──────────────────────────────────────────
  /** Number of 52-card decks in the shoe. Default: 6. */
  blackjackNumDecks?: 1 | 4 | 6 | 8;
  /** Minimum bet allowed per hand. Default: 5. */
  blackjackMinBet?: number;
  /** Maximum bet allowed per hand. Default: 500. */
  blackjackMaxBet?: number;
  /** Whether dealer hits (h17) or stands (s17) on soft 17. Default: 'stand'. */
  blackjackDealerSoftSeventeen?: 'hit' | 'stand';
}

/** Stack chips granted when a player sits (host-configured). */
export function getTableBuyIn(settings: VariantConfig): number {
  return settings.buyIn ?? settings.minBuyIn;
}

export const DEFAULT_VARIANT_CONFIG: VariantConfig = {
  game: 'holdem',
  limit: 'no_limit',
  maxPlayers: 8,
  blinds: { small: 5, big: 10 },
  buyIn: 500,
  minBuyIn: 500,
  maxBuyIn: 2000,
};
