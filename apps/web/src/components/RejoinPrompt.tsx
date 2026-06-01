import type { ActiveSeatInfo } from '@vct/shared-types';

interface Props {
  seat: ActiveSeatInfo;
  onRejoin: () => void;
  onDecline: () => void;
  declining: boolean;
}

export function RejoinPrompt({ seat, onRejoin, onDecline, declining }: Props) {
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
        <div className="rejoin-prompt-actions">
          <button className="btn primary" onClick={onRejoin} disabled={declining}>
            Return to table
          </button>
          <button className="btn small" onClick={onDecline} disabled={declining}>
            {declining ? 'Releasing…' : 'Release seat'}
          </button>
        </div>
      </div>
    </div>
  );
}
