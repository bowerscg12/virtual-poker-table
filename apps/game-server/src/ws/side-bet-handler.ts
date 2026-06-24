import type { WebSocket } from 'ws';
import type { ClientMessage, VariantConfig } from '@vct/shared-types';
import type { ClientState } from './connection.js';
import { send, sendToUser, broadcastLobby, getConnectedSet } from './connection.js';
import { broadcastTableState } from './broadcast.js';
import { getLobbyById, donateChips } from '../services/lobby.js';
import { getActiveGame, transferChipsBetweenSeats } from '../services/game-manager.js';
import { isBotUser } from '../services/bots.js';
import {
  acceptChallenge,
  createChallenge,
  declineChallenge,
  getOpenAcceptedBetsForUser,
  getPendingChallengesForTarget,
  getSettlementsForHand,
  markSettled,
  pruneTerminal,
} from '../services/side-bets.js';

/**
 * 1v1 hole-card side bets: the WS message handlers plus end-of-hand settlement. Chips move
 * directly between the two players (never through the pot) via the donate path. Sits on top of
 * the transport (connection.ts) and broadcast hub (broadcast.ts), so it needs nothing from the
 * main handler — keeping the dependency one-directional.
 */

/** userId → last side-bet challenge timestamp (spam cooldown). */
const sideBetCreateAt = new Map<string, number>();
const SIDE_BET_CREATE_COOLDOWN_MS = 3_000;

/**
 * Settle all 1v1 side bets bound to the just-completed hand. Runs after end-of-hand stacks are
 * synced so payouts clamp to real post-hand chip counts. Transfers chips directly between the two
 * players (never touching the pot) via the same path as donate_chips, then reveals the result.
 */
export async function settleSideBets(lobbyId: string, handNumber: number, config: VariantConfig): Promise<void> {
  const settlements = getSettlementsForHand(lobbyId, handNumber);
  if (settlements.length === 0) return;

  const tableWide = config.sideBetResultVisibility === 'table';

  for (const { bet, result } of settlements) {
    let payout = 0;
    if (!result.push && result.winnerUserId) {
      const winnerUserId = result.winnerUserId;
      const loserUserId =
        winnerUserId === bet.challengerUserId ? bet.targetUserId : bet.challengerUserId;

      // Authoritative post-hand stack from the active engine state; clamp the payout to it.
      const game = await getActiveGame(lobbyId);
      const loserStack = game?.seats.find((s) => s.userId === loserUserId)?.stack ?? 0;
      payout = Math.min(bet.wager, Math.max(0, loserStack));

      if (payout > 0) {
        await donateChips(lobbyId, loserUserId, winnerUserId, payout);
        await transferChipsBetweenSeats(lobbyId, loserUserId, winnerUserId, payout);
      }
    }

    const finalized = markSettled(lobbyId, bet.id, payout);
    if (!finalized) continue; // already settled (idempotent guard)

    if (tableWide) {
      broadcastLobby(lobbyId, () => ({ type: 'side_bet_settled', result: finalized }));
    } else {
      sendToUser(bet.challengerUserId, { type: 'side_bet_settled', result: finalized });
      sendToUser(bet.targetUserId, { type: 'side_bet_settled', result: finalized });
    }
  }

  pruneTerminal(lobbyId);

  // Reflect the transferred chips in everyone's tray + table immediately.
  const connected = getConnectedSet(lobbyId);
  const updatedLobby = await getLobbyById(lobbyId, connected);
  if (updatedLobby) broadcastLobby(lobbyId, () => ({ type: 'lobby_state', lobby: updatedLobby }));
  await broadcastTableState(lobbyId);
}

/**
 * On reconnect, re-send any pending side-bet challenges aimed at this player, and restore the
 * "accepted" notice for any open bet they're part of. The active-bet seat indicator returns
 * automatically via the resent table_state.
 */
export function resendSideBetPrompts(ws: WebSocket, lobbyId: string, userId: string): void {
  for (const challenge of getPendingChallengesForTarget(lobbyId, userId)) {
    send(ws, { type: 'side_bet_challenge', challenge });
  }
  for (const bet of getOpenAcceptedBetsForUser(lobbyId, userId)) {
    send(ws, { type: 'side_bet_accepted', challenge: bet });
  }
}

/** Route a side_bet_create / side_bet_accept / side_bet_decline message. */
export async function handleSideBetMessage(ws: WebSocket, msg: ClientMessage, st: ClientState): Promise<void> {
  switch (msg.type) {
    case 'side_bet_create': {
      if (!st.userId || !st.lobbyId) return;
      const userId = st.userId;
      const lobbyId = st.lobbyId;
      const { targetSeatIndex, betType, suit, wager, challengeId } = msg;

      if (!Number.isInteger(wager) || wager <= 0) {
        send(ws, { type: 'error', message: 'Side bet wager must be a positive integer' });
        return;
      }
      if (betType === 'highest_suit' || betType === 'lowest_suit') {
        if (suit !== 'h' && suit !== 'd' && suit !== 'c' && suit !== 's') {
          send(ws, { type: 'error', message: 'A suit must be chosen for this side bet' });
          return;
        }
      }

      // Cooldown to prevent challenge spam.
      const last = sideBetCreateAt.get(userId) ?? 0;
      if (Date.now() - last < SIDE_BET_CREATE_COOLDOWN_MS) {
        send(ws, { type: 'error', message: 'Slow down — too many side bet challenges' });
        return;
      }

      const lobby = await getLobbyById(lobbyId);
      if (!lobby) return;
      const challengerSeat = lobby.seats.find((s) => s.userId === userId);
      if (!challengerSeat) { send(ws, { type: 'error', message: 'You are not seated' }); return; }
      const targetSeat = lobby.seats.find((s) => s.seatIndex === targetSeatIndex);
      if (!targetSeat?.userId) { send(ws, { type: 'error', message: 'No player in that seat' }); return; }
      if (targetSeat.userId === userId) { send(ws, { type: 'error', message: 'Cannot side bet against yourself' }); return; }

      // Both players must currently hold at least the wager (engine stack is authoritative).
      const game = await getActiveGame(lobbyId);
      const challengerStack = game?.seats.find((s) => s.userId === userId)?.stack ?? challengerSeat.stack;
      const targetStack = game?.seats.find((s) => s.userId === targetSeat.userId)?.stack ?? targetSeat.stack;
      if (challengerStack < wager) { send(ws, { type: 'error', message: 'Insufficient chips for that wager' }); return; }
      if (targetStack < wager) { send(ws, { type: 'error', message: 'That player has insufficient chips' }); return; }

      const created = createChallenge(lobbyId, {
        id: challengeId,
        challengerUserId: userId,
        challengerName: challengerSeat.displayName ?? 'Player',
        targetUserId: targetSeat.userId,
        targetName: targetSeat.displayName ?? 'Player',
        type: betType,
        suit: (betType === 'highest_suit' || betType === 'lowest_suit') ? suit : undefined,
        wager,
      });
      if (!created.ok) { send(ws, { type: 'error', message: created.reason }); return; }

      sideBetCreateAt.set(userId, Date.now());

      // Bots have no WebSocket to prompt, and always accept. Resolve the challenge server-side
      // immediately (stacks were just validated above) and notify the human challenger.
      if (isBotUser(targetSeat.userId)) {
        const accepted = acceptChallenge(lobbyId, created.challenge.id, targetSeat.userId);
        if (accepted.ok) {
          sendToUser(accepted.challenge.challengerUserId, { type: 'side_bet_accepted', challenge: accepted.challenge });
        }
        return;
      }

      // Deliver the challenge to the target; the challenger sees it as pending via accepted/declined replies.
      sendToUser(targetSeat.userId, { type: 'side_bet_challenge', challenge: created.challenge });
      return;
    }

    case 'side_bet_accept': {
      if (!st.userId || !st.lobbyId) return;
      const userId = st.userId;
      const lobbyId = st.lobbyId;

      const accepted = acceptChallenge(lobbyId, msg.challengeId, userId);
      if (!accepted.ok) { send(ws, { type: 'error', message: accepted.reason }); return; }

      // Revalidate both players can still cover the wager at acceptance time.
      const bet = accepted.challenge;
      const game = await getActiveGame(lobbyId);
      const lobby = await getLobbyById(lobbyId);
      const stackOf = (uid: string) =>
        game?.seats.find((s) => s.userId === uid)?.stack ??
        lobby?.seats.find((s) => s.userId === uid)?.stack ?? 0;
      if (stackOf(bet.challengerUserId) < bet.wager || stackOf(bet.targetUserId) < bet.wager) {
        // Roll back to declined and notify both parties.
        declineChallenge(lobbyId, bet.id, userId);
        sendToUser(bet.challengerUserId, { type: 'side_bet_declined', challengeId: bet.id });
        sendToUser(bet.targetUserId, { type: 'side_bet_declined', challengeId: bet.id });
        send(ws, { type: 'error', message: 'A player no longer has enough chips' });
        return;
      }

      sendToUser(bet.challengerUserId, { type: 'side_bet_accepted', challenge: bet });
      sendToUser(bet.targetUserId, { type: 'side_bet_accepted', challenge: bet });
      return;
    }

    case 'side_bet_decline': {
      if (!st.userId || !st.lobbyId) return;
      const declined = declineChallenge(st.lobbyId, msg.challengeId, st.userId);
      if (declined) {
        sendToUser(declined.challengerUserId, { type: 'side_bet_declined', challengeId: declined.id });
      }
      return;
    }
  }
}
