import { useEffect, useState } from 'react';
import type { ActiveSeatInfo } from '@vct/shared-types';

interface Props {
  seat: ActiveSeatInfo;
  onRejoin: () => void;
  onDecline: () => void;
  onExpired: () => void;
  declining: boolean;
}

function formatCountdown(secs: number): string {
  if (secs <= 0) return '0s';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function RejoinPrompt({ seat, onRejoin, onDecline, onExpired, declining }: Props) {
  const [secsLeft, setSecsLeft] = useState<number | null>(() => {
    if (!seat.expiresAt) return null;
    return Math.max(0, Math.round((new Date(seat.expiresAt).getTime() - Date.now()) / 1000));
  });

  useEffect(() => {
    if (!seat.expiresAt) return;
    const deadline = new Date(seat.expiresAt).getTime();
    const update = () => Math.max(0, Math.round((deadline - Date.now()) / 1000));

    const initial = update();
    setSecsLeft(initial);
    if (initial === 0) { onExpired(); return; }

    const id = setInterval(() => {
      const remaining = update();
      setSecsLeft(remaining);
      if (remaining === 0) { clearInterval(id); onExpired(); }
    }, 1000);
    return () => clearInterval(id);
  }, [seat.expiresAt, onExpired]);

  return (
    <div className="rejoin-prompt panel">
      <div className="rejoin-prompt-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      </div>
      <div className="rejoin-prompt-body">
        <h3 className="rejoin-prompt-title">Active seat reserved</h3>
        <p className="rejoin-prompt-detail">
          Table <strong>{seat.inviteCode}</strong> &mdash; hosted by {seat.hostDisplayName}
        </p>
        <p className="rejoin-prompt-stack">
          Seat {seat.seatIndex + 1} &bull; {seat.stack.toLocaleString()} chips
        </p>
        {secsLeft !== null && (
          <p className={`rejoin-prompt-expiry${secsLeft <= 60 ? ' rejoin-prompt-expiry--urgent' : ''}`}>
            Seat reserved for {formatCountdown(secsLeft)}
          </p>
        )}
        <div className="rejoin-prompt-actions">
          <button type="button" className="btn primary" onClick={onRejoin} disabled={declining}>
            Return to table
          </button>
          <button type="button" className="btn small" onClick={onDecline} disabled={declining}>
            {declining ? 'Releasing…' : 'Release seat'}
          </button>
        </div>
      </div>
    </div>
  );
}
