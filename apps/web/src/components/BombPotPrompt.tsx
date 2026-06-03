import { useEffect, useRef, useState } from 'react';
import { formatChips } from '../utils/formatChips';

const WINDOW_MS = 10_000;

interface Props {
  deadline: string;
  amount: number;
  doubleBoard: boolean;
  /** null = no choice yet, true = joined, false = sitting out */
  choice: boolean | null;
  onJoin: () => void;
  onSitOut: () => void;
}

export function BombPotPrompt({ deadline, amount, doubleBoard, choice, onJoin, onSitOut }: Props) {
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, new Date(deadline).getTime() - Date.now())
  );
  const onSitOutRef = useRef(onSitOut);
  onSitOutRef.current = onSitOut;
  const choiceRef = useRef(choice);
  choiceRef.current = choice;

  useEffect(() => {
    const tick = () => {
      const ms = Math.max(0, new Date(deadline).getTime() - Date.now());
      setRemainingMs(ms);
      // Timing out without a response is treated as sitting out.
      if (ms === 0 && choiceRef.current === null) onSitOutRef.current();
    };
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [deadline]);

  const pct = Math.min(100, (remainingMs / WINDOW_MS) * 100);
  const secs = Math.ceil(remainingMs / 1000);
  const urgent = secs <= 3;
  const title = doubleBoard ? 'Double Board Bomb Pot' : 'Bomb Pot';

  return (
    <div className="modal-overlay bomb-pot-overlay" role="dialog" aria-modal="true" aria-labelledby="bomb-pot-title">
      <div className="modal bomb-pot-modal">
        <h2 id="bomb-pot-title" className="modal-title">💣 {title}</h2>
        <p className="modal-body">
          A {doubleBoard ? 'Double Board ' : ''}Bomb Pot is starting. Ante is{' '}
          <strong>{formatChips(amount)}</strong> chips. Join?
        </p>

        <div className={`show-cards-timer ${urgent ? 'urgent' : ''}`}>
          <div
            className="show-cards-timer-bar"
            style={{ '--sc-pct': `${pct}%` } as React.CSSProperties}
          />
          <span className="show-cards-timer-label">{secs}s</span>
        </div>

        {choice === null ? (
          <div className="modal-actions bomb-pot-actions">
            <button type="button" className="btn primary" onClick={onJoin}>
              Join Bomb Pot
            </button>
            <button type="button" className="btn small" onClick={onSitOut}>
              Sit Out This Bomb Pot
            </button>
          </div>
        ) : (
          <p className={`bomb-pot-choice ${choice ? 'bomb-pot-choice--joined' : 'bomb-pot-choice--out'}`}>
            {choice ? '✅ Joined — waiting for other players…' : '🚫 Sitting out this Bomb Pot'}
          </p>
        )}
      </div>
    </div>
  );
}
