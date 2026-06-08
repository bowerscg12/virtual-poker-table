import type { Card, LegalAction, PlayerActionType, TableSeat } from '@vct/shared-types';
import { CardView } from './CardView';
import { ActionBar } from './ActionBar';
import { formatChips } from '../utils/formatChips';
import { getHandStrengthLabel } from '../utils/handStrength';

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
  onCancelQueue: () => void;
  onRebuyClick: () => void;
  onLeaveTable: () => void;
  onSitOutToggle: (enabled: boolean) => void;
  onDonateOpen?: () => void;

  // Blind hand
  isBlindThisHand: boolean;
  cardsRevealed: boolean;
  onRevealCards: () => void;
  onBlindHandToggle: (enabled: boolean) => void;

  // Hand strength indicator
  showHandStrength: boolean;
  board: Card[];
  variant: string;
  isFolded: boolean;

  // Settings pass-through
  showPotOdds: boolean;
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
  onCancelQueue,
  onRebuyClick,
  onLeaveTable,
  onSitOutToggle,
  onDonateOpen,
  isBlindThisHand,
  cardsRevealed,
  onRevealCards,
  onBlindHandToggle,
  showHandStrength,
  board,
  variant,
  isFolded,
  showPotOdds,
}: Props) {
  const showBlindCards = isBlindThisHand && !cardsRevealed;

  const handLabel =
    showHandStrength &&
    !isDealingThisHand &&
    !isBlindThisHand &&
    !isFolded &&
    holeCards.length >= 2
      ? getHandStrengthLabel(holeCards, board, variant)
      : '';

  return (
    <div className="hero-action-panel">
      {/* Left column — YOUR CARDS */}
      <div className="hero-panel__cards">
        <span className="hero-panel__label">
          {showBlindCards ? <span className="blind-hand-badge blind-hand-badge--inline">BLIND</span> : 'Your Cards'}
        </span>
        <div className="hero-panel__cards-row">
          {showBlindCards ? (
            holeCards.map((_, index) => {
              const delayClass = dealDelayClasses[index as 0 | 1] ?? '';
              const dealClass = isDealingThisHand && delayClass ? `dealing ${delayClass}` : '';
              return (
                <div
                  key={index}
                  className={['card-anim-wrapper', dealClass].filter(Boolean).join(' ')}
                >
                  <div className="playing-card back" />
                </div>
              );
            })
          ) : (
            holeCards.map((card, index) => {
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
            })
          )}
        </div>

        {handLabel && (
          <span className="hand-strength-label">{handLabel}</span>
        )}

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
          ) : cashOutQueued ? (
            <div className="cash-out-queued-banner">
              <span>Cashing out after this hand</span>
              <button type="button" className="btn small" onClick={onCancelQueue}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="btn cash-out-btn" onClick={onCashOutOpen}>
              Cash Out
            </button>
          )}
          {showBlindCards && holeCards.length > 0 && (
            <button
              type="button"
              className="btn blind-reveal-btn"
              onClick={onRevealCards}
            >
              Reveal My Cards
            </button>
          )}
          {gameStarted && !rebuyAvailable && !seat.waitingForReentryBlind && !isBlindThisHand && (
            <button
              type="button"
              className={`btn sit-out-toggle${seat.nextHandBlind ? ' sit-out-toggle--active' : ''}`}
              onClick={() => onBlindHandToggle(!seat.nextHandBlind)}
            >
              {seat.nextHandBlind ? 'Cancel Blind' : 'Play Next Hand Blind'}
            </button>
          )}
          {gameStarted && !rebuyAvailable && !seat.waitingForReentryBlind && (
            <button
              type="button"
              className={`btn sit-out-toggle${seat.sitOutNextHand ? ' sit-out-toggle--active' : ''}`}
              onClick={() => onSitOutToggle(!seat.sitOutNextHand)}
            >
              {seat.sitOutNextHand
                ? seat.sitOutBlindOwed ? 'Cancel Sit Out' : 'Resume Play'
                : 'Sit Out'}
            </button>
          )}
          {onDonateOpen && seat.stack > 0 && !rebuyAvailable && (
            <button type="button" className="btn donate-btn" onClick={onDonateOpen}>
              Donate Chips
            </button>
          )}
        </div>
      </div>

      {/* Right column — ACTIONS */}
      <div className="hero-panel__actions">
        {legalActions.length > 0 && (
          <ActionBar
            legalActions={legalActions}
            pot={pot}
            currentBet={currentBet}
            limit={limit}
            onAction={onAction}
            showPotOdds={showPotOdds}
          />
        )}
      </div>
    </div>
  );
}
