import type { Card } from '@vct/shared-types';
import type { LobbySummary, PublicTableState } from '@vct/shared-types';
import { CardView } from './CardView';

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
          <div className="pot">Pot: {table.pots.reduce((s, p) => s + p.amount, 0)}</div>
        ) : (
          <div className="pot">Waiting for hand</div>
        )}
        <div className="board">
          {table?.board.map((c, i) => (
            <CardView key={i} card={c} faceUp />
          ))}
          {table && table.board.length === 0 && <span className="street">{table.street}</span>}
        </div>
      </div>

      <ul className="seats">
        {seats.map((seat, i) => {
          const gs = table?.seats.find((s) => s.seatIndex === seat.seatIndex);
          const isMe = seat.userId === myUserId;
          const isActor = table?.actionSeatIndex === seat.seatIndex;
          const x = 50 + 42 * Math.cos(angleStep * i - Math.PI / 2);
          const y = 50 + 38 * Math.sin(angleStep * i - Math.PI / 2);

          return (
            <li
              key={seat.seatIndex}
              className={`seat ${isActor ? 'acting' : ''} ${gs?.folded ? 'folded' : ''}`}
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <div className="seat-info">
                <strong>{seat.displayName ?? `Seat ${seat.seatIndex + 1}`}</strong>
                <span>{gs?.stack ?? seat.stack} chips</span>
                {gs?.betThisStreet ? <span className="bet">Bet: {gs.betThisStreet}</span> : null}
              </div>
              <div className="hole-cards">
                {isMe && privateHoleCards?.map((c, j) => <CardView key={j} card={c} faceUp />)}
                {!isMe && gs && !gs.folded && table?.street !== 'complete' && (
                  <>
                    <div className="card back" />
                    <div className="card back" />
                  </>
                )}
                {gs?.shownCards?.map((c, j) => <CardView key={j} card={c} faceUp />)}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
