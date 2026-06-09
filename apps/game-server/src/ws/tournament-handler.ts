import type { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@vct/shared-types';
import {
  getTournamentById,
  buildPublicTournamentState,
  getRegistrations,
} from '../services/tournament-service.js';
import {
  tournamentManager,
} from '../services/tournament-manager.js';

type ClientState = { userId: string | null; lobbyId: string | null; isSpectator: boolean; sessionId: string | null };
type SendFn = (ws: WebSocket, msg: ServerMessage) => void;

export async function handleTournamentMessage(
  ws: WebSocket,
  msg: ClientMessage,
  st: ClientState,
  send: SendFn
): Promise<void> {
  if (!st.userId) {
    send(ws, { type: 'error', message: 'Not authenticated' });
    return;
  }

  switch (msg.type) {
    case 'join_tournament': {
      const data = await getTournamentById(msg.tournamentId);
      if (!data) { send(ws, { type: 'error', message: 'Tournament not found' }); return; }

      // Subscribe to tournament broadcasts
      tournamentManager.subscribeToTournament(st.userId, msg.tournamentId);

      // Send current state
      const regs = await getRegistrations(msg.tournamentId);
      const remainingMs = calcRemainingMs(data);
      const state = buildPublicTournamentState(data, regs, remainingMs);
      send(ws, { type: 'tournament_state', tournament: state });
      break;
    }

    case 'leave_tournament': {
      tournamentManager.unsubscribeFromTournament(st.userId);
      break;
    }

    case 'host_start_tournament': {
      const data = await getTournamentById(msg.tournamentId);
      if (!data) { send(ws, { type: 'error', message: 'Tournament not found' }); return; }
      if (data.hostUserId !== st.userId) { send(ws, { type: 'error', message: 'Only the host can start the tournament' }); return; }
      if (data.status !== 'waiting') { send(ws, { type: 'error', message: 'Tournament is not in waiting state' }); return; }

      const result = await tournamentManager.startTournament(msg.tournamentId);
      if ('error' in result) { send(ws, { type: 'error', message: result.error }); return; }
      break;
    }

    case 'host_cancel_tournament': {
      const data = await getTournamentById(msg.tournamentId);
      if (!data) { send(ws, { type: 'error', message: 'Tournament not found' }); return; }
      if (data.hostUserId !== st.userId) { send(ws, { type: 'error', message: 'Only the host can cancel the tournament' }); return; }
      if (data.status === 'finished' || data.status === 'cancelled') { send(ws, { type: 'error', message: 'Tournament already ended' }); return; }

      await tournamentManager.cancelTournament(msg.tournamentId);
      break;
    }

    case 'host_advance_blind_level': {
      const data = await getTournamentById(msg.tournamentId);
      if (!data) { send(ws, { type: 'error', message: 'Tournament not found' }); return; }
      if (data.hostUserId !== st.userId) { send(ws, { type: 'error', message: 'Only the host can advance the blind level' }); return; }
      if (data.status !== 'running') { send(ws, { type: 'error', message: 'Tournament is not running' }); return; }

      await tournamentManager.advanceBlindLevel(msg.tournamentId, true);
      break;
    }

    case 'tournament_acknowledge_seat_change': {
      // Client acknowledges the seat change warning — no server action needed
      // The move will execute on its timer regardless
      break;
    }

    default:
      send(ws, { type: 'error', message: 'Unknown tournament message type' });
  }
}

function calcRemainingMs(data: {
  blindLevelStartedAt: Date | null;
  blindSchedule: { durationMinutes: number }[];
  currentBlindLevel: number;
}): number {
  if (!data.blindLevelStartedAt || data.blindSchedule.length === 0) return 0;
  const levelIdx = Math.min(data.currentBlindLevel, data.blindSchedule.length - 1);
  const durationMs = data.blindSchedule[levelIdx].durationMinutes * 60_000;
  const elapsed = Date.now() - data.blindLevelStartedAt.getTime();
  return Math.max(0, durationMs - elapsed);
}
