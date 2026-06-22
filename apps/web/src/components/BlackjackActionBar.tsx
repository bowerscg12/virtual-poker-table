import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  BlackjackLegalAction,
  PublicBlackjackPlayer,
  PublicBlackjackState,
  VariantConfig,
} from '@vct/shared-types';
import { formatChips } from '../utils/formatChips';
import { BetChips } from './BetChips';
import { useActionTimer } from '../hooks/useActionTimer';

const CHIP_DENOMS = [5, 25, 100, 500, 1000];

/** Convert a Unix-ms deadline into the ISO string that useActionTimer expects. */
function iso(ms: number | undefined): string | undefined {
  return ms ? new Date(ms).toISOString() : undefined;
}

/** Small countdown pill shown above the action buttons. */
function Countdown({ deadline }: { deadline: number | undefined }) {
  const remaining = useActionTimer(iso(deadline));
  if (remaining === null) return null;
  const urgent = remaining <= 10;
  return (
    <div className={`bj-countdown${urgent ? ' bj-countdown--urgent' : ''}`} aria-live="off">
      {remaining}s
    </div>
  );
}

interface Props {
  state: PublicBlackjackState;
  me: PublicBlackjackPlayer;
  legalActions: BlackjackLegalAction[];
  config: VariantConfig;
  onPlaceBet: (amount: number) => void;
  onClearBet: () => void;
  onHit: (handId: string) => void;
  onStand: (handId: string) => void;
  onDouble: (handId: string) => void;
  onSplit: (handId: string) => void;
  onSurrender: (handId: string) => void;
  onInsurance: (amount: number) => void;
  onEvenMoney: () => void;
}

export function BlackjackActionBar({
  state,
  me,
  legalActions,
  config,
  onPlaceBet,
  onClearBet,
  onHit,
  onStand,
  onDouble,
  onSplit,
  onSurrender,
  onInsurance,
  onEvenMoney,
}: Props) {
  const { t } = useTranslation();
  const [stagedBet, setStagedBet] = useState(0);
  const phase = state.phase;

  const minBet = config.blackjackMinBet ?? 5;
  const maxBet = config.blackjackMaxBet ?? 500;
  const isMyTurn = state.players[state.activePlayerIndex]?.userId === me.userId;

  // ── Insurance window ─────────────────────────────────────────────────────────
  if (phase === 'insurance') {
    const mainWager = me.hands[0]?.wager ?? 0;
    const cost = Math.floor(mainWager / 2);
    const canEvenMoney = me.hands[0]?.isBlackjack === true;
    const decided = me.insuranceActed === true || me.status !== 'waiting';

    return (
      <div className="bj-action-bar bj-action-bar--insurance" aria-live="polite">
        <Countdown deadline={state.insuranceDeadline} />
        {decided ? (
          <span className="bj-insurance-waiting">{t('blackjack.insuranceWaiting', { defaultValue: 'Waiting for other players…' })}</span>
        ) : (
          <>
            <span className="bj-insurance-prompt">
              {t('blackjack.insuranceOffer', { defaultValue: 'Dealer shows an Ace — Insurance?' })}
            </span>
            <div className="bj-play-buttons">
              {canEvenMoney ? (
                <>
                  <button className="btn primary" onClick={onEvenMoney}
                    aria-label={t('blackjack.evenMoney', { defaultValue: 'Even Money' })}>
                    {t('blackjack.evenMoney', { defaultValue: 'Even Money' })}
                  </button>
                  <button className="btn" onClick={() => onInsurance(0)}>
                    {t('blackjack.declineEvenMoney', { defaultValue: 'Decline' })}
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn bj-btn-double"
                    onClick={() => onInsurance(cost)}
                    disabled={cost <= 0 || cost > me.stack}
                    aria-label={t('blackjack.takeInsurance', { defaultValue: 'Insurance' })}
                  >
                    {t('blackjack.insurance')} ({formatChips(cost)})
                  </button>
                  <button className="btn" onClick={() => onInsurance(0)}
                    aria-label={t('blackjack.declineInsurance', { defaultValue: 'No Insurance' })}>
                    {t('blackjack.declineInsurance', { defaultValue: 'No Insurance' })}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Betting phase ──────────────────────────────────────────────────────────
  if (phase === 'waiting_for_bets') {
    const myStack = me.stack;
    const myPendingBet = me.pendingBet;

    function addChip(denom: number) {
      setStagedBet((prev) => Math.min(prev + denom, maxBet, myStack));
    }
    function clear() {
      setStagedBet(0);
    }
    function confirmBet() {
      if (stagedBet < minBet || stagedBet > myStack) return;
      onPlaceBet(stagedBet);
      setStagedBet(0);
    }
    const canConfirm = stagedBet >= minBet && stagedBet <= myStack;

    return (
      <div className="bj-action-bar">
        <Countdown deadline={state.betDeadline} />
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
              {stagedBet > 0 && <BetChips amount={stagedBet} className="bj-staged-chips" />}
              <span>
                {t('blackjack.bet')}: <strong>{formatChips(stagedBet)}</strong>
                {myPendingBet > 0 && (
                  <span className="bj-confirmed-bet"> ({t('blackjack.confirmed')}: {formatChips(myPendingBet)})</span>
                )}
              </span>
            </div>
            <div className="bj-bet-actions">
              <button className="btn" onClick={clear} disabled={stagedBet === 0}
                aria-label={t('blackjack.clear')}>
                {t('blackjack.clear')}
              </button>
              <button className="btn primary" onClick={confirmBet} disabled={!canConfirm}
                aria-label={t('blackjack.placeBet')}>
                {t('blackjack.placeBet')}
              </button>
              {myPendingBet > 0 && (
                <button className="btn" onClick={onClearBet} aria-label={t('blackjack.cancelBet')}>
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
  if (phase === 'player_turn' && isMyTurn && legalActions.length > 0) {
    const handId = legalActions[0]!.handId;
    const types = new Set(legalActions.map((a) => a.type));

    return (
      <div className="bj-action-bar">
        <Countdown deadline={state.actionDeadline} />
        <div className="bj-play-buttons bj-play-buttons--segmented">
          {types.has('hit') && (
            <button className="btn bj-btn-hit" onClick={() => onHit(handId)} aria-label={t('blackjack.hit')}>
              {t('blackjack.hit')}
            </button>
          )}
          {types.has('stand') && (
            <button className="btn bj-btn-stand" onClick={() => onStand(handId)} aria-label={t('blackjack.stand')}>
              {t('blackjack.stand')}
            </button>
          )}
          {types.has('double_down') && (
            <button className="btn bj-btn-double" onClick={() => onDouble(handId)} aria-label={t('blackjack.doubleDown')}>
              {t('blackjack.doubleDown')}
            </button>
          )}
          {types.has('split') && (
            <button className="btn bj-btn-split" onClick={() => onSplit(handId)} aria-label={t('blackjack.split')}>
              {t('blackjack.split')}
            </button>
          )}
          {types.has('surrender') && (
            <button className="btn bj-btn-disabled" onClick={() => onSurrender(handId)}
              aria-label={t('blackjack.surrender')}>
              {t('blackjack.surrender')}
            </button>
          )}
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
