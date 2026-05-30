import { useEffect, useState } from 'react';
import type { LegalAction, PlayerActionType } from '@vct/shared-types';
import { formatChips } from '../utils/formatChips';

interface Props {
  legalActions: LegalAction[];
  onAction: (action: PlayerActionType, amount?: number) => void;
}

export function ActionBar({ legalActions, onAction }: Props) {
  const [showRaise, setShowRaise] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState(0);

  const raise = legalActions.find((a) => a.type === 'raise');
  const raiseMin = raise?.minAmount ?? 0;
  const raiseMax = raise?.maxAmount ?? 0;
  const hasRaise = !!raise && raiseMin > 0 && raiseMax > 0;

  // Reset whenever legal actions change (new betting round or new turn)
  useEffect(() => {
    setShowRaise(false);
    if (hasRaise) setRaiseAmount(raiseMin);
  }, [legalActions, hasRaise, raiseMin]);

  if (legalActions.length === 0) return null;

  const callAction = legalActions.find((a) => a.type === 'call');

  return (
    <div className="action-bar" role="toolbar" aria-label="Your actions">
      {/* Buttons first in DOM — with column-reverse on parent they render closest to cards */}
      <div className="action-bar__btns">
        {legalActions.some((a) => a.type === 'fold') && (
          <button type="button" className="btn danger small" onClick={() => onAction('fold')}>
            Fold
          </button>
        )}
        {legalActions.some((a) => a.type === 'check') && (
          <button type="button" className="btn small" onClick={() => onAction('check')}>
            Check
          </button>
        )}
        {callAction && (
          <button type="button" className="btn small" onClick={() => onAction('call', callAction.amount)}>
            Call {formatChips(callAction.amount ?? 0)}
          </button>
        )}
        {hasRaise && (
          <button
            type="button"
            className={`btn small${showRaise ? ' primary' : ''}`}
            onClick={() => setShowRaise((s) => !s)}
            aria-expanded={showRaise}
          >
            Raise {showRaise ? '▾' : '▸'}
          </button>
        )}
        {legalActions.some((a) => a.type === 'all_in') && (
          <button type="button" className="btn warn small" onClick={() => onAction('all_in')}>
            All-in
          </button>
        )}
      </div>

      {/* Raise panel second in DOM — column-reverse positions it above the buttons */}
      {showRaise && hasRaise && (
        <div className="raise-panel" role="group" aria-label="Set raise amount">
          <div className="raise-panel__slider-col">
            <span className="raise-panel__bound">{formatChips(raiseMax)}</span>
            <div className="raise-panel__slider-wrap">
              <input
                className="raise-panel__slider"
                type="range"
                min={raiseMin}
                max={raiseMax}
                step={1}
                value={raiseAmount}
                onChange={(e) => setRaiseAmount(Number(e.target.value))}
                aria-label="Raise amount"
              />
            </div>
            <span className="raise-panel__bound">{formatChips(raiseMin)}</span>
          </div>
          <div className="raise-panel__right">
            <span className="raise-panel__amount">{formatChips(raiseAmount)}</span>
            <button
              type="button"
              className="btn primary small"
              onClick={() => { onAction('raise', raiseAmount); setShowRaise(false); }}
            >
              Raise
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => setShowRaise(false)}
              aria-label="Cancel raise"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
