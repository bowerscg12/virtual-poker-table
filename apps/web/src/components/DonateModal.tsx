import { useState } from 'react';
import { formatChips } from '../utils/formatChips';

interface Recipient {
  seatIndex: number;
  displayName: string | null;
  stack: number;
}

interface Props {
  myStack: number;
  recipients: Recipient[];
  onDonate: (recipientSeatIndex: number, amount: number) => void;
  onClose: () => void;
}

export function DonateModal({ myStack, recipients, onDonate, onClose }: Props) {
  const [selectedSeat, setSelectedSeat] = useState<number | null>(
    recipients.length === 1 ? recipients[0].seatIndex : null,
  );
  const [rawAmount, setRawAmount] = useState('');

  const amount = parseInt(rawAmount, 10);
  const amountValid = !Number.isNaN(amount) && amount > 0 && amount <= myStack;

  function handleSubmit() {
    if (selectedSeat === null || !amountValid) return;
    onDonate(selectedSeat, amount);
    onClose();
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="donate-title">
      <div className="modal donate-modal">
        <h2 id="donate-title" className="modal-title">Donate Chips</h2>
        <p className="modal-body">
          Your stack: <strong>{formatChips(myStack)}</strong>
        </p>

        <div className="donate-field">
          <label className="donate-label">Recipient</label>
          <div className="donate-recipient-list">
            {recipients.map((r) => (
              <button
                key={r.seatIndex}
                type="button"
                className={`btn donate-recipient-btn${selectedSeat === r.seatIndex ? ' donate-recipient-btn--selected' : ''}`}
                onClick={() => setSelectedSeat(r.seatIndex)}
              >
                <span className="donate-recipient-name">{r.displayName ?? `Seat ${r.seatIndex + 1}`}</span>
                <span className="donate-recipient-stack">{formatChips(r.stack)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="donate-field">
          <label className="donate-label" htmlFor="donate-amount">Amount</label>
          <input
            id="donate-amount"
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
          <button
            type="button"
            className="btn primary"
            onClick={handleSubmit}
            disabled={selectedSeat === null || !amountValid}
          >
            Donate
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
