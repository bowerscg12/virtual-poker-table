import { useEffect, useId, useState, type ChangeEvent } from 'react';
import type { LegalAction, PlayerActionType } from '@vct/shared-types';
import { formatChips } from '../utils/formatChips';

interface Props {
  legalActions: LegalAction[];
  onAction: (action: PlayerActionType, amount?: number) => void;
}

export function ActionBar({ legalActions, onAction }: Props) {
  const raiseId = useId();
  const [raiseAmount, setRaiseAmount] = useState(0);
  const [raiseDraft, setRaiseDraft] = useState('');
  const [raiseError, setRaiseError] = useState<string | null>(null);
  const raise = legalActions.find((a) => a.type === 'raise');
  const raiseMin = raise?.minAmount ?? 0;
  const raiseMax = raise?.maxAmount ?? 0;
  const hasRaiseBounds = !!raise && raiseMin > 0 && raiseMax > 0;

  useEffect(() => {
    if (!hasRaiseBounds) {
      setRaiseAmount(0);
      setRaiseDraft('');
      setRaiseError(null);
      return;
    }

    setRaiseAmount(raiseMin);
    setRaiseDraft(String(raiseMin));
    setRaiseError(null);
  }, [hasRaiseBounds, raiseMin, raiseMax]);

  if (legalActions.length === 0) return null;

  function clampRaiseAmount(amount: number) {
    return Math.min(raiseMax, Math.max(raiseMin, amount));
  }

  function updateRaiseAmount(amount: number) {
    const clamped = clampRaiseAmount(amount);
    setRaiseAmount(clamped);
    setRaiseDraft(String(clamped));
    setRaiseError(null);
  }

  function handleRaiseInputChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value;

    if (nextValue !== '' && !/^\d+$/.test(nextValue)) {
      setRaiseError('Raise amounts must be whole numbers.');
      return;
    }

    setRaiseDraft(nextValue);

    if (nextValue.length === 0) {
      setRaiseError('Enter a raise amount.');
      return;
    }

    const parsed = Number(nextValue);
    if (!Number.isFinite(parsed)) {
      setRaiseError('Enter a valid raise amount.');
      return;
    }

    if (parsed < raiseMin || parsed > raiseMax) {
      setRaiseError(`Raise must be between ${formatChips(raiseMin)} and ${formatChips(raiseMax)} chips.`);
      return;
    }

    setRaiseAmount(parsed);
    setRaiseError(null);
  }

  function handleRaiseBlur() {
    if (!hasRaiseBounds) return;

    const parsed = Number(raiseDraft);
    updateRaiseAmount(Number.isFinite(parsed) ? parsed : raiseMin);
  }

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
        <div className="raise-control">
          <div className="raise-control__top">
            <label className="raise-control__label" htmlFor={raiseId}>
              Raise to
            </label>
            <strong className="raise-control__value">{formatChips(raiseAmount)} chips</strong>
          </div>
          <input
            className="raise-control__range"
            type="range"
            min={raiseMin}
            max={raiseMax}
            step={1}
            value={raiseAmount}
            onChange={(event) => updateRaiseAmount(Number(event.target.value))}
            aria-label="Raise amount slider"
          />
          <div className="raise-control__inputs">
            <input
              id={raiseId}
              className="raise-control__input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={raiseDraft}
              onChange={handleRaiseInputChange}
              onBlur={handleRaiseBlur}
              aria-invalid={!!raiseError}
              aria-describedby={raiseError ? `${raiseId}-error` : `${raiseId}-hint`}
              aria-label="Raise amount"
            />
            <button
              type="button"
              className="btn primary"
              onClick={() => onAction('raise', raiseAmount)}
              disabled={!!raiseError || !raiseDraft}
            >
              Raise
            </button>
          </div>
          <p id={`${raiseId}-hint`} className="raise-control__hint">
            Minimum {formatChips(raiseMin)} chips, all-in {formatChips(raiseMax)} chips.
          </p>
          {raiseError && (
            <p id={`${raiseId}-error`} className="raise-control__error" role="status">
              {raiseError}
            </p>
          )}
        </div>
      )}
      {legalActions.some((a) => a.type === 'all_in') && (
        <button type="button" className="btn warn" onClick={() => onAction('all_in')}>
          All-in
        </button>
      )}
    </div>
  );
}
