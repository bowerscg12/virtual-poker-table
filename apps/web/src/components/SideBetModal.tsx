import { useState } from 'react';
import type { SideBetType, Suit } from '@vct/shared-types';
import { formatChips } from '../utils/formatChips';

interface Props {
  targetName: string;
  myStack: number;
  onCreate: (betType: SideBetType, suit: Suit | undefined, wager: number) => void;
  onClose: () => void;
}

const BET_TYPES: { value: SideBetType; label: string; needsSuit: boolean }[] = [
  { value: 'highest_suit', label: 'Highest card of suit', needsSuit: true },
  { value: 'lowest_suit', label: 'Lowest card of suit', needsSuit: true },
  { value: 'highest_sum', label: 'Highest hole-card sum', needsSuit: false },
  { value: 'lowest_sum', label: 'Lowest hole-card sum', needsSuit: false },
];

const SUITS: { value: Suit; label: string; red: boolean }[] = [
  { value: 's', label: '♠ Spades', red: false },
  { value: 'h', label: '♥ Hearts', red: true },
  { value: 'd', label: '♦ Diamonds', red: true },
  { value: 'c', label: '♣ Clubs', red: false },
];

export function SideBetModal({ targetName, myStack, onCreate, onClose }: Props) {
  const [betType, setBetType] = useState<SideBetType>('highest_sum');
  const [suit, setSuit] = useState<Suit>('s');
  const [rawAmount, setRawAmount] = useState('');

  const needsSuit = betType === 'highest_suit' || betType === 'lowest_suit';
  const amount = parseInt(rawAmount, 10);
  const amountValid = !Number.isNaN(amount) && amount > 0 && amount <= myStack;

  function handleSubmit() {
    if (!amountValid) return;
    onCreate(betType, needsSuit ? suit : undefined, amount);
    onClose();
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="sidebet-title">
      <div className="modal sidebet-modal">
        <h2 id="sidebet-title" className="modal-title">Side Bet vs {targetName}</h2>
        <p className="modal-body">
          A private 1v1 wager on hole cards only — settled after the hand, never touching the pot.
          <br />Your stack: <strong>{formatChips(myStack)}</strong>
        </p>

        <div className="sidebet-field">
          <label className="sidebet-label">Bet Type</label>
          <div className="sidebet-type-list">
            {BET_TYPES.map((bt) => (
              <button
                key={bt.value}
                type="button"
                className={`btn sidebet-type-btn${betType === bt.value ? ' sidebet-type-btn--selected' : ''}`}
                onClick={() => setBetType(bt.value)}
              >
                {bt.label}
              </button>
            ))}
          </div>
        </div>

        {needsSuit && (
          <div className="sidebet-field">
            <label className="sidebet-label">Suit</label>
            <div className="sidebet-suit-list">
              {SUITS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className={`btn sidebet-suit-btn${suit === s.value ? ' sidebet-suit-btn--selected' : ''}${s.red ? ' sidebet-suit-btn--red' : ''}`}
                  onClick={() => setSuit(s.value)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="sidebet-field">
          <label className="sidebet-label" htmlFor="sidebet-amount">Wager</label>
          <input
            id="sidebet-amount"
            type="number"
            className="donate-amount-input"
            placeholder="0"
            min={1}
            max={myStack}
            value={rawAmount}
            onChange={(e) => setRawAmount(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
          />
          {rawAmount !== '' && !amountValid && (
            <span className="donate-amount-error">
              {amount <= 0 ? 'Must be > 0' : `Max ${formatChips(myStack)}`}
            </span>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn primary" onClick={handleSubmit} disabled={!amountValid}>
            Send Challenge
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
