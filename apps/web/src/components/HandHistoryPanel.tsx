import { useEffect, useState } from 'react';
import type { HandHistoryEntry } from '@vct/shared-types';
import { getHandHistory } from '../api/client';

interface Props {
  lobbyId: string;
  onClose: () => void;
}

export function HandHistoryPanel({ lobbyId, onClose }: Props) {
  const [hands, setHands] = useState<HandHistoryEntry[]>([]);

  useEffect(() => {
    getHandHistory(lobbyId).then((r) => setHands(r.hands as HandHistoryEntry[]));
  }, [lobbyId]);

  return (
    <aside className="history-panel card">
      <header>
        <h2>Hand history</h2>
        <button type="button" onClick={onClose}>
          ×
        </button>
      </header>
      <ul>
        {hands.length === 0 && <li>No hands yet</li>}
        {hands.map((h) => (
          <li key={h.id}>
            Hand #{h.handNumber} — {h.winners.map((w) => w.handDescription).join(', ') || 'Complete'}
          </li>
        ))}
      </ul>
    </aside>
  );
}
