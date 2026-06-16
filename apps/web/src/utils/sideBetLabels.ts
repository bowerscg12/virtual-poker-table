import type { SideBetType, Suit } from '@vct/shared-types';

const SUIT_LABEL: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

/** Human-readable description of a side bet, e.g. "Highest ♥" or "Highest hole-card sum". */
export function sideBetTypeLabel(type: SideBetType, suit?: Suit): string {
  switch (type) {
    case 'highest_suit':
      return `Highest ${suit ? SUIT_LABEL[suit] : 'suit'}`;
    case 'lowest_suit':
      return `Lowest ${suit ? SUIT_LABEL[suit] : 'suit'}`;
    case 'highest_sum':
      return 'Highest hole-card sum';
    case 'lowest_sum':
      return 'Lowest hole-card sum';
  }
}
