import { useState } from 'react';
import type { LobbySummary } from '@vct/shared-types';
import { TIMER_STEPS_SEC, formatTimerLabel, getTableBuyIn } from '@vct/shared-types';

interface Props {
  lobby: LobbySummary;
  onStart: () => void;
  onPause: (paused: boolean) => void;
  onKick: (seatIndex: number) => void;
  onSetBuyIn: (amount: number) => void;
  onSetActionTimer: (seconds: number) => void;
}

export function HostControls({ lobby, onStart, onPause, onKick, onSetBuyIn, onSetActionTimer }: Props) {
  const currentBuyIn = getTableBuyIn(lobby.settings);
  const [buyIn, setBuyIn] = useState(String(currentBuyIn));
  const parsedBuyIn = Number.parseInt(buyIn, 10);
  const isValidBuyIn =
    Number.isInteger(parsedBuyIn) && parsedBuyIn >= 10 && parsedBuyIn <= 10000 && parsedBuyIn % 5 === 0;

  const currentTimerSec = lobby.settings.actionTimerSec ?? 0;

  function handleUpdateBuyIn() {
    if (!isValidBuyIn) return;
    onSetBuyIn(parsedBuyIn);
  }

  return (
    <div className="host-controls panel">
      <h3>Host controls</h3>
      <label className="host-buy-in">
        Table buy-in (chips for new players)
        <div className="host-buy-in-row">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={buyIn}
            onChange={(e) => setBuyIn(e.target.value.replace(/[^\d]/g, ''))}
          />
          <button type="button" className="btn small" onClick={handleUpdateBuyIn} disabled={!isValidBuyIn}>
            Update
          </button>
        </div>
      </label>
      <p className="field-hint">Current seated stacks stay as-is; new joiners get the updated amount.</p>

      <label className="host-timer">
        Action timer
        <select
          value={currentTimerSec}
          onChange={(e) => onSetActionTimer(Number(e.target.value))}
        >
          {TIMER_STEPS_SEC.map((sec) => (
            <option key={sec} value={sec}>
              {formatTimerLabel(sec)}
            </option>
          ))}
        </select>
      </label>
      <p className="field-hint">Takes effect on the next action. Changing to "No Timer" cancels any running countdown.</p>

      <div className="host-btns">
        <button type="button" className="btn primary" onClick={onStart}>
          Start hand
        </button>
        <button type="button" className="btn" onClick={() => onPause(true)}>
          Pause
        </button>
        <button type="button" className="btn" onClick={() => onPause(false)}>
          Resume
        </button>
      </div>
      <details>
        <summary>Kick player</summary>
        <ul>
          {lobby.seats
            .filter((s) => s.userId)
            .map((s) => (
              <li key={s.seatIndex}>
                {s.displayName} ({s.stack.toLocaleString()} chips){' '}
                <button type="button" className="btn small danger" onClick={() => onKick(s.seatIndex)}>
                  Kick
                </button>
              </li>
            ))}
        </ul>
      </details>
      <p className="rules-summary">
        {lobby.settings.game} · {lobby.settings.limit} · Blinds {lobby.settings.blinds.small}/
        {lobby.settings.blinds.big}
      </p>
    </div>
  );
}
