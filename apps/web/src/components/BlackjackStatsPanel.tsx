import { useEffect, useState } from 'react';
import type { BlackjackStats } from '@vct/shared-types';
import { fetchBlackjackStats } from '../api/client';
import { formatChips } from '../utils/formatChips';

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="career-stat-row">
      <span className="career-stat-label">{label}</span>
      <span className="career-stat-value">{value}</span>
    </div>
  );
}

/**
 * All-time personal-best blackjack stats, shown on the avatar screen when the chosen
 * game is blackjack (mirrors CareerStatsPanel, which covers poker). Reuses the
 * `career-stats-*` styles for visual consistency.
 */
export function BlackjackStatsPanel() {
  const [stats, setStats] = useState<BlackjackStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBlackjackStats()
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  const noData =
    !stats ||
    (stats.highestPeak === 0 &&
      stats.longestWinStreak === 0 &&
      stats.mostHandsWithoutBusting === 0 &&
      stats.biggestHandWin === 0);

  return (
    <div className="career-stats-panel panel">
      <h3>Blackjack Stats</h3>

      {loading ? (
        <p className="career-stats-loading">Loading…</p>
      ) : noData ? (
        <p className="career-stats-empty">Play your first blackjack hand to start building your stats.</p>
      ) : (
        <div className="career-stats-group">
          <StatRow
            label="Highest Chip Peak"
            value={<span className="career-profit">{formatChips(stats!.highestPeak)}</span>}
          />
          <StatRow label="Longest Win Streak" value={stats!.longestWinStreak.toLocaleString()} />
          <StatRow label="Most Hands Without Busting" value={stats!.mostHandsWithoutBusting.toLocaleString()} />
          <StatRow
            label="Biggest Winning Hand"
            value={<span className="career-profit">+{formatChips(stats!.biggestHandWin)}</span>}
          />
        </div>
      )}
    </div>
  );
}
