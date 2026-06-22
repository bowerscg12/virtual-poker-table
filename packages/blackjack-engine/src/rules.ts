import type { VariantConfig } from '@vct/shared-types';
import type { BlackjackRules } from './types.js';

/** Derive engine {@link BlackjackRules} from a table's {@link VariantConfig}. */
export function blackjackRulesFromConfig(config: VariantConfig): BlackjackRules {
  return {
    dealerHitsSoft17: (config.blackjackDealerSoftSeventeen ?? 'stand') === 'hit',
    blackjackPayout: config.blackjackBlackjackPayout ?? '3:2',
    surrender: config.blackjackSurrender ?? 'late',
    insurance: config.blackjackInsurance ?? true,
    doubleAfterSplit: config.blackjackDoubleAfterSplit ?? true,
    resplitAces: config.blackjackResplitAces ?? false,
    maxSplitHands: config.blackjackMaxSplitHands ?? 4,
  };
}
