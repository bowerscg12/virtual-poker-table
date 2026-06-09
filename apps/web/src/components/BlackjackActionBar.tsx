import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BlackjackLegalAction, BlackjackPhase, VariantConfig } from '@vct/shared-types';
import { formatChips } from '../utils/formatChips';

const CHIP_DENOMS = [5, 25, 100, 500, 1000];

interface Props {
  phase: BlackjackPhase;
  legalActions: BlackjackLegalAction[];
  myStack: number;
  myPendingBet: number;
  config: VariantConfig;
  onPlaceBet: (amount: number) => void;
  onClearBet: () => void;
  onHit: (handId: string) => void;
  onStand: (handId: string) => void;
  onDouble: (handId: string) => void;
  onSplit: (handId: string) => void;
}

export function BlackjackActionBar({
  phase,
  legalActions,
  myStack,
  myPendingBet,
  config,
  onPlaceBet,
  onClearBet,
  onHit,
  onStand,
  onDouble,
  onSplit,
}: Props) {
  const { t } = useTranslation();
  const [stagedBet, setStagedBet] = useState(0);

  const minBet = config.blackjackMinBet ?? 5;
  const maxBet = config.blackjackMaxBet ?? 500;

  // ── Betting phase ──────────────────────────────────────────────────────────
  if (phase === 'waiting_for_bets') {
    function addChip(denom: number) {
      const next = Math.min(stagedBet + denom, maxBet, myStack);
      setStagedBet(next);
    }

    function clear() {
      setStagedBet(0);
    }

    function confirmBet() {
      if (stagedBet < minBet) return;
      onPlaceBet(stagedBet);
      setStagedBet(0);
    }

    const canConfirm = stagedBet >= minBet && stagedBet <= myStack;

    return (
      <div className="bj-action-bar">
        <div className="bj-bet-area">
          <div className="bj-chip-buttons">
            {CHIP_DENOMS.map((d) => (
              <button
                key={d}
                className="bj-chip-btn"
                onClick={() => addChip(d)}
                disabled={stagedBet + d > maxBet || stagedBet >= myStack}
                aria-label={t('blackjack.addChip', { amount: formatChips(d) })}
              >
                {formatChips(d)}
              </button>
            ))}
          </div>
          <div className="bj-bet-controls">
            <div className="bj-bet-display">
              {t('blackjack.bet')}: <strong>{formatChips(stagedBet)}</strong>
              {myPendingBet > 0 && (
                <span className="bj-confirmed-bet"> ({t('blackjack.confirmed')}: {formatChips(myPendingBet)})</span>
              )}
            </div>
            <div className="bj-bet-actions">
              <button className="btn" onClick={clear} disabled={stagedBet === 0}
                aria-label={t('blackjack.clear')}>
                {t('blackjack.clear')}
              </button>
              <button
                className="btn primary"
                onClick={confirmBet}
                disabled={!canConfirm}
                aria-label={t('blackjack.placeBet')}
              >
                {t('blackjack.placeBet')}
              </button>
              {myPendingBet > 0 && (
                <button className="btn" onClick={onClearBet}
                  aria-label={t('blackjack.cancelBet')}>
                  {t('blackjack.cancelBet')}
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="bj-limits">
          {t('blackjack.limits', { min: formatChips(minBet), max: formatChips(maxBet) })}
        </div>
      </div>
    );
  }

  // ── Player turn ────────────────────────────────────────────────────────────
  if (phase === 'player_turn' && legalActions.length > 0) {
    const handId = legalActions[0]!.handId;
    const types = new Set(legalActions.map((a) => a.type));

    return (
      <div className="bj-action-bar">
        <div className="bj-play-buttons">
          {types.has('hit') && (
            <button className="btn bj-btn-hit" onClick={() => onHit(handId)}
              aria-label={t('blackjack.hit')}>
              {t('blackjack.hit')}
            </button>
          )}
          {types.has('stand') && (
            <button className="btn bj-btn-stand" onClick={() => onStand(handId)}
              aria-label={t('blackjack.stand')}>
              {t('blackjack.stand')}
            </button>
          )}
          {types.has('double_down') && (
            <button className="btn bj-btn-double" onClick={() => onDouble(handId)}
              aria-label={t('blackjack.doubleDown')}>
              {t('blackjack.doubleDown')}
            </button>
          )}
          {types.has('split') && (
            <button className="btn bj-btn-split" onClick={() => onSplit(handId)}
              aria-label={t('blackjack.split')}>
              {t('blackjack.split')}
            </button>
          )}
          {/* Stubs for future actions */}
          <button className="btn bj-btn-disabled" disabled title="Coming soon"
            aria-label={t('blackjack.insurance')} aria-disabled="true">
            {t('blackjack.insurance')}
          </button>
          <button className="btn bj-btn-disabled" disabled title="Coming soon"
            aria-label={t('blackjack.surrender')} aria-disabled="true">
            {t('blackjack.surrender')}
          </button>
        </div>
      </div>
    );
  }

  // ── Waiting / dealing / dealer turn / settlement ───────────────────────────
  return (
    <div className="bj-action-bar bj-action-bar--waiting" aria-live="polite" aria-atomic="true">
      {phase === 'dealing' && <span>{t('blackjack.dealing')}</span>}
      {phase === 'player_turn' && <span>{t('blackjack.waitingTurn')}</span>}
      {phase === 'dealer_turn' && <span>{t('blackjack.dealerPlaying')}</span>}
      {phase === 'settlement' && <span>{t('blackjack.settlingBets')}</span>}
      {phase === 'round_complete' && <span>{t('blackjack.nextRound')}</span>}
    </div>
  );
}
