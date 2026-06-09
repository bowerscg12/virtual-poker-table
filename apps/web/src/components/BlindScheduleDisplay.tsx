import { useState, useEffect } from 'react';
import type { PublicTournamentState } from '@vct/shared-types';

interface Props {
  tournament: PublicTournamentState;
  isHost: boolean;
  onAdvanceLevel: () => void;
}

function useCountdown(ms: number): string {
  const [remaining, setRemaining] = useState(ms);
  useEffect(() => {
    const started = Date.now();
    const initial = ms;
    function update() {
      const elapsed = Date.now() - started;
      const left = Math.max(0, initial - elapsed);
      setRemaining(left);
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [ms]);

  const m = Math.floor(remaining / 60_000);
  const s = Math.floor((remaining % 60_000) / 1000);
  return remaining === 0 ? 'Last level' : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function BlindScheduleDisplay({ tournament, isHost, onAdvanceLevel }: Props) {
  const [expanded, setExpanded] = useState(false);
  const countdown = useCountdown(tournament.blindLevelRemainingMs);
  const currentBlind = tournament.blindSchedule[Math.min(tournament.currentBlindLevel, tournament.blindSchedule.length - 1)];
  if (!currentBlind) return null;

  return (
    <div
      style={{
        background: 'rgba(10,20,10,0.95)',
        border: '1px solid rgba(212,175,55,0.2)',
        borderRadius: 8,
        padding: '0.4rem 0.75rem',
        fontSize: '0.8rem',
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onClick={() => setExpanded(!expanded)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--gold)', fontWeight: 600 }}>
          Level {tournament.currentBlindLevel + 1} — {currentBlind.small}/{currentBlind.big}
        </span>
        <span style={{ opacity: 0.6 }}>Next: {countdown}</span>
        {isHost && (
          <button
            className="btn small"
            style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', marginLeft: 'auto' }}
            onClick={(e) => { e.stopPropagation(); onAdvanceLevel(); }}
          >
            Advance
          </button>
        )}
      </div>

      {expanded && (
        <div style={{ marginTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.4rem' }}>
          {tournament.blindSchedule.map((l) => (
            <div
              key={l.level}
              style={{
                display: 'flex',
                gap: '1.5rem',
                padding: '0.1rem 0',
                opacity: l.level - 1 === tournament.currentBlindLevel ? 1 : 0.5,
                fontWeight: l.level - 1 === tournament.currentBlindLevel ? 700 : 400,
              }}
            >
              <span style={{ width: '2rem' }}>L{l.level}</span>
              <span>{l.small}/{l.big}</span>
              <span style={{ opacity: 0.7 }}>{l.durationMinutes}m</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
