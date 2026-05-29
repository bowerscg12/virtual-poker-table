import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getTableBuyIn, type LobbySummary } from '@vct/shared-types';
import { useAuth } from '../context/AuthContext';
import { getLobbyById } from '../api/client';
import { useGameSocket } from '../hooks/useGameSocket';
import { PokerTable } from '../components/PokerTable';
import { ActionBar } from '../components/ActionBar';
import { ChatPanel } from '../components/ChatPanel';
import { HostControls } from '../components/HostControls';
import { HandHistoryPanel } from '../components/HandHistoryPanel';

export default function TablePage() {
  const { lobbyId } = useParams<{ lobbyId: string }>();
  const { user, token } = useAuth();
  const [chatOpen, setChatOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapshotLobby, setSnapshotLobby] = useState<LobbySummary | null>(null);
  const { connected, reconnecting, lobby, table, privateState, chat, error, send } = useGameSocket(
    token,
    lobbyId ?? null
  );

  useEffect(() => {
    if (!lobbyId) return;

    let cancelled = false;
    getLobbyById(lobbyId)
      .then(({ lobby: fetchedLobby }) => {
        if (!cancelled) setSnapshotLobby(fetchedLobby);
      })
      .catch(() => {
        if (!cancelled) setSnapshotLobby(null);
      });

    return () => {
      cancelled = true;
    };
  }, [lobbyId]);

  const headerLobby = lobby ?? snapshotLobby;
  const isHost = user && headerLobby && headerLobby.hostUserId === user.id;
  const mySeat = headerLobby?.seats.find((s) => s.userId === user?.id);
  const tableFull = headerLobby && !mySeat && headerLobby.seats.every((s) => s.userId);
  const buyIn = headerLobby ? getTableBuyIn(headerLobby.settings) : 0;

  function copyInvite() {
    if (!headerLobby) return;
    const url = `${window.location.origin}/join/${headerLobby.inviteCode}`;
    navigator.clipboard.writeText(url);
  }

  return (
    <div className="table-layout">
      <header className="table-header">
        <div>
          <h1>{headerLobby ? `${headerLobby.hostDisplayName}'s Table` : 'Table ...'}</h1>
          {headerLobby && <p className="invite-code">Code: {headerLobby.inviteCode}</p>}
          <span className={`status ${connected ? 'on' : reconnecting ? 'reconnecting' : 'off'}`}>
            {connected ? 'Connected' : reconnecting ? 'Reconnecting...' : 'Connecting...'}
          </span>
          {headerLobby && <p className="table-meta">Buy-in: {buyIn.toLocaleString()} chips per player</p>}
        </div>
        <div className="header-actions">
          {headerLobby && (
            <button type="button" className="btn small" onClick={copyInvite}>
              Copy invite link
            </button>
          )}
          <button type="button" className="btn small" onClick={() => setChatOpen((o) => !o)}>
            Chat
          </button>
          <button type="button" className="btn small" onClick={() => setHistoryOpen((o) => !o)}>
            History
          </button>
        </div>
      </header>

      {reconnecting && !connected && (
        <div className="banner warning">Connection lost — reconnecting to your session...</div>
      )}
      {error && <div className="banner error">{error}</div>}

      <main className="table-main">
        <PokerTable lobby={headerLobby} table={table} privateHoleCards={privateState?.holeCards} myUserId={user?.id} />

        {mySeat && (
          <div className="my-stack panel">
            <ChipStackLabel amount={mySeat.stack} buyIn={buyIn} />
          </div>
        )}

        {mySeat && table && privateState && (
          <ActionBar
            legalActions={privateState.legalActions}
            onAction={(action, amount) => {
              send({
                type: 'game_action',
                actionId: crypto.randomUUID(),
                action,
                amount,
              });
            }}
          />
        )}

        {!mySeat && headerLobby && token && connected && (
          <div className="sit-panel panel">
            {tableFull ? (
              <p>Table is full. Wait for a seat to open.</p>
            ) : (
              <p>Joining table... you will be seated automatically with {buyIn.toLocaleString()} chips.</p>
            )}
          </div>
        )}

        {isHost && headerLobby && (
          <HostControls
            lobby={headerLobby}
            onStart={() => send({ type: 'host_start' })}
            onPause={(paused) => send({ type: 'host_pause', paused })}
            onKick={(seatIndex) => send({ type: 'host_kick', seatIndex })}
            onSetBuyIn={(amount) => send({ type: 'host_set_buy_in', buyIn: amount })}
          />
        )}
      </main>

      {chatOpen && (
        <ChatPanel
          messages={chat}
          onSend={(text) => send({ type: 'chat', text })}
          onClose={() => setChatOpen(false)}
        />
      )}

      {historyOpen && lobbyId && <HandHistoryPanel lobbyId={lobbyId} onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}

function ChipStackLabel({ amount, buyIn }: { amount: number; buyIn: number }) {
  return (
    <p className="my-stack-label">
      Your stack: <strong>{amount.toLocaleString()}</strong> chips
      {amount === buyIn && <span className="buy-in-tag"> (table buy-in)</span>}
    </p>
  );
}
