import { useState } from 'react';
import type { LobbySummary } from '@vct/shared-types';
import { TIMER_STEPS_SEC, formatTimerLabel, getTableBuyIn } from '@vct/shared-types';
import { formatChips } from '../utils/formatChips';

interface Props {
  lobby: LobbySummary;
  handActive: boolean;
  onStart: () => void;
  onPause: (paused: boolean) => void;
  onKick: (seatIndex: number) => void;
  onSetBuyIn: (amount: number) => void;
  onSetActionTimer: (seconds: number) => void;
  onSetFlipAnte?: (ante: number) => void;
}

export function HostControls({ lobby, handActive, onStart, onPause, onKick, onSetBuyIn, onSetActionTimer, onSetFlipAnte }: Props) {
  const isTcf = lobby.settings.game === 'twelve_card_flip';
  const currentBuyIn = getTableBuyIn(lobby.settings);
  const [buyIn, setBuyIn] = useState(String(currentBuyIn));
  const parsedBuyIn = Number.parseInt(buyIn, 10);
  const isValidBuyIn =
    Number.isInteger(parsedBuyIn) && parsedBuyIn >= 10 && parsedBuyIn <= 10000 && parsedBuyIn % 5 === 0;

  const currentAnte = lobby.settings.twelveCardFlipAnte ?? currentBuyIn;
  const [ante, setAnte] = useState(String(currentAnte));
  const parsedAnte = Number.parseInt(ante, 10);
  const isValidAnte =
    Number.isInteger(parsedAnte) && parsedAnte >= 10 && parsedAnte <= 10000 && parsedAnte % 5 === 0;

  const currentTimerSec = lobby.settings.actionTimerSec ?? 0;
  const gameStarted = lobby.status === 'playing' || lobby.status === 'paused';

  function handleUpdateBuyIn() {
    if (!isValidBuyIn) return;
    onSetBuyIn(parsedBuyIn);
  }

  function handleUpdateAnte() {
    if (!isValidAnte || !onSetFlipAnte) return;
    onSetFlipAnte(parsedAnte);
  }

  return (
    <div className="host-controls panel">
      <h3>Host controls</h3>

      {isTcf && onSetFlipAnte && (
        <>
          <label className="host-buy-in">
            Ante per hand
            <div className="host-buy-in-row">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={ante}
                disabled={handActive}
                onChange={(e) => setAnte(e.target.value.replace(/[^\d]/g, ''))}
              />
              <button
                type="button"
                className="btn small"
                onClick={handleUpdateAnte}
                disabled={!isValidAnte || handActive}
              >
                Update
              </button>
            </div>
          </label>
          <p className="field-hint">
            {handActive
              ? 'Ante cannot be changed while a hand is in progress.'
              : `Current ante: ${formatChips(currentAnte)} chips. Takes effect next hand.`}
          </p>
        </>
      )}

      {!isTcf && (
        <>
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
        </>
      )}

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
        {!gameStarted && (
          <button type="button" className="btn primary" onClick={onStart}>
            Start hand
          </button>
        )}
        {gameStarted && lobby.status === 'playing' && (
          <button type="button" className="btn" onClick={() => onPause(true)}>
            Pause
          </button>
        )}
        {gameStarted && lobby.status === 'paused' && (
          <button type="button" className="btn primary" onClick={() => onPause(false)}>
            Resume
          </button>
        )}
      </div>
      <details>
        <summary>Kick player</summary>
        <ul>
          {lobby.seats
            .filter((s) => s.userId)
            .map((s) => (
              <li key={s.seatIndex}>
                {s.displayName} ({formatChips(s.stack)} chips){' '}
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
