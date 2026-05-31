import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { getTableBuyIn, type LobbySummary } from '@vct/shared-types';
import { formatChips } from '../utils/formatChips';
import { useAuth } from '../context/AuthContext';
import { getLobbyById } from '../api/client';
import { useGameSocket } from '../hooks/useGameSocket';
import { useTableAnimations } from '../hooks/useTableAnimations';
import { PokerTable } from '../components/PokerTable';
import { ActionBar } from '../components/ActionBar';
import { CardView } from '../components/CardView';
import { ChatPanel } from '../components/ChatPanel';
import { HostControls } from '../components/HostControls';
import { HandHistoryPanel } from '../components/HandHistoryPanel';
import { CashOutModal } from '../components/CashOutModal';
import { RebuyModal } from '../components/RebuyModal';
import { ShowCardsModal } from '../components/ShowCardsModal';
import { SessionResultsModal } from '../components/SessionResultsModal';

export default function TablePage() {
  const { lobbyId } = useParams<{ lobbyId: string }>();
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const [chatOpen, setChatOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapshotLobby, setSnapshotLobby] = useState<LobbySummary | null>(null);
  const [cashOutOpen, setCashOutOpen] = useState(false);
  const [rebuyClicked, setRebuyClicked] = useState(false);

  const {
    connected,
    reconnecting,
    lobby,
    table,
    privateState,
    chat,
    error,
    cashOutQueued,
    cashOutSummary,
    handComplete,
    rebuyAvailable,
    rebuyQueued,
    showCardsPrompt,
    clearCashOutSummary,
    send,
  } = useGameSocket(token, lobbyId ?? null);

  const anim = useTableAnimations(table, handComplete ?? null);

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

  // Reset the clicked flag whenever the rebuy state resets (new bust or confirmed)
  useEffect(() => {
    if (!rebuyAvailable && !rebuyQueued) setRebuyClicked(false);
  }, [rebuyAvailable, rebuyQueued]);

  const headerLobby = lobby ?? snapshotLobby;
  const isHost = user && headerLobby && headerLobby.hostUserId === user.id;
  const mySeat = headerLobby?.seats.find((s) => s.userId === user?.id);
  const mySeatIndex = mySeat?.seatIndex ?? 0;
  const tableFull = headerLobby && !mySeat && headerLobby.seats.every((s) => s.userId);
  const buyIn = headerLobby ? getTableBuyIn(headerLobby.settings) : 0;
  const gameStarted = headerLobby?.status === 'playing' || headerLobby?.status === 'paused';

  // Deal animation helpers for the local player's hole cards
  const totalPot = table
    ? table.pots.reduce((s, p) => s + p.amount, 0) + table.seats.reduce((s, seat) => s + seat.betThisStreet, 0)
    : 0;

  const maxSeats = headerLobby?.settings.maxPlayers ?? 9;
  const dealerSeatIndex = table?.dealerSeatIndex ?? 0;
  const isDealingThisHand = anim.dealingHandNum === table?.handNumber;
  function holeDealDelayClass(cardRound: 0 | 1): string {
    const dealOrder = (mySeatIndex - dealerSeatIndex - 1 + maxSeats) % maxSeats;
    const idx = dealOrder + cardRound * maxSeats;
    return `deal-delay-${idx}`;
  }

  const holeCards = privateState?.holeCards ?? [];

  function copyInvite() {
    if (!headerLobby) return;
    const url = `${window.location.origin}/join/${headerLobby.inviteCode}`;
    navigator.clipboard.writeText(url);
  }

  function handleCashOutConfirm() {
    send({ type: 'cash_out' });
  }

  function handleCancelQueue() {
    send({ type: 'cash_out_cancel' });
    setCashOutOpen(false);
  }

  function handleLeaveTable() {
    clearCashOutSummary();
    navigate('/');
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
          {headerLobby && <p className="table-meta">Buy-in: {formatChips(buyIn)} chips per player</p>}
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
        <PokerTable
          lobby={headerLobby}
          table={table}
          myUserId={user?.id}
          anim={anim}
        />

        {!mySeat && headerLobby && token && connected && (
          <div className="sit-panel panel">
            {tableFull ? (
              <p>Table is full. Wait for a seat to open.</p>
            ) : (
              <p>Joining table... you will be seated automatically with {formatChips(buyIn)} chips.</p>
            )}
          </div>
        )}
      </main>

      {/* Host settings — scrollable section below gameplay, host only */}
      {isHost && headerLobby && (
        <section className="host-section">
          <HostControls
            lobby={headerLobby}
            onStart={() => send({ type: 'host_start' })}
            onPause={(paused) => send({ type: 'host_pause', paused })}
            onKick={(seatIndex) => send({ type: 'host_kick', seatIndex })}
            onSetBuyIn={(amount) => send({ type: 'host_set_buy_in', buyIn: amount })}
            onSetActionTimer={(seconds) => send({ type: 'host_set_action_timer', seconds })}
          />
        </section>
      )}

      {/* Compact player tray — portalled to document.body so no ancestor transform/filter
          can break position:fixed. Cards always anchor to the bottom via column-reverse. */}
      {mySeat && createPortal(
        <div className="player-tray">
          {/* 1st in DOM = renders at bottom */}
          <div className="player-tray__cards-row">
            <div className="player-tray__cards">
              {holeCards.map((card, index) => {
                const dealClass = isDealingThisHand
                  ? `dealing ${holeDealDelayClass(index as 0 | 1)}`
                  : '';
                return (
                  <div
                    key={index}
                    className={['card-anim-wrapper', dealClass].filter(Boolean).join(' ')}
                  >
                    <CardView card={card} faceUp />
                  </div>
                );
              })}
            </div>
            <div className="player-tray__meta">
              <span className="player-tray__stack">{formatChips(mySeat.stack)}</span>
              {rebuyQueued || rebuyClicked ? (
                <span className="rebuy-pending-badge">Rebuy pending...</span>
              ) : (
                <button
                  type="button"
                  className="btn small cash-out-btn"
                  onClick={() => setCashOutOpen(true)}
                >
                  {cashOutQueued ? 'Queued' : 'Cash Out'}
                </button>
              )}
            </div>
          </div>

          {/* 2nd in DOM = renders above cards */}
          {table && privateState && privateState.legalActions.length > 0 && (
            <ActionBar
              legalActions={privateState.legalActions}
              pot={totalPot}
              currentBet={table.currentBet}
              onAction={(action, amount) => {
                send({ type: 'game_action', actionId: crypto.randomUUID(), action, amount });
              }}
            />
          )}

          {/* 3rd in DOM = renders at top */}
          {isHost && headerLobby && (
            <div className="player-tray__host">
              {!gameStarted && (
                <button type="button" className="btn small primary" onClick={() => send({ type: 'host_start' })}>
                  Start
                </button>
              )}
              {gameStarted && headerLobby.status === 'paused' && (
                <button type="button" className="btn small primary" onClick={() => send({ type: 'host_pause', paused: false })}>
                  Resume
                </button>
              )}
              {gameStarted && headerLobby.status === 'playing' && (
                <button type="button" className="btn small" onClick={() => send({ type: 'host_pause', paused: true })}>
                  Pause
                </button>
              )}
            </div>
          )}
        </div>,
        document.body
      )}

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

      {showCardsPrompt && !cashOutSummary && (
        <ShowCardsModal
          deadline={showCardsPrompt.deadline}
          onShow={() => send({ type: 'show_cards', show: true })}
          onMuck={() => send({ type: 'show_cards', show: false })}
        />
      )}

      {rebuyAvailable && !rebuyClicked && !cashOutSummary && (
        <RebuyModal
          amount={rebuyAvailable.amount}
          onRebuy={() => {
            setRebuyClicked(true);
            send({ type: 'rebuy' });
          }}
          onLeave={() => send({ type: 'cash_out' })}
        />
      )}

      {cashOutSummary && (
        <SessionResultsModal summary={cashOutSummary} onLeave={handleLeaveTable} />
      )}
    </div>
  );
}
