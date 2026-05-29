import type { CashOutSummary } from '@vct/shared-types';
import { CardView } from './CardView';
import { formatChips } from '../utils/formatChips';

interface Props {
  summary: CashOutSummary;
  onLeave: () => void;
}

const HAND_RANK_LABELS: Record<string, string> = {
  high_card: 'High Card',
  pair: 'Pair',
  two_pair: 'Two Pair',
  three_kind: 'Three of a Kind',
  straight: 'Straight',
  flush: 'Flush',
  full_house: 'Full House',
  four_kind: 'Four of a Kind',
  straight_flush: 'Straight Flush',
  royal_flush: 'Royal Flush',
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

export function SessionResultsModal({ summary, onLeave }: Props) {
  const isProfit = summary.netProfit > 0;
  const isLoss = summary.netProfit < 0;
  const profitClass = isProfit ? 'profit' : isLoss ? 'loss' : '';

  const totalActions =
    summary.actionCounts.fold +
    summary.actionCounts.check +
    summary.actionCounts.call +
    summary.actionCounts.raise +
    summary.actionCounts.all_in;

  return (
    <div className="modal-overlay results-overlay" role="dialog" aria-modal="true" aria-labelledby="results-title">
      <div className="modal results-modal">
        <h2 id="results-title" className="modal-title">Session Complete</h2>
        <p className="results-player">{summary.displayName}</p>

        {/* Hero: chip total + profit/loss */}
        <div className="results-hero">
          <div className="results-final-stack">
            {formatChips(summary.finalStack)}
            <span className="results-chips-label"> chips</span>
          </div>
          {summary.netProfit !== 0 && (
            <div className={`results-net ${profitClass}`}>
              {isProfit ? '+' : ''}{formatChips(summary.netProfit)} chips
            </div>
          )}
        </div>

        <div className="results-grid">
          {/* Session overview */}
          <section className="results-section">
            <h3 className="results-section-title">Session</h3>
            <StatRow label="Duration" value={formatDuration(summary.sessionDurationMs)} />
            <StatRow label="Started with" value={`${formatChips(summary.startingStack)} chips`} />
            <StatRow label="Ended with" value={`${formatChips(summary.finalStack)} chips`} />
          </section>

          {/* Hands */}
          <section className="results-section">
            <h3 className="results-section-title">Hands</h3>
            <StatRow label="Played" value={String(summary.handsPlayed)} />
            <StatRow label="Won" value={String(summary.handsWon)} />
            <StatRow
              label="Win rate"
              value={summary.handsPlayed > 0 ? `${Math.round(summary.winPercentage * 100)}%` : '—'}
            />
            <StatRow
              label="Biggest pot won"
              value={summary.biggestPotWon > 0 ? `+${formatChips(summary.biggestPotWon)}` : '—'}
            />
            <StatRow
              label="Biggest loss"
              value={summary.biggestLoss > 0 ? `-${formatChips(summary.biggestLoss)}` : '—'}
            />
            <StatRow
              label="Avg pot won"
              value={summary.averagePotWon > 0 ? `+${formatChips(Math.round(summary.averagePotWon))}` : '—'}
            />
          </section>

          {/* Best hand */}
          {summary.bestHandDescription && (
            <section className="results-section">
              <h3 className="results-section-title">Best Hand</h3>
              <p className="results-best-hand-name">
                {summary.bestHandRank ? HAND_RANK_LABELS[summary.bestHandRank] ?? summary.bestHandRank : ''}
              </p>
              {summary.bestHandCards && summary.bestHandCards.length > 0 && (
                <div className="results-cards">
                  {summary.bestHandCards.map((card, i) => (
                    <CardView key={i} card={card} faceUp />
                  ))}
                </div>
              )}
              <p className="results-hand-desc">{summary.bestHandDescription}</p>
            </section>
          )}

          {/* Most common starting hand */}
          {summary.mostCommonStartingHand && summary.handsPlayed > 0 && (
            <section className="results-section">
              <h3 className="results-section-title">Most Dealt Hand</h3>
              <p className="results-starting-hand">{summary.mostCommonStartingHand.key}</p>
              <p className="results-starting-hand-meta">
                {summary.mostCommonStartingHand.count}× dealt
                {' · '}
                {Math.round(summary.mostCommonStartingHand.frequency * 100)}% of hands
              </p>
            </section>
          )}

          {/* Action breakdown */}
          {totalActions > 0 && (
            <section className="results-section">
              <h3 className="results-section-title">Actions</h3>
              <div className="action-breakdown">
                {summary.actionCounts.fold > 0 && (
                  <ActionBar label="Fold" count={summary.actionCounts.fold} total={totalActions} color="var(--danger)" />
                )}
                {summary.actionCounts.check > 0 && (
                  <ActionBar label="Check" count={summary.actionCounts.check} total={totalActions} color="#888" />
                )}
                {summary.actionCounts.call > 0 && (
                  <ActionBar label="Call" count={summary.actionCounts.call} total={totalActions} color="#5a9" />
                )}
                {summary.actionCounts.raise > 0 && (
                  <ActionBar label="Raise" count={summary.actionCounts.raise} total={totalActions} color="var(--gold)" />
                )}
                {summary.actionCounts.all_in > 0 && (
                  <ActionBar label="All-in" count={summary.actionCounts.all_in} total={totalActions} color="#c66" />
                )}
              </div>
            </section>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn primary" onClick={onLeave}>
            Leave Table
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const widthPct = Math.max(4, Math.round((count / total) * 100));
  return (
    <div className="action-bar-row">
      <span className="action-bar-label">{label}</span>
      <div className="action-bar-track">
        <div
          className="action-bar-fill"
          style={{ '--bar-width': `${widthPct}%`, '--bar-color': color } as React.CSSProperties}
        />
      </div>
      <span className="action-bar-count">{count}</span>
    </div>
  );
}
