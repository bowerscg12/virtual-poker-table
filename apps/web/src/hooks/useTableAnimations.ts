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
  /**
   * Chip-to-pot flight animations to trigger. Each entry is one chip bundle traveling
   * from a seat toward the pot. Set to a new array reference on every chip commitment;
   * PokerTable uses reference equality to avoid replaying stale entries.
   */
  potFlightBatch: ReadonlyArray<{ id: string; seatIndex: number; isAllIn: boolean; delay: number }> | null;
  /**
   * First-hand "slot machine" dealer selection. Non-null only while the spin is running;
   * `highlightSeatIndex` is the seat the spotlight is currently on. The spin decelerates
   * and lands on the (server-decided) dealer, then the hole-card deal is released.
   */
  dealerSpin: { highlightSeatIndex: number } | null;
}

type WinnerEntry = { seatIndex: number; amount: number; handDescription: string; isContested: boolean };

function emptyAnim(): TableAnimState {
  return {
    dealingHandNum: null,
    boardDealFromIndex: null,
    recentBetSeat: null,
    winningSeats: new Set(),
    winnerBanner: null,
    allInShakeTrigger: 0,
    runoutHoleRevealTrigger: 0,
    potFlightBatch: null,
    dealerSpin: null,
  };
}

// ── Dealer-selection spin tuning ──────────────────────────────────────────────
const SPIN_STEP_START = 70;   // ms between spotlight hops at the start (fast)
const SPIN_DECEL = 1.14;      // each hop interval grows by this factor (ease-out)
const SPIN_MIN_TIME = 2100;   // keep hopping at least this long before landing
const SPIN_LAND_HOLD = 700;   // pause on the dealer before releasing the deal

/**
 * Build a decelerating sequence of spotlight hops around `order` (seat indices in
 * seat order) that is guaranteed to finish on `dealerSeat`. Returns the per-hop
 * schedule (ms offsets) and the total duration including the final hold.
 */
function buildSpinSchedule(
  order: number[],
  dealerSeat: number,
): { steps: { seat: number; at: number }[]; total: number } {
  const n = order.length;
  if (n === 0) return { steps: [{ seat: dealerSeat, at: 0 }], total: SPIN_LAND_HOLD };

  const steps: { seat: number; at: number }[] = [];
  let idx = Math.max(0, order.indexOf(dealerSeat));
  let t = 0;
  let interval = SPIN_STEP_START;

  // Phase 1: hop quickly, slowing each step, until the minimum spin time elapses.
  while (t < SPIN_MIN_TIME) {
    steps.push({ seat: order[idx % n], at: t });
    t += interval;
    interval *= SPIN_DECEL;
    idx++;
  }
  // Phase 2: keep slowing until the next hop would land on the dealer.
  let guard = 0;
  while (order[idx % n] !== dealerSeat && guard++ <= n) {
    steps.push({ seat: order[idx % n], at: t });
    t += interval;
    interval *= SPIN_DECEL;
    idx++;
  }
  steps.push({ seat: dealerSeat, at: t });
  return { steps, total: t + SPIN_LAND_HOLD };
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
  // Dealer spin fires once per table session (reset when the table tears down) and,
  // while running, gates all other transition animations so the deal lands after it.
  const dealerSpinFiredRef = useRef(false);
  const dealerSpinActiveRef = useRef(false);

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
      dealerSpinFiredRef.current = false;
      dealerSpinActiveRef.current = false;
      return;
    }

    function schedule(fn: () => void, ms: number) {
      const tid = setTimeout(fn, ms);
      tidQueueRef.current.push(tid);
    }

    // Release the hole-card deal animation for hand `hn` (mirrors the normal new-hand
    // trigger). Used both inline and after the dealer spin finishes.
    function startDeal(hn: number, t: PublicTableState) {
      const blindSeats = t.seats.filter(s => s.betThisStreet > 0);
      const ts = Date.now();
      const batch = blindSeats.length > 0
        ? blindSeats.map((s, i) => ({ id: `pf-blind-${ts}-${s.seatIndex}`, seatIndex: s.seatIndex, isAllIn: s.allIn, delay: i * 130 }))
        : null;
      setAnim(a => ({ ...a, dealingHandNum: hn, boardDealFromIndex: null, ...(batch ? { potFlightBatch: batch } : {}) }));
      schedule(() => setAnim(a => (a.dealingHandNum === hn ? { ...a, dealingHandNum: null } : a)), 1200);
    }

    // ── First-hand dealer spin ──────────────────────────────────────────────
    // The first hand (and only the first) randomizes the dealer server-side. Reveal
    // it with a decelerating "slot machine" spotlight that lands on the chosen seat,
    // gating the deal until it finishes. Fires once; a late joiner mid-hand-1 may see
    // it, which is acceptable since hand 1 is short-lived.
    const dealtStreet = table.street === 'preflop' || table.street === 'reveal';
    if (!dealerSpinFiredRef.current && table.handNumber === 1 && dealtStreet && table.seats.length >= 2) {
      dealerSpinFiredRef.current = true;
      dealerSpinActiveRef.current = true;
      const order = table.seats.map(s => s.seatIndex).sort((a, b) => a - b);
      const { steps, total } = buildSpinSchedule(order, table.dealerSeatIndex);
      const hn = table.handNumber;
      const dealtTable = table;

      setAnim(a => ({ ...a, dealerSpin: { highlightSeatIndex: steps[0].seat }, dealingHandNum: null, winnerBanner: null, winningSeats: new Set() }));
      for (const step of steps) {
        schedule(() => setAnim(a => (a.dealerSpin ? { ...a, dealerSpin: { highlightSeatIndex: step.seat } } : a)), step.at);
      }
      schedule(() => {
        dealerSpinActiveRef.current = false;
        setAnim(a => ({ ...a, dealerSpin: null }));
        startDeal(hn, dealtTable);
      }, total);
      return;
    }

    // While the spin is running, hold back every other transition animation so the
    // deal (and any early action) doesn't visually precede the dealer reveal.
    if (dealerSpinActiveRef.current) return;

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

      // Animate blind/ante postings that are already reflected in the new preflop state
      const ts = Date.now();
      const blindSeats = table.seats.filter(s => s.betThisStreet > 0);
      if (blindSeats.length > 0) {
        updates.potFlightBatch = blindSeats.map((s, i) => ({
          id: `pf-blind-${ts}-${s.seatIndex}`,
          seatIndex: s.seatIndex,
          isAllIn: s.allIn,
          delay: i * 130,
        }));
      }
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

    // ── Chip commitments: detected from per-seat totalBet increases ──────────
    // totalBet accumulates across the whole hand and is never cleared at street
    // boundaries, so it catches closing calls (where lastAction is wiped before
    // the broadcast because the street advanced in the same processGameAction call).
    let chipSeatIndex: number | null = null;
    let chipSeatAllIn = false;

    if (table.handNumber === prev.handNumber) {
      for (const seat of table.seats) {
        const prevSeat = prev.seats.find(s => s.seatIndex === seat.seatIndex);
        if (seat.totalBet <= (prevSeat?.totalBet ?? 0)) continue;
        chipSeatIndex = seat.seatIndex;
        chipSeatAllIn = seat.allIn;
        break;
      }
    }

    const isNewAllIn = chipSeatAllIn;

    if (chipSeatIndex !== null) {
      const seatIndex = chipSeatIndex;
      updates.recentBetSeat = seatIndex;
      schedule(() => {
        setAnim(a => (a.recentBetSeat === seatIndex ? { ...a, recentBetSeat: null } : a));
      }, 700);

      // Chip-to-pot flight: 2 chips for all-in, 1 for normal commitment
      const ts = Date.now();
      const count = chipSeatAllIn ? 2 : 1;
      updates.potFlightBatch = Array.from({ length: count }, (_, i) => ({
        id: `pf-${ts}-${seatIndex}-${i}`,
        seatIndex,
        isAllIn: chipSeatAllIn,
        delay: i * 90,
      }));
    }

    // ── Hand complete: winner banner + seat glow ────────────
    if (handComplete && handComplete !== prevHC) {
      // winnerPayouts has one entry per pot/return (main + side pots + uncalled-chip
      // returns), so a single winner often yields multiple entries. Collapse to one
      // row per seat (summing amounts) for display.
      const bySeat = new Map<number, WinnerBannerData['winners'][number]>();
      for (const w of handComplete) {
        const existing = bySeat.get(w.seatIndex);
        if (existing) {
          existing.amount += w.amount;
          if (!existing.handDescription) existing.handDescription = w.handDescription;
        } else {
          bySeat.set(w.seatIndex, {
            seatIndex: w.seatIndex,
            amount: w.amount,
            handDescription: w.handDescription,
            displayName:
              table.seats.find(s => s.seatIndex === w.seatIndex)?.displayName ??
              `Seat ${w.seatIndex + 1}`,
          });
        }
      }
      const winners = [...bySeat.values()];
      // A true split is 2+ distinct seats winning a *contested* pot — not merely
      // multiple payout entries (e.g. an uncalled-chip return alongside a single win).
      const contestedSeats = new Set(handComplete.filter(w => w.isContested).map(w => w.seatIndex));
      const banner: WinnerBannerData = { winners, isSplit: contestedSeats.size > 1 };
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
