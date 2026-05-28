import { useState } from 'react';
import type { LegalAction, PlayerActionType } from '@vct/shared-types';

interface Props {
  legalActions: LegalAction[];
  onAction: (action: PlayerActionType, amount?: number) => void;
}

export function ActionBar({ legalActions, onAction }: Props) {
  const [raiseAmount, setRaiseAmount] = useState(0);
  const raise = legalActions.find((a) => a.type === 'raise');

  if (legalActions.length === 0) return null;

  return (
    <div className="action-bar" role="toolbar" aria-label="Your actions">
      {legalActions.some((a) => a.type === 'fold') && (
        <button type="button" className="btn danger" onClick={() => onAction('fold')}>
          Fold <kbd>F</kbd>
        </button>
      )}
      {legalActions.some((a) => a.type === 'check') && (
        <button type="button" className="btn" onClick={() => onAction('check')}>
          Check <kbd>K</kbd>
        </button>
      )}
      {legalActions.filter((a) => a.type === 'call').map((a, i) => (
        <button key={i} type="button" className="btn" onClick={() => onAction('call', a.amount)}>
          Call {a.amount}
        </button>
      ))}
      {raise && (
        <>
          <input
            type="range"
            min={raise.minAmount}
            max={raise.maxAmount}
            value={raiseAmount || raise.minAmount}
            onChange={(e) => setRaiseAmount(Number(e.target.value))}
          />
          <button
            type="button"
            className="btn primary"
            onClick={() => onAction('raise', raiseAmount || raise.minAmount)}
          >
            Raise
          </button>
        </>
      )}
      {legalActions.some((a) => a.type === 'all_in') && (
        <button type="button" className="btn warn" onClick={() => onAction('all_in')}>
          All-in
        </button>
      )}
    </div>
  );
}
