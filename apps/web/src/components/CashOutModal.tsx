import { formatChips } from '../utils/formatChips';

interface Props {
  currentStack: number;
  queued: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onCancelQueue: () => void;
}

export function CashOutModal({ currentStack, queued, onConfirm, onCancel, onCancelQueue }: Props) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="cash-out-title">
      <div className="modal">
        {queued ? (
          <>
            <h2 id="cash-out-title" className="modal-title">Cash Out Pending</h2>
            <p className="modal-body">
              Your cash-out request is queued. You will automatically leave the table with your
              chips when the current hand finishes.
            </p>
            <p className="modal-chip-count">
              {formatChips(currentStack)} chips
            </p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={onCancelQueue}>
                Cancel Request
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="cash-out-title" className="modal-title">Cash Out?</h2>
            <p className="modal-body">
              You are about to cash out and leave the table with:
            </p>
            <p className="modal-chip-count">
              {formatChips(currentStack)} chips
            </p>
            <p className="modal-warning">
              Your seat will become available to other players.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn danger" onClick={onConfirm}>
                Cash Out
              </button>
              <button type="button" className="btn" onClick={onCancel}>
                Stay
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
