import type { LegalAction, Street } from '@vct/shared-types';
import type { VariantConfig } from '@vct/shared-types';

export interface BettingPlayer {
  seatIndex: number;
  stack: number;
  betThisStreet: number;
  totalBet: number;
  folded: boolean;
  allIn: boolean;
}

export function computeLegalActions(
  player: BettingPlayer,
  players: BettingPlayer[],
  currentBet: number,
  minRaise: number,
  street: Street,
  config: VariantConfig
): LegalAction[] {
  if (player.folded || player.allIn || player.stack <= 0) return [];

  const toCall = currentBet - player.betThisStreet;
  const actions: LegalAction[] = [{ type: 'fold' }];

  if (toCall === 0) {
    actions.push({ type: 'check' });
  } else if (toCall > 0 && player.stack > toCall) {
    actions.push({ type: 'call', amount: toCall });
  } else if (toCall > 0 && player.stack <= toCall) {
    actions.push({ type: 'call', amount: player.stack });
  }

  const canRaise = player.stack > toCall;
  if (canRaise && street !== 'complete') {
    const minRaiseTo = currentBet + minRaise;
    const maxRaiseTo = player.betThisStreet + player.stack;
    if (config.limit === 'no_limit') {
      if (maxRaiseTo >= minRaiseTo) {
        actions.push({
          type: 'raise',
          minAmount: minRaiseTo,
          maxAmount: maxRaiseTo,
        });
      }
      if (player.stack <= toCall + minRaise) {
        actions.push({ type: 'all_in', amount: player.stack });
      }
    } else if (config.limit === 'pot_limit') {
      const pot = players.reduce((s, p) => s + p.totalBet, 0);
      const maxBet = currentBet + pot + toCall;
      const cap = Math.min(maxBet, maxRaiseTo);
      if (cap >= minRaiseTo) {
        actions.push({ type: 'raise', minAmount: minRaiseTo, maxAmount: cap });
      }
    }
    actions.push({ type: 'all_in', amount: player.stack });
  }

  return actions;
}

export function nextActiveSeat(
  seats: number[],
  from: number,
  isActive: (idx: number) => boolean
): number | null {
  if (seats.length === 0) return null;
  const sorted = [...seats].sort((a, b) => a - b);
  const start = sorted.findIndex((s) => s >= from);
  const startIndex = start === -1 ? 0 : start;
  for (let i = 0; i < sorted.length; i++) {
    const idx = sorted[(startIndex + i) % sorted.length];
    if (isActive(idx)) return idx;
  }
  return null;
}
