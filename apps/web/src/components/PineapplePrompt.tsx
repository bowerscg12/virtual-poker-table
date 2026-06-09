import { useEffect, useRef, useState } from 'react';

const WINDOW_MS = 10_000;

interface Props {
  deadline: string;
  choice: boolean | null;
  onJoin: () => void;
  onSitOut: () => void;
}

export function PineapplePrompt({ deadline, choice, onJoin, onSitOut }: Props) {
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
      if (ms === 0 && choiceRef.current === null) onSitOutRef.current();
    };
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [deadline]);

  const pct = Math.min(100, (remainingMs / WINDOW_MS) * 100);
  const secs = Math.ceil(remainingMs / 1000);
  const urgent = secs <= 3;

  return (
    <div className="modal-overlay bomb-pot-overlay" role="dialog" aria-modal="true" aria-labelledby="pineapple-prompt-title">
      <div className="modal bomb-pot-modal pineapple-prompt-modal">
        <h2 id="pineapple-prompt-title" className="modal-title">🍍 Pineapple Hand</h2>
        <p className="modal-body">
          Next hand is <strong>Pineapple</strong>. You'll be dealt 3 hole cards and must discard one before preflop betting. Join?
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
              Play Pineapple
            </button>
            <button type="button" className="btn small" onClick={onSitOut}>
              Sit Out This Hand
            </button>
          </div>
        ) : (
          <p className={`bomb-pot-choice ${choice ? 'bomb-pot-choice--joined' : 'bomb-pot-choice--out'}`}>
            {choice ? '✅ Joined — waiting for other players…' : '🚫 Sitting out this hand'}
          </p>
        )}
      </div>
    </div>
  );
}
