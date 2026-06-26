import { useNavigate } from 'react-router-dom';
import type { LeaderboardEntry } from '@vct/shared-types';

interface Props {
  leaderboard: LeaderboardEntry[];
  onClose: () => void;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function TournamentSummaryModal({ leaderboard, onClose }: Props) {
  const navigate = useNavigate();
  const winner = leaderboard.find((e) => e.bustPosition === 1);
  const paid = leaderboard.filter((e) => (e.prizeAwarded ?? 0) > 0);

  function handleClose() {
    onClose();
    navigate('/tournaments');
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 75 }}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div style={{ textAlign: 'center', marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>🏆</div>
          <h2 className="modal-title">Tournament Complete!</h2>
          {winner && (
            <p style={{ opacity: 0.75, margin: '0.2rem 0 0', fontSize: '0.9rem' }}>
              Winner: <strong style={{ color: 'var(--gold)' }}>{winner.displayName}</strong>
            </p>
          )}
        </div>

        {paid.length > 0 && (
          <div style={{ marginBottom: '0.5rem' }}>
            <p style={{ fontSize: '0.75rem', opacity: 0.5, margin: '0 0 0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Prize Winners</p>
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {paid.map((entry) => (
                <div
                  key={entry.userId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.3rem 0',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    fontSize: '0.9rem',
                  }}
                >
                  <span>
                    <span style={{ opacity: 0.5, marginRight: '0.35rem' }}>{ordinal(entry.bustPosition ?? 0)}</span>
                    {entry.displayName}
                  </span>
                  <span style={{ color: 'var(--gold)', fontWeight: 600 }}>
                    +{(entry.prizeAwarded ?? 0).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginBottom: '0.5rem' }}>
          <p style={{ fontSize: '0.75rem', opacity: 0.5, margin: '0 0 0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Final Standings ({leaderboard.length} players)
          </p>
          <div style={{ maxHeight: 160, overflowY: 'auto' }}>
            {leaderboard.map((entry, i) => (
              <div
                key={entry.userId}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '0.25rem 0',
                  fontSize: '0.82rem',
                  opacity: (entry.prizeAwarded ?? 0) > 0 ? 1 : 0.5,
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}
              >
                <span><span style={{ opacity: 0.5, marginRight: '0.3rem' }}>{i + 1}.</span>{entry.displayName}</span>
                {(entry.prizeAwarded ?? 0) > 0 && (
                  <span style={{ color: 'var(--gold)', fontSize: '0.78rem' }}>
                    +{(entry.prizeAwarded ?? 0).toLocaleString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn primary" onClick={handleClose}>Back to Tournaments</button>
        </div>
      </div>
    </div>
  );
}
