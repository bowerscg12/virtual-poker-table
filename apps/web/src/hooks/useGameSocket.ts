import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ClientMessage, LobbySummary, PublicTableState, ServerMessage } from '@vct/shared-types';
import type { Card, LegalAction } from '@vct/shared-types';
import { getWsUrl } from '../api/client';

export function useGameSocket(token: string | null, lobbyId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const pendingJoinLobbyIdRef = useRef<string | null>(null);
  const joinedLobbyRef = useRef<string | null>(null);
  const pendingMessagesRef = useRef<ClientMessage[]>([]);
  const readyToFlushRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [lobby, setLobby] = useState<LobbySummary | null>(null);
  const [table, setTable] = useState<PublicTableState | null>(null);
  const [privateState, setPrivateState] = useState<{ holeCards: Card[]; legalActions: LegalAction[] } | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !readyToFlushRef.current) {
      pendingMessagesRef.current.push(msg);
      return;
    }
    ws.send(JSON.stringify(msg));
  }, []);

  function flushPendingMessages(ws: WebSocket) {
    if (!readyToFlushRef.current || pendingMessagesRef.current.length === 0) return;
    const queued = pendingMessagesRef.current.splice(0);
    for (const msg of queued) {
      ws.send(JSON.stringify(msg));
    }
  }

  useEffect(() => {
    if (!token || !lobbyId) return;

    pendingJoinLobbyIdRef.current = lobbyId;
    joinedLobbyRef.current = null;
    readyToFlushRef.current = false;
    pendingMessagesRef.current = [];
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: 'auth', token } satisfies ClientMessage));
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as ServerMessage;
      switch (msg.type) {
        case 'lobby_state':
          setLobby(msg.lobby);
          readyToFlushRef.current = true;
          flushPendingMessages(ws);
          break;
        case 'authenticated':
          if (pendingJoinLobbyIdRef.current && joinedLobbyRef.current !== pendingJoinLobbyIdRef.current) {
            joinedLobbyRef.current = pendingJoinLobbyIdRef.current;
            ws.send(JSON.stringify({ type: 'join_lobby', lobbyId: pendingJoinLobbyIdRef.current } satisfies ClientMessage));
          }
          break;
        case 'table_state':
          setTable(msg.public);
          setPrivateState(msg.private ?? null);
          readyToFlushRef.current = true;
          flushPendingMessages(ws);
          break;
        case 'chat':
          setChat((c) => [...c, msg.message]);
          break;
        case 'error':
          setError(msg.message);
          break;
        default:
          break;
      }
    };

    ws.onclose = () => setConnected(false);
    ws.onerror = () => setError('Connection error');

    return () => {
      ws.close();
      wsRef.current = null;
      pendingJoinLobbyIdRef.current = null;
      pendingMessagesRef.current = [];
      readyToFlushRef.current = false;
    };
  }, [token, lobbyId]);

  return {
    connected,
    lobby,
    table,
    privateState,
    chat,
    error,
    send,
  };
}
