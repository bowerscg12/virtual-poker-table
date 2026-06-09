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

export function EliminationModal({ bustPosition, prizeAwarded, totalPlayers, onClose }: Props) {
  const navigate = useNavigate();
  const won = prizeAwarded && prizeAwarded > 0;

  function handleClose() {
    onClose();
    navigate('/');
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 80 }}>
      <div className="modal" style={{ textAlign: 'center', maxWidth: 380 }}>
        {won ? (
          <>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🏆</div>
            <h2 className="modal-title" style={{ color: 'var(--gold)' }}>
              Congratulations!
            </h2>
            <p className="modal-body">
              You finished <strong>{ordinal(bustPosition)}</strong> place out of {totalPlayers} players and won{' '}
              <strong style={{ color: 'var(--gold)' }}>{prizeAwarded.toLocaleString()} chips</strong>!
            </p>
          </>
        ) : (
          <>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.5 }}>✕</div>
            <h2 className="modal-title">Eliminated</h2>
            <p className="modal-body">
              You finished <strong>{ordinal(bustPosition)}</strong> place out of {totalPlayers} players.
            </p>
            {bustPosition <= Math.max(1, Math.floor(totalPlayers * 0.15)) ? (
              <p className="modal-warning">So close — keep it up next time!</p>
            ) : null}
          </>
        )}
        <div className="modal-actions" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={handleClose}>
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
