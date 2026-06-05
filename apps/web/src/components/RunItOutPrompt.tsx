import { useEffect, useRef, useState } from 'react';

const WINDOW_MS = 10_000;

interface Props {
  deadline: string;
  maxRuns: number;
  isChooser: boolean;
  chooserName: string;
  onChoice: (times: number) => void;
}

export function RunItOutPrompt({ deadline, maxRuns, isChooser, chooserName, onChoice }: Props) {
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, new Date(deadline).getTime() - Date.now())
  );
  const [chosen, setChosen] = useState<number | null>(null);
  const chosenRef = useRef<number | null>(null);
  const onChoiceRef = useRef(onChoice);
  onChoiceRef.current = onChoice;

  useEffect(() => {
    const tick = () => {
      const ms = Math.max(0, new Date(deadline).getTime() - Date.now());
      setRemainingMs(ms);
      if (ms === 0 && chosenRef.current === null && isChooser) {
        chosenRef.current = 1;
        setChosen(1);
        onChoiceRef.current(1);
      }
    };
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [deadline, isChooser]);

  const pct = Math.min(100, (remainingMs / WINDOW_MS) * 100);
  const secs = Math.ceil(remainingMs / 1000);
  const urgent = secs <= 3;

  function pick(times: number) {
    if (chosen !== null || !isChooser) return;
    chosenRef.current = times;
    setChosen(times);
    onChoiceRef.current(times);
  }

  const labels: Record<number, string> = { 1: 'Run Once', 2: 'Run Twice', 3: 'Run 3 Times' };

  return (
    <div className="modal-overlay run-it-out-overlay" role="dialog" aria-modal="true" aria-labelledby="rio-title">
      <div className="modal run-it-out-modal">
        <h2 id="rio-title" className="modal-title">All-In Showdown</h2>

        {isChooser ? (
          <>
            <p className="modal-body">You get to choose how many times to run the board out.</p>
            <div className={`show-cards-timer ${urgent ? 'urgent' : ''}`}>
              <div
                className="show-cards-timer-bar"
                style={{ '--sc-pct': `${pct}%` } as React.CSSProperties}
              />
              <span className="show-cards-timer-label">{secs}s</span>
            </div>
            {chosen === null ? (
              <div className="modal-actions run-it-out-actions">
                {Array.from({ length: maxRuns }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`btn ${n === 1 ? '' : 'primary'}`}
                    onClick={() => pick(n)}
                  >
                    {labels[n] ?? `Run ${n}×`}
                  </button>
                ))}
              </div>
            ) : (
              <p className="run-it-out-chosen">
                Running it {chosen === 1 ? 'once' : chosen === 2 ? 'twice' : `${chosen} times`}…
              </p>
            )}
          </>
        ) : (
          <>
            <p className="modal-body">
              <strong>{chooserName}</strong> is choosing how many times to run the board out.
            </p>
            <div className={`show-cards-timer ${urgent ? 'urgent' : ''}`}>
              <div
                className="show-cards-timer-bar"
                style={{ '--sc-pct': `${pct}%` } as React.CSSProperties}
              />
              <span className="show-cards-timer-label">{secs}s</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
