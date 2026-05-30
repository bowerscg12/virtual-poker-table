import { formatChips } from '../utils/formatChips';

interface Props {
  amount: number;
  onRebuy: () => void;
  onLeave: () => void;
}

export function RebuyModal({ amount, onRebuy, onLeave }: Props) {
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
            Buy Back
          </button>
          <button type="button" className="btn small" onClick={onLeave}>
            Leave Table
          </button>
        </div>
      </div>
    </div>
  );
}
