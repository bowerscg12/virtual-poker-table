import type { Card } from '@vct/shared-types';
import { getConnectedSet, broadcastLobby, sendToUser } from './connection.js';
import { waitingForPlayers, activeRunouts, isPineappleDiscardActive } from './state.js';
import { getTimeBankRemaining } from './time-bank.js';
import { getLobbyById } from '../services/lobby.js';
import {
  getActiveGame,
  getActionDeadline,
  getIntermissionDeadline,
  toPublicState,
} from '../services/game-manager.js';
import { drainBindNotifications } from '../services/side-bets.js';
import { addSystemChatMessage } from '../services/chat.js';

/**
 * Table-state broadcast hub. Sits on top of the transport layer (connection.ts) and reads shared
 * orchestration state (state.ts) to render each client's view. Carved out of the main handler so
 * subsystem modules can broadcast without importing — and creating a cycle with — the handler.
 */

/** Deliver any pending 1v1 side-bet activation/expiry notifications queued at deal time. */
function deliverSideBetBindNotifications(lobbyId: string): void {
  const drained = drainBindNotifications(lobbyId);
  if (!drained) return;
  for (const a of drained.activated) {
    for (const userId of a.participantUserIds) {
      sendToUser(userId, {
        type: 'side_bet_activated',
        betId: a.bet.id,
        opponentName: a.opponentNameByUser[userId] ?? 'Opponent',
      });
    }
  }
  for (const e of drained.expired) {
    for (const userId of e.participantUserIds) {
      sendToUser(userId, { type: 'side_bet_expired', betId: e.bet.id, reason: e.reason });
    }
  }
}

/**
 * After a seat is vacated, post a system chat message if host status migrated to a new player.
 * `updated` is the lobby summary reflecting the post-removal state.
 */
export function announceHostChange(
  lobbyId: string,
  prevHostUserId: string | null,
  updated: { hostUserId: string | null; hostDisplayName: string } | null
): void {
  if (!updated) return;
  if (updated.hostUserId && updated.hostUserId !== prevHostUserId) {
    const msg = addSystemChatMessage(lobbyId, `${updated.hostDisplayName} is now the host.`);
    broadcastLobby(lobbyId, () => ({ type: 'chat', message: msg }));
  }
}

export async function broadcastTableState(lobbyId: string): Promise<void> {
  const connected = getConnectedSet(lobbyId);
  const lobby = await getLobbyById(lobbyId, connected);
  if (!lobby) return;

  // Deliver any pending 1v1 side-bet activation/expiry notifications queued at deal time.
  deliverSideBetBindNotifications(lobbyId);

  const deadline = getActionDeadline(lobbyId);
  const intermDeadline = getIntermissionDeadline(lobbyId);
  const paused = lobby.status === 'paused';
  const isWaitingForPlayers = waitingForPlayers.get(lobbyId) ?? false;

  // When a runout is active use the final engine state and a truncated board count.
  // Override seat stacks with pre-payout values so chips appear to stay in the center
  // pot until the board has been fully revealed and handleHandComplete fires.
  const runout = activeRunouts.get(lobbyId);
  const rawGame = runout ? runout.finalEngineState : await getActiveGame(lobbyId);

  // For multi-runout: override the board to show the current run's cards at the current reveal depth.
  let boardOverride: Card[] | undefined;
  let runoutCurrentRun: number | undefined;
  let runoutTotalRuns: number | undefined;
  if (runout?.numRuns !== undefined && runout.currentRunIndex !== undefined && rawGame?.runoutBoards) {
    boardOverride = rawGame.runoutBoards[runout.currentRunIndex].slice(0, runout.currentRunVisibleCount ?? 0);
    runoutCurrentRun = runout.currentRunIndex + 1;
    runoutTotalRuns = runout.numRuns;
  }

  const game = runout && rawGame
    ? {
        ...rawGame,
        board: boardOverride ?? rawGame.board,
        seats: rawGame.seats.map((s) => ({
          ...s,
          stack: runout.prePayoutStacks.get(s.seatIndex) ?? s.stack,
        })),
      }
    : rawGame;
  // For single runout pass visibleBoardCount; for multi-runout the board is already sliced above.
  const visibleBoardCount = (runout && !boardOverride) ? runout.visibleBoardCount : undefined;
  const runoutActive = runout !== undefined;
  const revealHoleCards = runout ? runout.revealHoleCards : undefined;

  const suppressLegalActions = isPineappleDiscardActive(lobbyId);

  broadcastLobby(lobbyId, (userId, isSpectator) => {
    if (!game) {
      return { type: 'lobby_state', lobby };
    }
    const { public: pub, private: priv } = toPublicState(
      lobbyId, game, userId, isSpectator, lobby.settings, deadline, paused, intermDeadline,
      visibleBoardCount, runoutActive, revealHoleCards,
      runoutCurrentRun, runoutTotalRuns, suppressLegalActions,
      userId ? getTimeBankRemaining(lobbyId, userId) : undefined,
    );
    return {
      type: 'table_state',
      public: { ...pub, waitingForPlayers: isWaitingForPlayers || undefined },
      private: priv,
    };
  });
}
