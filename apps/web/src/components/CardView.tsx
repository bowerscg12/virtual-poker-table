import type { Card } from '@vct/shared-types';

const SUIT_SYM: Record<string, string> = { h: '♥', d: '♦', c: '♣', s: '♠' };
const RED = new Set(['h', 'd']);

export function CardView({ card, faceUp }: { card: Card; faceUp?: boolean }) {
  if (!faceUp) return <div className="card back" aria-hidden />;
  const rank = card[0] === 'T' ? '10' : card[0];
  const suit = card[1];
  const red = RED.has(suit);
  return (
    <div className={`card face ${red ? 'red' : 'black'}`} aria-label={`${rank} of ${suit}`}>
      <span>{rank}</span>
      <span>{SUIT_SYM[suit]}</span>
    </div>
  );
}
