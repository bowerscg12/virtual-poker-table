import { useEffect, useState } from 'react';

/**
 * Tracks remaining seconds until actionDeadline (ISO string from server).
 * Returns null when no deadline is set, and 0 once the deadline has passed.
 * Polls every 100ms so the display stays smooth without drifting.
 */
export function useActionTimer(actionDeadline: string | undefined): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!actionDeadline) {
      setRemaining(null);
      return;
    }

    function tick() {
      const ms = new Date(actionDeadline!).getTime() - Date.now();
      setRemaining(Math.max(0, Math.ceil(ms / 1000)));
    }

    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [actionDeadline]);

  return remaining;
}
