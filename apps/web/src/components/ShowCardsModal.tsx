import { useEffect, useRef, useState } from 'react';

const TIMEOUT_MS = 5_000;

interface Props {
  deadline: string;
  onShow: () => void;
  onMuck: () => void;
}

export function ShowCardsModal({ deadline, onShow, onMuck }: Props) {
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, new Date(deadline).getTime() - Date.now())
  );
  const onMuckRef = useRef(onMuck);
  onMuckRef.current = onMuck;

  useEffect(() => {
    const tick = () => {
      const ms = Math.max(0, new Date(deadline).getTime() - Date.now());
      setRemainingMs(ms);
      if (ms === 0) onMuckRef.current();
    };

    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [deadline]);

  const pct = Math.min(100, (remainingMs / TIMEOUT_MS) * 100);
  const secs = Math.ceil(remainingMs / 1000);
  const urgent = secs <= 2;

  return (
    <div className="modal-overlay show-cards-overlay" role="dialog" aria-modal="true" aria-labelledby="show-cards-title">
      <div className="modal show-cards-modal">
        <h2 id="show-cards-title" className="modal-title">Everyone Folded</h2>
        <p className="modal-body">Would you like to show your cards?</p>

        <div className={`show-cards-timer ${urgent ? 'urgent' : ''}`}>
          <div
            className="show-cards-timer-bar"
            style={{ '--sc-pct': `${pct}%` } as React.CSSProperties}
          />
          <span className="show-cards-timer-label">{secs}s</span>
        </div>

        <div className="modal-actions show-cards-actions">
          <button type="button" className="btn primary show-cards-show-btn" onClick={onShow}>
            Show Cards
          </button>
          <button type="button" className="btn small" onClick={onMuck}>
            Muck (Hide)
          </button>
        </div>
      </div>
    </div>
  );
}
