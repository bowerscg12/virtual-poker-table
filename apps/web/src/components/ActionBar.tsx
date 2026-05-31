import { useEffect, useState } from 'react';
import type { LegalAction, PlayerActionType } from '@vct/shared-types';
import { formatChips } from '../utils/formatChips';

interface Props {
  legalActions: LegalAction[];
  onAction: (action: PlayerActionType, amount?: number) => void;
  pot: number;
  currentBet: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function computeDefaultRaise(pot: number, currentBet: number, min: number, max: number): number {
  // Re-raise: 3× current bet; first bet in street: 1/3 pot
  const raw = currentBet > 0 ? currentBet * 3 : Math.floor(pot / 3);
  return clamp(raw, min, max);
}

export function ActionBar({ legalActions, onAction, pot, currentBet }: Props) {
  const [showRaise, setShowRaise] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState(0);
  const [inputValue, setInputValue] = useState('0');

  const raise = legalActions.find((a) => a.type === 'raise');
  const raiseMin = raise?.minAmount ?? 0;
  const raiseMax = raise?.maxAmount ?? 0;
  const hasRaise = !!raise && raiseMin > 0 && raiseMax > 0;

  // Reset whenever legal actions change (new betting round or new turn); compute smart default
  useEffect(() => {
    setShowRaise(false);
    if (hasRaise) {
      const def = computeDefaultRaise(pot, currentBet, raiseMin, raiseMax);
      setRaiseAmount(def);
      setInputValue(String(def));
    }
  }, [legalActions, hasRaise, raiseMin, raiseMax, pot, currentBet]); // eslint-disable-line react-hooks/exhaustive-deps

  if (legalActions.length === 0) return null;

  const callAction = legalActions.find((a) => a.type === 'call');

  function applyRaiseAmount(v: number) {
    const clamped = clamp(v, raiseMin, raiseMax);
    setRaiseAmount(clamped);
    setInputValue(String(clamped));
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^\d]/g, '');
    setInputValue(raw);
    const v = Number(raw);
    if (v >= raiseMin && v <= raiseMax) {
      setRaiseAmount(v);
    }
  }

  function handleInputBlur() {
    const v = Number(inputValue);
    applyRaiseAmount(Number.isFinite(v) ? v : raiseMin);
  }

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
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setRaiseAmount(v);
                  setInputValue(String(v));
                }}
                aria-label="Raise amount"
              />
            </div>
            <span className="raise-panel__bound">{formatChips(raiseMin)}</span>
          </div>

          <div className="raise-panel__quick">
            <button
              type="button"
              className="btn small raise-quick-btn"
              onClick={() => applyRaiseAmount(raiseMax)}
              title={`All-in: ${formatChips(raiseMax)}`}
            >
              Max
            </button>
            <button
              type="button"
              className="btn small raise-quick-btn"
              onClick={() => applyRaiseAmount(Math.floor(pot / 2))}
              title={`Half pot: ${formatChips(Math.floor(pot / 2))}`}
            >
              ½ Pot
            </button>
            <button
              type="button"
              className="btn small raise-quick-btn"
              onClick={() => applyRaiseAmount(raiseMin)}
              title={`Minimum: ${formatChips(raiseMin)}`}
            >
              Min
            </button>
          </div>

          <div className="raise-panel__right">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="raise-panel__amount-input"
              value={inputValue}
              onChange={handleInputChange}
              onBlur={handleInputBlur}
              aria-label="Raise amount"
            />
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
