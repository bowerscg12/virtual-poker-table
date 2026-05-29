import type { Card } from '@vct/shared-types';
import type { LobbySummary, PublicTableState } from '@vct/shared-types';
import { CardView } from './CardView';
import { ChipStack } from './ChipStack';

interface Props {
  lobby: LobbySummary | null;
  table: PublicTableState | null;
  privateHoleCards?: Card[];
  myUserId?: string;
}

export function PokerTable({ lobby, table, privateHoleCards, myUserId }: Props) {
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

  return (
    <div className="felt" role="region" aria-label="Poker table">
      <div className="pot-area">
        {table && table.pots.length > 0 ? (
          <div className="pot">Pot: {table.pots.reduce((s, p) => s + p.amount, 0).toLocaleString()}</div>
        ) : (
          <div className="pot">Waiting for hand</div>
        )}
        <div className="board">
          {table?.board.map((c, i) => (
            <CardView key={i} card={c} faceUp />
          ))}
          {table && table.board.length === 0 && table.street !== 'waiting' && (
            <span className="street">{table.street}</span>
          )}
        </div>
      </div>

      <ul className="seats">
        {seats.map((seat, i) => {
          const gs = table?.seats.find((s) => s.seatIndex === seat.seatIndex);
          const stack = gs?.stack ?? seat.stack;
          const occupied = !!seat.userId;
          const isMe = seat.userId === myUserId;
          const isActor = table?.actionSeatIndex === seat.seatIndex;
          const x = 50 + 42 * Math.cos(angleStep * i - Math.PI / 2);
          const y = 50 + 38 * Math.sin(angleStep * i - Math.PI / 2);

          return (
            <li
              key={seat.seatIndex}
              className={`seat ${occupied ? 'occupied' : 'empty'} ${isActor ? 'acting' : ''} ${gs?.folded ? 'folded' : ''} ${isMe ? 'me' : ''}`}
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <div className="seat-info">
                <strong>{seat.displayName ?? (occupied ? 'Player' : `Seat ${seat.seatIndex + 1}`)}</strong>
                {occupied && stack > 0 && <ChipStack amount={stack} />}
                {!occupied && <span className="seat-empty-label">Open</span>}
                {gs?.betThisStreet ? (
                  <span className="bet">Bet: {gs.betThisStreet.toLocaleString()}</span>
                ) : null}
              </div>
              <div className="hole-cards">
                {!isMe && gs && !gs.folded && table?.street !== 'complete' && occupied && (
                  <>
                    <div className="playing-card back" />
                    <div className="playing-card back" />
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
            {privateHoleCards.map((card, index) => (
              <CardView key={index} card={card} faceUp />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
