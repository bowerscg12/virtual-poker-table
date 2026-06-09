import { useTranslation } from 'react-i18next';
import type { Card } from '@vct/shared-types';

const SUIT_SYM: Record<string, string> = { h: '♥', d: '♦', c: '♣', s: '♠' };
const RED = new Set(['h', 'd']);

interface CardViewProps {
  card: Card;
  faceUp?: boolean;
  className?: string;
}

export function CardView({ card, faceUp, className = '' }: CardViewProps) {
  const { t } = useTranslation();
  if (!faceUp) {
    return <div className={`playing-card back ${className}`.trim()} aria-label={t('cards.faceDown')} />;
  }
  const rankKey = card[0] as string;
  const suit = card[1] as string;
  const displayRank = rankKey === 'T' ? '10' : rankKey;
  const red = RED.has(suit);
  const suitName = t(`cards.suits.${suit}` as Parameters<typeof t>[0]);
  const rankName = t(`cards.ranks.${rankKey}` as Parameters<typeof t>[0], { defaultValue: displayRank });
  return (
    <div
      className={`playing-card face ${red ? 'red' : 'black'} ${className}`.trim()}
      aria-label={`${rankName} ${t('cards.of')} ${suitName}`}
    >
      <span>{displayRank}</span>
      <span>{SUIT_SYM[suit]}</span>
    </div>
  );
}
