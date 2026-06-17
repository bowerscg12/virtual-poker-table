import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type {
  AvatarConfig,
  Card,
  LegalAction,
  LobbySummary,
  PlayerActionType,
  PublicTableState,
} from '@vct/shared-types';
import { CardView } from './CardView';
import { AvatarSvg } from './AvatarSvg';
import { WinnerBanner } from './WinnerBanner';
import type { TableAnimState } from '../hooks/useTableAnimations';
import { formatChips } from '../utils/formatChips';
import { playSound } from '../utils/soundEngine';

interface Props {
  lobby: LobbySummary | null;
  table: PublicTableState | null;
  myUserId?: string;
  privateHoleCards: Card[];
  legalActions: LegalAction[];
  onAction: (action: PlayerActionType) => void;
  anim: TableAnimState;
  isHost: boolean;
  onDealAgain: () => void;
  /** Host-only: add an AI opponent to the open seat (difficulty is irrelevant in flip). */
  onAddBot?: (seatIndex: number) => void;
  onExit: () => void;
  soundEnabled?: boolean;
}

const RANK_RUNGS = 10; // high card … royal flush

/** Lay the grid out in a roughly even 1–3 rows depending on the card count (5–26). */
function gridColumns(total: number): number {
  if (total <= 6) return total;
  if (total <= 16) return Math.ceil(total / 2);
  return Math.ceil(total / 3);
}

function vibrate(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported — ignore */
  }
}

// ── Avatar with graceful fallback ──────────────────────────────────────────────
function FlipAvatar({ avatar, name, size }: { avatar?: AvatarConfig; name: string; size: number }) {
  if (avatar) return <AvatarSvg config={avatar} size={size} />;
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <div className="tcf-avatar-fallback" style={{ width: size, height: Math.round(size * 1.1) }}>
      {initial}
    </div>
  );
}

// ── Hand-strength meter (climbs as the hand improves) ───────────────────────────
function RankMeter({ rank }: { rank: number }) {
  return (
    <div className="tcf-meter" aria-hidden>
      {Array.from({ length: RANK_RUNGS }, (_, i) => (
        <span
          key={i}
          className={`tcf-meter__seg ${i <= rank ? 'tcf-meter__seg--on' : ''} ${i === rank ? 'tcf-meter__seg--peak' : ''}`}
        />
      ))}
    </div>
  );
}

// ── Grid of 3D flip cards (count is configurable, 5–26) ─────────────────────────
function FlipGrid({
  revealed,
  total,
  bestSet,
  dimNonBest,
  isDealing,
  justFlippedIdx,
}: {
  revealed: Card[];
  total: number;
  bestSet: Set<string>;
  dimNonBest: boolean;
  isDealing: boolean;
  justFlippedIdx: number | null;
}) {
  return (
    <div
      className={`tcf-grid ${isDealing ? 'tcf-grid--dealing' : ''}`}
      style={{ '--cols': gridColumns(total) } as CSSProperties}
    >
      {Array.from({ length: total }, (_, idx) => {
        const card = revealed[idx];
        const flipped = idx < revealed.length && !!card;
        const isBest = flipped && bestSet.has(card!);
        const isDim = flipped && dimNonBest && !bestSet.has(card!);
        const isNew = justFlippedIdx === idx;
        return (
          <div
            key={idx}
            className={[
              'tcf-card3d',
              flipped ? 'tcf-card3d--flipped' : '',
              isBest ? 'tcf-card3d--best' : '',
              isDim ? 'tcf-card3d--dim' : '',
              isNew ? 'tcf-card3d--new' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ '--i': idx } as CSSProperties}
          >
            <div className="tcf-card3d__inner">
              <div className="tcf-card3d__face tcf-card3d__back">
                <div className="playing-card back" aria-hidden />
              </div>
              <div className="tcf-card3d__face tcf-card3d__front">
                {flipped && card ? <CardView card={card} faceUp /> : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TwelveCardFlip({
  lobby,
  table,
  myUserId,
  legalActions,
  onAction,
  anim,
  isHost,
  onDealAgain,
  onAddBot,
  onExit,
  soundEnabled = false,
}: Props) {
  const seats = table?.seats ?? [];
  const flipReveal = table?.flipReveal;
  const pot = (table?.pots ?? []).reduce((s, p) => s + p.amount, 0);
  const isComplete = table?.street === 'complete';
  const canFlip = legalActions.some((a) => a.type === 'flip_card');
  const anteAmount = lobby?.settings.twelveCardFlipAnte ?? lobby?.settings.buyIn ?? 0;

  // Avatar lookup by userId from the lobby seats.
  const avatarFor = (userId?: string | null): AvatarConfig | undefined =>
    userId ? lobby?.seats.find((s) => s.userId === userId)?.avatar : undefined;

  // ── Per-seat just-flipped tracking (drives the pop on the newest card) ─────────
  const prevRevealedCountsRef = useRef<Record<number, number>>({});
  const [justFlipped, setJustFlipped] = useState<Record<number, number | null>>({});

  useEffect(() => {
    if (!flipReveal) return;
    const newJust: Record<number, number | null> = {};
    let changed = false;
    seats.forEach((seat, i) => {
      const prev = prevRevealedCountsRef.current[seat.seatIndex] ?? 0;
      const curr = (flipReveal.revealedCards?.[i] ?? []).length;
      if (curr > prev) {
        newJust[seat.seatIndex] = curr - 1;
        changed = true;
      } else {
        newJust[seat.seatIndex] = null;
      }
      prevRevealedCountsRef.current[seat.seatIndex] = curr;
    });
    if (changed) {
      setJustFlipped(newJust);
      const tid = setTimeout(() => setJustFlipped({}), 600);
      return () => clearTimeout(tid);
    }
  }, [flipReveal?.revealedCards]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Flip sound + haptic on any new card revealed ──────────────────────────────
  const prevTotalRef = useRef(0);
  useEffect(() => {
    if (!flipReveal) {
      prevTotalRef.current = 0;
      return;
    }
    const total = (flipReveal.revealedCards ?? []).reduce((s, c) => s + c.length, 0);
    const prev = prevTotalRef.current;
    prevTotalRef.current = total;
    if (total > prev && !isComplete) {
      playSound(soundEnabled, 'flip');
      vibrate(12);
    }
  }, [flipReveal?.revealedCards, isComplete, soundEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lead-change sting ─────────────────────────────────────────────────────────
  const prevLeadRef = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    const lead = flipReveal?.leadingSeatIndex ?? null;
    const prev = prevLeadRef.current;
    prevLeadRef.current = lead;
    if (prev === undefined) return; // first observation — don't sting
    if (lead !== null && lead !== prev && !isComplete) {
      playSound(soundEnabled, 'lead');
      vibrate(25);
    }
  }, [flipReveal?.leadingSeatIndex, isComplete, soundEnabled]);

  // Reset trackers between hands.
  const handNumber = table?.handNumber;
  useEffect(() => {
    prevTotalRef.current = 0;
    prevLeadRef.current = undefined;
    prevRevealedCountsRef.current = {};
  }, [handNumber]);

  // ── Confetti when the viewer wins (kept above the early return to preserve
  //    a stable hook order between the waiting and playing states) ─────────────
  const winnerBanner = anim.winnerBanner;
  const confetti = useMemo(() => {
    if (!table || table.street !== 'complete') return [];
    const winnerSeats = winnerBanner?.winners ?? [];
    const mySeat = table.seats.find((s) => s.userId === myUserId);
    const iWin = mySeat != null && winnerSeats.some((w) => w.seatIndex === mySeat.seatIndex);
    if (!iWin) return [];
    return Array.from({ length: 40 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.5,
      dur: 1.6 + Math.random() * 1.4,
      hue: Math.floor(Math.random() * 360),
      drift: (Math.random() - 0.5) * 120,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table?.street, handNumber, winnerBanner, myUserId]);

  // Before the first hand the table has no seats yet — drive the lobby/waiting
  // view off the live lobby roster so the host sees players arrive in real time.
  if (!table || table.street === 'waiting' || seats.length < 2) {
    const seatedPlayers = (lobby?.seats ?? []).filter((s) => s.userId);
    const ready = seatedPlayers.length >= 2;
    return (
      <div className="twelve-card-flip twelve-card-flip--waiting">
        <div className="twelve-card-flip__waiting">
          <h3 className="tcf-lobby__title">Multi-Card Flip</h3>
          <p className="tcf-lobby__subtitle">{lobby?.settings.twelveCardFlipCardCount ?? 12} cards each</p>

          <div className="tcf-lobby__roster">
            {seatedPlayers.map((s) => (
              <div key={s.seatIndex} className="tcf-lobby__player">
                <FlipAvatar avatar={s.avatar} name={s.displayName ?? 'Player'} size={48} />
                <span className="tcf-lobby__player-name">{s.displayName ?? 'Player'}</span>
                {lobby?.hostUserId === s.userId && <span className="tcf-lobby__host-tag">Host</span>}
              </div>
            ))}
            {seatedPlayers.length < 2 && (
              <div className="tcf-lobby__player tcf-lobby__player--empty">
                <div className="tcf-lobby__empty-seat">?</div>
                <span className="tcf-lobby__player-name">Waiting…</span>
                {isHost && onAddBot && (
                  <button
                    type="button"
                    className="btn small tcf-lobby__add-bot"
                    onClick={() => {
                      const openSeat = (lobby?.seats ?? []).find((s) => !s.userId);
                      if (openSeat) onAddBot(openSeat.seatIndex);
                    }}
                  >
                    🤖 Add bot opponent
                  </button>
                )}
              </div>
            )}
          </div>

          {ready ? (
            isHost ? (
              <button type="button" className="btn primary tcf-lobby__start" onClick={onDealAgain}>
                Start Game
              </button>
            ) : (
              <p className="tcf-lobby__status">Both players ready — waiting for host to start…</p>
            )
          ) : (
            <>
              <p className="tcf-lobby__status">Waiting for another player to join…</p>
              {lobby && (
                <p className="invite-hint">
                  Invite code: <strong>{lobby.inviteCode}</strong>
                </p>
              )}
            </>
          )}

          <button type="button" className="btn ghost tcf-exit-btn" onClick={onExit}>
            Exit Game
          </button>
        </div>
      </div>
    );
  }

  const mySeatData = seats.find((s) => s.userId === myUserId);
  const opponentSeatData = seats.find((s) => s.userId !== myUserId);
  const myIdx = mySeatData ? seats.indexOf(mySeatData) : -1;
  const opponentIdx = opponentSeatData ? seats.indexOf(opponentSeatData) : -1;

  const myRevealed = myIdx >= 0 ? flipReveal?.revealedCards?.[myIdx] ?? [] : [];
  const opponentRevealed = opponentIdx >= 0 ? flipReveal?.revealedCards?.[opponentIdx] ?? [] : [];

  const myBestHand = myIdx >= 0 ? flipReveal?.bestHands?.[myIdx] ?? null : null;
  const opponentBestHand = opponentIdx >= 0 ? flipReveal?.bestHands?.[opponentIdx] ?? null : null;

  const myRank = myIdx >= 0 ? flipReveal?.bestHandRanks?.[myIdx] ?? -1 : -1;
  const opponentRank = opponentIdx >= 0 ? flipReveal?.bestHandRanks?.[opponentIdx] ?? -1 : -1;

  const myBestFive = myIdx >= 0 ? flipReveal?.bestFiveCards?.[myIdx] ?? null : null;
  const opponentBestFive = opponentIdx >= 0 ? flipReveal?.bestFiveCards?.[opponentIdx] ?? null : null;
  const myBestSet = new Set(myBestFive ?? []);
  const opponentBestSet = new Set(opponentBestFive ?? []);
  const myDimNonBest = (myBestFive?.length ?? 0) >= 5;
  const opponentDimNonBest = (opponentBestFive?.length ?? 0) >= 5;

  const leadingSeat = flipReveal?.leadingSeatIndex ?? null;
  const isMeLead = mySeatData != null && leadingSeat === mySeatData.seatIndex;
  const isOpponentLead = opponentSeatData != null && leadingSeat === opponentSeatData.seatIndex;
  const isTied = !isMeLead && !isOpponentLead && myRevealed.length > 0 && opponentRevealed.length > 0;

  // Per-player card count for this hand (configurable 5–26). Never clip revealed cards.
  const cardCount = Math.max(
    lobby?.settings.twelveCardFlipCardCount ?? 12,
    myRevealed.length,
    opponentRevealed.length,
  );
  const myRemainingCount = cardCount - myRevealed.length;
  const opponentRemainingCount = cardCount - opponentRevealed.length;

  const isMyTurn = table.actionSeatIndex === mySeatData?.seatIndex;
  const isOpponentTurn = table.actionSeatIndex === opponentSeatData?.seatIndex;

  const winners = anim.winnerBanner?.winners ?? [];
  const myWin = mySeatData != null && winners.some((w) => w.seatIndex === mySeatData.seatIndex);
  const opponentWin =
    opponentSeatData != null && winners.some((w) => w.seatIndex === opponentSeatData.seatIndex);

  const isDealing = anim.dealingHandNum != null && anim.dealingHandNum === table.handNumber;

  // ── Tug-of-war / evaluation bar: 0 (opponent) … 100 (me) = my win probability ──
  // Driven by the server's Monte-Carlo equity over the unseen cards, so it
  // reflects true odds (cards left to flip, draws) rather than just made-hand rank.
  const myWinChance =
    myIdx >= 0 && flipReveal?.winChances?.[myIdx] != null
      ? flipReveal.winChances[myIdx]
      : myRevealed.length === 0 && opponentRevealed.length === 0
        ? 0.5
        : null;
  const tugPos = myWinChance != null ? Math.round(myWinChance * 100) : 50;
  const myWinPct = myWinChance != null ? Math.round(myWinChance * 100) : null;

  // ── Tension ramp as the hand nears resolution ─────────────────────────────────
  const progress = (myRevealed.length + opponentRevealed.length) / (cardCount * 2);
  const tensionClass = isComplete
    ? ''
    : progress >= 0.78
      ? 'twelve-card-flip--tense-high'
      : progress >= 0.5
        ? 'twelve-card-flip--tense-mid'
        : '';

  const renderPanel = (side: 'me' | 'opp') => {
    const isMe = side === 'me';
    const data = isMe ? mySeatData : opponentSeatData;
    const revealed = isMe ? myRevealed : opponentRevealed;
    const bestHand = isMe ? myBestHand : opponentBestHand;
    const rank = isMe ? myRank : opponentRank;
    const bestSet = isMe ? myBestSet : opponentBestSet;
    const dimNonBest = isMe ? myDimNonBest : opponentDimNonBest;
    const remaining = isMe ? myRemainingCount : opponentRemainingCount;
    const isTurn = isMe ? isMyTurn : isOpponentTurn;
    const isLead = isMe ? isMeLead : isOpponentLead;
    const didWin = isMe ? myWin : opponentWin;

    return (
      <div
        className={[
          'tcf-player',
          isMe ? 'tcf-player--me' : 'tcf-player--opp',
          isTurn && !isComplete ? 'tcf-player--active' : '',
          isLead && !isComplete ? 'tcf-player--lead' : '',
          isComplete && didWin ? 'tcf-player--winner' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="tcf-player__top">
          <div className="tcf-player__id">
            <FlipAvatar avatar={avatarFor(data?.userId)} name={data?.displayName ?? (isMe ? 'You' : 'Opponent')} size={40} />
            <div className="tcf-player__id-text">
              <span className="tcf-player__name">{data?.displayName ?? (isMe ? 'You' : 'Opponent')}</span>
              <span className="tcf-player__stack">{formatChips(data?.stack ?? 0)}</span>
            </div>
            <div className="tcf-player__tags">
              {isTurn && !isComplete && <span className="tcf-tag tcf-tag--turn">{isMe ? 'Your turn' : 'Flipping…'}</span>}
              {isLead && !isComplete && <span className="tcf-tag tcf-tag--lead">Leading</span>}
            </div>
          </div>
          <div className="tcf-player__handline">
            <span className={`tcf-player__besthand ${bestHand ? '' : 'tcf-player__besthand--none'}`}>
              {bestHand ?? 'No cards revealed'}
            </span>
            {!isComplete && <span className="tcf-player__remaining">{remaining} left</span>}
          </div>
          <RankMeter rank={rank} />
        </div>

        <div className="tcf-player__cards">
          <FlipGrid
            revealed={revealed}
            total={cardCount}
            bestSet={bestSet}
            dimNonBest={dimNonBest}
            isDealing={isDealing}
            justFlippedIdx={data ? justFlipped[data.seatIndex] ?? null : null}
          />
        </div>

        {isMe && canFlip && !isComplete && (
          <button type="button" className="btn primary tcf-flip-btn" onClick={() => onAction('flip_card')}>
            Flip Card
          </button>
        )}
      </div>
    );
  };

  return (
    <div className={`twelve-card-flip ${tensionClass} ${table.paused ? 'twelve-card-flip--paused' : ''}`}>
      <div className="tcf-vignette" aria-hidden />

      {table.paused && (
        <div className="pause-overlay">
          <span>Game Paused</span>
        </div>
      )}

      {confetti.length > 0 && (
        <div className="tcf-confetti" aria-hidden>
          {confetti.map((c) => (
            <span
              key={c.id}
              className="tcf-confetti__piece"
              style={
                {
                  left: `${c.left}%`,
                  animationDelay: `${c.delay}s`,
                  animationDuration: `${c.dur}s`,
                  background: `hsl(${c.hue} 85% 60%)`,
                  '--drift': `${c.drift}px`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}

      {anim.winnerBanner && <WinnerBanner data={anim.winnerBanner} />}

      {renderPanel('opp')}

      {/* Center — pot, tug-of-war, status */}
      <div className="tcf-center">
        <div className="tcf-center__pot">
          <span className="tcf-center__pot-label">Pot</span>
          <strong className="tcf-center__pot-value">{formatChips(pot)}</strong>
          {!isComplete && anteAmount > 0 && (
            <span className="tcf-center__ante">Ante {formatChips(anteAmount)}</span>
          )}
        </div>

        <div className="tcf-tug" aria-hidden>
          <span className="tcf-tug__end tcf-tug__end--opp">
            <span className="tcf-tug__end-name">{opponentSeatData?.displayName ?? 'Opponent'}</span>
            {myWinPct != null && <span className="tcf-tug__pct">{100 - myWinPct}%</span>}
          </span>
          <div className="tcf-tug__track">
            <div className={`tcf-tug__fill ${tugPos >= 50 ? 'tcf-tug__fill--me' : 'tcf-tug__fill--opp'}`} style={{ left: `${Math.min(tugPos, 50)}%`, right: `${Math.min(100 - tugPos, 50)}%` }} />
            <div className="tcf-tug__knob" style={{ left: `${tugPos}%` }} />
            <div className="tcf-tug__center-mark" />
          </div>
          <span className="tcf-tug__end tcf-tug__end--me">
            <span className="tcf-tug__end-name">You</span>
            {myWinPct != null && <span className="tcf-tug__pct">{myWinPct}%</span>}
          </span>
        </div>
        <div className="tcf-tug__caption" aria-hidden>Win chance</div>

        <div className="tcf-center__status">
          {isTied && !isComplete && <span className="tcf-status-badge tcf-status-badge--tied">Tied</span>}

          {isComplete && (
            <>
              {myWin && opponentWin ? (
                <span className="tcf-result tcf-result--split">Split Pot!</span>
              ) : myWin ? (
                <span className="tcf-result tcf-result--win">You win!</span>
              ) : opponentWin ? (
                <span className="tcf-result tcf-result--loss">Opponent wins</span>
              ) : null}
            </>
          )}

          {isComplete && isHost && (
            <button type="button" className="btn primary tcf-deal-again" onClick={onDealAgain}>
              Start Next Hand
            </button>
          )}
          {isComplete && !isHost && (
            <span className="tcf-waiting-text">Waiting for host to start the next hand…</span>
          )}

          <button type="button" className="btn ghost tcf-exit-btn" onClick={onExit}>
            Exit Game
          </button>
        </div>
      </div>

      {renderPanel('me')}
    </div>
  );
}
