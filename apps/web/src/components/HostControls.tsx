import { useState } from 'react';
import type { LobbySummary } from '@vct/shared-types';
import { getTableBuyIn } from '@vct/shared-types';

interface Props {
  lobby: LobbySummary;
  onStart: () => void;
  onPause: (paused: boolean) => void;
  onKick: (seatIndex: number) => void;
  onSetBuyIn: (amount: number) => void;
}

export function HostControls({ lobby, onStart, onPause, onKick, onSetBuyIn }: Props) {
  const currentBuyIn = getTableBuyIn(lobby.settings);
  const [buyIn, setBuyIn] = useState(currentBuyIn);

  return (
    <div className="host-controls panel">
      <h3>Host controls</h3>
      <label className="host-buy-in">
        Table buy-in (chips for new players)
        <div className="host-buy-in-row">
          <input
            type="number"
            min={1}
            step={50}
            value={buyIn}
            onChange={(e) => setBuyIn(Math.max(1, parseInt(e.target.value, 10) || 0))}
          />
          <button type="button" className="btn small" onClick={() => onSetBuyIn(buyIn)}>
            Update
          </button>
        </div>
      </label>
      <p className="field-hint">Current seated stacks stay as-is; new joiners get the updated amount.</p>
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
