import { useEffect, useRef, useState } from 'react';
import type { Card, LegalAction, LobbySummary, PlayerActionType, PublicTableState } from '@vct/shared-types';
import { CardView } from './CardView';
import { WinnerBanner } from './WinnerBanner';
import type { TableAnimState } from '../hooks/useTableAnimations';
import { formatChips } from '../utils/formatChips';

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
}

const TOTAL_CARDS = 12;

function CardGrid({ cards, revealedCards, isMe, isActive, justFlippedIdx }: {
  cards: Card[];
  revealedCards: Card[];
  isMe: boolean;
  isActive: boolean;
  justFlippedIdx: number | null;
}) {
  const revealedCount = revealedCards.length;

  return (
    <div className={`flip-card-grid ${isMe ? 'flip-card-grid--me' : 'flip-card-grid--opponent'} ${isActive ? 'flip-card-grid--active' : ''}`}>
      {Array.from({ length: TOTAL_CARDS }, (_, idx) => {
        const revealed = idx < revealedCount;
        const card = revealed ? revealedCards[idx] : (isMe ? cards[idx] : undefined);
        const isNew = justFlippedIdx === idx;
        return (
          <div
            key={idx}
            className={[
              'flip-card-slot',
              revealed ? 'flip-card-slot--revealed' : 'flip-card-slot--hidden',
              isNew ? 'flip-card-slot--new' : '',
            ].filter(Boolean).join(' ')}
          >
            {revealed && card ? (
              <CardView card={card} faceUp className={isNew ? 'flip-card-new' : ''} />
            ) : isMe && card ? (
              <CardView card={card} faceUp={false} />
            ) : (
              <div className="playing-card back" aria-hidden />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TwelveCardFlip({ lobby, table, myUserId, privateHoleCards, legalActions, onAction, anim, isHost, onDealAgain }: Props) {
  const seats = table?.seats ?? [];
  const flipReveal = table?.flipReveal;
  const pot = (table?.pots ?? []).reduce((s, p) => s + p.amount, 0);
  const isComplete = table?.street === 'complete';
  const canFlip = legalActions.some((a) => a.type === 'flip_card');

  const anteAmount = lobby?.settings.twelveCardFlipAnte ?? lobby?.settings.buyIn ?? 0;

  // Track the index of the most recently flipped card per seat for animation
  const prevRevealedCountsRef = useRef<Record<number, number>>({});
  const [justFlipped, setJustFlipped] = useState<Record<number, number | null>>({});

  useEffect(() => {
    if (!flipReveal) return;
    const newJust: Record<number, number | null> = {};
    let changed = false;

    seats.forEach((seat, i) => {
      const prev = prevRevealedCountsRef.current[seat.seatIndex] ?? 0;
      const curr = (flipReveal.revealedCards[i] ?? []).length;
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

  if (!table || seats.length < 2) {
    return (
      <div className="twelve-card-flip twelve-card-flip--waiting">
        <div className="twelve-card-flip__waiting">
          <p>Waiting for players...</p>
          {lobby && <p className="invite-hint">Invite code: <strong>{lobby.inviteCode}</strong></p>}
        </div>
      </div>
    );
  }

  const mySeatData = seats.find((s) => s.userId === myUserId);
  const opponentSeatData = seats.find((s) => s.userId !== myUserId);

  const myIdx = mySeatData ? seats.indexOf(mySeatData) : -1;
  const opponentIdx = opponentSeatData ? seats.indexOf(opponentSeatData) : -1;

  const myRevealed = myIdx >= 0 ? (flipReveal?.revealedCards[myIdx] ?? []) : [];
  const opponentRevealed = opponentIdx >= 0 ? (flipReveal?.revealedCards[opponentIdx] ?? []) : [];

  const myBestHand = myIdx >= 0 ? flipReveal?.bestHands[myIdx] : null;
  const opponentBestHand = opponentIdx >= 0 ? flipReveal?.bestHands[opponentIdx] : null;

  const leadingSeat = flipReveal?.leadingSeatIndex ?? null;
  const isMeLead = mySeatData && leadingSeat === mySeatData.seatIndex;
  const isOpponentLead = opponentSeatData && leadingSeat === opponentSeatData.seatIndex;
  const isTied = !isMeLead && !isOpponentLead && myRevealed.length > 0 && opponentRevealed.length > 0;

  const myCardsForDisplay = privateHoleCards.length > 0 ? privateHoleCards : [];
  const myRemainingCount = TOTAL_CARDS - myRevealed.length;
  const opponentRemainingCount = TOTAL_CARDS - opponentRevealed.length;

  const isMyTurn = table.actionSeatIndex === mySeatData?.seatIndex;
  const isOpponentTurn = table.actionSeatIndex === opponentSeatData?.seatIndex;

  const winners = anim.winnerBanner?.winners ?? [];
  const myWin = mySeatData && winners.some((w) => w.seatIndex === mySeatData.seatIndex);
  const opponentWin = opponentSeatData && winners.some((w) => w.seatIndex === opponentSeatData.seatIndex);

  const myShownCards = isComplete ? (mySeatData?.shownCards ?? myCardsForDisplay) : myCardsForDisplay;
  const opponentShownCards = isComplete ? (opponentSeatData?.shownCards ?? []) : [];

  return (
    <div className={`twelve-card-flip ${table.paused ? 'twelve-card-flip--paused' : ''}`}>
      {table.paused && (
        <div className="pause-overlay"><span>Game Paused</span></div>
      )}

      {anim.winnerBanner && <WinnerBanner data={anim.winnerBanner} />}

      {/* Opponent section */}
      <div className={[
        'flip-player flip-player--opponent',
        isOpponentTurn ? 'flip-player--active' : '',
        isOpponentLead ? 'flip-player--lead' : '',
        isComplete && opponentWin ? 'flip-player--winner' : '',
      ].filter(Boolean).join(' ')}>
        <div className="flip-player__header">
          <span className="flip-player__name">
            {opponentSeatData?.displayName ?? 'Opponent'}
          </span>
          <span className="flip-player__stack">{formatChips(opponentSeatData?.stack ?? 0)}</span>
          {isOpponentTurn && !isComplete && (
            <span className="flip-player__turn-badge">Flipping...</span>
          )}
          {isOpponentLead && !isComplete && (
            <span className="flip-player__lead-badge lead">LEADING</span>
          )}
        </div>

        <div className="flip-player__hand-info">
          {opponentBestHand ? (
            <span className="flip-player__best-hand">{opponentBestHand}</span>
          ) : (
            <span className="flip-player__best-hand flip-player__best-hand--none">No cards revealed</span>
          )}
          {!isComplete && (
            <span className="flip-player__remaining">{opponentRemainingCount} remaining</span>
          )}
        </div>

        <div className="flip-card-area">
          <CardGrid
            cards={opponentShownCards}
            revealedCards={isComplete ? opponentShownCards : opponentRevealed}
            isMe={false}
            isActive={isOpponentTurn && !isComplete}
            justFlippedIdx={opponentSeatData ? (justFlipped[opponentSeatData.seatIndex] ?? null) : null}
          />
        </div>
      </div>

      {/* Center info */}
      <div className="flip-center">
        <div className="flip-pot">
          Pot: <strong>{formatChips(pot)}</strong>
        </div>

        {!isComplete && anteAmount > 0 && (
          <div className="flip-ante">
            Ante: <strong>{formatChips(anteAmount)}</strong>
          </div>
        )}

        {isTied && !isComplete && (
          <div className="flip-tied-badge">TIED</div>
        )}

        {isComplete && table.intermissionDeadline && (
          <div className="intermission flip-intermission">
            Next hand starting soon...
          </div>
        )}

        {isComplete && (
          <div className="flip-complete-info">
            {myWin && opponentWin ? (
              <span className="flip-result flip-result--split">Split Pot!</span>
            ) : myWin ? (
              <span className="flip-result flip-result--win">You win!</span>
            ) : opponentWin ? (
              <span className="flip-result flip-result--loss">Opponent wins</span>
            ) : null}
          </div>
        )}

        {isComplete && isHost && (
          <button type="button" className="btn primary flip-deal-again-btn" onClick={onDealAgain}>
            Deal Again
          </button>
        )}
        {isComplete && !isHost && (
          <span className="flip-waiting-text">Waiting for host to deal...</span>
        )}
      </div>

      {/* My section */}
      <div className={[
        'flip-player flip-player--me',
        isMyTurn ? 'flip-player--active' : '',
        isMeLead ? 'flip-player--lead' : '',
        isComplete && myWin ? 'flip-player--winner' : '',
      ].filter(Boolean).join(' ')}>
        <div className="flip-player__header">
          <span className="flip-player__name">
            {mySeatData?.displayName ?? 'You'}
          </span>
          <span className="flip-player__stack">{formatChips(mySeatData?.stack ?? 0)}</span>
          {isMyTurn && !isComplete && (
            <span className="flip-player__turn-badge">Your turn</span>
          )}
          {isMeLead && !isComplete && (
            <span className="flip-player__lead-badge lead">LEADING</span>
          )}
        </div>

        <div className="flip-player__hand-info">
          {myBestHand ? (
            <span className="flip-player__best-hand">{myBestHand}</span>
          ) : (
            <span className="flip-player__best-hand flip-player__best-hand--none">No cards revealed</span>
          )}
          {!isComplete && (
            <span className="flip-player__remaining">{myRemainingCount} remaining</span>
          )}
        </div>

        <div className="flip-card-area">
          <CardGrid
            cards={isComplete ? myShownCards : myCardsForDisplay}
            revealedCards={isComplete ? myShownCards : myRevealed}
            isMe={!isComplete}
            isActive={isMyTurn && !isComplete}
            justFlippedIdx={mySeatData ? (justFlipped[mySeatData.seatIndex] ?? null) : null}
          />
        </div>

        {canFlip && !isComplete && (
          <button
            type="button"
            className="btn primary flip-btn"
            onClick={() => onAction('flip_card')}
          >
            Flip Card
          </button>
        )}
      </div>
    </div>
  );
}
