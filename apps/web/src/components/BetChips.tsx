import { formatChips } from '../utils/formatChips';

/** Chip denominations, highest first — matched to CHIP_DENOMS in BlackjackActionBar. */
const CHIP_LADDER = [1000, 500, 100, 25, 5] as const;

/** Cap on rendered discs so a huge bet doesn't draw hundreds of chips. */
const MAX_DISCS = 7;

/**
 * Break an amount into chip discs (greedy, highest denom first), capped at
 * MAX_DISCS. The exact amount is always shown as a label, so dropping overflow
 * discs is purely cosmetic. Returned lowest-first so the highest chip sits on top
 * of the visual stack.
 */
function chipDiscs(amount: number): number[] {
  const discs: number[] = [];
  let remaining = Math.round(amount);
  for (const denom of CHIP_LADDER) {
    while (remaining >= denom && discs.length < MAX_DISCS) {
      discs.push(denom);
      remaining -= denom;
    }
    if (discs.length >= MAX_DISCS) break;
  }
  if (discs.length === 0 && amount > 0) discs.push(CHIP_LADDER[CHIP_LADDER.length - 1]);
  return discs.reverse();
}

/**
 * Renders a blackjack bet as a stack of color-coded poker chips plus a formatted
 * amount label. Purely presentational — used for seat bets and the staged-bet
 * preview. Distinct from the poker `ChipStack` (which shows generic stack size).
 */
export function BetChips({ amount, className }: { amount: number; className?: string }) {
  if (!amount || amount <= 0) return null;
  const discs = chipDiscs(amount);
  return (
    <div className={`bj-chip-stack${className ? ` ${className}` : ''}`} aria-label={`Bet ${formatChips(amount)}`}>
      <div className="bj-chip-discs" aria-hidden="true">
        {discs.map((denom, i) => (
          <span key={i} className={`bj-chip bj-chip--${denom}`} />
        ))}
      </div>
      <span className="bj-chip-amount">{formatChips(amount)}</span>
    </div>
  );
}
