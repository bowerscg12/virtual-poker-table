import type { Card } from '@vct/shared-types';

const SUIT_SYM: Record<string, string> = { h: '♥', d: '♦', c: '♣', s: '♠' };
const RED = new Set(['h', 'd']);

interface CardViewProps {
  card: Card;
  faceUp?: boolean;
  className?: string;
}

export function CardView({ card, faceUp, className = '' }: CardViewProps) {
  if (!faceUp) return <div className={`playing-card back ${className}`.trim()} aria-hidden />;
  const rank = card[0] === 'T' ? '10' : card[0];
  const suit = card[1];
  const red = RED.has(suit);
  return (
    <div
      className={`playing-card face ${red ? 'red' : 'black'} ${className}`.trim()}
      aria-label={`${rank} of ${suit}`}
    >
      <span>{rank}</span>
      <span>{SUIT_SYM[suit]}</span>
    </div>
  );
}
