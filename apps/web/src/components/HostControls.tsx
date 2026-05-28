import type { LobbySummary } from '@vct/shared-types';

interface Props {
  lobby: LobbySummary;
  onStart: () => void;
  onPause: (paused: boolean) => void;
  onKick: (seatIndex: number) => void;
}

export function HostControls({ lobby, onStart, onPause, onKick }: Props) {
  return (
    <div className="host-controls card">
      <h3>Host controls</h3>
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
                {s.displayName}{' '}
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
