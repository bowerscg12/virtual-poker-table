import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Card, LegalAction, PlayerActionType, TableSeat } from '@vct/shared-types';
import { cardToString } from '@vct/shared-types';
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

  // Pineapple discard phase
  pineappleDiscardActive: boolean;
  pineappleDiscardDeadline?: string;
  onPineappleDiscard: (cardIndex: number) => void;

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
  pineappleDiscardActive,
  pineappleDiscardDeadline,
  onPineappleDiscard,
  showPotOdds,
}: Props) {
  const { t } = useTranslation();
  const announceRef = useRef<HTMLSpanElement>(null);

  const showBlindCards = isBlindThisHand && !cardsRevealed;

  // ── Pineapple discard state ──────────────────────────────
  // confirmIndex: card the player tapped/clicked, awaiting confirmation.
  // submittedIndex: card the player confirmed discarding (locks the UI until the phase ends).
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);
  const [submittedIndex, setSubmittedIndex] = useState<number | null>(null);
  const [discardSecs, setDiscardSecs] = useState(0);

  // Reset selection state whenever a new discard phase begins.
  useEffect(() => {
    setConfirmIndex(null);
    setSubmittedIndex(null);
  }, [pineappleDiscardDeadline]);

  // Countdown for the discard phase.
  useEffect(() => {
    if (!pineappleDiscardActive || !pineappleDiscardDeadline) return;
    const tick = () => {
      const secs = Math.max(0, Math.ceil((new Date(pineappleDiscardDeadline).getTime() - Date.now()) / 1000));
      setDiscardSecs(secs);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [pineappleDiscardActive, pineappleDiscardDeadline]);

  function confirmDiscard() {
    if (confirmIndex === null) return;
    setSubmittedIndex(confirmIndex);
    onPineappleDiscard(confirmIndex);
    setConfirmIndex(null);
  }

  const handLabel =
    showHandStrength &&
    !isDealingThisHand &&
    !isBlindThisHand &&
    !isFolded &&
    holeCards.length >= 2
      ? getHandStrengthLabel(holeCards, board, variant)
      : '';

  // Announce hole cards to screen readers when they are dealt
  useEffect(() => {
    if (!announceRef.current) return;
    if (holeCards.length < 2 || isDealingThisHand || isBlindThisHand) return;
    const cardNames = holeCards.map((c) => {
      const rankKey = c[0] as string;
      const suit = c[1] as string;
      const displayRank = rankKey === 'T' ? '10' : rankKey;
      return `${displayRank} ${t('cards.of')} ${t(`cards.suits.${suit}` as Parameters<typeof t>[0])}`;
    });
    announceRef.current.textContent = t('hero.holeCardsAnnouncement', { cards: cardNames.join(', ') });
  }, [holeCards, isDealingThisHand, isBlindThisHand, t]);

  return (
    <div className="hero-action-panel">
      {/* Visually-hidden live region for card announcements */}
      <span
        ref={announceRef}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />

      {/* Left column — YOUR CARDS */}
      <div className="hero-panel__cards">
        <span className="hero-panel__label">
          {pineappleDiscardActive ? (
            <span className={`pineapple-discard-label${discardSecs <= 5 ? ' urgent' : ''}`}>
              🍍 {submittedIndex !== null ? t('pineapple.discarded') : t('pineapple.discardOne')} · {discardSecs}s
            </span>
          ) : showBlindCards ? (
            <span className="blind-hand-badge blind-hand-badge--inline">BLIND</span>
          ) : (
            t('hero.yourCards')
          )}
        </span>
        <div className="hero-panel__cards-row">
          {pineappleDiscardActive ? (
            holeCards.map((card, index) => {
              const delayClass = dealDelayClasses[index as 0 | 1] ?? '';
              const dealClass = isDealingThisHand && delayClass ? `dealing ${delayClass}` : '';
              const locked = submittedIndex !== null;
              const isDiscarded = submittedIndex === index;
              const label = showBlindCards
                ? t('pineapple.discardThisCard')
                : t('pineapple.discardCard', { card: cardToString(card) });
              return (
                <div
                  key={index}
                  className={['card-anim-wrapper', dealClass].filter(Boolean).join(' ')}
                >
                  <button
                    type="button"
                    className={[
                      'pineapple-discardable',
                      locked ? 'locked' : '',
                      isDiscarded ? 'discarded' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => { if (!locked) setConfirmIndex(index); }}
                    disabled={locked}
                    aria-label={label}
                  >
                    {showBlindCards
                      ? <div className="playing-card back" aria-hidden="true" />
                      : <CardView card={card} faceUp />}
                    {!locked && <span className="discard-overlay">{t('pineapple.discard')}</span>}
                  </button>
                </div>
              );
            })
          ) : showBlindCards ? (
            holeCards.map((_, index) => {
              const delayClass = dealDelayClasses[index as 0 | 1] ?? '';
              const dealClass = isDealingThisHand && delayClass ? `dealing ${delayClass}` : '';
              return (
                <div
                  key={index}
                  className={['card-anim-wrapper', dealClass].filter(Boolean).join(' ')}
                >
                  <div className="playing-card back" aria-label={t('cards.faceDown')} />
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

        {pineappleDiscardActive && submittedIndex !== null && (
          <span className="hand-strength-label">{t('pineapple.waitingForOthers')}</span>
        )}

        {handLabel && !pineappleDiscardActive && (
          <span className="hand-strength-label">{handLabel}</span>
        )}

        <div className="hero-panel__meta">
          <span className="hero-panel__stack">{formatChips(seat.stack)}</span>
          {seat.waitingForReentryBlind ? (
            <span className="rebuy-pending-badge">{t('hero.waitingBigBlind')}</span>
          ) : rebuyQueued || rebuyClicked ? (
            <span className="rebuy-pending-badge">{t('hero.rebuyPending')}</span>
          ) : rebuyAvailable && rebuyDismissed ? (
            <div className="rebuy-bar">
              <button type="button" className="btn small primary" onClick={onRebuyClick}
                aria-label={t('hero.buyBackIn')}>
                {t('hero.buyBackIn')}
              </button>
              <button type="button" className="btn small" onClick={onLeaveTable}
                aria-label={t('hero.leaveTable')}>
                {t('hero.leaveTable')}
              </button>
            </div>
          ) : cashOutQueued ? (
            <div className="cash-out-queued-banner">
              <span>{t('hero.cashingOut')}</span>
              <button type="button" className="btn small" onClick={onCancelQueue}
                aria-label={t('hero.cancel')}>
                {t('hero.cancel')}
              </button>
            </div>
          ) : (
            <button type="button" className="btn cash-out-btn" onClick={onCashOutOpen}
              aria-label={t('hero.cashOut')}>
              {t('hero.cashOut')}
            </button>
          )}
          {showBlindCards && holeCards.length > 0 && (
            <button
              type="button"
              className="btn blind-reveal-btn"
              onClick={onRevealCards}
              aria-label={t('hero.revealMyCards')}
            >
              {t('hero.revealMyCards')}
            </button>
          )}
          {gameStarted && !rebuyAvailable && !seat.waitingForReentryBlind && !isBlindThisHand && (
            <button
              type="button"
              className={`btn sit-out-toggle${seat.nextHandBlind ? ' sit-out-toggle--active' : ''}`}
              onClick={() => onBlindHandToggle(!seat.nextHandBlind)}
              aria-label={seat.nextHandBlind ? t('hero.cancelBlind') : t('hero.playBlind')}
              aria-pressed={seat.nextHandBlind ? 'true' : 'false'}
            >
              {seat.nextHandBlind ? t('hero.cancelBlind') : t('hero.playBlind')}
            </button>
          )}
          {gameStarted && !rebuyAvailable && !seat.waitingForReentryBlind && (
            <button
              type="button"
              className={`btn sit-out-toggle${seat.sitOutNextHand ? ' sit-out-toggle--active' : ''}`}
              onClick={() => onSitOutToggle(!seat.sitOutNextHand)}
              aria-label={
                seat.sitOutNextHand
                  ? (seat.sitOutBlindOwed ? t('hero.cancelSitOut') : t('hero.resumePlay'))
                  : t('hero.sitOut')
              }
              aria-pressed={seat.sitOutNextHand ? 'true' : 'false'}
            >
              {seat.sitOutNextHand
                ? seat.sitOutBlindOwed ? t('hero.cancelSitOut') : t('hero.resumePlay')
                : t('hero.sitOut')}
            </button>
          )}
          {onDonateOpen && seat.stack > 0 && !rebuyAvailable && (
            <button type="button" className="btn donate-btn" onClick={onDonateOpen}
              aria-label={t('hero.donateChips')}>
              {t('hero.donateChips')}
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

      {confirmIndex !== null && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="pineapple-confirm-title">
          <div className="modal pineapple-confirm-modal">
            <h2 id="pineapple-confirm-title" className="modal-title">
              🍍 {showBlindCards
                ? t('pineapple.confirmDiscardBlind')
                : t('pineapple.confirmDiscard', { card: cardToString(holeCards[confirmIndex]) })}
            </h2>
            <div className="modal-actions bomb-pot-actions">
              <button type="button" className="btn primary" onClick={confirmDiscard}>
                {t('pineapple.discard')}
              </button>
              <button type="button" className="btn small" onClick={() => setConfirmIndex(null)}>
                {t('hero.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
