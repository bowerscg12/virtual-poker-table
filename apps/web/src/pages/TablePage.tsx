import { useParams } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useGameSocket } from '../hooks/useGameSocket';
import { PokerTable } from '../components/PokerTable';
import { ActionBar } from '../components/ActionBar';
import { ChatPanel } from '../components/ChatPanel';
import { HostControls } from '../components/HostControls';
import { VoicePanel } from '../components/VoicePanel';
import { HandHistoryPanel } from '../components/HandHistoryPanel';

export default function TablePage() {
  const { lobbyId } = useParams<{ lobbyId: string }>();
  const { user, token } = useAuth();
  const [chatOpen, setChatOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { connected, lobby, table, privateState, chat, error, voiceToken, send } = useGameSocket(
    token,
    lobbyId ?? null
  );

  const isHost = user && lobby && lobby.hostUserId === user.id;
  const mySeat = lobby?.seats.find((s) => s.userId === user?.id);

  function copyInvite() {
    if (!lobby) return;
    const url = `${window.location.origin}/join/${lobby.inviteCode}`;
    navigator.clipboard.writeText(url);
  }

  return (
    <div className="table-layout">
      <header className="table-header">
        <div>
          <h1>Table {lobby?.inviteCode ?? '…'}</h1>
          <span className={`status ${connected ? 'on' : 'off'}`}>{connected ? 'Connected' : 'Connecting…'}</span>
        </div>
        <div className="header-actions">
          {lobby && (
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

      {error && <div className="banner error">{error}</div>}

      <main className="table-main">
        <PokerTable lobby={lobby} table={table} privateHoleCards={privateState?.holeCards} myUserId={user?.id} />

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

        {!mySeat && lobby && token && (
          <div className="sit-panel card">
            <h3>Take a seat</h3>
            <div className="seat-grid">
              {lobby.seats.map((seat) => (
                <button
                  key={seat.seatIndex}
                  type="button"
                  disabled={!!seat.userId}
                  className="btn seat-btn"
                  onClick={() =>
                    send({
                      type: 'sit',
                      seatIndex: seat.seatIndex,
                      buyIn: lobby.settings.minBuyIn,
                    })
                  }
                >
                  Seat {seat.seatIndex + 1}
                  {seat.userId ? ` (${seat.displayName})` : ''}
                </button>
              ))}
            </div>
          </div>
        )}

        {isHost && lobby && (
          <HostControls
            lobby={lobby}
            onStart={() => send({ type: 'host_start' })}
            onPause={(paused) => send({ type: 'host_pause', paused })}
            onKick={(seatIndex) => send({ type: 'host_kick', seatIndex })}
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

      {historyOpen && lobbyId && (
        <HandHistoryPanel lobbyId={lobbyId} onClose={() => setHistoryOpen(false)} />
      )}

      <VoicePanel voiceToken={voiceToken} displayName={user?.displayName ?? 'Player'} />
    </div>
  );
}
