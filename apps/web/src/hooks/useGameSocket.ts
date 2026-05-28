import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ClientMessage, LobbySummary, PublicTableState, ServerMessage } from '@vct/shared-types';
import type { Card, LegalAction } from '@vct/shared-types';
import { getWsUrl } from '../api/client';

export function useGameSocket(token: string | null, lobbyId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lobby, setLobby] = useState<LobbySummary | null>(null);
  const [table, setTable] = useState<PublicTableState | null>(null);
  const [privateState, setPrivateState] = useState<{ holeCards: Card[]; legalActions: LegalAction[] } | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [voiceToken, setVoiceToken] = useState<{ token: string; roomName: string } | null>(null);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    if (!token || !lobbyId) return;

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: 'auth', token } satisfies ClientMessage));
      ws.send(JSON.stringify({ type: 'join_lobby', lobbyId } satisfies ClientMessage));
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as ServerMessage;
      switch (msg.type) {
        case 'lobby_state':
          setLobby(msg.lobby);
          break;
        case 'table_state':
          setTable(msg.public);
          setPrivateState(msg.private ?? null);
          break;
        case 'chat':
          setChat((c) => [...c, msg.message]);
          break;
        case 'error':
          setError(msg.message);
          break;
        case 'voice_token':
          setVoiceToken({ token: msg.token, roomName: msg.roomName });
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
    };
  }, [token, lobbyId]);

  return {
    connected,
    lobby,
    table,
    privateState,
    chat,
    error,
    voiceToken,
    send,
  };
}
