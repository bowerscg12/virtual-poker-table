import type { BotDifficulty } from '@vct/shared-types';

interface Props {
  seatIndex: number;
  onSelect: (difficulty: BotDifficulty) => void;
  onCancel: () => void;
}

const OPTIONS: { difficulty: BotDifficulty; label: string; blurb: string }[] = [
  { difficulty: 'beginner', label: 'Beginner', blurb: 'Loose and exploitable — misreads hands and pays off too often.' },
  { difficulty: 'intermediate', label: 'Intermediate', blurb: 'Solid fundamentals with the occasional mistake.' },
  { difficulty: 'pro', label: 'Pro', blurb: 'Sharp hand reading, disciplined folds, well-timed aggression.' },
];

/** Host-only modal for choosing an AI opponent's difficulty before it takes the seat. */
export function AddBotPrompt({ seatIndex, onSelect, onCancel }: Props) {
  return (
    <div className="modal-overlay bomb-pot-overlay" role="dialog" aria-modal="true" aria-labelledby="add-bot-title">
      <div className="modal bomb-pot-modal add-bot-modal">
        <h2 id="add-bot-title" className="modal-title">🤖 Add AI Opponent</h2>
        <p className="modal-body">
          Seat {seatIndex + 1} — choose a difficulty. The bot is randomly assigned a playstyle.
        </p>

        <div className="add-bot-options">
          {OPTIONS.map((opt) => (
            <button
              key={opt.difficulty}
              type="button"
              className="btn add-bot-option"
              onClick={() => onSelect(opt.difficulty)}
            >
              <span className="add-bot-option__label">{opt.label}</span>
              <span className="add-bot-option__blurb">{opt.blurb}</span>
            </button>
          ))}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn small" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
