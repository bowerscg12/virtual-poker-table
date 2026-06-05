import { useState } from 'react';
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
              >
                {formatChips(d)}
              </button>
            ))}
          </div>
          <div className="bj-bet-controls">
            <div className="bj-bet-display">
              Bet: <strong>{formatChips(stagedBet)}</strong>
              {myPendingBet > 0 && (
                <span className="bj-confirmed-bet"> (confirmed: {formatChips(myPendingBet)})</span>
              )}
            </div>
            <div className="bj-bet-actions">
              <button className="btn" onClick={clear} disabled={stagedBet === 0}>
                Clear
              </button>
              <button
                className="btn primary"
                onClick={confirmBet}
                disabled={!canConfirm}
              >
                Place Bet
              </button>
              {myPendingBet > 0 && (
                <button className="btn" onClick={onClearBet}>
                  Cancel Bet
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="bj-limits">
          Min {formatChips(minBet)} · Max {formatChips(maxBet)}
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
            <button className="btn bj-btn-hit" onClick={() => onHit(handId)}>
              Hit
            </button>
          )}
          {types.has('stand') && (
            <button className="btn bj-btn-stand" onClick={() => onStand(handId)}>
              Stand
            </button>
          )}
          {types.has('double_down') && (
            <button className="btn bj-btn-double" onClick={() => onDouble(handId)}>
              Double Down
            </button>
          )}
          {types.has('split') && (
            <button className="btn bj-btn-split" onClick={() => onSplit(handId)}>
              Split
            </button>
          )}
          {/* Stubs for future actions */}
          <button className="btn bj-btn-disabled" disabled title="Coming soon">
            Insurance
          </button>
          <button className="btn bj-btn-disabled" disabled title="Coming soon">
            Surrender
          </button>
        </div>
      </div>
    );
  }

  // ── Waiting / dealing / dealer turn / settlement ───────────────────────────
  return (
    <div className="bj-action-bar bj-action-bar--waiting">
      {phase === 'dealing' && <span>Dealing cards…</span>}
      {phase === 'player_turn' && <span>Waiting for your turn…</span>}
      {phase === 'dealer_turn' && <span>Dealer is playing…</span>}
      {phase === 'settlement' && <span>Settling bets…</span>}
      {phase === 'round_complete' && <span>Next round starting…</span>}
    </div>
  );
}
