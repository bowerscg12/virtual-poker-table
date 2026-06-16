import { useEffect, useState } from 'react';
import type { CareerStats } from '@vct/shared-types';
import { fetchCareerStats } from '../api/client';
import { formatChips } from '../utils/formatChips';
import { holeHandToCards } from '../utils/holeHandCards';
import { CardView } from './CardView';

const GAME_MODE_LABELS: Record<string, string> = {
  holdem: 'Texas Hold\'em',
  omaha: 'Omaha',
  plo8: 'PLO Hi-Lo',
  twelve_card_flip: '12-Card Flip',
  blackjack: 'Blackjack',
};

function sign(n: number): string {
  return n >= 0 ? `+${formatChips(n)}` : `-${formatChips(Math.abs(n))}`;
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="career-stat-row">
      <span className="career-stat-label">{label}</span>
      <span className="career-stat-value">{value}</span>
    </div>
  );
}

function WinRatePct(rate: number) {
  return `${Math.round(rate * 100)}%`;
}

export function CareerStatsPanel() {
  const [stats, setStats] = useState<CareerStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCareerStats()
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  const noData = !stats || stats.handsPlayed === 0;

  return (
    <div className="career-stats-panel panel">
      <h3>Career Stats</h3>

      {loading ? (
        <p className="career-stats-loading">Loading…</p>
      ) : noData ? (
        <p className="career-stats-empty">Play your first hand to start building your career stats.</p>
      ) : (
        <>
          {(stats.archetype || stats.favoriteGameMode) && (
            <div className="career-stats-group">
              {stats.archetype && (
                <StatRow label="Archetype" value={<strong>{stats.archetype}</strong>} />
              )}
              {stats.favoriteGameMode && (
                <StatRow
                  label="Favorite Mode"
                  value={GAME_MODE_LABELS[stats.favoriteGameMode] ?? stats.favoriteGameMode}
                />
              )}
            </div>
          )}

          <div className="career-stats-group">
            <StatRow
              label="Lifetime Profit"
              value={
                <span className={stats.lifetimeProfit >= 0 ? 'career-profit' : 'career-loss'}>
                  {sign(stats.lifetimeProfit)}
                </span>
              }
            />
            <StatRow label="Hands Played" value={stats.handsPlayed.toLocaleString()} />
            <StatRow label="Hands Won" value={stats.handsWon.toLocaleString()} />
          </div>

          <div className="career-stats-group">
            <StatRow label="Winning Sessions" value={stats.winningSessions} />
            <StatRow label="Losing Sessions" value={stats.losingSessions} />
          </div>

          {stats.bestHandDescription && (
            <div className="career-stats-group">
              <StatRow label="Best Hand" value={stats.bestHandDescription} />
              {stats.bestHandCards && stats.bestHandCards.length > 0 && (
                <div className="career-stat-cards">
                  {stats.bestHandCards.map((card, i) => (
                    <CardView key={i} card={card} faceUp />
                  ))}
                </div>
              )}
              <StatRow
                label="Biggest Pot Won"
                value={<span className="career-profit">+{formatChips(stats.biggestPotWon)}</span>}
              />
            </div>
          )}

          {(stats.biggestSessionGain > 0 || stats.biggestSessionLoss > 0) && (
            <div className="career-stats-group">
              {stats.biggestSessionGain > 0 && (
                <StatRow
                  label="Best Session"
                  value={<span className="career-profit">+{formatChips(stats.biggestSessionGain)}</span>}
                />
              )}
              {stats.biggestSessionLoss > 0 && (
                <StatRow
                  label="Worst Session"
                  value={<span className="career-loss">-{formatChips(stats.biggestSessionLoss)}</span>}
                />
              )}
            </div>
          )}

          {stats.mostCommonHoleHand && (
            <div className="career-stats-group">
              <StatRow
                label="Most Dealt Hand"
                value={
                  <>
                    <code>{stats.mostCommonHoleHand.hand}</code>
                    {' '}
                    <span className="career-stat-sub">×{stats.mostCommonHoleHand.timesDealt}</span>
                  </>
                }
              />
              <div className="career-stat-cards">
                {holeHandToCards(stats.mostCommonHoleHand.hand).map((card, i) => (
                  <CardView key={i} card={card} faceUp />
                ))}
              </div>
              {stats.bestHoleHand && (
                <>
                  <StatRow
                    label="Best Starting Hand"
                    value={
                      <>
                        <code>{stats.bestHoleHand.hand}</code>
                        {' '}
                        <span className="career-stat-sub">
                          ({WinRatePct(stats.bestHoleHand.winRate)} win rate)
                        </span>
                      </>
                    }
                  />
                  <div className="career-stat-cards">
                    {holeHandToCards(stats.bestHoleHand.hand).map((card, i) => (
                      <CardView key={i} card={card} faceUp />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
