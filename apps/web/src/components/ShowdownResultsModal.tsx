import { useEffect, useState } from 'react';
import type { Card, ShowdownHandEntry, ShowdownResult } from '@vct/shared-types';
import { CardView } from './CardView';
import { formatChips } from '../utils/formatChips';

interface Props {
  result: ShowdownResult;
  onClose: () => void;
}

const AUTO_CLOSE_SEC = 5;

function BoardSection({
  label,
  board,
  hands,
  winnersOnly = false,
}: {
  label?: string;
  board?: Card[];
  hands: ShowdownHandEntry[];
  winnersOnly?: boolean;
}) {
  const winners = hands.filter((h) => h.isWinner);
  const losers = winnersOnly ? [] : hands.filter((h) => !h.isWinner);

  return (
    <div className="showdown-modal__board-section">
      {label && <h3 className="showdown-modal__board-label">{label}</h3>}
      {board && board.length > 0 && (
        <div className="showdown-modal__community">
          {board.map((card, i) => (
            <CardView key={i} card={card} faceUp className="showdown-modal__card showdown-modal__card--small" />
          ))}
        </div>
      )}

      <div className="showdown-modal__winners">
        {winners.map((w) => (
          <div key={w.seatIndex} className="showdown-modal__winner-row">
            <div className="showdown-modal__winner-header">
              <span className="showdown-modal__trophy">🏆</span>
              <span className="showdown-modal__player-name">{w.displayName}</span>
              <span className="showdown-modal__pot-won">+{formatChips(w.potWon)}</span>
            </div>
            <p className="showdown-modal__hand-desc">{w.handDescription}</p>
            <div className="showdown-modal__cards">
              {w.bestFive.map((card, i) => (
                <CardView key={i} card={card} faceUp className="showdown-modal__card showdown-modal__card--small" />
              ))}
            </div>
          </div>
        ))}
      </div>

      {losers.length > 0 && (
        <div className="showdown-modal__losers">
          <p className="showdown-modal__losers-label">Other hands</p>
          {losers.map((h) => (
            <div key={h.seatIndex} className="showdown-modal__loser-row">
              <div className="showdown-modal__loser-header">
                <span className="showdown-modal__player-name showdown-modal__player-name--loser">
                  {h.displayName}
                </span>
                {h.chipsReturned !== undefined && h.chipsReturned > 0 && (
                  <span className="showdown-modal__chips-returned">+{formatChips(h.chipsReturned)} returned</span>
                )}
                <span className="showdown-modal__hand-desc showdown-modal__hand-desc--small">
                  {h.handDescription}
                </span>
              </div>
              <div className="showdown-modal__cards showdown-modal__cards--small">
                {h.bestFive.map((card, i) => (
                  <CardView key={i} card={card} faceUp className="showdown-modal__card showdown-modal__card--small" />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ShowdownResultsModal({ result, onClose }: Props) {
  const { hands, isSplit, soloWinner, secondBoard, secondHands, runoutBoards } = result;
  const isDoubleBoard = !!secondHands;
  const isMultiRunout = !!runoutBoards && runoutBoards.length > 1;
  const autoClose = isDoubleBoard || isMultiRunout;
  const [countdown, setCountdown] = useState(AUTO_CLOSE_SEC);

  useEffect(() => {
    if (!autoClose) return;
    const id = setTimeout(onClose, AUTO_CLOSE_SEC * 1000);
    return () => clearTimeout(id);
  }, [autoClose, onClose]);

  useEffect(() => {
    if (!autoClose || countdown <= 0) return;
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [autoClose, countdown]);

  const aWinners = hands.filter((h) => h.isWinner);
  const bWinners = secondHands?.filter((h) => h.isWinner) ?? [];
  const isScooped =
    isDoubleBoard &&
    aWinners.length === 1 &&
    bWinners.length === 1 &&
    aWinners[0].seatIndex === bWinners[0].seatIndex;

  const numRuns = runoutBoards?.length ?? 0;
  const multiRunoutLabel = numRuns === 2 ? 'Run Twice' : numRuns === 3 ? 'Run Three Times' : 'Multi-Runout';

  const title = isMultiRunout
    ? isSplit
      ? `Split Pot — ${multiRunoutLabel}`
      : soloWinner
      ? `${soloWinner} Wins!`
      : multiRunoutLabel
    : isDoubleBoard
    ? isScooped
      ? `${aWinners[0].displayName} Scooped Both Boards!`
      : 'Double Board Bomb Pot'
    : isSplit
    ? 'Split Pot'
    : soloWinner
    ? `${soloWinner} Wins!`
    : 'Showdown';

  return (
    <div className="modal-overlay showdown-overlay" onClick={onClose}>
      <div className="modal showdown-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title showdown-modal__title">{title}</h2>

        <div className="showdown-modal__scroll-body">
          {isMultiRunout ? (
            <div className="showdown-modal__boards">
              {runoutBoards!.map((rb, i) => (
                <BoardSection
                  key={i}
                  label={`Run ${i + 1}`}
                  board={rb.board}
                  hands={rb.hands}
                  winnersOnly
                />
              ))}
            </div>
          ) : isDoubleBoard ? (
            <div className="showdown-modal__boards">
              <BoardSection label="Board A" board={result.board} hands={hands} winnersOnly />
              <BoardSection label="Board B" board={secondBoard} hands={secondHands!} winnersOnly />
            </div>
          ) : (
            <BoardSection hands={hands} />
          )}
        </div>

        <div className="showdown-modal__footer">
          {autoClose && (
            <span className="showdown-modal__countdown">Closing in {countdown}s…</span>
          )}
          <button type="button" className="btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
