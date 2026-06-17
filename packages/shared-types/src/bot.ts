/**
 * AI opponent (bot) types shared between server, engine, and client.
 *
 * A bot occupies a normal seat (synthetic user + `isBot` flag). Its "brain" is two
 * values: a {@link BotDifficulty} (how skillfully it executes) and a {@link BotStyle}
 * (its personality, randomly assigned when it is added). Only cash-game variants
 * (holdem/omaha/plo8) and twelve_card_flip support bots.
 */

/** How skillfully a bot executes its assigned playstyle. */
export type BotDifficulty = 'beginner' | 'intermediate' | 'pro';

/**
 * Bot personality, randomly assigned on add:
 * - `tag`     Tight-Aggressive — plays few hands, bets/raises them hard.
 * - `lag`     Loose-Aggressive — plays many hands with relentless pressure/bluffs.
 * - `nit`     Tight-Passive — plays few hands, rarely raises (rock).
 * - `station` Loose-Passive — calls far too often, rarely folds or raises.
 * - `maniac`  Hyper-aggressive — raises/bluffs constantly regardless of holding.
 */
export type BotStyle = 'tag' | 'lag' | 'nit' | 'station' | 'maniac';

export const BOT_DIFFICULTIES: readonly BotDifficulty[] = ['beginner', 'intermediate', 'pro'];
export const BOT_STYLES: readonly BotStyle[] = ['tag', 'lag', 'nit', 'station', 'maniac'];

export const BOT_DIFFICULTY_LABELS: Record<BotDifficulty, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  pro: 'Pro',
};

export const BOT_STYLE_LABELS: Record<BotStyle, string> = {
  tag: 'Tight-Aggressive',
  lag: 'Loose-Aggressive',
  nit: 'Rock',
  station: 'Calling Station',
  maniac: 'Maniac',
};
