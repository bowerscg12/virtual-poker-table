import React, { useRef, useState, useEffect } from 'react';
import type { BadgeType, Card, LobbySummary, PublicTableState, ChatMessage, PlayerActionType } from '@vct/shared-types';
import { CardView } from './CardView';
import { ChipStack } from './ChipStack';
import { WinnerBanner } from './WinnerBanner';
import { AvatarSvg } from './AvatarSvg';
import { useActionTimer } from '../hooks/useActionTimer';
import type { TableAnimState, WinnerBannerData } from '../hooks/useTableAnimations';
import { formatChips } from '../utils/formatChips';
import { PotDisplay } from './PotDisplay';

/** How far (as fraction of seat orbit radius) the felt buttons sit from center. */
const BTN_RADIUS_FACTOR = 0.80;

const BADGE_ICON: Record<BadgeType, string> = {
  big_stack:       '👑',
  short_stack:     '💸',
  hot_streak:      '🔥',
  calling_station: '📞',
  charlie:         '✂',
  whale:           '🐋',
  maniac:          '💣',
  loose_cannon:    '🎯',
};

const BADGE_LABEL: Record<BadgeType, string> = {
  big_stack:       'Big Stack — chip leader at the table',
  short_stack:     'Short Stack — fewest chips at the table',
  hot_streak:      'Hot Streak — 3+ wins in a row',
  calling_station: 'Calling Station — calls the most per hand',
  charlie:         'Charlie — folds preflop the most',
  whale:           'Whale — biggest chip loss this session',
  maniac:          'Maniac — raises the most this session',
  loose_cannon:    'Loose Cannon — plays the most hands (VPIP)',
};

function formatActionBadge(action: PlayerActionType, amount?: number): string {
  switch (action) {
    case 'fold':   return 'Fold';
    case 'check':  return 'Check';
    case 'call':   return amount !== undefined ? `Call ${formatChips(amount)}` : 'Call';
    case 'raise':  return amount !== undefined ? `Raise ${formatChips(amount)}` : 'Raise';
    case 'all_in': return amount !== undefined ? `All-In ${formatChips(amount)}` : 'All-In';
    default:       return action;
  }
}

const BUBBLE_DURATION_MS = 5000;
const BUBBLE_MAX_LENGTH = 120;

interface ActiveBubble {
  text: string;
  key: string;
}

interface Props {
  lobby: LobbySummary | null;
  table: PublicTableState | null;
  myUserId?: string;
  anim: TableAnimState;
  messages?: ChatMessage[];
}

interface ChipFlight {
  id: string;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  delay: number;
}

/** Compute seat center in pixels relative to the felt element. */
function computeSeatCenterPx(
  loopIdx: number,
  angleStep: number,
  feltRect: DOMRect,
): { x: number; y: number } {
  const xPct = 50 + 46 * Math.cos(angleStep * loopIdx - Math.PI / 2);
  const yPct = 50 + 42 * Math.sin(angleStep * loopIdx - Math.PI / 2);
  return {
    x: (feltRect.width * xPct) / 100,
    y: (feltRect.height * yPct) / 100,
  };
}

export function PokerTable({ lobby, table, myUserId, anim, messages }: Props) {
  const maxSeats = lobby?.settings.maxPlayers ?? 8;
  const seats = lobby?.seats ?? Array.from({ length: maxSeats }, (_, i) => ({
    seatIndex: i,
    userId: null,
    displayName: null,
    stack: 0,
    sittingOut: false,
    isConnected: false,
  }));

  const angleStep = (2 * Math.PI) / maxSeats;
  const remaining = useActionTimer(table?.paused ? undefined : table?.actionDeadline);
  const intermissionRemaining = useActionTimer(table?.paused ? undefined : table?.intermissionDeadline);
  const timerSec = lobby?.settings.actionTimerSec ?? 0;
  const isUrgent = remaining !== null && remaining <= 10;

  const [activeBadgeTip, setActiveBadgeTip] = useState<string | null>(null);

  // ── Chat bubble state ──────────────────────────────────────
  const [activeBubbles, setActiveBubbles] = useState<Map<string, ActiveBubble>>(new Map());
  const bubbleTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const processedMsgCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (!messages) return;
    if (processedMsgCountRef.current === null) {
      processedMsgCountRef.current = messages.length;
      return;
    }
    const prev = processedMsgCountRef.current;
    if (messages.length <= prev) return;
    const newMessages = messages.slice(prev);
    processedMsgCountRef.current = messages.length;

    newMessages.forEach((msg) => {
      const existing = bubbleTimers.current.get(msg.userId);
      if (existing !== undefined) clearTimeout(existing);
      setActiveBubbles((b) => new Map(b).set(msg.userId, { text: msg.text, key: msg.id }));
      const tid = setTimeout(() => {
        setActiveBubbles((b) => {
          const next = new Map(b);
          if (next.get(msg.userId)?.key === msg.id) next.delete(msg.userId);
          return next;
        });
        bubbleTimers.current.delete(msg.userId);
      }, BUBBLE_DURATION_MS);
      bubbleTimers.current.set(msg.userId, tid);
    });
  }, [messages]);

  useEffect(() => {
    const timers = bubbleTimers.current;
    return () => { timers.forEach((t) => clearTimeout(t)); };
  }, []);

  // ── Chip flight state ──────────────────────────────────────
  const feltRef = useRef<HTMLDivElement>(null);

  // ── All-in shake ───────────────────────────────────────────
  const shakeTriggerRef = useRef(anim.allInShakeTrigger);
  useEffect(() => {
    const felt = feltRef.current;
    if (!felt || anim.allInShakeTrigger === shakeTriggerRef.current) return;
    shakeTriggerRef.current = anim.allInShakeTrigger;
    felt.classList.remove('shake');
    void felt.offsetWidth;
    felt.classList.add('shake');
    const tid = setTimeout(() => felt.classList.remove('shake'), 500);
    return () => clearTimeout(tid);
  }, [anim.allInShakeTrigger]);

  // ── All-in runout: flip opponents' hole cards face-up ─────
  const runoutRevealTriggerRef = useRef(anim.runoutHoleRevealTrigger);
  useEffect(() => {
    if (anim.runoutHoleRevealTrigger === runoutRevealTriggerRef.current) return;
    runoutRevealTriggerRef.current = anim.runoutHoleRevealTrigger;
    const felt = feltRef.current;
    if (!felt) return;
    const opponentSeats = felt.querySelectorAll<HTMLElement>('.seat.occupied:not(.me)');
    opponentSeats.forEach(el => {
      el.classList.remove('runout-reveal');
      void el.offsetWidth;
      el.classList.add('runout-reveal');
    });
    const tid = setTimeout(() => {
      opponentSeats.forEach(el => el.classList.remove('runout-reveal'));
    }, 1000);
    return () => clearTimeout(tid);
  }, [anim.runoutHoleRevealTrigger]);

  const potAreaRef = useRef<HTMLDivElement>(null);
  const [flyingChips, setFlyingChips] = useState<ChipFlight[]>([]);
  const prevWinnerBannerRef = useRef<WinnerBannerData | null>(null);

  useEffect(() => {
    const banner = anim.winnerBanner;
    const prev = prevWinnerBannerRef.current;
    prevWinnerBannerRef.current = banner;
    if (!banner || banner === prev) return;

    const felt = feltRef.current;
    const potArea = potAreaRef.current;
    if (!felt || !potArea) return;

    const feltRect = felt.getBoundingClientRect();
    const potRect = potArea.getBoundingClientRect();
    const potCenterX = potRect.left + potRect.width / 2 - feltRect.left;
    const potCenterY = potRect.top + potRect.height / 2 - feltRect.top;

    const chips: ChipFlight[] = [];
    const now = Date.now();

    banner.winners.forEach((winner, streamIdx) => {
      const loopIdx = seats.findIndex(s => s.seatIndex === winner.seatIndex);
      if (loopIdx === -1) return;
      const dest = computeSeatCenterPx(loopIdx, angleStep, feltRect);
      for (let chipIdx = 0; chipIdx < 2; chipIdx++) {
        chips.push({
          id: `cf-${winner.seatIndex}-${chipIdx}-${now}`,
          startX: potCenterX,
          startY: potCenterY,
          dx: dest.x - potCenterX,
          dy: dest.y - potCenterY,
          delay: streamIdx * 65 + chipIdx * 125,
        });
      }
    });

    if (chips.length === 0) return;
    setFlyingChips(chips);
    const maxDelay = (banner.winners.length - 1) * 65 + 125;
    const tid = setTimeout(() => setFlyingChips([]), 800 + maxDelay + 150);
    return () => clearTimeout(tid);
  }, [anim.winnerBanner]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPot = table
    ? table.pots.reduce((s, p) => s + p.amount, 0)
      + table.seats.reduce((s, seat) => s + seat.betThisStreet, 0)
    : 0;
  const buyIn = lobby?.settings.buyIn ?? 0;
  const isDistributing = !!anim.winnerBanner;

  const dealerSeatIndex = table?.dealerSeatIndex ?? 0;
  const isDealingThisHand = anim.dealingHandNum === table?.handNumber;

  function dealOrderOf(seatIndex: number) {
    return (seatIndex - dealerSeatIndex - 1 + maxSeats) % maxSeats;
  }

  function holeDealDelayClass(seatIndex: number, cardRound: 0 | 1): string {
    const idx = dealOrderOf(seatIndex) + cardRound * maxSeats;
    return `deal-delay-${idx}`;
  }

  const isRunoutActive = table?.runout?.active === true;

  return (
    <div
      className={`felt${isRunoutActive ? ' runout-active' : ''}`}
      ref={feltRef}
      role="region"
      aria-label="Poker table"
      onPointerDown={() => setActiveBadgeTip(null)}
    >
      {table?.paused && (
        <div className="pause-overlay"><span>Game Paused</span></div>
      )}
      {isRunoutActive && (
        <div className="runout-overlay" aria-live="polite"><span>All-In Showdown</span></div>
      )}

      {anim.winnerBanner && <WinnerBanner data={anim.winnerBanner} />}

      {flyingChips.map(chip => (
        <div
          key={chip.id}
          className="chip-flight-group"
          ref={(el) => {
            if (!el) return;
            el.style.left = `${chip.startX - 15}px`;
            el.style.top = `${chip.startY - 15}px`;
            el.style.setProperty('--chip-dx', `${chip.dx}px`);
            el.style.setProperty('--chip-dy', `${chip.dy}px`);
            el.style.animationDelay = `${chip.delay}ms`;
          }}
          aria-hidden
        />
      ))}

      <div className="pot-area" ref={potAreaRef}>
        {totalPot <= 0 && <div className="pot">Waiting for hand</div>}
        {(() => {
          const isDoubleBoard = !!table?.secondBoard;
          const renderCards = (cards: Card[]) =>
            cards.map((c, i) => {
              const isNewCard = anim.boardDealFromIndex !== null && i >= anim.boardDealFromIndex;
              const relativeIdx = isNewCard ? i - (anim.boardDealFromIndex ?? 0) : 0;
              return (
                <div
                  key={i}
                  className={[
                    'card-anim-wrapper',
                    isNewCard ? 'board-dealing' : '',
                    isNewCard ? `board-delay-${relativeIdx}` : '',
                  ].filter(Boolean).join(' ')}
                >
                  <CardView card={c} faceUp />
                </div>
              );
            });
          return (
            <>
              {isDoubleBoard && <span className="board-label">Board A</span>}
              <div className="board">
                {table?.board && renderCards(table.board)}
                {table && table.board.length === 0 && table.street !== 'waiting' && !isDoubleBoard && (
                  <span className="street">{table.street}</span>
                )}
              </div>
              {isDoubleBoard && (
                <>
                  <span className="board-label">Board B</span>
                  <div className="board board--second">
                    {renderCards(table!.secondBoard!)}
                  </div>
                </>
              )}
            </>
          );
        })()}
        <PotDisplay totalPot={totalPot} buyIn={buyIn} distributing={isDistributing} />
        {intermissionRemaining !== null && table?.street === 'complete' && (
          <div className="intermission">Next hand in {intermissionRemaining}s</div>
        )}
      </div>

      <ul className="seats">
        {seats.map((seat, i) => {
          const gs = table?.seats.find((s) => s.seatIndex === seat.seatIndex);
          const stack = gs?.stack ?? seat.stack;
          const occupied = !!seat.userId;
          const isMe = seat.userId === myUserId;
          const isActor = table?.actionSeatIndex === seat.seatIndex;
          const isWinner = anim.winningSeats.has(seat.seatIndex);
          const isBetting = anim.recentBetSeat === seat.seatIndex;
          const isAllIn = gs?.allIn === true;

          // Seats pushed further toward the rail (46% x-radius, 42% y-radius)
          const x = 50 + 46 * Math.cos(angleStep * i - Math.PI / 2);
          const y = 50 + 42 * Math.sin(angleStep * i - Math.PI / 2);

          const seatClass = [
            'seat',
            occupied ? 'occupied' : 'empty',
            isActor ? 'acting' : '',
            gs?.folded ? 'folded' : '',
            isMe ? 'me' : '',
            isWinner ? 'winner' : '',
            isAllIn ? 'all-in' : '',
          ].filter(Boolean).join(' ');

          const bubble = seat.userId ? activeBubbles.get(seat.userId) : undefined;

          // Show face-down backs for opponents during active hand (not folded, not complete)
          const showFaceDownBacks = !isMe && gs && !gs.folded && table?.street !== 'complete' && occupied;

          return (
            <li
              key={seat.seatIndex}
              className={seatClass}
              style={{ '--seat-x': `${x}%`, '--seat-y': `${y}%` } as React.CSSProperties}
            >
              {bubble && (
                <div key={bubble.key} className="chat-bubble" aria-live="polite">
                  {bubble.text.length > BUBBLE_MAX_LENGTH
                    ? bubble.text.slice(0, BUBBLE_MAX_LENGTH) + '…'
                    : bubble.text}
                </div>
              )}

              {/* Face-down backs before capsule in DOM — capsule paints over their bottom edge */}
              {showFaceDownBacks && (
                <div className="hole-cards">
                  {([0, 1] as const).map(cardRound => (
                    <div
                      key={cardRound}
                      className={[
                        'playing-card back',
                        isDealingThisHand ? 'dealing' : '',
                        isDealingThisHand ? holeDealDelayClass(seat.seatIndex, cardRound) : '',
                      ].filter(Boolean).join(' ')}
                    />
                  ))}
                </div>
              )}

              <div className="seat-info">
                <span className="seat-number" aria-hidden="true">{seat.seatIndex + 1}</span>
                {occupied && seat.avatar && (
                  <div className="seat-avatar">
                    <AvatarSvg config={seat.avatar} size={32} />
                  </div>
                )}

                <strong className="seat-name">{seat.displayName ?? (occupied ? 'Player' : `Seat ${seat.seatIndex + 1}`)}</strong>
                {occupied && stack > 0 && <ChipStack amount={stack} />}
                {!occupied && <span className="seat-empty-label">Open</span>}
                {gs?.betThisStreet ? (
                  <span
                    key={`bet-${seat.seatIndex}-${gs.betThisStreet}`}
                    className={`bet${isBetting ? ' bet-pulse' : ''}`}
                  >
                    Bet: {formatChips(gs.betThisStreet)}
                  </span>
                ) : null}
                {occupied && stack === 0 && !seat.waitingForReentryBlind && (
                  <span className="out-of-chips-badge">Out of Chips</span>
                )}
                {occupied && seat.waitingForReentryBlind && (
                  <span className="waiting-bb-badge">Waiting for BB</span>
                )}
                {occupied && seat.sitOutNextHand && !seat.waitingForReentryBlind && (
                  <span className="sit-out-badge">
                    {seat.sitOutBlindOwed ? 'Blind owed' : 'Sitting Out'}
                  </span>
                )}
                {occupied && gs?.lastAction && (
                  <span className={`action-badge action-badge--${gs.lastAction.action}`}>
                    {formatActionBadge(gs.lastAction.action, gs.lastAction.amount)}
                  </span>
                )}
                {occupied && gs?.badges && gs.badges.length > 0 && (
                  <div className="seat-badges">
                    {gs.badges.map((badge) => {
                      const tipKey = `${seat.seatIndex}:${badge}`;
                      const tipActive = activeBadgeTip === tipKey;
                      return (
                        <span
                          key={badge}
                          className={`seat-badge seat-badge--${badge}${tipActive ? ' tip-active' : ''}`}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            setActiveBadgeTip(tipActive ? null : tipKey);
                          }}
                          role="img"
                          aria-label={BADGE_LABEL[badge]}
                        >
                          {BADGE_ICON[badge]}
                          <span className="seat-badge-tip">{BADGE_LABEL[badge]}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
                {isActor && remaining !== null && timerSec > 0 && (
                  <span className={`seat-timer${isUrgent ? ' urgent' : ''}`}>
                    {remaining}s
                  </span>
                )}
              </div>

              {isActor && remaining !== null && timerSec > 0 && (
                <div className="timer-bar-track">
                  <div
                    className={`timer-bar${isUrgent ? ' urgent' : ''}`}
                    style={{ '--timer-pct': `${Math.min(100, (remaining / timerSec) * 100)}%` } as React.CSSProperties}
                  />
                </div>
              )}

              {/* Shown cards at showdown — visible below capsule for all seats */}
              {gs?.shownCards && gs.shownCards.length > 0 && (
                <div className="shown-cards">
                  {gs.shownCards.map((c, j) => <CardView key={j} card={c} faceUp />)}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Dealer / blind buttons on the felt — physical poker-table style */}
      {seats.map((seat, i) => {
        const gs = table?.seats.find((s) => s.seatIndex === seat.seatIndex);
        if (!gs || (!gs.isDealer && !gs.isSmallBlind && !gs.isBigBlind)) return null;
        const angle = angleStep * i - Math.PI / 2;
        const bx = 50 + 46 * BTN_RADIUS_FACTOR * Math.cos(angle);
        const by = 50 + 42 * BTN_RADIUS_FACTOR * Math.sin(angle);
        return (
          <div
            key={`pos-btn-${seat.seatIndex}`}
            className="felt-position-markers"
            style={{ '--btn-x': `${bx}%`, '--btn-y': `${by}%` } as React.CSSProperties}
            aria-label="Position markers"
          >
            {gs.isDealer && <span className="position-marker position-marker--d" title="Dealer Button">D</span>}
            {gs.isSmallBlind && <span className="position-marker position-marker--sb" title="Small Blind">SB</span>}
            {gs.isBigBlind && <span className="position-marker position-marker--bb" title="Big Blind">BB</span>}
          </div>
        );
      })}
    </div>
  );
}
