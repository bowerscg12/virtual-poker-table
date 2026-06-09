import { useEffect, useState } from 'react';

interface Props {
  newTableNumber: number;
  deadline: string;
  onDismiss: () => void;
}

export function SeatChangeModal({ newTableNumber, deadline, onDismiss }: Props) {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    function update() {
      const diff = Math.max(0, new Date(deadline).getTime() - Date.now());
      setSecondsLeft(Math.ceil(diff / 1000));
      if (diff <= 0) onDismiss();
    }
    update();
    const id = setInterval(update, 500);
    return () => clearInterval(id);
  }, [deadline, onDismiss]);

  return (
    <div className="modal-overlay" style={{ zIndex: 70 }}>
      <div className="modal" style={{ textAlign: 'center', maxWidth: 340 }}>
        <h2 className="modal-title">Table Move</h2>
        <p className="modal-body">
          You are being moved to <strong style={{ color: 'var(--gold)' }}>Table {newTableNumber}</strong> to balance the tournament.
        </p>
        <p className="modal-warning">Moving in {secondsLeft}s...</p>
        <div className="modal-actions" style={{ justifyContent: 'center' }}>
          <button className="btn" onClick={onDismiss}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
