import type { Card, LegalAction, PlayerActionType, TableSeat } from '@vct/shared-types';
import { CardView } from './CardView';
import { ActionBar } from './ActionBar';
import { formatChips } from '../utils/formatChips';

interface Props {
  // Cards
  holeCards: Card[];
  isDealingThisHand: boolean;
  dealDelayClasses: [string, string];

  // Actions
  legalActions: LegalAction[];
  pot: number;
  currentBet: number;
  limit?: string;
  onAction: (action: PlayerActionType, amount?: number) => void;

  // Seat meta
  seat: TableSeat;
  gameStarted: boolean;
  cashOutQueued: boolean;
  rebuyAvailable: boolean;
  rebuyQueued: boolean;
  rebuyClicked: boolean;
  rebuyDismissed: boolean;
  onCashOutOpen: () => void;
  onRebuyClick: () => void;
  onLeaveTable: () => void;
  onSitOutToggle: (enabled: boolean) => void;

  // Host quick controls
  isHost: boolean;
  lobbyStatus?: string;
  onHostStart: () => void;
  onHostPause: (paused: boolean) => void;
}

export function HeroActionPanel({
  holeCards,
  isDealingThisHand,
  dealDelayClasses,
  legalActions,
  pot,
  currentBet,
  limit,
  onAction,
  seat,
  gameStarted,
  cashOutQueued,
  rebuyAvailable,
  rebuyQueued,
  rebuyClicked,
  rebuyDismissed,
  onCashOutOpen,
  onRebuyClick,
  onLeaveTable,
  onSitOutToggle,
  isHost,
  lobbyStatus,
  onHostStart,
  onHostPause,
}: Props) {
  return (
    <div className="hero-action-panel">
      {/* Left column — YOUR CARDS */}
      <div className="hero-panel__cards">
        <span className="hero-panel__label">Your Cards</span>
        <div className="hero-panel__cards-row">
          {holeCards.map((card, index) => {
            const delayClass = dealDelayClasses[index as 0 | 1] ?? '';
            const dealClass = isDealingThisHand && delayClass ? `dealing ${delayClass}` : '';
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
        <div className="hero-panel__meta">
          <span className="hero-panel__stack">{formatChips(seat.stack)}</span>
          {seat.waitingForReentryBlind ? (
            <span className="rebuy-pending-badge">Waiting for Big Blind...</span>
          ) : rebuyQueued || rebuyClicked ? (
            <span className="rebuy-pending-badge">Rebuy pending...</span>
          ) : rebuyAvailable && rebuyDismissed ? (
            <div className="rebuy-bar">
              <button type="button" className="btn small primary" onClick={onRebuyClick}>
                Buy Back In
              </button>
              <button type="button" className="btn small" onClick={onLeaveTable}>
                Leave Table
              </button>
            </div>
          ) : (
            <button type="button" className="btn small cash-out-btn" onClick={onCashOutOpen}>
              {cashOutQueued ? 'Queued' : 'Cash Out'}
            </button>
          )}
          {gameStarted && !rebuyAvailable && !seat.waitingForReentryBlind && (
            <button
              type="button"
              className={`btn small sit-out-toggle${seat.sitOutNextHand ? ' sit-out-toggle--active' : ''}`}
              onClick={() => onSitOutToggle(!seat.sitOutNextHand)}
            >
              {seat.sitOutNextHand
                ? seat.sitOutBlindOwed ? 'Cancel Sit Out' : 'Resume Play'
                : 'Sit Out'}
            </button>
          )}
        </div>
      </div>

      {/* Right column — ACTIONS */}
      <div className="hero-panel__actions">
        {isHost && (
          <div className="hero-panel__host">
            {!gameStarted && (
              <button type="button" className="btn small primary" onClick={onHostStart}>
                Start
              </button>
            )}
            {gameStarted && lobbyStatus === 'paused' && (
              <button
                type="button"
                className="btn small primary"
                onClick={() => onHostPause(false)}
              >
                Resume
              </button>
            )}
            {gameStarted && lobbyStatus === 'playing' && (
              <button type="button" className="btn small" onClick={() => onHostPause(true)}>
                Pause
              </button>
            )}
          </div>
        )}
        {legalActions.length > 0 && (
          <ActionBar
            legalActions={legalActions}
            pot={pot}
            currentBet={currentBet}
            limit={limit}
            onAction={onAction}
          />
        )}
      </div>
    </div>
  );
}
