import { useEffect, useRef, useState } from 'react';
import type { PublicTableState } from '@vct/shared-types';

export interface WinnerBannerData {
  winners: { seatIndex: number; amount: number; handDescription: string; displayName: string }[];
  isSplit: boolean;
}

export interface TableAnimState {
  /** Hand number actively being dealt (null = deal animation finished/not running) */
  dealingHandNum: number | null;
  /** Board cards from this index onward are animating in (null = not animating) */
  boardDealFromIndex: number | null;
  /** Seat that just placed a bet (for chip-pulse animation) */
  recentBetSeat: number | null;
  /** Seats currently receiving the winner-glow treatment */
  winningSeats: ReadonlySet<number>;
  /** Winner overlay data — null when hidden */
  winnerBanner: WinnerBannerData | null;
  /** Increments each time a new all-in action occurs; drives one-shot table shake */
  allInShakeTrigger: number;
  /** Increments when the all-in runout starts; drives opponent hole-card flip animation */
  runoutHoleRevealTrigger: number;
}

type WinnerEntry = { seatIndex: number; amount: number; handDescription: string };

function emptyAnim(): TableAnimState {
  return {
    dealingHandNum: null,
    boardDealFromIndex: null,
    recentBetSeat: null,
    winningSeats: new Set(),
    winnerBanner: null,
    allInShakeTrigger: 0,
    runoutHoleRevealTrigger: 0,
  };
}

/** Detects game-state transitions and returns which animation classes should be applied. */
export function useTableAnimations(
  table: PublicTableState | null,
  handComplete: WinnerEntry[] | null,
): TableAnimState {
  const prevTableRef = useRef<PublicTableState | null>(null);
  const prevHandCompleteRef = useRef<WinnerEntry[] | null>(null);
  const [anim, setAnim] = useState<TableAnimState>(emptyAnim);
  const tidQueueRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Cancel all pending timeouts on unmount to avoid setState after unmount
  useEffect(() => {
    return () => {
      for (const tid of tidQueueRef.current) clearTimeout(tid);
    };
  }, []);

  useEffect(() => {
    const prev = prevTableRef.current;
    const prevHC = prevHandCompleteRef.current;
    prevTableRef.current = table;
    prevHandCompleteRef.current = handComplete;

    if (!table) {
      setAnim(emptyAnim());
      return;
    }

    function schedule(fn: () => void, ms: number) {
      const tid = setTimeout(fn, ms);
      tidQueueRef.current.push(tid);
    }

    // On first arrival (no previous state): skip transition animations, but still
    // trigger the deal animation if this looks like a fresh preflop hand.
    if (!prev) {
      if (table.street === 'preflop') {
        const hn = table.handNumber;
        setAnim(a => ({ ...a, dealingHandNum: hn }));
        schedule(() => setAnim(a => (a.dealingHandNum === hn ? { ...a, dealingHandNum: null } : a)), 1200);
      }
      return;
    }

    const updates: Partial<TableAnimState> = {};

    // ── New hand: trigger hole-card deal animation ──────────
    if (table.handNumber > prev.handNumber && table.street === 'preflop') {
      const hn = table.handNumber;
      updates.dealingHandNum = hn;
      updates.boardDealFromIndex = null;
      updates.winnerBanner = null;
      updates.winningSeats = new Set();

      // Keep class active long enough for the last staggered card to finish
      schedule(() => {
        setAnim(a => (a.dealingHandNum === hn ? { ...a, dealingHandNum: null } : a));
      }, 1200);
    }

    // ── Community cards: flip-in animation ─────────────────
    if (table.board.length > prev.board.length) {
      const fromIdx = prev.board.length;
      updates.boardDealFromIndex = fromIdx;

      // 3 cards × 160 ms stagger + 350 ms animation = ~830 ms max
      schedule(() => {
        setAnim(a => (a.boardDealFromIndex === fromIdx ? { ...a, boardDealFromIndex: null } : a));
      }, 900);
    }

    // ── All-in runout start: flip opponents' hole cards over ─────────────
    const isNewRunoutStart = !!table.runout?.active && !prev.runout?.active;

    // ── Bet / raise / call / all_in: chip-pulse; all_in also triggers shake ──
    const lastActionChanged =
      !!table.lastAction &&
      JSON.stringify(table.lastAction) !== JSON.stringify(prev.lastAction);
    const isNewAllIn = lastActionChanged && table.lastAction!.action === 'all_in';

    if (lastActionChanged) {
      const { action, seatIndex } = table.lastAction!;
      if (action === 'raise' || action === 'call' || action === 'all_in') {
        updates.recentBetSeat = seatIndex;
        schedule(() => {
          setAnim(a => (a.recentBetSeat === seatIndex ? { ...a, recentBetSeat: null } : a));
        }, 700);
      }
    }

    // ── Hand complete: winner banner + seat glow ────────────
    if (handComplete && handComplete !== prevHC) {
      const winners = handComplete.map(w => ({
        ...w,
        displayName:
          table.seats.find(s => s.seatIndex === w.seatIndex)?.displayName ??
          `Seat ${w.seatIndex + 1}`,
      }));
      const banner: WinnerBannerData = { winners, isSplit: handComplete.length > 1 };
      updates.winnerBanner = banner;
      updates.winningSeats = new Set(handComplete.map(w => w.seatIndex));

      // Banner auto-dismisses; reference equality guards against clearing newer banners
      schedule(() => {
        setAnim(a => (a.winnerBanner === banner ? { ...a, winnerBanner: null, winningSeats: new Set() } : a));
      }, 4500);
    }

    if (Object.keys(updates).length > 0 || isNewAllIn || isNewRunoutStart) {
      setAnim(a => ({
        ...a,
        ...updates,
        ...(isNewAllIn ? { allInShakeTrigger: a.allInShakeTrigger + 1 } : {}),
        ...(isNewRunoutStart ? { runoutHoleRevealTrigger: a.runoutHoleRevealTrigger + 1 } : {}),
      }));
    }
  // handComplete identity change is the trigger; getSeatName is derived from table
  }, [table, handComplete]);

  return anim;
}
