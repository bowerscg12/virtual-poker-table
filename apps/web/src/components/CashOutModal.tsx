import { useEffect, useState } from 'react';
import { formatChips } from '../utils/formatChips';

interface Props {
  currentStack: number;
  confirmPending?: { amount: number; deadline: string } | null;
  onConfirm: () => void;
  onCancel: () => void;
  onConfirmCashOut?: () => void;
  onCancelCashOut?: () => void;
}

export function CashOutModal({
  currentStack,
  confirmPending,
  onConfirm,
  onCancel,
  onConfirmCashOut,
  onCancelCashOut,
}: Props) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!confirmPending) { setSecondsLeft(null); return; }
    const update = () => {
      const ms = new Date(confirmPending.deadline).getTime() - Date.now();
      setSecondsLeft(Math.max(0, Math.ceil(ms / 1000)));
    };
    update();
    const id = setInterval(update, 500);
    return () => clearInterval(id);
  }, [confirmPending?.deadline]);

  if (confirmPending) {
    return (
      <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="cash-out-title">
        <div className="modal">
          <h2 id="cash-out-title" className="modal-title">Cash Out?</h2>
          <p className="modal-body">Hand is over. Cash out now with your final stack?</p>
          <p className="modal-chip-count">{formatChips(confirmPending.amount)} chips</p>
          {secondsLeft !== null && (
            <p className="modal-warning">Auto-confirming in {secondsLeft}s</p>
          )}
          <div className="modal-actions">
            <button type="button" className="btn danger" onClick={onConfirmCashOut}>
              Cash Out
            </button>
            <button type="button" className="btn" onClick={onCancelCashOut}>
              Stay
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="cash-out-title">
      <div className="modal">
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
      </div>
    </div>
  );
}
