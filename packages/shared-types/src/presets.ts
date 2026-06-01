import type { VariantConfig } from './variant.js';

export interface RulesPreset {
  id: string;
  name: string;
  description: string;
  config: VariantConfig;
}

export const RULES_PRESETS: RulesPreset[] = [
  {
    id: 'nlhe-standard',
    name: 'No-Limit Hold\'em',
    description: 'Standard Texas Hold\'em, 9-max',
    config: {
      game: 'holdem',
      limit: 'no_limit',
      maxPlayers: 9,
      blinds: { small: 5, big: 10 },
      buyIn: 500,
      minBuyIn: 500,
      maxBuyIn: 2000,
    },
  },
  {
    id: 'nlhe-6max',
    name: 'NL Hold\'em 6-Max',
    description: 'Aggressive 6-max table',
    config: {
      game: 'holdem',
      limit: 'no_limit',
      maxPlayers: 6,
      blinds: { small: 10, big: 20 },
      buyIn: 1000,
      minBuyIn: 1000,
      maxBuyIn: 4000,
    },
  },
  {
    id: 'plo-standard',
    name: 'Pot-Limit Omaha',
    description: '4 hole cards, must use exactly 2',
    config: {
      game: 'omaha',
      limit: 'pot_limit',
      maxPlayers: 9,
      blinds: { small: 5, big: 10 },
      buyIn: 500,
      minBuyIn: 500,
      maxBuyIn: 2000,
    },
  },
  {
    id: 'bomb-pot-holdem',
    name: 'Bomb Pot Hold\'em',
    description: 'Ante bomb every 15 hands',
    config: {
      game: 'holdem',
      limit: 'no_limit',
      maxPlayers: 9,
      blinds: { small: 5, big: 10, ante: 2 },
      bombPot: { everyNHands: 15, multiplier: 8 },
      buyIn: 1000,
      minBuyIn: 1000,
      maxBuyIn: 5000,
    },
  },
  {
    id: 'twelve-card-flip',
    name: '12 Card Flip',
    description: 'Heads-up bomb-pot: 12 private cards, take turns revealing to beat opponent',
    config: {
      game: 'twelve_card_flip',
      limit: 'no_limit',
      maxPlayers: 2,
      blinds: { small: 0, big: 0 },
      buyIn: 500,
      minBuyIn: 500,
      maxBuyIn: 500,
      twelveCardFlipAnte: 500,
    },
  },
];
