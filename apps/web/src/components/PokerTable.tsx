import React, { useRef, useState, useEffect } from 'react';
import type { Card } from '@vct/shared-types';
import type { LobbySummary, PublicTableState } from '@vct/shared-types';
import { CardView } from './CardView';
import { ChipStack } from './ChipStack';
import { WinnerBanner } from './WinnerBanner';
import { useActionTimer } from '../hooks/useActionTimer';
import { useTableAnimations, type WinnerBannerData } from '../hooks/useTableAnimations';

interface Props {
  lobby: LobbySummary | null;
  table: PublicTableState | null;
  privateHoleCards?: Card[];
  myUserId?: string;
  handComplete?: { seatIndex: number; amount: number; handDescription: string }[] | null;
}

interface ChipFlight {
  id: string;
  startX: number;  // px from felt left edge
  startY: number;  // px from felt top edge
  dx: number;      // px displacement to winner seat
  dy: number;
  delay: number;   // animation-delay in ms
}

/** Compute seat center in pixels relative to the felt element. */
function computeSeatCenterPx(
  loopIdx: number,
  angleStep: number,
  feltRect: DOMRect,
): { x: number; y: number } {
  const xPct = 50 + 42 * Math.cos(angleStep * loopIdx - Math.PI / 2);
  const yPct = 50 + 38 * Math.sin(angleStep * loopIdx - Math.PI / 2);
  return {
    x: (feltRect.width * xPct) / 100,
    y: (feltRect.height * yPct) / 100,
  };
}

export function PokerTable({ lobby, table, privateHoleCards, myUserId, handComplete }: Props) {
  const maxSeats = lobby?.settings.maxPlayers ?? 9;
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

  const anim = useTableAnimations(table, handComplete ?? null);

  // ── Chip flight state ─────────────────────────────────────
  const feltRef = useRef<HTMLDivElement>(null);
  const potAreaRef = useRef<HTMLDivElement>(null);
  const [flyingChips, setFlyingChips] = useState<ChipFlight[]>([]);
  const prevWinnerBannerRef = useRef<WinnerBannerData | null>(null);

  useEffect(() => {
    const banner = anim.winnerBanner;
    const prev = prevWinnerBannerRef.current;
    prevWinnerBannerRef.current = banner;

    // Only fire when a new banner appears (null → non-null or different object)
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
      // Two chips per winner in quick succession — looks like a stream
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

    // Clean up after all animations finish (duration 800ms + max stagger + buffer)
    const maxDelay = (banner.winners.length - 1) * 65 + 125;
    const tid = setTimeout(() => setFlyingChips([]), 800 + maxDelay + 150);
    return () => clearTimeout(tid);
  }, [anim.winnerBanner]); // seats/angleStep captured from current render — correct

  // ─────────────────────────────────────────────────────────

  const dealerSeatIndex = table?.dealerSeatIndex ?? 0;
  const isDealingThisHand = anim.dealingHandNum === table?.handNumber;

  // Deal order: seat immediately after dealer is dealt first (0-indexed round-trip)
  function dealOrderOf(seatIndex: number) {
    return (seatIndex - dealerSeatIndex - 1 + maxSeats) % maxSeats;
  }

  // CSS class name that encodes the stagger delay for hole cards
  // Round 0 = first card, round 1 = second card dealt to each player
  function holeDealDelayClass(seatIndex: number, cardRound: 0 | 1): string {
    const idx = dealOrderOf(seatIndex) + cardRound * maxSeats;
    return `deal-delay-${idx}`;
  }

  return (
    <div className="felt" ref={feltRef} role="region" aria-label="Poker table">
      {table?.paused && (
        <div className="pause-overlay">
          <span>Game Paused</span>
        </div>
      )}

      {anim.winnerBanner && <WinnerBanner data={anim.winnerBanner} />}

      {/* Chip flights — absolutely positioned over the felt.
          Positioned via ref callback to avoid JSX inline-style lint rule. */}
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
        {table && table.pots.length > 0 ? (
          <div className={`pot${anim.winnerBanner ? ' pot-distributing' : ''}`}>
            Pot: {table.pots.reduce((s, p) => s + p.amount, 0).toLocaleString()}
          </div>
        ) : (
          <div className="pot">Waiting for hand</div>
        )}
        <div className="board">
          {table?.board.map((c, i) => {
            const isNewCard =
              anim.boardDealFromIndex !== null && i >= anim.boardDealFromIndex;
            const relativeIdx = isNewCard ? i - (anim.boardDealFromIndex ?? 0) : 0;
            return (
              <div
                key={i}
                className={[
                  'card-anim-wrapper',
                  isNewCard ? 'board-dealing' : '',
                  isNewCard ? `board-delay-${relativeIdx}` : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <CardView card={c} faceUp />
              </div>
            );
          })}
          {table && table.board.length === 0 && table.street !== 'waiting' && (
            <span className="street">{table.street}</span>
          )}
        </div>
        {intermissionRemaining !== null && table?.street === 'complete' && (
          <div className="intermission">
            Next hand in {intermissionRemaining}s
          </div>
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
          const x = 50 + 42 * Math.cos(angleStep * i - Math.PI / 2);
          const y = 50 + 38 * Math.sin(angleStep * i - Math.PI / 2);

          const seatClass = [
            'seat',
            occupied ? 'occupied' : 'empty',
            isActor ? 'acting' : '',
            gs?.folded ? 'folded' : '',
            isMe ? 'me' : '',
            isWinner ? 'winner' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <li
              key={seat.seatIndex}
              className={seatClass}
              style={{ '--seat-x': `${x}%`, '--seat-y': `${y}%` } as React.CSSProperties}
            >
              <div className="seat-info">
                <strong>{seat.displayName ?? (occupied ? 'Player' : `Seat ${seat.seatIndex + 1}`)}</strong>
                {occupied && stack > 0 && <ChipStack amount={stack} />}
                {!occupied && <span className="seat-empty-label">Open</span>}
                {gs?.betThisStreet ? (
                  <span
                    key={`bet-${seat.seatIndex}-${gs.betThisStreet}`}
                    className={`bet${isBetting ? ' bet-pulse' : ''}`}
                  >
                    Bet: {gs.betThisStreet.toLocaleString()}
                  </span>
                ) : null}
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
              <div className="hole-cards">
                {!isMe && gs && !gs.folded && table?.street !== 'complete' && occupied && (
                  <>
                    {([0, 1] as const).map(cardRound => (
                      <div
                        key={cardRound}
                        className={[
                          'playing-card back',
                          isDealingThisHand ? 'dealing' : '',
                          isDealingThisHand ? holeDealDelayClass(seat.seatIndex, cardRound) : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      />
                    ))}
                  </>
                )}
                {gs?.shownCards?.map((c, j) => <CardView key={j} card={c} faceUp />)}
              </div>
            </li>
          );
        })}
      </ul>

      {privateHoleCards && privateHoleCards.length > 0 && (
        <div className="player-hand-tray" aria-label="Your hole cards">
          <div className="player-hand-title">Your hand</div>
          <div className="player-hand-cards">
            {privateHoleCards.map((card, index) => {
              const mySeatIndex = seats.find(s => s.userId === myUserId)?.seatIndex ?? 0;
              const dealClass = isDealingThisHand
                ? `dealing ${holeDealDelayClass(mySeatIndex, index as 0 | 1)}`
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
        </div>
      )}
    </div>
  );
}
