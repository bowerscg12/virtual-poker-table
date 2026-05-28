export type Suit = 'h' | 'd' | 'c' | 's';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';

export type Card = `${Rank}${Suit}`;

export const SUITS: Suit[] = ['h', 'd', 'c', 's'];
export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

export function cardToString(card: Card): string {
  const rank = card[0] === 'T' ? '10' : card[0];
  const suitMap: Record<Suit, string> = { h: '♥', d: '♦', c: '♣', s: '♠' };
  return `${rank}${suitMap[card[1] as Suit]}`;
}
