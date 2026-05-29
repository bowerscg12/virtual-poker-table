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
      actionTimerSec: 30,
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
      actionTimerSec: 25,
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
      actionTimerSec: 35,
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
      actionTimerSec: 30,
    },
  },
  {
    id: 'straddle-holdem',
    name: 'Straddle Hold\'em',
    description: 'UTG straddle optional',
    config: {
      game: 'holdem',
      limit: 'no_limit',
      maxPlayers: 9,
      blinds: { small: 5, big: 10 },
      straddle: true,
      buyIn: 500,
      minBuyIn: 500,
      maxBuyIn: 3000,
      actionTimerSec: 30,
    },
  },
  {
    id: 'card-flip-chaos',
    name: 'Card Flip Chaos',
    description: 'Extra flop cards (house rules)',
    config: {
      game: 'holdem',
      limit: 'no_limit',
      maxPlayers: 6,
      blinds: { small: 2, big: 5 },
      extraFlopCards: 3,
      buyIn: 200,
      minBuyIn: 200,
      maxBuyIn: 1000,
      actionTimerSec: 20,
    },
  },
];
