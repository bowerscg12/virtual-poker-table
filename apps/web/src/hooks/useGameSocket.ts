import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ClientMessage, CashOutSummary, LeaderboardEntry, LobbySummary, PublicTableState, PublicTournamentState, ServerMessage, TableReaction } from '@vct/shared-types';
import type { Card, LegalAction, SideBetChallenge, SideBetResult } from '@vct/shared-types';
import { getWsUrl } from '../api/client';
import { useBlackjackState } from './useBlackjackState';

const SESSION_ID_KEY = 'vct_session_id';

const HEARTBEAT_INTERVAL_MS = 25_000;
const HEARTBEAT_TIMEOUT_MS = 55_000;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const RECONNECT_MAX_ATTEMPTS = 12;

export function useGameSocket(token: string | null, lobbyId: string | null, spectate = false) {
  const bj = useBlackjackState();
  const wsRef = useRef<WebSocket | null>(null);
  const pendingMessagesRef = useRef<ClientMessage[]>([]);
  const readyToFlushRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handNumberRef = useRef<number>(0);

  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [lobby, setLobby] = useState<LobbySummary | null>(null);
  const [table, setTable] = useState<PublicTableState | null>(null);
  const [privateState, setPrivateState] = useState<{ holeCards: Card[]; legalActions: LegalAction[]; timeBankUses?: number } | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<TableReaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cashOutQueued, setCashOutQueued] = useState(false);
  const [cashOutConfirmPending, setCashOutConfirmPending] = useState<{ amount: number; deadline: string } | null>(null);
  const [cashOutSummary, setCashOutSummary] = useState<CashOutSummary | null>(null);
  const [handComplete, setHandComplete] = useState<{ seatIndex: number; amount: number; handDescription: string; isContested: boolean }[] | null>(null);
  const [rebuyAvailable, setRebuyAvailable] = useState<{ amount: number } | null>(null);
  const [rebuyQueued, setRebuyQueued] = useState(false);
  const [showCardsPrompt, setShowCardsPrompt] = useState<{ deadline: string } | null>(null);
  const [bombPotPrompt, setBombPotPrompt] = useState<{ deadline: string; amount: number; doubleBoard: boolean } | null>(null);
  const [bombPotNotice, setBombPotNotice] = useState<string | null>(null);
  const [pineapplePrompt, setPineapplePrompt] = useState<{ deadline: string } | null>(null);
  const [pineappleDiscardPhase, setPineappleDiscardPhase] = useState<{ deadline: string } | null>(null);
  const [runItOutPrompt, setRunItOutPrompt] = useState<{ chooserSeatIndex: number; deadline: string; maxRuns: number } | null>(null);
  const [donationReceived, setDonationReceived] = useState<{ donorDisplayName: string; amount: number } | null>(null);
  const [donationConfirmed, setDonationConfirmed] = useState<{ recipientDisplayName: string; amount: number } | null>(null);
  const [incomingSideBetChallenge, setIncomingSideBetChallenge] = useState<SideBetChallenge | null>(null);
  const [sideBetNotice, setSideBetNotice] = useState<string | null>(null);
  const [sideBetResult, setSideBetResult] = useState<SideBetResult | null>(null);
  const [rabbitHuntAvailable, setRabbitHuntAvailable] = useState(false);
  const [rabbitCards, setRabbitCards] = useState<Card[] | null>(null);
  const [tournamentState, setTournamentState] = useState<PublicTournamentState | null>(null);
  const [seatChangeWarning, setSeatChangeWarning] = useState<{ newTableNumber: number; deadline: string } | null>(null);
  const [seatChanged, setSeatChanged] = useState<{ newLobbyId: string; newSeatIndex: number } | null>(null);
  const [eliminationResult, setEliminationResult] = useState<{ bustPosition: number; prizeAwarded: number | null; totalPlayers: number } | null>(null);
  const [tournamentFinalLeaderboard, setTournamentFinalLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [tournamentCancelled, setTournamentCancelled] = useState(false);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !readyToFlushRef.current) {
      pendingMessagesRef.current.push(msg);
      return;
    }
    ws.send(JSON.stringify(msg));
  }, []);

  const clearCashOutSummary = useCallback(() => setCashOutSummary(null), []);
  const clearBombPotNotice = useCallback(() => setBombPotNotice(null), []);

  useEffect(() => {
    if (!token || !lobbyId) return;

    let mounted = true;
    let intentionalClose = false;
    let joinedLobbyId: string | null = null;

    readyToFlushRef.current = false;
    pendingMessagesRef.current = [];
    reconnectAttemptRef.current = 0;

    function flushPending(ws: WebSocket) {
      if (!readyToFlushRef.current || pendingMessagesRef.current.length === 0) return;
      const queued = pendingMessagesRef.current.splice(0);
      for (const msg of queued) ws.send(JSON.stringify(msg));
    }

    function clearHeartbeat() {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      if (heartbeatTimeoutRef.current) {
        clearTimeout(heartbeatTimeoutRef.current);
        heartbeatTimeoutRef.current = null;
      }
    }

    function startHeartbeat(ws: WebSocket) {
      clearHeartbeat();
      heartbeatIntervalRef.current = setInterval(() => {
        if (!mounted || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'ping' } satisfies ClientMessage));
        // Force reconnect if pong not received in time
        heartbeatTimeoutRef.current = setTimeout(() => {
          if (mounted) ws.close();
        }, HEARTBEAT_TIMEOUT_MS - HEARTBEAT_INTERVAL_MS);
      }, HEARTBEAT_INTERVAL_MS);
    }

    function scheduleReconnect() {
      if (!mounted) return;
      if (reconnectAttemptRef.current >= RECONNECT_MAX_ATTEMPTS) {
        setError('Connection lost. Please refresh the page.');
        setReconnecting(false);
        return;
      }
      const delay = Math.min(
        RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttemptRef.current,
        RECONNECT_MAX_DELAY_MS
      );
      reconnectAttemptRef.current += 1;
      setReconnecting(true);
      reconnectTimerRef.current = setTimeout(() => {
        if (mounted) connect();
      }, delay);
    }

    function connect() {
      if (!mounted || !token || !lobbyId) return;

      // Reset per-connection state; joined lobby resets so we re-join after re-auth
      joinedLobbyId = null;
      readyToFlushRef.current = false;

      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mounted) return;
        setConnected(true);
        setReconnecting(false);

        const sessionId = localStorage.getItem(SESSION_ID_KEY);
        if (sessionId) {
          ws.send(JSON.stringify({ type: 'reconnect', sessionId } satisfies ClientMessage));
        } else {
          ws.send(JSON.stringify({ type: 'auth', token } satisfies ClientMessage));
        }

        startHeartbeat(ws);
      };

      ws.onmessage = (ev) => {
        if (!mounted) return;
        const msg = JSON.parse(ev.data as string) as ServerMessage;

        switch (msg.type) {
          case 'pong':
            if (heartbeatTimeoutRef.current) {
              clearTimeout(heartbeatTimeoutRef.current);
              heartbeatTimeoutRef.current = null;
            }
            break;

          case 'session_ready':
            // Server restored our session — it will push table/lobby state imminently.
            // Reset backoff counter since we successfully reconnected.
            reconnectAttemptRef.current = 0;
            readyToFlushRef.current = true;
            flushPending(ws);
            break;

          case 'session_invalid':
            // Session expired; fall back to full auth so a new session is issued.
            localStorage.removeItem(SESSION_ID_KEY);
            ws.send(JSON.stringify({ type: 'auth', token } satisfies ClientMessage));
            break;

          case 'authenticated':
            localStorage.setItem(SESSION_ID_KEY, msg.sessionId);
            reconnectAttemptRef.current = 0;
            if (lobbyId && joinedLobbyId !== lobbyId) {
              joinedLobbyId = lobbyId;
              // Spectators wire into the lobby without ever taking a seat.
              const joinMsg: ClientMessage = spectate
                ? { type: 'watch_lobby', lobbyId }
                : { type: 'join_lobby', lobbyId };
              ws.send(JSON.stringify(joinMsg));
            }
            break;

          case 'lobby_state':
            setLobby(msg.lobby);
            readyToFlushRef.current = true;
            flushPending(ws);
            break;

          case 'table_state':
            setTable(msg.public);
            setPrivateState(msg.private ?? null);
            // Clear hand result and show-cards prompt when a fresh hand begins
            if (msg.public.street === 'preflop' && msg.public.handNumber > handNumberRef.current) {
              handNumberRef.current = msg.public.handNumber;
              setHandComplete(null);
              setShowCardsPrompt(null);
              setRabbitHuntAvailable(false);
              setRabbitCards(null);
            }
            // The opt-in prompt resolves once the Bomb Pot hand starts (or a normal hand replaces it).
            if (msg.public.bombPot || msg.public.street === 'preflop') {
              setBombPotPrompt(null);
            }
            // Pineapple opt-in resolves once a hand starts.
            if (msg.public.street === 'preflop') {
              setPineapplePrompt(null);
            }
            // Pineapple discard phase clears once 2-card preflop betting begins
            // (private.legalActions will be non-empty when the action seat gets their turn).
            if (msg.private?.legalActions && msg.private.legalActions.length > 0) {
              setPineappleDiscardPhase(null);
            }
            // Run-it-out prompt resolves once the board reveal starts.
            if (msg.public.runout?.active) {
              setRunItOutPrompt(null);
            }
            readyToFlushRef.current = true;
            flushPending(ws);
            break;

          case 'hand_complete':
            setHandComplete(msg.winners);
            break;

          case 'chat':
            setChat((c) => [...c, msg.message]);
            break;

          case 'reaction':
            setReactions((r) => [...r, msg.reaction]);
            break;

          case 'cash_out_queued':
            setCashOutQueued(true);
            break;

          case 'cash_out_cancelled':
            setCashOutQueued(false);
            setCashOutConfirmPending(null);
            break;

          case 'cash_out_confirm_prompt':
            setCashOutConfirmPending({ amount: msg.amount, deadline: msg.deadline });
            break;

          case 'cashed_out':
            // Remove session so reconnect doesn't restore us to the cashed-out lobby
            localStorage.removeItem(SESSION_ID_KEY);
            setCashOutQueued(false);
            setCashOutConfirmPending(null);
            setRebuyAvailable(null);
            setRebuyQueued(false);
            setCashOutSummary(msg.summary);
            break;

          case 'show_cards_prompt':
            setShowCardsPrompt({ deadline: msg.deadline });
            break;

          case 'show_cards_result':
            setShowCardsPrompt(null);
            break;

          case 'bomb_pot_prompt':
            setBombPotNotice(null);
            setBombPotPrompt({ deadline: msg.deadline, amount: msg.amount, doubleBoard: msg.doubleBoard });
            break;

          case 'bomb_pot_cancelled':
            setBombPotPrompt(null);
            setBombPotNotice(msg.reason);
            break;

          case 'pineapple_prompt':
            setPineapplePrompt({ deadline: msg.deadline });
            break;

          case 'pineapple_cancelled':
            setPineapplePrompt(null);
            break;

          case 'pineapple_discard_phase':
            setPineappleDiscardPhase({ deadline: msg.deadline });
            break;

          case 'run_it_out_prompt':
            setRunItOutPrompt({ chooserSeatIndex: msg.chooserSeatIndex, deadline: msg.deadline, maxRuns: msg.maxRuns });
            break;

          case 'rebuy_available':
            setRebuyAvailable({ amount: msg.amount });
            setRebuyQueued(false);
            break;

          case 'rebuy_queued':
            setRebuyAvailable(null);
            setRebuyQueued(true);
            break;

          case 'rebuy_confirmed':
            setRebuyAvailable(null);
            setRebuyQueued(false);
            break;

          case 'donation_received':
            // Dismiss any active rebuy modal — player now has chips via donation
            setRebuyAvailable(null);
            setRebuyQueued(false);
            setDonationReceived({ donorDisplayName: msg.donorDisplayName, amount: msg.amount });
            break;

          case 'donation_confirmed':
            setDonationConfirmed({ recipientDisplayName: msg.recipientDisplayName, amount: msg.amount });
            break;

          case 'side_bet_challenge':
            setIncomingSideBetChallenge(msg.challenge);
            break;

          case 'side_bet_accepted':
            setIncomingSideBetChallenge((c) => (c && c.id === msg.challenge.id ? null : c));
            setSideBetNotice('Side bet accepted — locked in for the next hand');
            break;

          case 'side_bet_declined':
            setIncomingSideBetChallenge((c) => (c && c.id === msg.challengeId ? null : c));
            setSideBetNotice('Side bet declined');
            break;

          case 'side_bet_activated':
            setIncomingSideBetChallenge((c) => (c && c.id === msg.betId ? null : c));
            setSideBetNotice(`Side bet vs ${msg.opponentName} is live this hand`);
            break;

          case 'side_bet_expired':
            setIncomingSideBetChallenge((c) => (c && c.id === msg.betId ? null : c));
            setSideBetNotice('Side bet expired — a player was not dealt in');
            break;

          case 'side_bet_settled':
            setSideBetResult(msg.result);
            break;

          case 'rabbit_hunt_available':
            setRabbitHuntAvailable(true);
            break;

          case 'rabbit_hunt_result':
            setRabbitCards(msg.cards);
            break;

          case 'tournament_state':
            setTournamentState(msg.tournament);
            break;

          case 'tournament_seat_change_warning':
            setSeatChangeWarning({ newTableNumber: msg.newTableNumber, deadline: msg.deadline });
            break;

          case 'tournament_seat_changed':
            setSeatChanged({ newLobbyId: msg.newLobbyId, newSeatIndex: msg.newSeatIndex });
            break;

          case 'tournament_blind_level_changed':
            // tournament_state broadcast follows immediately; no separate action needed
            break;

          case 'tournament_elimination_result':
            setEliminationResult({ bustPosition: msg.bustPosition, prizeAwarded: msg.prizeAwarded, totalPlayers: msg.totalPlayers });
            break;

          case 'tournament_complete':
            setTournamentFinalLeaderboard(msg.finalLeaderboard);
            break;

          case 'tournament_cancelled':
            setTournamentCancelled(true);
            break;

          case 'error':
            setError(msg.message);
            break;

          case 'bj_session_recap':
            // A voluntary cash-out ends the session server-side; drop the local session id so a
            // refresh doesn't try to reconnect into the table we just left.
            if (msg.recap.cashedOut) localStorage.removeItem(SESSION_ID_KEY);
            bj.handleBjMessage(msg);
            break;

          default:
            bj.handleBjMessage(msg);
            break;
        }
      };

      ws.onclose = () => {
        if (!mounted) return;
        clearHeartbeat();
        setConnected(false);
        readyToFlushRef.current = false;
        if (!intentionalClose) scheduleReconnect();
      };

      ws.onerror = () => {
        if (!mounted) return;
        setError('Connection error');
      };
    }

    connect();

    return () => {
      mounted = false;
      intentionalClose = true;
      clearHeartbeat();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
      pendingMessagesRef.current = [];
      readyToFlushRef.current = false;
    };
  }, [token, lobbyId, spectate]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  return {
    connected,
    reconnecting,
    lobby,
    table,
    privateState,
    chat,
    reactions,
    error,
    cashOutQueued,
    cashOutConfirmPending,
    cashOutSummary,
    handComplete,
    rebuyAvailable,
    rebuyQueued,
    showCardsPrompt,
    bombPotPrompt,
    bombPotNotice,
    clearBombPotNotice,
    pineapplePrompt,
    pineappleDiscardPhase,
    runItOutPrompt,
    clearCashOutSummary,
    donationReceived,
    donationConfirmed,
    incomingSideBetChallenge,
    clearIncomingSideBetChallenge: () => setIncomingSideBetChallenge(null),
    sideBetNotice,
    clearSideBetNotice: () => setSideBetNotice(null),
    sideBetResult,
    clearSideBetResult: () => setSideBetResult(null),
    rabbitHuntAvailable,
    rabbitCards,
    tournamentState,
    seatChangeWarning,
    seatChanged,
    clearSeatChanged: () => setSeatChanged(null),
    eliminationResult,
    clearEliminationResult: () => setEliminationResult(null),
    tournamentFinalLeaderboard,
    clearTournamentFinalLeaderboard: () => setTournamentFinalLeaderboard(null),
    tournamentCancelled,
    // Blackjack state (non-null only when in a blackjack lobby)
    bjState: bj.bjState,
    bjLegalActions: bj.bjLegalActions,
    bjRoundResults: bj.bjRoundResults,
    clearBjRoundResults: bj.clearBjRoundResults,
    bjRecap: bj.bjRecap,
    clearBjRecap: bj.clearBjRecap,
    send,
  };
}
