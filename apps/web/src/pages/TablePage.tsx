import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getTableBuyIn, type LobbySummary } from '@vct/shared-types';
import { formatChips } from '../utils/formatChips';
import { useAuth } from '../context/AuthContext';
import { getLobbyById } from '../api/client';
import { useGameSocket } from '../hooks/useGameSocket';
import { useTableAnimations } from '../hooks/useTableAnimations';
import { PokerTable } from '../components/PokerTable';
import { TwelveCardFlip } from '../components/TwelveCardFlip';
import { TableHeader } from '../components/TableHeader';
import { HeroActionPanel } from '../components/HeroActionPanel';
import { ChatPanel } from '../components/ChatPanel';
import { HostControls } from '../components/HostControls';
import { HandHistoryPanel } from '../components/HandHistoryPanel';
import { CashOutModal } from '../components/CashOutModal';
import { RebuyModal } from '../components/RebuyModal';
import { ShowCardsModal } from '../components/ShowCardsModal';
import { BombPotPrompt } from '../components/BombPotPrompt';
import { SessionResultsModal } from '../components/SessionResultsModal';
import { ShowdownResultsModal } from '../components/ShowdownResultsModal';

export default function TablePage() {
  const { lobbyId } = useParams<{ lobbyId: string }>();
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const [chatOpen, setChatOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [unreadChat, setUnreadChat] = useState(0);
  const prevChatLengthRef = useRef(0);
  const [snapshotLobby, setSnapshotLobby] = useState<LobbySummary | null>(null);
  const [cashOutOpen, setCashOutOpen] = useState(false);
  const [rebuyClicked, setRebuyClicked] = useState(false);
  const [rebuyDismissed, setRebuyDismissed] = useState(false);
  const [dismissedShowdownHandNum, setDismissedShowdownHandNum] = useState<number | null>(null);

  const {
    connected,
    reconnecting,
    lobby,
    table,
    privateState,
    chat,
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
    clearCashOutSummary,
    send,
  } = useGameSocket(token, lobbyId ?? null);

  const [bombPotChoice, setBombPotChoice] = useState<boolean | null>(null);
  useEffect(() => {
    setBombPotChoice(null);
  }, [bombPotPrompt?.deadline]);

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
    return () => { cancelled = true; };
  }, [lobbyId]);

  // Track unread messages while chat panel is closed
  useEffect(() => {
    const incoming = chat.length - prevChatLengthRef.current;
    if (incoming > 0 && !chatOpen) setUnreadChat((n) => n + incoming);
    prevChatLengthRef.current = chat.length;
  }, [chat, chatOpen]);

  useEffect(() => {
    if (chatOpen) setUnreadChat(0);
  }, [chatOpen]);

  // Close the manual modal when queued or when the confirm prompt arrives
  useEffect(() => {
    if (cashOutQueued || cashOutConfirmPending) setCashOutOpen(false);
  }, [cashOutQueued, cashOutConfirmPending]);

  useEffect(() => {
    if (!rebuyAvailable && !rebuyQueued) setRebuyClicked(false);
  }, [rebuyAvailable, rebuyQueued]);

  useEffect(() => {
    if (rebuyAvailable) setRebuyDismissed(false);
  }, [rebuyAvailable]);

  // Escape → open/focus chat
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (document.querySelector('.modal-overlay, [role="dialog"]')) return;
        e.preventDefault();
        if (!chatOpen) {
          setChatOpen(true);
          setTimeout(() => {
            (document.getElementById('chat-input') as HTMLInputElement | null)?.focus();
          }, 50);
        } else {
          (document.getElementById('chat-input') as HTMLInputElement | null)?.focus();
        }
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [chatOpen]);

  const headerLobby = lobby ?? snapshotLobby;
  const isHost = !!(user && headerLobby && headerLobby.hostUserId === user.id);
  const mySeat = headerLobby?.seats.find((s) => s.userId === user?.id);
  const mySeatIndex = mySeat?.seatIndex ?? 0;
  const tableFull = headerLobby && !mySeat && headerLobby.seats.every((s) => s.userId);
  const buyIn = headerLobby ? getTableBuyIn(headerLobby.settings) : 0;
  const gameStarted = headerLobby?.status === 'playing' || headerLobby?.status === 'paused';

  const totalPot = table
    ? table.pots.reduce((s, p) => s + p.amount, 0) + table.seats.reduce((s, seat) => s + seat.betThisStreet, 0)
    : 0;

  const maxSeats = headerLobby?.settings.maxPlayers ?? 8;
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
    navigator.clipboard.writeText(`${window.location.origin}/join/${headerLobby.inviteCode}`);
  }

  function handleCashOutConfirm() { send({ type: 'cash_out' }); }
  function handleCancelQueue() { send({ type: 'cash_out_cancel' }); setCashOutOpen(false); }
  function handleLeaveTable() { clearCashOutSummary(); navigate('/'); }

  const isTcf = headerLobby?.settings.game === 'twelve_card_flip';
  const handActive = !!(table && table.street !== 'complete' && table.street !== 'waiting');
  const showHeroPanel = !!(mySeat && !isTcf);

  return (
    <div className={`table-layout${isTcf ? ' table-layout--tcf' : ''}${showHeroPanel ? ' table-layout--hero' : ''}`}>
      <div className="rotate-overlay">
        <span style={{ fontSize: '3rem' }}>⟳</span>
        <p>Rotate your device to play</p>
      </div>
      <TableHeader
        lobby={headerLobby}
        isHost={isHost}
        connected={connected}
        reconnecting={reconnecting}
        unreadChat={unreadChat}
        chatOpen={chatOpen}
        onCopyInvite={copyInvite}
        onChatToggle={() => setChatOpen((o) => !o)}
        onHistoryToggle={() => setHistoryOpen((o) => !o)}
      />

      {reconnecting && !connected && (
        <div className="banner warning">Connection lost — reconnecting to your session...</div>
      )}
      {error && <div className="banner error">{error}</div>}
      {table?.waitingForPlayers && !cashOutSummary && !error && (
        <div className="banner info">
          Waiting for more active players — need at least 2 to start the next hand
        </div>
      )}
      {table?.bombPot && (
        <div className="banner bomb-pot-banner">
          💣 {table.bombPot.doubleBoard ? 'Double Board Bomb Pot' : 'Bomb Pot'} ({formatChips(table.bombPot.amount)})
        </div>
      )}
      {!table?.bombPot && headerLobby?.settings.nextHandBombPot && (
        <div className="banner bomb-pot-banner">
          Next Hand: {headerLobby.settings.nextHandBombPot.doubleBoard ? 'Double Board Bomb Pot' : 'Bomb Pot'} (
          {formatChips(headerLobby.settings.nextHandBombPot.amount)})
        </div>
      )}
      {bombPotNotice && (
        <div className="banner warning" role="alert" onClick={clearBombPotNotice}>
          {bombPotNotice}
        </div>
      )}

      <main className="table-main">
        {showHeroPanel && (
          <HeroActionPanel
            holeCards={holeCards}
            isDealingThisHand={isDealingThisHand}
            dealDelayClasses={[holeDealDelayClass(0), holeDealDelayClass(1)]}
            legalActions={privateState?.legalActions ?? []}
            pot={totalPot}
            currentBet={table?.currentBet ?? 0}
            limit={headerLobby?.settings.limit}
            onAction={(action, amount) =>
              send({ type: 'game_action', actionId: crypto.randomUUID(), action, amount })
            }
            seat={mySeat}
            gameStarted={gameStarted}
            cashOutQueued={cashOutQueued}
            rebuyAvailable={!!rebuyAvailable}
            rebuyQueued={rebuyQueued}
            rebuyClicked={rebuyClicked}
            rebuyDismissed={rebuyDismissed}
            onCashOutOpen={() => setCashOutOpen(true)}
            onCancelQueue={handleCancelQueue}
            onRebuyClick={() => { setRebuyClicked(true); send({ type: 'rebuy' }); }}
            onLeaveTable={() => send({ type: 'cash_out' })}
            onSitOutToggle={(enabled) => send({ type: 'sit_out_next_hand', enabled })}
          />
        )}
        <div className="table-felt-wrapper">
          {isTcf ? (
            <TwelveCardFlip
              lobby={headerLobby!}
              table={table}
              myUserId={user?.id}
              privateHoleCards={holeCards}
              legalActions={privateState?.legalActions ?? []}
              onAction={(action) => send({ type: 'game_action', actionId: crypto.randomUUID(), action })}
              anim={anim}
              isHost={isHost}
              onDealAgain={() => send({ type: 'host_start' })}
            />
          ) : (
            <PokerTable
              lobby={headerLobby}
              table={table}
              myUserId={user?.id}
              anim={anim}
              messages={chat}
              isHost={isHost}
              handActive={handActive}
              onMoveSeat={(from, to) => send({ type: 'host_move_player', fromSeatIndex: from, toSeatIndex: to })}
            />
          )}

          {!mySeat && headerLobby && token && connected && !isTcf && (
            <div className="sit-panel panel">
              {tableFull ? (
                <p>Table is full. Wait for a seat to open.</p>
              ) : (
                <p>Joining table... you will be seated automatically with {formatChips(buyIn)} chips.</p>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Host settings — full controls panel, scrollable, host only */}
      {isHost && headerLobby && (
        <section className="host-section">
          <HostControls
            lobby={headerLobby}
            handActive={handActive}
            intermissionDeadline={table?.intermissionDeadline}
            onStart={() => send({ type: 'host_start' })}
            onPause={(paused) => send({ type: 'host_pause', paused })}
            onKick={(seatIndex) => send({ type: 'host_kick', seatIndex })}
            onTransferHost={(seatIndex) => send({ type: 'host_transfer', seatIndex })}
            onSetBuyIn={(amount) => send({ type: 'host_set_buy_in', buyIn: amount })}
            onSetActionTimer={(seconds) => send({ type: 'host_set_action_timer', seconds })}
            onSetFlipAnte={(ante) => send({ type: 'host_set_flip_ante', ante })}
            onSetBombPot={(value) => send({ type: 'host_set_bomb_pot', ...value })}
          />
        </section>
      )}

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

      {(cashOutOpen || cashOutConfirmPending) && !cashOutSummary && mySeat && (
        <CashOutModal
          currentStack={mySeat.stack}
          confirmPending={cashOutConfirmPending}
          onConfirm={handleCashOutConfirm}
          onCancel={() => setCashOutOpen(false)}
          onConfirmCashOut={() => send({ type: 'cash_out_confirm' })}
          onCancelCashOut={() => send({ type: 'cash_out_cancel' })}
        />
      )}

      {showCardsPrompt && !cashOutSummary && (
        <ShowCardsModal
          deadline={showCardsPrompt.deadline}
          onShow={() => send({ type: 'show_cards', show: true })}
          onMuck={() => send({ type: 'show_cards', show: false })}
        />
      )}

      {bombPotPrompt && mySeat && !cashOutSummary && (
        <BombPotPrompt
          deadline={bombPotPrompt.deadline}
          amount={bombPotPrompt.amount}
          doubleBoard={bombPotPrompt.doubleBoard}
          choice={bombPotChoice}
          onJoin={() => { setBombPotChoice(true); send({ type: 'bomb_pot_join', join: true }); }}
          onSitOut={() => { setBombPotChoice(false); send({ type: 'bomb_pot_join', join: false }); }}
        />
      )}

      {rebuyAvailable && !rebuyClicked && !rebuyDismissed && !cashOutSummary && (
        <RebuyModal
          amount={rebuyAvailable.amount}
          onRebuy={() => { setRebuyClicked(true); send({ type: 'rebuy' }); }}
          onSitOut={() => setRebuyDismissed(true)}
          onLeave={() => send({ type: 'cash_out' })}
          onDismiss={() => setRebuyDismissed(true)}
        />
      )}

      {table?.showdownResult && table.handNumber !== dismissedShowdownHandNum && !cashOutSummary && (
        <ShowdownResultsModal
          result={table.showdownResult}
          onClose={() => setDismissedShowdownHandNum(table.handNumber)}
        />
      )}

      {cashOutSummary && (
        <SessionResultsModal summary={cashOutSummary} onLeave={handleLeaveTable} />
      )}
    </div>
  );
}
