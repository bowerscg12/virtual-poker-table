import type {
  BlackjackLegalAction,
  BlackjackRoundPlayerResult,
  ChatMessage,
  ClientMessage,
  LobbySummary,
  PublicBlackjackPlayer,
  PublicBlackjackState,
  VariantConfig,
} from '@vct/shared-types';
import { useTranslation } from 'react-i18next';
import { CardView } from './CardView';
import { AvatarSvg } from './AvatarSvg';
import { BlackjackActionBar } from './BlackjackActionBar';
import { formatChips } from '../utils/formatChips';

// ── Hand-total badge ───────────────────────────────────────────────────────────

function TotalBadge({ total, isSoft, isBust, isBlackjack }: {
  total?: number; isSoft?: boolean; isBust?: boolean; isBlackjack?: boolean;
}) {
  const { t } = useTranslation();
  if (!total) return null;
  if (isBlackjack) return (
    <span className="bj-total bj-total--bj" aria-label={t('blackjack.handTotal.bj')}>BJ</span>
  );
  if (isBust) return (
    <span className="bj-total bj-total--bust" aria-label={t('blackjack.handTotal.bust')}>
      {t('blackjack.handTotal.bust')}
    </span>
  );
  const label = isSoft ? `S${total}` : `${total}`;
  const ariaLabel = isSoft ? t('blackjack.handTotal.soft', { total }) : `${total}`;
  const cls = total === 21 ? 'bj-total--21' : total > 16 ? 'bj-total--good' : '';
  return <span className={`bj-total ${cls}`} aria-label={ariaLabel}>{label}</span>;
}

// ── Status label ──────────────────────────────────────────────────────────────

function StatusLabel({ status, isActive }: { status: PublicBlackjackPlayer['status']; isActive: boolean }) {
  const { t } = useTranslation();
  if (isActive) return <span className="bj-status bj-status--acting">{t('blackjack.status.acting')}</span>;
  if (status === 'betting') return <span className="bj-status">{t('blackjack.status.betting')}</span>;
  if (status === 'waiting') return <span className="bj-status bj-status--waiting">{t('blackjack.status.waiting')}</span>;
  if (status === 'sitting_out') return <span className="bj-status bj-status--out">{t('blackjack.status.sittingOut')}</span>;
  return null;
}

// ── Hand result overlay ───────────────────────────────────────────────────────

function HandResult({ result, payout }: { result?: string; payout?: number }) {
  const { t } = useTranslation();
  if (!result) return null;
  const resultKey = result as 'win' | 'loss' | 'push' | 'blackjack';
  const label = t(`blackjack.result.${resultKey}` as Parameters<typeof t>[0], { defaultValue: result });
  const cls = `bj-hand-result bj-hand-result--${result}`;
  return (
    <div className={cls} role="status" aria-label={label}>
      <div>{label}</div>
      {payout !== undefined && payout > 0 && (
        <div className="bj-hand-payout">+{formatChips(payout)}</div>
      )}
    </div>
  );
}

// ── Player seat ───────────────────────────────────────────────────────────────

function PlayerSeat({
  player,
  isMe,
  isActive,
  phase,
}: {
  player: PublicBlackjackPlayer;
  isMe: boolean;
  isActive: boolean;
  phase: PublicBlackjackState['phase'];
}) {
  const sittingOut = player.status === 'sitting_out';

  return (
    <div className={`bj-seat${isActive ? ' bj-seat--active' : ''}${sittingOut ? ' bj-seat--out' : ''}${isMe ? ' bj-seat--me' : ''}`}>
      {/* Avatar + name */}
      <div className="bj-seat-header">
        <div className="bj-seat-avatar">
          {player.avatar ? (
            <AvatarSvg config={player.avatar} size={36} />
          ) : (
            <div className="bj-seat-avatar-fallback">{player.displayName[0]?.toUpperCase()}</div>
          )}
        </div>
        <div className="bj-seat-info">
          <div className="bj-seat-name">{player.displayName}{isMe ? ' (you)' : ''}</div>
          <div className="bj-seat-stack">{formatChips(player.stack)}</div>
        </div>
      </div>

      {/* Status */}
      <StatusLabel status={player.status} isActive={isActive} />

      {/* Pending bet during betting phase */}
      {phase === 'waiting_for_bets' && player.pendingBet > 0 && (
        <div className="bj-pending-bet">Bet: {formatChips(player.pendingBet)}</div>
      )}

      {/* Hands */}
      {player.hands.map((hand, hi) => {
        const isActiveHand = isActive && hi === player.activeHandIndex;
        return (
          <div key={hand.id} className={`bj-hand${isActiveHand ? ' bj-hand--active' : ''}`}>
            <div className="bj-hand-cards">
              {hand.cards.map((card, ci) => (
                <CardView key={ci} card={card} faceUp className="bj-card" />
              ))}
            </div>
            <div className="bj-hand-meta">
              {hand.wager > 0 && (
                <span className="bj-hand-wager">
                  {formatChips(hand.wager)}{hand.isDoubled ? ' (2×)' : ''}
                  {hand.isSplit ? ' (split)' : ''}
                </span>
              )}
              <TotalBadge
                total={hand.total}
                isSoft={hand.isSoft}
                isBust={hand.isBust}
                isBlackjack={hand.isBlackjack}
              />
            </div>
            <HandResult result={hand.result} payout={hand.payout} />
          </div>
        );
      })}
    </div>
  );
}

// ── Dealer seat ───────────────────────────────────────────────────────────────

function DealerSeat({ dealer, phase }: {
  dealer: PublicBlackjackState['dealer'];
  phase: PublicBlackjackState['phase'];
}) {
  const showPlaceholders = dealer.cards.length === 0;
  return (
    <div className="bj-dealer">
      <div className="bj-dealer-label">Dealer</div>
      <div className="bj-hand-cards bj-dealer-cards">
        {showPlaceholders ? (
          <>
            <div className="playing-card back bj-card bj-card--placeholder" aria-hidden="true" />
            <div className="playing-card back bj-card bj-card--placeholder" aria-hidden="true" />
          </>
        ) : dealer.cards.map((card, i) =>
          card === null ? (
            <div key={i} className="playing-card back bj-card" aria-label="face-down card" />
          ) : (
            <CardView key={i} card={card} faceUp className="bj-card" />
          ),
        )}
      </div>
      {dealer.total !== undefined && dealer.cards.length >= 2 && (
        <TotalBadge total={dealer.total} isSoft={dealer.isSoft} />
      )}
      {phase === 'dealer_turn' && <span className="bj-status bj-status--acting">Playing…</span>}
    </div>
  );
}

// ── Round results overlay ─────────────────────────────────────────────────────

function RoundResultsOverlay({
  results,
  onDismiss,
}: {
  results: BlackjackRoundPlayerResult[];
  onDismiss: () => void;
}) {
  return (
    <div className="bj-results-overlay" onClick={onDismiss}>
      <div className="bj-results-panel" onClick={(e) => e.stopPropagation()}>
        <h3>Round Results</h3>
        {results.map((r) => (
          <div key={r.userId} className="bj-result-row">
            <span className="bj-result-name">{r.displayName}</span>
            <span className={`bj-result-delta ${r.stackDelta >= 0 ? 'positive' : 'negative'}`}>
              {r.stackDelta >= 0 ? '+' : ''}{formatChips(r.stackDelta)}
            </span>
            <span className="bj-result-stack">{formatChips(r.finalStack)} chips</span>
          </div>
        ))}
        <button className="btn primary" onClick={onDismiss} style={{ marginTop: '1rem', width: '100%' }}>
          OK
        </button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  lobby: LobbySummary;
  bjState: PublicBlackjackState | null;
  legalActions: BlackjackLegalAction[];
  roundResults: BlackjackRoundPlayerResult[] | null;
  myUserId: string;
  isHost?: boolean;
  messages?: ChatMessage[];
  onClearRoundResults: () => void;
  onSend: (msg: ClientMessage) => void;
}

export function BlackjackTable({
  lobby,
  bjState,
  legalActions,
  roundResults,
  myUserId,
  isHost,
  onClearRoundResults,
  onSend,
}: Props) {
  const config: VariantConfig = lobby.settings;

  // ── Pre-game lobby waiting screen ────────────────────────────────────────
  if (!bjState) {
    const seatedCount = lobby.seats.filter((s) => s.userId).length;
    return (
      <div className="bj-table bj-table--waiting">
        <div className="bj-waiting-screen">
          <div className="bj-waiting-felt-label">BLACKJACK</div>
          <div className="bj-waiting-seats">
            {lobby.seats.filter((s) => s.userId).map((s) => (
              <div key={s.seatIndex} className="bj-waiting-player">
                <div className="bj-seat-avatar-fallback">
                  {(s.displayName ?? '?')[0]?.toUpperCase()}
                </div>
                <span>{s.displayName}</span>
                <span className="bj-waiting-stack">{formatChips(s.stack)}</span>
              </div>
            ))}
            {seatedCount === 0 && (
              <p style={{ opacity: 0.5, textAlign: 'center' }}>Waiting for players to join…</p>
            )}
          </div>
          {isHost ? (
            <button
              className="btn primary bj-start-btn"
              disabled={seatedCount === 0}
              onClick={() => onSend({ type: 'host_start' })}
            >
              Start Game
            </button>
          ) : (
            <p className="bj-waiting-hint">Waiting for host to start the game…</p>
          )}
        </div>
      </div>
    );
  }

  const myPlayer = bjState.players.find((p) => p.userId === myUserId);

  function sendBet(amount: number) {
    onSend({ type: 'bj_place_bet', amount });
  }

  function sendClearBet() {
    onSend({ type: 'bj_clear_bet' });
  }

  function sendHit(handId: string) {
    onSend({ type: 'bj_hit', handId });
  }

  function sendStand(handId: string) {
    onSend({ type: 'bj_stand', handId });
  }

  function sendDouble(handId: string) {
    onSend({ type: 'bj_double_down', handId });
  }

  function sendSplit(handId: string) {
    onSend({ type: 'bj_split', handId });
  }

  const activePlayer = bjState.activePlayerIndex >= 0
    ? bjState.players[bjState.activePlayerIndex]
    : null;

  return (
    <div className="bj-table">
      <div className="bj-felt-wrap">

        {/* Oval casino felt — dealer + inscription */}
        <div className="bj-felt">
          <div className="bj-dealer-zone">
            <DealerSeat dealer={bjState.dealer} phase={bjState.phase} />
          </div>
          <div className="bj-inscription">
            <span className="bj-inscription-line">Blackjack Pays 3 to 2</span>
          </div>
          {bjState.shoePenetration < 0.25 && bjState.phase === 'round_complete' && (
            <div className="bj-shoe-notice">Reshuffling shoe next round…</div>
          )}
        </div>

        {/* Player rail below the oval */}
        <div className="bj-player-row">
          {bjState.players.map((player) => (
            <PlayerSeat
              key={player.userId}
              player={player}
              isMe={player.userId === myUserId}
              isActive={activePlayer?.userId === player.userId}
              phase={bjState.phase}
            />
          ))}
        </div>

      </div>

      {/* Action bar — pinned at the very bottom */}
      {myPlayer && (
        <BlackjackActionBar
          phase={bjState.phase}
          legalActions={legalActions}
          myStack={myPlayer.stack}
          myPendingBet={myPlayer.pendingBet}
          config={config}
          onPlaceBet={sendBet}
          onClearBet={sendClearBet}
          onHit={sendHit}
          onStand={sendStand}
          onDouble={sendDouble}
          onSplit={sendSplit}
        />
      )}

      {/* Round results overlay */}
      {roundResults && (
        <RoundResultsOverlay results={roundResults} onDismiss={onClearRoundResults} />
      )}
    </div>
  );
}
