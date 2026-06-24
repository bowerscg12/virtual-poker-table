import type { GameTableState } from '@vct/poker-engine';
import type { VariantConfig } from '@vct/shared-types';

/**
 * Shared, mutable per-lobby orchestration state that crosses the boundary between the main
 * handler and the modules carved out of it (e.g. the broadcast hub). State that is private to a
 * single subsystem stays with that subsystem; only state read or written from more than one
 * module lives here. Each registry is a process-wide singleton (in-memory; reset on restart).
 */

/**
 * Set when onIntermissionExpired fires but startHand fails due to insufficient active players.
 * Cleared atomically at the start of tryStartWaitingHand to prevent concurrent triggers.
 */
export const waitingForPlayers = new Map<string, boolean>();

// ── All-in runout orchestration ───────────────────────────
export interface RunoutState {
  finalEngineState: GameTableState;
  config: VariantConfig;
  startBoardCount: number;
  visibleBoardCount: number;
  gen: number;
  /** Whether all participants' hole cards should be revealed at this point in the runout. */
  revealHoleCards: boolean;
  /**
   * Stack for each seat *before* pot distribution. The engine resolves the showdown (and
   * credits winner stacks) atomically, so during the runout animation we override seat stacks
   * with these values so chips appear to remain in the center pot until the reveal is done.
   */
  prePayoutStacks: Map<number, number>;
  /** Set for multi-runout reveals; undefined for single-board runouts. */
  numRuns?: number;
  currentRunIndex?: number;
  currentRunVisibleCount?: number;
}

/** lobbyId → active runout sequence (board cards being progressively revealed) */
export const activeRunouts = new Map<string, RunoutState>();

/**
 * Monotonic generation counter for runout callbacks.
 * Incremented by cancelRunout so stale setTimeout callbacks bail immediately.
 */
export const runoutGenerations = new Map<string, number>();

// ── Pineapple discard phase ───────────────────────────────
export interface PineappleDiscardState {
  deadline: string;
  gen: number;
  /** userId → card index they chose to discard */
  discards: Map<string, number>;
  /** userIds still waiting to discard */
  pending: Set<string>;
}

/** lobbyId → in-progress pineapple discard phase data */
export const pineappleDiscardData = new Map<string, PineappleDiscardState>();

/** Returns true if a pineapple discard phase is currently active for the lobby. */
export function isPineappleDiscardActive(lobbyId: string): boolean {
  return pineappleDiscardData.has(lobbyId);
}
