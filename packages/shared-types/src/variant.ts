export type GameVariant = 'holdem' | 'omaha' | 'plo8' | 'stud';
export type BettingLimit = 'no_limit' | 'pot_limit' | 'fixed';
export type MaxPlayers = 2 | 6 | 9;

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
  actionTimerSec: 30,
};
