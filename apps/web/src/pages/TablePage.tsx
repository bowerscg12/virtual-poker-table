import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getTableBuyIn, type LobbySummary } from '@vct/shared-types';
import { useAuth } from '../context/AuthContext';
import { getLobbyById } from '../api/client';
import { useGameSocket } from '../hooks/useGameSocket';
import { PokerTable } from '../components/PokerTable';
import { ActionBar } from '../components/ActionBar';
import { ChatPanel } from '../components/ChatPanel';
import { HostControls } from '../components/HostControls';
import { HandHistoryPanel } from '../components/HandHistoryPanel';
import { CashOutModal } from '../components/CashOutModal';
import { SessionResultsModal } from '../components/SessionResultsModal';

export default function TablePage() {
  const { lobbyId } = useParams<{ lobbyId: string }>();
  const navigate = useNavigate();
  const { user, token, loginGuest } = useAuth();
  const [chatOpen, setChatOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapshotLobby, setSnapshotLobby] = useState<LobbySummary | null>(null);
  const [cashOutOpen, setCashOutOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [nameChangeError, setNameChangeError] = useState<string | null>(null);

  const {
    connected,
    reconnecting,
    lobby,
    table,
    privateState,
    chat,
    error,
    nameTaken,
    cashOutQueued,
    cashOutSummary,
    clearCashOutSummary,
    send,
  } = useGameSocket(token, lobbyId ?? null);

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

  // Auto-open the confirmation modal when a queued cash out is acknowledged
  useEffect(() => {
    if (cashOutQueued) setCashOutOpen(true);
  }, [cashOutQueued]);

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

  function handleCashOutConfirm() {
    send({ type: 'cash_out' });
    // If the server responds with cash_out_queued, the modal stays open in queued mode.
    // If the server responds with cashed_out, cashOutSummary will be set and we hide this modal.
  }

  function handleCancelQueue() {
    send({ type: 'cash_out_cancel' });
    setCashOutOpen(false);
  }

  function handleLeaveTable() {
    clearCashOutSummary();
    navigate('/');
  }

  async function handleNameChange(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    setNameChangeError(null);
    try {
      await loginGuest(trimmed);
      setNewName('');
    } catch {
      setNameChangeError('Could not update name. Please try again.');
    }
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
            <button
              type="button"
              className="btn small cash-out-btn"
              onClick={() => setCashOutOpen(true)}
            >
              {cashOutQueued ? 'Cash Out Pending...' : 'Cash Out'}
            </button>
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
            {nameTaken ? (
              <>
                <p className="form-error" role="alert">
                  The name &ldquo;{user?.displayName}&rdquo; is already in use at this table.
                  Please choose a different name.
                </p>
                <form onSubmit={handleNameChange} className="name-change-form">
                  <input
                    placeholder="New display name"
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.target.value.slice(0, 10));
                      if (nameChangeError) setNameChangeError(null);
                    }}
                    maxLength={10}
                    autoFocus
                  />
                  {nameChangeError && <p className="form-error" role="alert">{nameChangeError}</p>}
                  <div className="name-change-actions">
                    <button type="submit" className="btn primary" disabled={!newName.trim()}>
                      Try Again
                    </button>
                    <button type="button" className="btn" onClick={() => navigate('/')}>
                      Leave Table
                    </button>
                  </div>
                </form>
              </>
            ) : tableFull ? (
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
            onSetActionTimer={(seconds) => send({ type: 'host_set_action_timer', seconds })}
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

      {cashOutOpen && !cashOutSummary && mySeat && (
        <CashOutModal
          currentStack={mySeat.stack}
          queued={cashOutQueued}
          onConfirm={handleCashOutConfirm}
          onCancel={() => setCashOutOpen(false)}
          onCancelQueue={handleCancelQueue}
        />
      )}

      {cashOutSummary && (
        <SessionResultsModal summary={cashOutSummary} onLeave={handleLeaveTable} />
      )}
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
