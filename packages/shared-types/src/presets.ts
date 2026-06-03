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
    description: 'Standard Texas Hold\'em, 8-max',
    config: {
      game: 'holdem',
      limit: 'no_limit',
      maxPlayers: 8,
      blinds: { small: 5, big: 10 },
      buyIn: 500,
      minBuyIn: 500,
      maxBuyIn: 2000,
    },
  },
  {
    id: 'plo-standard',
    name: 'Pot-Limit Omaha',
    description: '4 hole cards, must use exactly 2',
    config: {
      game: 'omaha',
      limit: 'pot_limit',
      maxPlayers: 8,
      blinds: { small: 5, big: 10 },
      buyIn: 500,
      minBuyIn: 500,
      maxBuyIn: 2000,
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
