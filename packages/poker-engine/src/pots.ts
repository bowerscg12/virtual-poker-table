export interface PotContribution {
  seatIndex: number;
  amount: number;
}

export interface SidePot {
  amount: number;
  eligibleSeatIndices: number[];
}

/** Build side pots from total contributions per seat */
export function buildSidePots(contributions: PotContribution[]): SidePot[] {
  const active = contributions.filter((c) => c.amount > 0);
  if (active.length === 0) return [];

  const sorted = [...active].sort((a, b) => a.amount - b.amount);
  const pots: SidePot[] = [];
  let prevLevel = 0;

  for (let i = 0; i < sorted.length; i++) {
    const level = sorted[i].amount;
    const increment = level - prevLevel;
    if (increment <= 0) continue;

    const eligible = sorted.slice(i).map((s) => s.seatIndex);
    const potAmount = increment * eligible.length;
    pots.push({ amount: potAmount, eligibleSeatIndices: eligible });
    prevLevel = level;
  }

  return pots;
}

export function totalPot(pots: SidePot[]): number {
  return pots.reduce((sum, p) => sum + p.amount, 0);
}
