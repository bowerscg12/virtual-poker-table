import { formatChips } from '../utils/formatChips';

/** Visual chip stack for a player's stack size */
export function ChipStack({ amount }: { amount: number }) {
  if (amount <= 0) return null;

  const chipCount = Math.min(5, Math.max(1, Math.ceil(amount / 250)));
  const label = formatChips(amount);

  return (
    <div className="chip-stack" aria-label={`${amount} chips`}>
      <div className="chip-discs">
        {Array.from({ length: chipCount }).map((_, i) => (
          <span key={i} className="chip-disc" style={{ marginLeft: i === 0 ? 0 : -6 }} />
        ))}
      </div>
      <span className="chip-amount">{label}</span>
    </div>
  );
}
