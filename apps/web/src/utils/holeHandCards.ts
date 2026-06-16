import type { Card } from '@vct/shared-types';

/**
 * Synthesizes two display cards for a canonical starting-hand key (e.g. "AKs", "AA", "72o").
 * Suits are illustrative (not the actual suits dealt) — suited hands get matching suits,
 * pair/offsuit hands get contrasting suits so the distinction reads visually.
 */
export function holeHandToCards(hand: string): [Card, Card] {
  const rank1 = hand[0];
  const rank2 = hand[1];
  const suited = hand[2] === 's';
  return [`${rank1}s` as Card, `${rank2}${suited ? 's' : 'h'}` as Card];
}
