/** Default emoji set offered in the table reaction picker. Order = picker layout. */
export const REACTION_EMOJIS = [
  '😀', '😎', '😂', '😭', '😡', '😱', '🤯', '🤔', '😴',
  '👍', '👎', '👏', '🙌', '💪',
  '🔥', '💯', '🎉', '🍀', '🧢',
  '♠️', '♥️', '♦️', '♣️',
] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export function isReactionEmoji(value: string): value is ReactionEmoji {
  return (REACTION_EMOJIS as readonly string[]).includes(value);
}

/**
 * A transient table reaction. Broadcast live to everyone in the lobby
 * (players and spectators) — never persisted, never replayed on reconnect,
 * and never part of hand history or gameplay state.
 */
export interface TableReaction {
  id: string;
  userId: string;
  displayName: string;
  emoji: ReactionEmoji;
  /** Seat the sender occupies, or null when sent by a spectator. */
  seatIndex: number | null;
  timestamp: string;
}
