import { useEffect, useRef } from 'react';
import type { PublicTableState } from '@vct/shared-types';
import type { PublicBlackjackState, BlackjackRoundPlayerResult } from '@vct/shared-types';
import type { TableAnimState } from './useTableAnimations';
import { useActionTimer } from './useActionTimer';
import { playSound } from '../utils/soundEngine';

export function useSoundEffects(
  enabled: boolean,
  table: PublicTableState | null,
  anim: TableAnimState,
  mySeatIndex: number,
  bjState: PublicBlackjackState | null,
  bjRoundResults: BlackjackRoundPlayerResult[] | null,
  myUserId: string | undefined,
): void {
  const prevTableRef = useRef<PublicTableState | null>(null);
  const prevAnimRef = useRef<TableAnimState | null>(null);
  const prevBjPhaseRef = useRef<string | null>(null);
  const prevBjRoundResultsRef = useRef<BlackjackRoundPlayerResult[] | null>(null);
  const prevBjStateRef = useRef<PublicBlackjackState | null>(null);
  const prevTimerSecondRef = useRef<number | null>(null);

  // ── Poker: state transition sounds ─────────────────────────────────────────
  useEffect(() => {
    const prev = prevTableRef.current;
    const prevAnim = prevAnimRef.current;
    prevTableRef.current = table;
    prevAnimRef.current = anim;

    if (!table || !prev) return;

    // Hole card deal: dealingHandNum goes null → handNumber
    if (anim.dealingHandNum !== prevAnim?.dealingHandNum && anim.dealingHandNum !== null) {
      playSound(enabled, 'deal');
    }

    // Board card deal: boardDealFromIndex goes null → index
    if (anim.boardDealFromIndex !== prevAnim?.boardDealFromIndex && anim.boardDealFromIndex !== null) {
      playSound(enabled, 'deal');
    }

    // Last action changed
    const lastStr = JSON.stringify(table.lastAction);
    const prevStr = JSON.stringify(prev.lastAction);
    if (lastStr !== prevStr && table.lastAction) {
      switch (table.lastAction.action) {
        case 'check': playSound(enabled, 'check'); break;
        case 'fold':  playSound(enabled, 'fold');  break;
        case 'call':
        case 'raise': playSound(enabled, 'chip');  break;
        case 'all_in': playSound(enabled, 'allin'); break;
      }
    }

    // Winner banner appeared (null → non-null)
    if (anim.winnerBanner !== null && (prevAnim?.winnerBanner ?? null) === null) {
      if (mySeatIndex >= 0 && anim.winningSeats.has(mySeatIndex)) {
        playSound(enabled, 'win');
      } else if (mySeatIndex >= 0) {
        playSound(enabled, 'lose');
      }
    }
  }, [enabled, table, anim, mySeatIndex]);

  // ── Timer tick: last 10 s of MY turn only ──────────────────────────────────
  const remaining = useActionTimer(table?.paused ? undefined : table?.actionDeadline);
  useEffect(() => {
    if (!enabled) return;
    if (remaining === null || remaining <= 0 || remaining > 10) return;
    if (table?.actionSeatIndex !== mySeatIndex) return;
    if (remaining === prevTimerSecondRef.current) return;
    prevTimerSecondRef.current = remaining;
    playSound(enabled, 'tick');
  }, [enabled, remaining, table?.actionSeatIndex, mySeatIndex]);

  // ── Blackjack: phase transitions + round results ───────────────────────────
  useEffect(() => {
    const prevPhase = prevBjPhaseRef.current;
    const prevResults = prevBjRoundResultsRef.current;
    const prevBjState = prevBjStateRef.current;
    prevBjPhaseRef.current = bjState?.phase ?? null;
    prevBjRoundResultsRef.current = bjRoundResults;
    prevBjStateRef.current = bjState;

    // Cards dealt: betting → dealing
    if (bjState?.phase === 'dealing' && prevPhase === 'waiting_for_bets') {
      playSound(enabled, 'deal');
    }

    // Round results appeared
    if (bjRoundResults && bjRoundResults !== prevResults) {
      const myResult = bjRoundResults.find(r => r.userId === myUserId);
      if (myResult) {
        if (myResult.stackDelta > 0) {
          playSound(enabled, 'win');
        } else if (myResult.stackDelta < 0) {
          playSound(enabled, 'lose');
        }
        // push (stackDelta === 0): silence
      }
    }

    // Chip sound when my pending bet changes during betting phase
    if (
      bjState?.phase === 'waiting_for_bets' &&
      prevPhase === 'waiting_for_bets' &&
      myUserId
    ) {
      const myPlayer = bjState.players.find(p => p.userId === myUserId);
      const prevMyPlayer = prevBjState?.players.find(p => p.userId === myUserId);
      if (myPlayer && prevMyPlayer && myPlayer.pendingBet !== prevMyPlayer.pendingBet) {
        playSound(enabled, 'chip');
      }
    }
  }, [enabled, bjState, bjRoundResults, myUserId]);
}
