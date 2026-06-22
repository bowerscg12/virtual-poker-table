import type {
  BlackjackLegalAction,
  BlackjackRoundPlayerResult,
  BlackjackSessionRecap,
  ChatMessage,
  ClientMessage,
  LobbySummary,
  PublicBlackjackPlayer,
  PublicBlackjackState,
  VariantConfig,
} from '@vct/shared-types';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CardView } from './CardView';
import { AvatarSvg } from './AvatarSvg';
import { BlackjackActionBar } from './BlackjackActionBar';
import { BetChips } from './BetChips';
import { formatChips } from '../utils/formatChips';
import { useActionTimer } from '../hooks/useActionTimer';

/** Per-seat countdown shown over the active player's seat. */
function SeatTimer({ deadline }: { deadline: number | undefined }) {
  const remaining = useActionTimer(deadline ? new Date(deadline).toISOString() : undefined);
  if (remaining === null) return null;
  return (
    <span className={`bj-seat-timer${remaining <= 10 ? ' bj-seat-timer--urgent' : ''}`} aria-hidden="true">
      {remaining}s
    </span>
  );
}

// ── Hand-total badge ───────────────────────────────────────────────────────────

function TotalBadge({ total, isSoft, isBust, isBlackjack, variant }: {
  total?: number; isSoft?: boolean; isBust?: boolean; isBlackjack?: boolean;
  variant?: 'dealer';
}) {
  const { t } = useTranslation();
  if (!total) return null;
  // The dealer badge is red (per the casino look); player badges stay green.
  const base = variant === 'dealer' ? 'bj-total bj-total--dealer' : 'bj-total';
  if (isBlackjack) return (
    <span className={`${base} bj-total--bj`} aria-label={t('blackjack.handTotal.bj')}>BJ</span>
  );
  if (isBust) return (
    <span className={`${base} bj-total--bust`} aria-label={t('blackjack.handTotal.bust')}>
      {t('blackjack.handTotal.bust')}
    </span>
  );
  const label = isSoft ? `S${total}` : `${total}`;
  const ariaLabel = isSoft ? t('blackjack.handTotal.soft', { total }) : `${total}`;
  const cls = variant === 'dealer' ? '' : total === 21 ? 'bj-total--21' : total > 16 ? 'bj-total--good' : '';
  return <span className={`${base} ${cls}`} aria-label={ariaLabel}>{label}</span>;
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
  const resultKey = result as 'win' | 'loss' | 'push' | 'blackjack' | 'surrender';
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
  actionDeadline,
}: {
  player: PublicBlackjackPlayer;
  isMe: boolean;
  isActive: boolean;
  phase: PublicBlackjackState['phase'];
  actionDeadline?: number;
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
            <div className="bj-seat-avatar-fallback">{(player.displayName[0] ?? '?').toUpperCase()}</div>
          )}
        </div>
        <div className="bj-seat-info">
          <div className="bj-seat-name">{player.displayName}{isMe ? ' (you)' : ''}</div>
          <div className="bj-seat-stack">{formatChips(player.stack)}</div>
        </div>
        {isActive && phase === 'player_turn' && <SeatTimer deadline={actionDeadline} />}
      </div>

      {/* Status */}
      <StatusLabel status={player.status} isActive={isActive} />

      {/* Insurance marker */}
      {player.insuranceBet ? (
        <div className="bj-pending-bet">Insurance: {formatChips(player.insuranceBet)}</div>
      ) : null}

      {/* Pending bet during betting phase — rendered as a chip stack */}
      {phase === 'waiting_for_bets' && player.pendingBet > 0 && (
        <BetChips amount={player.pendingBet} className="bj-seat-bet" />
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
                <div className="bj-hand-wager">
                  <BetChips amount={hand.wager} />
                  {(hand.isDoubled || hand.isSplit) && (
                    <span className="bj-hand-tags">
                      {hand.isDoubled ? '2×' : ''}{hand.isDoubled && hand.isSplit ? ' · ' : ''}{hand.isSplit ? 'split' : ''}
                    </span>
                  )}
                </div>
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
        <TotalBadge total={dealer.total} isSoft={dealer.isSoft} variant="dealer" />
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
  // Dismiss on Escape for keyboard accessibility.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onDismiss();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return (
    <div className="bj-results-overlay" onClick={onDismiss}>
      <div
        className="bj-results-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Round results"
      >
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

// ── End-of-run recap (high-score mode) ──────────────────────────────────────────

function SessionRecapOverlay({
  recap,
  onPlayAgain,
  onLeaveTable,
}: {
  recap: BlackjackSessionRecap;
  onPlayAgain: () => void;
  onLeaveTable: () => void;
}) {
  const cashedOut = recap.cashedOut === true;
  // Enter confirms the primary action: leave (cash-out) or play again (bust).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter') (cashedOut ? onLeaveTable : onPlayAgain)();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cashedOut, onPlayAgain, onLeaveTable]);

  const newRecord = recap.isPeakRecord || recap.isHandsRecord;

  return (
    <div className="bj-results-overlay">
      <div className="bj-recap-panel" role="dialog" aria-modal="true" aria-label="Session over">
        <h3 className="bj-recap-title">{cashedOut ? 'Cashed Out' : 'Busted Out'}</h3>
        {newRecord && <div className="bj-recap-record">🏆 New personal best!</div>}

        {cashedOut && (
          <div className="bj-recap-stat">
            <span className="bj-recap-label">Cashed out with</span>
            <span className="bj-recap-value">{formatChips(recap.finalStack ?? 0)}</span>
          </div>
        )}
        <div className="bj-recap-stat">
          <span className="bj-recap-label">Peak chips</span>
          <span className={`bj-recap-value${recap.isPeakRecord ? ' bj-recap-value--record' : ''}`}>
            {formatChips(recap.peakChips)}
          </span>
        </div>
        <div className="bj-recap-stat">
          <span className="bj-recap-label">Hands won</span>
          <span className={`bj-recap-value${recap.isHandsRecord ? ' bj-recap-value--record' : ''}`}>
            {recap.handsWon}
          </span>
        </div>
        <div className="bj-recap-stat bj-recap-stat--sub">
          <span className="bj-recap-label">Hands played</span>
          <span className="bj-recap-value">{recap.handsPlayed}</span>
        </div>

        <div className="bj-recap-best">
          Personal best — peak {formatChips(recap.bestPeak)} · {recap.bestHandsWon} hands won
        </div>

        {cashedOut ? (
          <button className="btn primary bj-recap-btn" onClick={onLeaveTable} autoFocus>
            Leave Table
          </button>
        ) : (
          <button className="btn primary bj-recap-btn" onClick={onPlayAgain} autoFocus>
            Play Again ({formatChips(recap.buyIn)})
          </button>
        )}
      </div>
    </div>
  );
}

// ── Add-bot host control ────────────────────────────────────────────────────────

function AddBotControl({ lobby, onSend }: { lobby: LobbySummary; onSend: (msg: ClientMessage) => void }) {
  const maxPlayers = lobby.settings.maxPlayers;
  const used = new Set(lobby.seats.filter((s) => s.userId).map((s) => s.seatIndex));
  let freeSeat = -1;
  for (let i = 0; i < maxPlayers; i++) {
    if (!used.has(i)) { freeSeat = i; break; }
  }
  const full = freeSeat === -1;
  return (
    <button
      className="btn"
      disabled={full}
      onClick={() => onSend({ type: 'host_add_bot', seatIndex: freeSeat, difficulty: 'intermediate' })}
      title={full ? 'Table is full' : 'Add an AI player that plays basic strategy'}
    >
      + Add Bot
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  lobby: LobbySummary;
  bjState: PublicBlackjackState | null;
  legalActions: BlackjackLegalAction[];
  roundResults: BlackjackRoundPlayerResult[] | null;
  recap: BlackjackSessionRecap | null;
  myUserId: string;
  isHost?: boolean;
  messages?: ChatMessage[];
  onClearRoundResults: () => void;
  onClearRecap: () => void;
  onSend: (msg: ClientMessage) => void;
  /** Leave the table after a cash-out (navigates home + clears the recap). */
  onLeaveTable: () => void;
}

export function BlackjackTable({
  lobby,
  bjState,
  legalActions,
  roundResults,
  recap,
  myUserId,
  isHost,
  onClearRoundResults,
  onClearRecap,
  onSend,
  onLeaveTable,
}: Props) {
  const config: VariantConfig = lobby.settings;

  function playAgain() {
    onSend({ type: 'bj_play_again' });
    onClearRecap();
  }

  // The bust / cash-out recap supersedes everything else for that player.
  if (recap) {
    return (
      <div className="bj-table">
        <SessionRecapOverlay recap={recap} onPlayAgain={playAgain} onLeaveTable={onLeaveTable} />
      </div>
    );
  }

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

  function sendSurrender(handId: string) {
    onSend({ type: 'bj_surrender', handId });
  }

  function sendInsurance(amount: number) {
    onSend({ type: 'bj_insurance', amount });
  }

  function sendEvenMoney() {
    onSend({ type: 'bj_even_money' });
  }

  const activePlayer = bjState.activePlayerIndex >= 0
    ? bjState.players[bjState.activePlayerIndex]
    : null;

  const paused = lobby.status === 'paused';

  // Cashing out is only allowed between hands (betting phase or the post-round intermission).
  const canCashOut =
    !!myPlayer && (bjState.phase === 'waiting_for_bets' || bjState.phase === 'round_complete');

  return (
    <div className="bj-table">
      {/* Host + player controls */}
      {(isHost || myPlayer) && (
        <div className="bj-host-controls">
          {isHost && (
            <>
              <button
                className="btn"
                onClick={() => onSend({ type: 'host_pause', paused: !paused })}
              >
                {paused ? '▶ Resume' : '⏸ Pause'}
              </button>
              <AddBotControl lobby={lobby} onSend={onSend} />
            </>
          )}
          {myPlayer && (
            <button
              className="btn bj-cash-out-btn"
              disabled={!canCashOut}
              title={canCashOut ? 'Leave the table and bank your chips' : 'You can only cash out between hands'}
              onClick={() => onSend({ type: 'bj_cash_out' })}
            >
              Cash Out
            </button>
          )}
        </div>
      )}
      {paused && <div className="bj-paused-banner" role="status">Paused by host</div>}

      <div className="bj-felt-wrap">

        {/* Oval casino felt — dealer + inscription */}
        <div className="bj-felt">
          <div className="bj-dealer-zone">
            <DealerSeat dealer={bjState.dealer} phase={bjState.phase} />
          </div>
          <div className="bj-inscription">
            <span className="bj-inscription-line bj-inscription-line--primary">Blackjack Pays 3 to 2</span>
            <span className="bj-inscription-line">Dealer must draw to 16 and stand on hard 17</span>
            <span className="bj-inscription-line">Insurance pays 2 to 1</span>
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
              actionDeadline={bjState.actionDeadline}
            />
          ))}
        </div>

      </div>

      {/* Action bar — pinned at the very bottom */}
      {myPlayer && (
        <BlackjackActionBar
          state={bjState}
          me={myPlayer}
          legalActions={legalActions}
          config={config}
          onPlaceBet={sendBet}
          onClearBet={sendClearBet}
          onHit={sendHit}
          onStand={sendStand}
          onDouble={sendDouble}
          onSplit={sendSplit}
          onSurrender={sendSurrender}
          onInsurance={sendInsurance}
          onEvenMoney={sendEvenMoney}
        />
      )}

      {/* Round results overlay */}
      {roundResults && (
        <RoundResultsOverlay results={roundResults} onDismiss={onClearRoundResults} />
      )}
    </div>
  );
}
