import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getTableBuyIn, type LobbySummary } from '@vct/shared-types';
import { formatChips } from '../utils/formatChips';
import { useAuth } from '../context/AuthContext';
import { getLobbyById } from '../api/client';
import { useGameSocket } from '../hooks/useGameSocket';
import { useTableAnimations } from '../hooks/useTableAnimations';
import { useSoundEffects } from '../hooks/useSoundEffects';
import { useSettings } from '../hooks/useSettings';
import { PokerTable } from '../components/PokerTable';
import { TwelveCardFlip } from '../components/TwelveCardFlip';
import { BlackjackTable } from '../components/BlackjackTable';
import { TableHeader } from '../components/TableHeader';
import { HeroActionPanel } from '../components/HeroActionPanel';
import { ChatPanel, type WhisperTarget } from '../components/ChatPanel';
import { ReactionOverlay } from '../components/ReactionOverlay';
import { playSound } from '../utils/soundEngine';
import { HostControls } from '../components/HostControls';
import { HandHistoryPanel } from '../components/HandHistoryPanel';
import { CashOutModal } from '../components/CashOutModal';
import { RebuyModal } from '../components/RebuyModal';
import { DonateModal } from '../components/DonateModal';
import { SideBetModal } from '../components/SideBetModal';
import { SideBetChallengePrompt } from '../components/SideBetChallengePrompt';
import { SideBetResultModal } from '../components/SideBetResultModal';
import { ShowCardsModal } from '../components/ShowCardsModal';
import { BombPotPrompt } from '../components/BombPotPrompt';
import { AddBotPrompt } from '../components/AddBotPrompt';
import { PineapplePrompt } from '../components/PineapplePrompt';
import { RunItOutPrompt } from '../components/RunItOutPrompt';
import { SessionResultsModal } from '../components/SessionResultsModal';
import { ShowdownResultsModal } from '../components/ShowdownResultsModal';
import { CardView } from '../components/CardView';
import { TournamentLeaderboard } from '../components/TournamentLeaderboard';
import { BlindScheduleDisplay } from '../components/BlindScheduleDisplay';
import { EliminationModal } from '../components/EliminationModal';
import { SeatChangeModal } from '../components/SeatChangeModal';

export default function TablePage() {
  const { lobbyId } = useParams<{ lobbyId: string }>();
  const [searchParams] = useSearchParams();
  const isSpectator = searchParams.get('spectate') === '1';
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadChat, setUnreadChat] = useState(0);
  const { settings, updateSetting } = useSettings();
  const prevChatLengthRef = useRef(0);
  const [snapshotLobby, setSnapshotLobby] = useState<LobbySummary | null>(null);
  const [cashOutOpen, setCashOutOpen] = useState(false);
  const [rebuyClicked, setRebuyClicked] = useState(false);
  const [rebuyDismissed, setRebuyDismissed] = useState(false);
  const [dismissedShowdownHandNum, setDismissedShowdownHandNum] = useState<number | null>(null);
  const [donateOpen, setDonateOpen] = useState(false);
  const [whisperTarget, setWhisperTarget] = useState<WhisperTarget | null>(null);
  const [donationNotice, setDonationNotice] = useState<string | null>(null);
  const [cardsRevealed, setCardsRevealed] = useState(false);
  const [sideBetTarget, setSideBetTarget] = useState<{ seatIndex: number; displayName: string } | null>(null);
  // Seat index for which the host is choosing a bot difficulty (null = modal closed).
  const [addBotSeat, setAddBotSeat] = useState<number | null>(null);

  const {
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
    clearIncomingSideBetChallenge,
    sideBetNotice,
    clearSideBetNotice,
    sideBetResult,
    clearSideBetResult,
    rabbitHuntAvailable,
    rabbitCards,
    tournamentState,
    seatChangeWarning,
    seatChanged,
    clearSeatChanged,
    eliminationResult,
    clearEliminationResult,
    tournamentFinalLeaderboard,
    clearTournamentFinalLeaderboard,
    tournamentCancelled,
    bjState,
    bjLegalActions,
    bjRoundResults,
    clearBjRoundResults,
    bjRecap,
    clearBjRecap,
    send,
  } = useGameSocket(token, lobbyId ?? null, isSpectator);

  const [bombPotChoice, setBombPotChoice] = useState<boolean | null>(null);
  useEffect(() => {
    setBombPotChoice(null);
  }, [bombPotPrompt?.deadline]);

  const [pineappleChoice, setPineappleChoice] = useState<boolean | null>(null);
  useEffect(() => {
    setPineappleChoice(null);
  }, [pineapplePrompt?.deadline]);

  const headerLobby = lobby ?? snapshotLobby;
  const mySeat = headerLobby?.seats.find((s) => s.userId === user?.id);
  const mySeatIndex = mySeat?.seatIndex ?? -1;

  const anim = useTableAnimations(table, handComplete ?? null);
  useSoundEffects(settings.soundEffects, table, anim, mySeatIndex, bjState, bjRoundResults, user?.id);

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

  // Track unread messages while chat panel is closed; chime on incoming whispers
  useEffect(() => {
    const incoming = chat.length - prevChatLengthRef.current;
    if (incoming > 0) {
      if (!chatOpen) setUnreadChat((n) => n + incoming);
      const newMessages = chat.slice(prevChatLengthRef.current);
      const gotWhisper = newMessages.some((m) => m.isWhisper && m.recipientUserId === user?.id);
      if (gotWhisper) playSound(settings.soundEffects, 'whisper');
      // Chime on system announcements (e.g. a player joining the table)
      const gotSystem = newMessages.some((m) => m.isSystem);
      if (gotSystem) playSound(settings.soundEffects, 'reaction');
    }
    prevChatLengthRef.current = chat.length;
  }, [chat, chatOpen, user?.id, settings.soundEffects]);

  // Soft pop for incoming reactions (everyone at the table hears their own and others')
  const prevReactionCountRef = useRef(0);
  useEffect(() => {
    if (reactions.length > prevReactionCountRef.current) {
      playSound(settings.soundEffects, 'reaction');
    }
    prevReactionCountRef.current = reactions.length;
  }, [reactions, settings.soundEffects]);

  // Drop the whisper target if that player leaves the table
  useEffect(() => {
    if (!whisperTarget || !headerLobby) return;
    if (!headerLobby.seats.some((s) => s.userId === whisperTarget.userId)) {
      setWhisperTarget(null);
    }
  }, [headerLobby, whisperTarget]);

  function handleWhisperRequest(userId: string, displayName: string) {
    setWhisperTarget({ userId, displayName });
    setChatOpen(true);
  }

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

  // Reset blind reveal state each new hand
  useEffect(() => {
    if (table?.street === 'preflop') setCardsRevealed(false);
  }, [table?.handNumber]);

  useEffect(() => {
    if (!donationReceived) return;
    const { donorDisplayName, amount } = donationReceived;
    setDonationNotice(`${donorDisplayName} donated ${formatChips(amount)} chips to you!`);
    const t = setTimeout(() => setDonationNotice(null), 5000);
    return () => clearTimeout(t);
  }, [donationReceived]);

  useEffect(() => {
    if (!donationConfirmed) return;
    const { recipientDisplayName, amount } = donationConfirmed;
    setDonationNotice(`Donated ${formatChips(amount)} chips to ${recipientDisplayName}.`);
    const t = setTimeout(() => setDonationNotice(null), 4000);
    return () => clearTimeout(t);
  }, [donationConfirmed]);

  // Reuse the donation toast slot for transient side-bet status notices.
  useEffect(() => {
    if (!sideBetNotice) return;
    setDonationNotice(sideBetNotice);
    const t = setTimeout(() => { setDonationNotice(null); clearSideBetNotice(); }, 4000);
    return () => clearTimeout(t);
  }, [sideBetNotice, clearSideBetNotice]);

  // Navigate to new table when tournament seat change executes
  useEffect(() => {
    if (!seatChanged) return;
    clearSeatChanged();
    navigate(`/table/${seatChanged.newLobbyId}`, { replace: true });
  }, [seatChanged, clearSeatChanged, navigate]);

  // Navigate away when the tournament is cancelled by the host
  useEffect(() => {
    if (tournamentCancelled) navigate('/tournaments');
  }, [tournamentCancelled, navigate]);

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

  const isHost = !!(user && headerLobby && headerLobby.hostUserId === user.id);
  const tableFull = headerLobby && !mySeat && headerLobby.seats.every((s) => s.userId);
  const buyIn = headerLobby ? getTableBuyIn(headerLobby.settings) : 0;
  const gameStarted = headerLobby?.status === 'playing' || headerLobby?.status === 'paused';

  const totalPot = table
    ? table.pots.reduce((s, p) => s + p.amount, 0)
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
  const myGameSeat = table?.seats.find((s) => s.userId === user?.id);
  const isBlindThisHand = myGameSeat?.isBlindThisHand ?? false;

  function copyInvite() {
    if (!headerLobby) return;
    navigator.clipboard.writeText(`${window.location.origin}/join/${headerLobby.inviteCode}`);
  }

  function copyWatchLink() {
    if (!headerLobby) return;
    navigator.clipboard.writeText(`${window.location.origin}/watch/${headerLobby.inviteCode}`);
  }

  function handleCashOutConfirm() { send({ type: 'cash_out' }); }
  function handleCancelQueue() { send({ type: 'cash_out_cancel' }); setCashOutOpen(false); }
  function handleLeaveTable() { clearCashOutSummary(); navigate('/'); }

  const isTcf = headerLobby?.settings.game === 'twelve_card_flip';
  const isBlackjack = headerLobby?.settings.game === 'blackjack';
  const handActive = !!(table && table.street !== 'complete' && table.street !== 'waiting');
  const showHeroPanel = !!(mySeat && !isTcf && !isBlackjack);

  return (
    <div className={`table-layout${isTcf ? ' table-layout--tcf' : ''}${isBlackjack ? ' table-layout--bj' : ''}${showHeroPanel ? ' table-layout--hero' : ''}`}>
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
        settings={settings}
        onCopyInvite={copyInvite}
        onCopyWatchLink={copyWatchLink}
        onChatToggle={() => setChatOpen((o) => !o)}
        onSettingChange={updateSetting}
        lastHandSeed={table?.lastHandSeed}
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
      {donationNotice && (
        <div className="banner info" role="status" onClick={() => setDonationNotice(null)}>
          {donationNotice}
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
            onDonateOpen={() => setDonateOpen(true)}
            isBlindThisHand={isBlindThisHand}
            cardsRevealed={cardsRevealed}
            onRevealCards={() => { setCardsRevealed(true); send({ type: 'reveal_blind_cards' }); }}
            onBlindHandToggle={(enabled) => send({ type: 'set_blind_hand', enabled })}
            showHandStrength={settings.showHandStrength}
            board={table?.board ?? []}
            variant={headerLobby?.settings.game ?? 'holdem'}
            isFolded={myGameSeat?.folded ?? false}
            pineappleDiscardActive={!!pineappleDiscardPhase && holeCards.length === 3}
            pineappleDiscardDeadline={pineappleDiscardPhase?.deadline}
            onPineappleDiscard={(cardIndex) => send({ type: 'pineapple_discard', cardIndex })}
            showPotOdds={settings.showPotOdds}
            timeBankEnabled={!!headerLobby?.settings.timeBankEnabled && (headerLobby?.settings.actionTimerSec ?? 0) > 0}
            timeBankUses={privateState?.timeBankUses ?? 0}
            onTimeBank={() => send({ type: 'time_bank' })}
          />
        )}
        <div className="table-felt-wrapper">
          {isBlackjack && headerLobby ? (
            <BlackjackTable
              lobby={headerLobby}
              bjState={bjState}
              legalActions={bjLegalActions}
              roundResults={bjRoundResults}
              recap={bjRecap}
              myUserId={user?.id ?? ''}
              isHost={isHost}
              messages={chat}
              onClearRoundResults={clearBjRoundResults}
              onClearRecap={clearBjRecap}
              onSend={send}
              onLeaveTable={() => { clearBjRecap(); navigate('/'); }}
            />
          ) : isTcf ? (
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
              onAddBot={isHost ? (seatIndex) => send({ type: 'host_add_bot', seatIndex, difficulty: 'intermediate' }) : undefined}
              onExit={() => send({ type: 'cash_out' })}
              soundEnabled={settings.soundEffects}
            />
          ) : (
            <PokerTable
              lobby={headerLobby}
              table={table}
              myUserId={user?.id}
              anim={anim}
              messages={chat}
              reactions={reactions}
              isHost={isHost}
              handActive={handActive}
              onMoveSeat={(from, to) => send({ type: 'host_move_player', fromSeatIndex: from, toSeatIndex: to })}
              onWhisper={handleWhisperRequest}
              onSideBetChallenge={mySeat ? (seatIndex, displayName) => setSideBetTarget({ seatIndex, displayName }) : undefined}
              onAddBot={isHost ? (seatIndex) => setAddBotSeat(seatIndex) : undefined}
              myBlindRevealed={cardsRevealed}
            />
          )}

          {/* Poker tables anchor reactions to seats inside PokerTable; other variants
              float them from the felt centre via this wrapper-level overlay. */}
          {(isTcf || isBlackjack) && <ReactionOverlay reactions={reactions} />}

          {!mySeat && headerLobby && token && connected && !isTcf && !isBlackjack && (
            <div className="sit-panel panel">
              {isSpectator ? (
                <p>👁 Spectating — you're watching this table.</p>
              ) : tableFull ? (
                <p>Table is full. Wait for a seat to open.</p>
              ) : (
                <p>Joining table... you will be seated automatically with {formatChips(buyIn)} chips.</p>
              )}
            </div>
          )}

          {rabbitHuntAvailable && !isTcf && !isBlackjack && (
            <div className="rabbit-hunt-widget">
              {rabbitCards ? (
                <div className="rabbit-hunt-result">
                  <span className="rabbit-hunt-label">Rabbit:</span>
                  {rabbitCards.map((c, i) => (
                    <CardView key={i} card={c} faceUp />
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  className="btn small rabbit-hunt-btn"
                  onClick={() => send({ type: 'rabbit_hunt' })}
                >
                  Rabbit Hunt
                </button>
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
            onSetTimeBank={(enabled) => send({ type: 'host_set_time_bank', enabled })}
            onSetFlipAnte={(ante) => send({ type: 'host_set_flip_ante', ante })}
            onSetBombPot={(value) => send({ type: 'host_set_bomb_pot', ...value })}
            onSetRunItOut={(times) => send({ type: 'host_set_run_it_out', times })}
            onSetPineapple={(enabled) => send({ type: 'host_set_pineapple', enabled })}
            onSetBigBlindAnte={(amount) => send({ type: 'host_set_big_blind_ante', amount })}
            onSetSmallBlindAnte={(amount) => send({ type: 'host_set_small_blind_ante', amount })}
          />
        </section>
      )}

      {chatOpen && (
        <ChatPanel
          messages={chat}
          myUserId={user?.id}
          whisperTarget={whisperTarget}
          onSend={(text) => send({ type: 'chat', text })}
          onWhisper={(recipientUserId, text) => send({ type: 'whisper', recipientUserId, text })}
          onWhisperTargetChange={setWhisperTarget}
          onReact={(emoji) => send({ type: 'reaction', emoji })}
          onClose={() => { setChatOpen(false); setWhisperTarget(null); }}
        />
      )}

      {settings.showHandHistory && lobbyId && (
        <HandHistoryPanel lobbyId={lobbyId} onClose={() => updateSetting('showHandHistory', false)} />
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

      {pineapplePrompt && mySeat && !cashOutSummary && (
        <PineapplePrompt
          deadline={pineapplePrompt.deadline}
          choice={pineappleChoice}
          onJoin={() => { setPineappleChoice(true); send({ type: 'pineapple_join', join: true }); }}
          onSitOut={() => { setPineappleChoice(false); send({ type: 'pineapple_join', join: false }); }}
        />
      )}

      {runItOutPrompt && !cashOutSummary && (() => {
        const chooserSeat = table?.seats.find((s) => s.seatIndex === runItOutPrompt.chooserSeatIndex);
        const isChooser = mySeat?.seatIndex === runItOutPrompt.chooserSeatIndex;
        return (
          <RunItOutPrompt
            deadline={runItOutPrompt.deadline}
            maxRuns={runItOutPrompt.maxRuns}
            isChooser={isChooser}
            chooserName={chooserSeat?.displayName ?? 'A player'}
            onChoice={(times) => {
              if (isChooser) send({ type: 'run_it_out_choice', times });
            }}
          />
        );
      })()}

      {rebuyAvailable && !rebuyClicked && !rebuyDismissed && !cashOutSummary && (
        <RebuyModal
          amount={rebuyAvailable.amount}
          onRebuy={() => { setRebuyClicked(true); send({ type: 'rebuy' }); }}
          onSitOut={() => setRebuyDismissed(true)}
          onLeave={() => send({ type: 'cash_out' })}
          onDismiss={() => setRebuyDismissed(true)}
        />
      )}

      {donateOpen && mySeat && headerLobby && (
        <DonateModal
          myStack={mySeat.stack}
          recipients={headerLobby.seats.filter((s) => s.userId && s.userId !== user?.id).map((s) => ({
            seatIndex: s.seatIndex,
            displayName: s.displayName,
            stack: s.stack,
          }))}
          onDonate={(recipientSeatIndex, amount) =>
            send({ type: 'donate_chips', recipientSeatIndex, amount, donationId: crypto.randomUUID() })
          }
          onClose={() => setDonateOpen(false)}
        />
      )}

      {addBotSeat !== null && (
        <AddBotPrompt
          seatIndex={addBotSeat}
          onSelect={(difficulty) => {
            send({ type: 'host_add_bot', seatIndex: addBotSeat, difficulty });
            setAddBotSeat(null);
          }}
          onCancel={() => setAddBotSeat(null)}
        />
      )}

      {sideBetTarget && mySeat && (
        <SideBetModal
          targetName={sideBetTarget.displayName}
          myStack={mySeat.stack}
          onCreate={(betType, suit, wager) =>
            send({ type: 'side_bet_create', targetSeatIndex: sideBetTarget.seatIndex, betType, suit, wager, challengeId: crypto.randomUUID() })
          }
          onClose={() => setSideBetTarget(null)}
        />
      )}

      {incomingSideBetChallenge && (
        <SideBetChallengePrompt
          challenge={incomingSideBetChallenge}
          onAccept={() => { send({ type: 'side_bet_accept', challengeId: incomingSideBetChallenge.id }); clearIncomingSideBetChallenge(); }}
          onDecline={() => { send({ type: 'side_bet_decline', challengeId: incomingSideBetChallenge.id }); clearIncomingSideBetChallenge(); }}
        />
      )}

      {sideBetResult && (
        <SideBetResultModal
          result={sideBetResult}
          myUserId={user?.id ?? null}
          onClose={clearSideBetResult}
        />
      )}

      {table?.showdownResult && table.handNumber !== dismissedShowdownHandNum && !cashOutSummary && (
        <ShowdownResultsModal
          result={table.showdownResult}
          onClose={() => setDismissedShowdownHandNum(table.handNumber)}
        />
      )}

      {cashOutSummary && (
        <SessionResultsModal summary={cashOutSummary} onLeave={handleLeaveTable} game={headerLobby?.settings.game} />
      )}

      {/* ── Tournament overlays ──────────────────────────────────────── */}
      {tournamentState && (
        <TournamentLeaderboard tournament={tournamentState} />
      )}

      {tournamentState && headerLobby?.tournamentId && (
        <div style={{ position: 'fixed', bottom: '4.5rem', left: '50%', transform: 'translateX(-50%)', zIndex: 28, maxWidth: 400, width: '90%' }}>
          <BlindScheduleDisplay
            tournament={tournamentState}
            isHost={isHost}
            onAdvanceLevel={() => {
              if (headerLobby.tournamentId) {
                send({ type: 'host_advance_blind_level', tournamentId: headerLobby.tournamentId });
              }
            }}
          />
        </div>
      )}

      {seatChangeWarning && (
        <SeatChangeModal
          newTableNumber={seatChangeWarning.newTableNumber}
          deadline={seatChangeWarning.deadline}
          onDismiss={() => send({ type: 'tournament_acknowledge_seat_change' })}
        />
      )}

      {eliminationResult && (
        <EliminationModal
          bustPosition={eliminationResult.bustPosition}
          prizeAwarded={eliminationResult.prizeAwarded}
          totalPlayers={eliminationResult.totalPlayers}
          onClose={clearEliminationResult}
        />
      )}

      {tournamentFinalLeaderboard && !eliminationResult && (
        <div className="modal-overlay" style={{ zIndex: 75 }}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <h2 className="modal-title">Tournament Complete!</h2>
            <div style={{ maxHeight: 300, overflowY: 'auto', margin: '0.75rem 0' }}>
              {tournamentFinalLeaderboard.map((entry, i) => (
                <div key={entry.userId} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', fontSize: '0.9rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span><span style={{ opacity: 0.5 }}>{i + 1}. </span>{entry.displayName}</span>
                  {entry.prizeAwarded && entry.prizeAwarded > 0 && (
                    <span style={{ color: 'var(--gold)', fontWeight: 600 }}>+{entry.prizeAwarded.toLocaleString()}</span>
                  )}
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => { clearTournamentFinalLeaderboard(); navigate('/'); }}>
                Back to Home
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
