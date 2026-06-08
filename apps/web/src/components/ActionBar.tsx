import { useEffect, useState } from 'react';
import type { LegalAction, PlayerActionType } from '@vct/shared-types';
import { formatChips } from '../utils/formatChips';

interface Props {
  legalActions: LegalAction[];
  onAction: (action: PlayerActionType, amount?: number) => void;
  pot: number;
  currentBet: number;
  limit?: string;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function computeDefaultRaise(pot: number, currentBet: number, min: number, max: number): number {
  // Re-raise: 3× current bet; first bet in street: 1/3 pot
  const raw = currentBet > 0 ? currentBet * 3 : Math.floor(pot / 3);
  return clamp(raw, min, max);
}

export function ActionBar({ legalActions, onAction, pot, currentBet, limit }: Props) {
  const [showRaise, setShowRaise] = useState(false);
  const [showAllInConfirm, setShowAllInConfirm] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState(0);
  const [inputValue, setInputValue] = useState('0');

  const raise = legalActions.find((a) => a.type === 'raise');
  const raiseMin = raise?.minAmount ?? 0;
  const raiseMax = raise?.maxAmount ?? 0;
  const hasRaise = !!raise && raiseMin > 0 && raiseMax > 0;

  const callAction = legalActions.find((a) => a.type === 'call');

  function applyRaiseAmount(v: number) {
    const clamped = clamp(v, raiseMin, raiseMax);
    setRaiseAmount(clamped);
    setInputValue(String(clamped));
  }

  // Reset whenever legal actions change (new betting round or new turn); compute smart default
  useEffect(() => {
    setShowRaise(false);
    setShowAllInConfirm(false);
    if (hasRaise) {
      const def = computeDefaultRaise(pot, currentBet, raiseMin, raiseMax);
      setRaiseAmount(def);
      setInputValue(String(def));
    }
  }, [legalActions, hasRaise, raiseMin, raiseMax, pot, currentBet]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus the raise amount input when the raise panel is opened (desktop only —
  // auto-focusing on touch devices opens the virtual keyboard and covers the confirm button)
  useEffect(() => {
    if (showRaise && !('ontouchstart' in window) && navigator.maxTouchPoints === 0) {
      setTimeout(() => {
        const input = document.querySelector('.raise-panel__amount-input') as HTMLInputElement;
        if (input) {
          input.focus();
          input.select();
        }
      }, 50);
    }
  }, [showRaise]);

  // Keyboard shortcut listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore shortcuts if the user is typing in an input, textarea, or contentEditable
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      // Ignore shortcuts if any modal overlay/dialog is active
      if (document.querySelector('.modal-overlay, [role="dialog"]')) {
        return;
      }

      const key = e.key.toLowerCase();
      const toCall = callAction ? (callAction.amount ?? 0) : 0;

      if (key === 'f') {
        const hasFold = legalActions.some((a) => a.type === 'fold');
        if (hasFold) {
          e.preventDefault();
          onAction('fold');
        }
      } else if (key === 'c') {
        const hasCheck = legalActions.some((a) => a.type === 'check');
        if (hasCheck) {
          e.preventDefault();
          onAction('check');
        } else if (callAction) {
          e.preventDefault();
          onAction('call', callAction.amount);
        }
      } else if (key === 'r') {
        if (hasRaise) {
          e.preventDefault();
          if (!showRaise) {
            setShowRaise(true);
          } else {
            onAction('raise', raiseAmount);
            setShowRaise(false);
          }
        }
      } else if (key === '1') {
        if (hasRaise) {
          e.preventDefault();
          applyRaiseAmount(raiseMin);
          if (!showRaise) setShowRaise(true);
        }
      } else if (key === '2') {
        if (hasRaise) {
          e.preventDefault();
          applyRaiseAmount(Math.floor((pot + toCall) / 2));
          if (!showRaise) setShowRaise(true);
        }
      } else if (key === '3') {
        if (hasRaise && limit !== 'fixed') {
          e.preventDefault();
          applyRaiseAmount(currentBet + pot + toCall);
          if (!showRaise) setShowRaise(true);
        }
      } else if (key === '4') {
        if (hasRaise) {
          e.preventDefault();
          applyRaiseAmount(raiseMax);
          if (!showRaise) setShowRaise(true);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [legalActions, onAction, pot, currentBet, limit, showRaise, raiseAmount, raiseMin, raiseMax, hasRaise, callAction]); // eslint-disable-line react-hooks/exhaustive-deps

  if (legalActions.length === 0) return null;

  const toCall = callAction ? (callAction.amount ?? 0) : 0;

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
          <button type="button" className="btn fold" onClick={() => onAction('fold')}>
            Fold <kbd className="key-hint">F</kbd>
          </button>
        )}
        {legalActions.some((a) => a.type === 'check') && (
          <button type="button" className="btn check" onClick={() => onAction('check')}>
            Check <kbd className="key-hint">C</kbd>
          </button>
        )}
        {callAction && (
          <button type="button" className="btn call" onClick={() => onAction('call', callAction.amount)}>
            Call {formatChips(callAction.amount ?? 0)} <kbd className="key-hint">C</kbd>
          </button>
        )}
        {hasRaise && (
          <button
            type="button"
            className={`btn raise-btn${showRaise ? ' active' : ''}`}
            onClick={() => setShowRaise((s) => !s)}
            aria-expanded={showRaise ? 'true' : 'false'}
          >
            Raise {showRaise ? '▾' : '▸'} <kbd className="key-hint">R</kbd>
          </button>
        )}
        {legalActions.some((a) => a.type === 'all_in') && (
          showAllInConfirm ? (
            <>
              <button
                type="button"
                className="btn all-in"
                onClick={() => { onAction('all_in'); setShowAllInConfirm(false); }}
              >
                Confirm All-in
              </button>
              <button
                type="button"
                className="btn small"
                onClick={() => setShowAllInConfirm(false)}
                aria-label="Cancel all-in"
              >
                ✕
              </button>
            </>
          ) : (
            <button type="button" className="btn all-in" onClick={() => setShowAllInConfirm(true)}>
              All-in
            </button>
          )
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
              onClick={() => applyRaiseAmount(raiseMin)}
              title={`Minimum: ${formatChips(raiseMin)}`}
            >
              Min <kbd className="key-hint">1</kbd>
            </button>
            <button
              type="button"
              className="btn small raise-quick-btn"
              onClick={() => applyRaiseAmount(Math.floor((pot + toCall) / 2))}
              title={`Half pot: ${formatChips(Math.floor((pot + toCall) / 2))}`}
            >
              ½ Pot <kbd className="key-hint">2</kbd>
            </button>
            {limit !== 'fixed' && limit !== 'pot_limit' && (
              <button
                type="button"
                className="btn small raise-quick-btn"
                onClick={() => applyRaiseAmount(currentBet + pot + toCall)}
                title={`Pot: ${formatChips(currentBet + pot + toCall)}`}
              >
                Pot <kbd className="key-hint">3</kbd>
              </button>
            )}
            <button
              type="button"
              className="btn small raise-quick-btn"
              onClick={() => applyRaiseAmount(raiseMax)}
              title={`${limit === 'pot_limit' ? 'Pot' : 'All-in'}: ${formatChips(raiseMax)}`}
            >
              {limit === 'pot_limit' ? 'Pot' : 'Max / All-In'} <kbd className="key-hint">{limit === 'pot_limit' ? '3' : '4'}</kbd>
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
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onAction('raise', raiseAmount);
                  setShowRaise(false);
                }
              }}
              aria-label="Raise amount"
            />
            <button
              type="button"
              className="btn primary"
              onClick={() => { onAction('raise', raiseAmount); setShowRaise(false); }}
            >
              Raise <kbd className="key-hint">R</kbd>
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
