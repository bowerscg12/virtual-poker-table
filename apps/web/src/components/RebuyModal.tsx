import { useEffect, useRef } from 'react';
import { formatChips } from '../utils/formatChips';

const AUTO_CLOSE_MS = 30_000;

interface Props {
  amount: number;
  onRebuy: () => void;
  onSitOut: () => void;
  onLeave: () => void;
  onDismiss: () => void;
}

export function RebuyModal({ amount, onRebuy, onSitOut, onLeave, onDismiss }: Props) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const tid = setTimeout(() => onDismissRef.current(), AUTO_CLOSE_MS);
    return () => clearTimeout(tid);
  }, []);

  return (
    <div className="modal-overlay rebuy-overlay" role="dialog" aria-modal="true" aria-labelledby="rebuy-title">
      <div className="modal rebuy-modal">
        <div className="rebuy-bust-banner">OUT OF CHIPS</div>
        <h2 id="rebuy-title" className="modal-title">Buy Back In?</h2>
        <p className="modal-body">Your chip stack hit zero. Buy back in to keep playing.</p>
        <p className="rebuy-amount">
          <span className="rebuy-chip-count">{formatChips(amount)}</span>
          <span className="rebuy-chip-label"> chips</span>
        </p>
        <div className="modal-actions rebuy-actions">
          <button type="button" className="btn primary rebuy-btn" onClick={onRebuy}>
            Buy Back In
          </button>
          <button type="button" className="btn small" onClick={onSitOut}>
            Sit Out
          </button>
          <button type="button" className="btn small" onClick={onLeave}>
            Leave Table
          </button>
        </div>
        <p className="rebuy-dismiss-hint">Sit out to stay seated with no chips — you can buy back in any time from your seat.</p>
      </div>
    </div>
  );
}
