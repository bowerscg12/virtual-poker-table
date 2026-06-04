import { formatChips } from '../utils/formatChips';

type Tier = 'small' | 'medium' | 'large';

function getTier(totalPot: number, buyIn: number): Tier {
  if (buyIn <= 0 || totalPot <= buyIn / 3) return 'small';
  if (totalPot <= buyIn) return 'medium';
  return 'large';
}

const TIER_ROWS: Record<Tier, number[]> = {
  small:  [2],
  medium: [3, 2],
  large:  [4, 3],
};

interface PotDisplayProps {
  totalPot: number;
  buyIn: number;
  distributing?: boolean;
}

export function PotDisplay({ totalPot, buyIn, distributing = false }: PotDisplayProps) {
  if (totalPot <= 0) return null;
  const tier = getTier(totalPot, buyIn);
  const rows = TIER_ROWS[tier];

  return (
    <div className={`pot-display${distributing ? ' pot-distributing' : ''}`}>
      <div className="pot-chip-pile">
        {rows.map((count, rowIdx) => (
          <div key={rowIdx} className="pot-chip-row" style={rowIdx > 0 ? { marginLeft: 11 } : undefined}>
            {Array.from({ length: count }).map((_, i) => (
              <span key={i} className="pot-chip-disc" />
            ))}
          </div>
        ))}
      </div>
      <span className="pot-display__amount">{formatChips(totalPot)}</span>
    </div>
  );
}
