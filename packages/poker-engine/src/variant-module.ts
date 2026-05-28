import type { Card } from '@vct/shared-types';
import type { VariantConfig } from '@vct/shared-types';
import type { EvaluatedHand } from './evaluate.js';
import { evaluateHoldem, evaluateOmaha } from './evaluate.js';

export interface VariantModule {
  holeCardCount: number;
  evaluateHand(hole: Card[], board: Card[]): EvaluatedHand;
  flopCardCount(config: VariantConfig): number;
}

export const holdemModule: VariantModule = {
  holeCardCount: 2,
  evaluateHand: evaluateHoldem,
  flopCardCount: (config) => 3 + (config.extraFlopCards ?? 0),
};

export const omahaModule: VariantModule = {
  holeCardCount: 4,
  evaluateHand: evaluateOmaha,
  flopCardCount: (config) => 3 + (config.extraFlopCards ?? 0),
};

export function getVariantModule(config: VariantConfig): VariantModule {
  switch (config.game) {
    case 'omaha':
    case 'plo8':
      return omahaModule;
    case 'holdem':
    default:
      return holdemModule;
  }
}
