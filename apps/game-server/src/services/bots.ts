/**
 * AI opponent (bot) identity & seating.
 *
 * A bot is a normal seat occupant backed by a synthetic `users` row flagged `is_bot`. Its brain
 * (difficulty + playstyle) is persisted on the seat (see {@link setSeatBotFields}), so behavior
 * survives a server restart. Bots have no WebSocket connection — the turn driver in the WS handler
 * computes and applies their actions via the pure {@link decidePokerAction} engine.
 *
 * Cash games (holdem/omaha/plo8), twelve_card_flip, and blackjack support bots; tournaments are
 * rejected by the caller. Poker bots use {@link decidePokerAction}; blackjack bots play textbook
 * basic strategy (driven inside blackjack-handler.ts).
 */
import type { AvatarConfig, BotDifficulty, BotStyle, GameVariant, LobbySummary } from '@vct/shared-types';
import { BOT_STYLES, EYE_COLORS, HAIR_COLORS, SKIN_TONES, ALL_HAIR_STYLES, getTableBuyIn } from '@vct/shared-types';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { tableSeats, users } from '../db/schema.js';
import { memoryCreateUser, memoryStore } from '../store/memory-fallback.js';
import {
  getLobbyById,
  isMemoryMode,
  setSeatBotFields,
  sitAtSeat,
} from './lobby.js';
import { initSession } from './session-stats.js';

/** Variants that support AI opponents. */
const BOT_VARIANTS: ReadonlySet<GameVariant> = new Set(['holdem', 'omaha', 'plo8', 'twelve_card_flip', 'blackjack']);

export function variantSupportsBots(game: GameVariant): boolean {
  return BOT_VARIANTS.has(game);
}

/** Display-name pool — picked at random, de-duplicated against the table. */
const BOT_NAMES = [
  'Ace', 'Rocky', 'Maverick', 'Lucky', 'Diesel', 'Bishop', 'Goose', 'Slick',
  'Cobra', 'Bandit', 'Shark', 'Domino', 'Jett', 'Rebel', 'Hawk', 'Vega',
  'Knox', 'Razor', 'Echo', 'Blaze', 'Duke', 'Fox', 'Banks', 'Rusty',
  'Jake', 'Wes', 'Trey', 'Bret', 'Nick', 'Mack',
];

/**
 * userIds known to be bots. Lets the (synchronous) action-timer scheduler tell bots apart from
 * disconnected humans without an async lobby fetch. Rebuilt from a lobby via {@link registerLobbyBots};
 * authoritative source of truth is the persisted seat (`isBot`), so a cold cache self-heals.
 */
const botUserIds = new Set<string>();

export function isBotUser(userId: string | null | undefined): boolean {
  return !!userId && botUserIds.has(userId);
}

/** Drop a userId from the bot-id cache (cache only; does not delete the user row). */
export function unregisterBotUser(userId: string): void {
  botUserIds.delete(userId);
}

/**
 * Re-sync the bot-id cache from a lobby's seats (call wherever a lobby is loaded for play) and
 * ensure each bot has a session-stats accumulator. Bots never connect/reconnect, so this is the
 * only place their stats get initialized — without it they accrue no VPIP/aggression/etc. data and
 * only stack-derived badges (big stack / short stack) ever appear on them. initSession is idempotent.
 */
export function registerLobbyBots(lobby: LobbySummary): void {
  for (const seat of lobby.seats) {
    if (seat.isBot && seat.userId) {
      botUserIds.add(seat.userId);
      initSession(lobby.id, seat.userId, seat.displayName ?? 'Bot', seat.stack);
    }
  }
}

export interface BotBrainInfo {
  difficulty: BotDifficulty;
  style: BotStyle;
}

/**
 * Read a seated bot's brain (difficulty + style) from the persisted seat, or null if the seat is
 * empty / not a bot. Difficulty is deliberately not on the public lobby summary, so this reads the
 * store directly (memory or Postgres).
 */
export async function getSeatBotBrain(lobbyId: string, seatIndex: number): Promise<BotBrainInfo | null> {
  if (isMemoryMode()) {
    const mem = memoryStore.lobbies.get(lobbyId);
    const seat = mem?.seats.find((s) => s.seatIndex === seatIndex);
    if (!seat?.isBot || !seat.userId) return null;
    return { difficulty: seat.botDifficulty ?? 'intermediate', style: seat.botStyle ?? 'tag' };
  }
  const db = getDb();
  const [row] = await db
    .select({ isBot: tableSeats.isBot, difficulty: tableSeats.botDifficulty, style: tableSeats.botStyle })
    .from(tableSeats)
    .where(and(eq(tableSeats.lobbyId, lobbyId), eq(tableSeats.seatIndex, seatIndex)))
    .limit(1);
  if (!row?.isBot) return null;
  return {
    difficulty: (row.difficulty as BotDifficulty) ?? 'intermediate',
    style: (row.style as BotStyle) ?? 'tag',
  };
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomBotStyle(): BotStyle {
  return pick(BOT_STYLES);
}

function randomBotAvatar(): AvatarConfig {
  const gender = Math.random() < 0.5 ? 'male' : 'female';
  return {
    gender,
    skinTone: pick(SKIN_TONES),
    hairStyle: pick(ALL_HAIR_STYLES),
    hairColor: pick(HAIR_COLORS),
    eyeColor: pick(EYE_COLORS),
  };
}

/** Pick a bot name not already taken at the table; falls back to a numbered suffix. */
function uniqueBotName(lobby: LobbySummary): string {
  const taken = new Set(
    lobby.seats.filter((s) => s.userId && s.displayName).map((s) => s.displayName!.toLowerCase())
  );
  const shuffled = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  for (const base of shuffled) {
    if (!taken.has(base.toLowerCase())) return base;
  }
  // Every base name is taken — append a number.
  for (let n = 2; n < 100; n++) {
    for (const base of shuffled) {
      const candidate = `${base} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }
  return `Bot ${Math.floor(Math.random() * 10000)}`;
}

async function createBotUser(displayName: string, avatar: AvatarConfig): Promise<string> {
  if (isMemoryMode()) {
    const u = memoryCreateUser({ displayName, isGuest: false, isBot: true, avatar });
    botUserIds.add(u.id);
    return u.id;
  }
  const db = getDb();
  const [row] = await db
    .insert(users)
    .values({ displayName, isGuest: false, isBot: true, avatarUrl: JSON.stringify(avatar) })
    .returning({ id: users.id });
  botUserIds.add(row.id);
  return row.id;
}

/** Permanently remove a bot's user row (called when a bot leaves the table / lobby is torn down). */
export async function deleteBotUser(userId: string): Promise<void> {
  botUserIds.delete(userId);
  if (isMemoryMode()) {
    memoryStore.users.delete(userId);
    return;
  }
  try {
    const db = getDb();
    await db.delete(users).where(eq(users.id, userId));
  } catch {
    // Seat already nulled its FK (ON DELETE SET NULL); safe to ignore a missing row.
  }
}

/**
 * Delete the synthetic `users` rows for every bot seated in a lobby. Call before tearing a lobby
 * down (graceful close or abandoned-lobby cleanup) so bot accounts don't outlive their table.
 */
export async function deleteBotUsersForLobby(lobbyId: string): Promise<void> {
  if (isMemoryMode()) {
    const mem = memoryStore.lobbies.get(lobbyId);
    if (!mem) return;
    for (const seat of mem.seats) {
      if (seat.isBot && seat.userId) {
        botUserIds.delete(seat.userId);
        memoryStore.users.delete(seat.userId);
      }
    }
    return;
  }
  try {
    const db = getDb();
    const rows = await db
      .select({ userId: tableSeats.userId })
      .from(tableSeats)
      .where(and(eq(tableSeats.lobbyId, lobbyId), eq(tableSeats.isBot, true)));
    const ids = rows.map((r) => r.userId).filter((x): x is string => !!x);
    for (const id of ids) botUserIds.delete(id);
    if (ids.length > 0) await db.delete(users).where(inArray(users.id, ids));
  } catch {
    // Best-effort cleanup; orphaned bot rows are harmless and rare.
  }
}

export type AddBotResult =
  | { lobby: LobbySummary; userId: string; style: BotStyle }
  | { error: string };

/**
 * Create a bot user and seat it at `seatIndex` with the table buy-in and a random playstyle.
 * Validation of host / variant / tournament must be done by the caller. Returns the updated lobby.
 */
export async function addBot(
  lobbyId: string,
  seatIndex: number,
  difficulty: BotDifficulty
): Promise<AddBotResult> {
  const lobby = await getLobbyById(lobbyId);
  if (!lobby) return { error: 'Lobby not found' };
  if (!variantSupportsBots(lobby.settings.game)) return { error: 'Bots are not available for this game' };
  if (lobby.tournamentId) return { error: 'Bots are not available in tournaments' };

  const seat = lobby.seats.find((s) => s.seatIndex === seatIndex);
  if (!seat) return { error: 'Invalid seat' };
  if (seat.userId) return { error: 'Seat taken' };

  const style = randomBotStyle();
  const name = uniqueBotName(lobby);
  const avatar = randomBotAvatar();
  const userId = await createBotUser(name, avatar);

  const buyIn = getTableBuyIn(lobby.settings);
  const seated = await sitAtSeat(lobbyId, userId, seatIndex, buyIn, name);
  if ('error' in seated) {
    await deleteBotUser(userId); // roll back the orphan user
    return { error: seated.error };
  }
  await setSeatBotFields(lobbyId, userId, difficulty, style);

  const updated = (await getLobbyById(lobbyId)) ?? seated;
  return { lobby: updated, userId, style };
}
