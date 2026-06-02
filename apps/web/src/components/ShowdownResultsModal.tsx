import type { ShowdownResult } from '@vct/shared-types';
import { CardView } from './CardView';
import { formatChips } from '../utils/formatChips';

interface Props {
  result: ShowdownResult;
  onClose: () => void;
}

export function ShowdownResultsModal({ result, onClose }: Props) {
  const { hands, isSplit } = result;
  const winners = hands.filter((h) => h.isWinner);
  const losers = hands.filter((h) => !h.isWinner);

  return (
    <div className="modal-overlay showdown-overlay" onClick={onClose}>
      <div
        className="modal showdown-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="modal-title showdown-modal__title">
          {isSplit ? 'Split Pot' : 'Showdown'}
        </h2>

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
                  <CardView key={i} card={card} faceUp className="showdown-modal__card" />
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

        <div className="modal-actions">
          <button type="button" className="btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
