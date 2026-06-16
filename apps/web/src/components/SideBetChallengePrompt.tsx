import type { SideBetChallenge } from '@vct/shared-types';
import { formatChips } from '../utils/formatChips';
import { sideBetTypeLabel } from '../utils/sideBetLabels';

interface Props {
  challenge: SideBetChallenge;
  onAccept: () => void;
  onDecline: () => void;
}

export function SideBetChallengePrompt({ challenge, onAccept, onDecline }: Props) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="sidebet-challenge-title">
      <div className="modal sidebet-modal">
        <h2 id="sidebet-challenge-title" className="modal-title">🎲 Side Bet Challenge</h2>
        <p className="modal-body">
          <strong>{challenge.challengerName}</strong> challenges you to a 1v1 side bet:
        </p>
        <div className="sidebet-summary">
          <div className="sidebet-summary-row">
            <span>Type</span>
            <strong>{sideBetTypeLabel(challenge.type, challenge.suit)}</strong>
          </div>
          <div className="sidebet-summary-row">
            <span>Wager</span>
            <strong>{formatChips(challenge.wager)}</strong>
          </div>
        </div>
        <p className="sidebet-fineprint">
          Decided on hole cards only, applied to the next hand, and settled after it ends.
          It never affects the pot.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn primary" onClick={onAccept}>Accept</button>
          <button type="button" className="btn" onClick={onDecline}>Decline</button>
        </div>
      </div>
    </div>
  );
}
