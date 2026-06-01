export type GameVariant = 'holdem' | 'omaha' | 'plo8' | 'stud' | 'twelve_card_flip';
export type BettingLimit = 'no_limit' | 'pot_limit' | 'fixed';
export type MaxPlayers = 2 | 6 | 9;

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

export interface BombPotConfig {
  everyNHands: number;
  multiplier: number;
}

export interface VariantConfig {
  game: GameVariant;
  limit: BettingLimit;
  maxPlayers: MaxPlayers;
  blinds: BlindsConfig;
  bombPot?: BombPotConfig;
  runItTwice?: boolean;
  straddle?: boolean;
  straddleAmount?: number;
  sevenDeuceRule?: boolean;
  /** Host-set stack size for each player when they join */
  buyIn: number;
  minBuyIn: number;
  maxBuyIn: number;
  actionTimerSec?: number;
  /** Extra community cards dealt in one street (house preset) */
  extraFlopCards?: number;
  /** Bomb pot ante per player for twelve_card_flip (defaults to buyIn) */
  twelveCardFlipAnte?: number;
}

/** Stack chips granted when a player sits (host-configured). */
export function getTableBuyIn(settings: VariantConfig): number {
  return settings.buyIn ?? settings.minBuyIn;
}

export const DEFAULT_VARIANT_CONFIG: VariantConfig = {
  game: 'holdem',
  limit: 'no_limit',
  maxPlayers: 9,
  blinds: { small: 5, big: 10 },
  buyIn: 500,
  minBuyIn: 500,
  maxBuyIn: 2000,
};
