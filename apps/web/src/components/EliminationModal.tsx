import { useNavigate } from 'react-router-dom';

interface Props {
  bustPosition: number;
  prizeAwarded: number | null;
  totalPlayers: number;
  onClose: () => void;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function encouragement(bustPosition: number, totalPlayers: number, prizeAwarded: number | null): string {
  if ((prizeAwarded ?? 0) > 0) {
    if (bustPosition === 1) return '🏆 Champion!';
    if (bustPosition <= 3) return 'Excellent run! 🔥';
    return 'In the money — well played';
  }
  if (bustPosition <= Math.max(1, Math.floor(totalPlayers * 0.25))) return 'So close to cashing — keep grinding';
  return 'Keep practicing and come back stronger';
}

export function EliminationModal({ bustPosition, prizeAwarded, totalPlayers, onClose }: Props) {
  const navigate = useNavigate();
  const won = (prizeAwarded ?? 0) > 0;

  function handleClose() {
    onClose();
    navigate('/tournaments');
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 80 }}>
      <div className="modal" style={{ textAlign: 'center', maxWidth: 400 }}>
        {won ? (
          <>
            <div style={{ fontSize: bustPosition === 1 ? '3rem' : '2.5rem', marginBottom: '0.5rem' }}>
              {bustPosition === 1 ? '🥇' : bustPosition === 2 ? '🥈' : bustPosition === 3 ? '🥉' : '🏆'}
            </div>
            <h2 className="modal-title" style={{ color: 'var(--gold)' }}>
              {bustPosition === 1 ? 'Tournament Winner!' : 'Congratulations!'}
            </h2>
            <p className="modal-body">
              You finished <strong>{ordinal(bustPosition)}</strong> out of {totalPlayers} players
            </p>
            <p style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--gold)', margin: '0.5rem 0' }}>
              +{(prizeAwarded ?? 0).toLocaleString()} chips
            </p>
          </>
        ) : (
          <>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.45 }}>✕</div>
            <h2 className="modal-title">Eliminated</h2>
            <p className="modal-body">
              You finished <strong>{ordinal(bustPosition)}</strong> out of {totalPlayers} players
            </p>
          </>
        )}
        <p style={{ fontSize: '0.85rem', opacity: 0.65, margin: '0.25rem 0 0.75rem' }}>
          {encouragement(bustPosition, totalPlayers, prizeAwarded)}
        </p>
        <div className="modal-actions" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={handleClose}>
            Back to Tournaments
          </button>
        </div>
      </div>
    </div>
  );
}
