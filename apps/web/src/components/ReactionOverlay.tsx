import React, { useEffect, useRef, useState } from 'react';
import type { TableReaction } from '@vct/shared-types';

/** Must match the felt-emote-float animation duration in styles.css. */
const EMOTE_DURATION_MS = 3000;
/** Hard cap on simultaneously rendered emotes so a full table can't tank framerate. */
const MAX_CONCURRENT_EMOTES = 14;

export interface EmotePos {
  xPct: number;
  yPct: number;
}

interface FloatingEmote {
  id: string;
  emoji: string;
  displayName: string;
  xPct: number;
  yPct: number;
  driftX: number;
}

interface Props {
  reactions?: TableReaction[];
  /** Anchor a reaction over its sender's seat; return null to float from the felt centre (spectators). */
  getPos?: (reaction: TableReaction) => EmotePos | null;
}

/**
 * Transparent overlay that floats emoji reactions up from their sender's seat.
 * Pointer-events are disabled so it can never block cards or betting controls.
 * Only reactions arriving after mount are shown — nothing replays on reconnect.
 */
export function ReactionOverlay({ reactions, getPos }: Props) {
  const [emotes, setEmotes] = useState<FloatingEmote[]>([]);
  const processedCountRef = useRef<number | null>(null);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const getPosRef = useRef(getPos);
  getPosRef.current = getPos;

  useEffect(() => {
    if (!reactions) return;
    if (processedCountRef.current === null) {
      processedCountRef.current = reactions.length;
      return;
    }
    const prev = processedCountRef.current;
    if (reactions.length <= prev) {
      processedCountRef.current = reactions.length;
      return;
    }
    const fresh = reactions.slice(prev);
    processedCountRef.current = reactions.length;

    const spawned: FloatingEmote[] = fresh.map((r) => {
      const pos = getPosRef.current?.(r) ?? null;
      const base = pos ?? { xPct: 50, yPct: 58 };
      return {
        id: r.id,
        emoji: r.emoji,
        displayName: r.displayName,
        // Slight horizontal jitter so back-to-back reactions don't stack exactly
        xPct: base.xPct + (Math.random() * 6 - 3),
        yPct: base.yPct,
        driftX: Math.random() * 24 - 12,
      };
    });

    setEmotes((cur) => [...cur, ...spawned].slice(-MAX_CONCURRENT_EMOTES));
    const tid = setTimeout(() => {
      setEmotes((cur) => cur.filter((e) => !spawned.some((s) => s.id === e.id)));
      timersRef.current.delete(tid);
    }, EMOTE_DURATION_MS);
    timersRef.current.add(tid);
  }, [reactions]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  const latest = emotes[emotes.length - 1];

  return (
    <div className="reaction-overlay">
      {emotes.map((e) => (
        <span
          key={e.id}
          className="felt-emote"
          style={{ left: `${e.xPct}%`, top: `${e.yPct}%`, '--emote-drift-x': `${e.driftX}px` } as React.CSSProperties}
          aria-hidden="true"
        >
          {e.emoji}
        </span>
      ))}
      <span className="sr-only" role="status">
        {latest ? `${latest.displayName} reacted ${latest.emoji}` : ''}
      </span>
    </div>
  );
}
