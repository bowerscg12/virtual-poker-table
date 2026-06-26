import { useState, useEffect } from 'react';
import type { PublicTournamentState } from '@vct/shared-types';

interface Props {
  tournament: PublicTournamentState;
}

function useBlindCountdown(tournament: PublicTournamentState): string {
  const [label, setLabel] = useState('');
  useEffect(() => {
    function update() {
      const remaining = Math.max(0, tournament.blindLevelRemainingMs);
      if (remaining === 0) { setLabel('Last level'); return; }
      const m = Math.floor(remaining / 60_000);
      const s = Math.floor((remaining % 60_000) / 1000);
      setLabel(m > 0 ? `${m}m ${s}s` : `${s}s`);
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [tournament.blindLevelRemainingMs]);
  return label;
}

export function TournamentLeaderboard({ tournament }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const blindCountdown = useBlindCountdown(tournament);

  const currentBlind = tournament.blindSchedule[Math.min(tournament.currentBlindLevel, tournament.blindSchedule.length - 1)];
  const active = tournament.leaderboard.filter((e) => !e.isEliminated);
  const eliminated = tournament.leaderboard.filter((e) => e.isEliminated);

  if (collapsed) {
    return (
      <button
        className="btn small"
        style={{
          position: 'fixed',
          top: '4.5rem',
          right: '0.75rem',
          zIndex: 30,
          fontSize: '0.8rem',
          padding: '0.35rem 0.6rem',
          background: 'rgba(20,30,20,0.92)',
          border: '1px solid rgba(212,175,55,0.3)',
          borderRadius: 8,
        }}
        onClick={() => setCollapsed(false)}
      >
        {tournament.remainingPlayers} left
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: '4rem',
        right: 0,
        bottom: 0,
        width: 220,
        background: 'rgba(10,18,10,0.97)',
        borderLeft: '1px solid rgba(212,175,55,0.2)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 25,
        fontSize: '0.82rem',
      }}
    >
      <div style={{ padding: '0.6rem 0.75rem', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: 'var(--gold)', fontWeight: 700 }}>Leaderboard</span>
        <button
          onClick={() => setCollapsed(true)}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid rgba(255,255,255,0.08)', fontSize: '0.76rem' }}>
        <div style={{ color: 'var(--gold)' }}>
          Level {tournament.currentBlindLevel + 1} — {currentBlind?.small}/{currentBlind?.big}
        </div>
        <div style={{ opacity: 0.6, marginTop: '0.1rem' }}>
          Next level: {blindCountdown}
        </div>
        <div style={{ opacity: 0.6 }}>
          {tournament.remainingPlayers} of {tournament.totalPlayers} remaining
        </div>
        <div style={{ opacity: 0.6 }}>
          Prize pool: {tournament.prizePool.toLocaleString()} chips
        </div>
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {active.map((entry, i) => {
          const maxStack = active[0]?.stack ?? 1;
          const pct = Math.round(((entry.stack ?? 0) / Math.max(1, maxStack)) * 100);
          const isLeader = i === 0;
          return (
            <div
              key={entry.userId}
              style={{
                padding: '0.35rem 0.75rem 0.4rem',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '0.5rem' }}>
                  <span style={{ opacity: 0.5, marginRight: '0.35rem' }}>{i + 1}.</span>
                  {isLeader && <span style={{ marginRight: '0.25rem' }}>👑</span>}
                  {entry.displayName}
                  {entry.tableNumber && active.length > 9 && (
                    <span style={{ opacity: 0.4, fontSize: '0.7rem', marginLeft: '0.25rem' }}>T{entry.tableNumber}</span>
                  )}
                </span>
                <span style={{ color: 'var(--gold)', fontWeight: 600, whiteSpace: 'nowrap', fontSize: '0.75rem' }}>
                  {(entry.stack ?? 0).toLocaleString()}
                </span>
              </div>
              <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, marginTop: '0.25rem', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: isLeader ? 'var(--gold)' : 'rgba(100,200,120,0.7)',
                  borderRadius: 2,
                  transition: 'width 0.5s ease',
                }} />
              </div>
            </div>
          );
        })}

        {eliminated.length > 0 && (
          <>
            <div style={{ padding: '0.4rem 0.75rem', opacity: 0.4, fontSize: '0.72rem', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '0.25rem' }}>
              Eliminated
            </div>
            {eliminated.map((entry) => (
              <div
                key={entry.userId}
                style={{
                  padding: '0.3rem 0.75rem',
                  opacity: 0.45,
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.76rem',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {entry.bustPosition}. {entry.displayName}
                </span>
                {entry.prizeAwarded && entry.prizeAwarded > 0 && (
                  <span style={{ color: 'var(--gold)', fontSize: '0.7rem' }}>
                    +{entry.prizeAwarded.toLocaleString()}
                  </span>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
