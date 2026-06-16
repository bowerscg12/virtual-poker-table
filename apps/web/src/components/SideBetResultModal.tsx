import type { SideBetResult } from '@vct/shared-types';
import { formatChips } from '../utils/formatChips';
import { sideBetTypeLabel } from '../utils/sideBetLabels';
import { CardView } from './CardView';

interface Props {
  result: SideBetResult;
  myUserId: string | null;
  onClose: () => void;
}

export function SideBetResultModal({ result, myUserId, onClose }: Props) {
  // Frame the modal from the viewer's perspective when they're a participant.
  const viewerIsChallenger = result.challenger.userId === myUserId;
  const me = viewerIsChallenger ? result.challenger : result.target;
  const opp = viewerIsChallenger ? result.target : result.challenger;
  const viewerIsParticipant =
    result.challenger.userId === myUserId || result.target.userId === myUserId;

  let outcomeText: string;
  let outcomeClass: string;
  if (result.push) {
    outcomeText = 'Push — wager returned';
    outcomeClass = 'sidebet-outcome--push';
  } else if (viewerIsParticipant) {
    const won = result.winnerUserId === me.userId;
    outcomeText = won ? `You won +${formatChips(result.payout)}` : `You lost -${formatChips(result.payout)}`;
    outcomeClass = won ? 'sidebet-outcome--win' : 'sidebet-outcome--loss';
  } else {
    const winnerName = result.winnerUserId === result.challenger.userId ? result.challenger.name : result.target.name;
    outcomeText = `${winnerName} won ${formatChips(result.payout)}`;
    outcomeClass = 'sidebet-outcome--win';
  }

  // Spectators (table-wide visibility) see challenger vs target; participants see You vs opponent.
  const top = viewerIsParticipant ? me : result.challenger;
  const bottom = viewerIsParticipant ? opp : result.target;
  const topLabel = viewerIsParticipant ? 'You' : top.name;
  const bottomLabel = viewerIsParticipant ? opp.name : bottom.name;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="sidebet-result-title">
      <div className="modal sidebet-modal">
        <h2 id="sidebet-result-title" className="modal-title">🎲 Side Bet Result</h2>
        <p className="sidebet-result-type">{sideBetTypeLabel(result.type, result.suit)}</p>

        <div className="sidebet-result-side">
          <div className="sidebet-result-name">{topLabel} <span className="sidebet-result-value">({top.value})</span></div>
          <div className="sidebet-result-cards">
            {top.cards.map((c, i) => <CardView key={i} card={c} faceUp />)}
          </div>
        </div>

        <div className="sidebet-result-vs">vs</div>

        <div className="sidebet-result-side">
          <div className="sidebet-result-name">{bottomLabel} <span className="sidebet-result-value">({bottom.value})</span></div>
          <div className="sidebet-result-cards">
            {bottom.cards.map((c, i) => <CardView key={i} card={c} faceUp />)}
          </div>
        </div>

        <p className={`sidebet-outcome ${outcomeClass}`}>{outcomeText}</p>

        <div className="modal-actions">
          <button type="button" className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
