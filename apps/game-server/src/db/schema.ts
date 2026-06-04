import { boolean, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: varchar('display_name', { length: 64 }).notNull(),
  username: varchar('username', { length: 30 }).unique(),
  passwordHash: text('password_hash'),
  avatarUrl: text('avatar_url'),
  isGuest: boolean('is_guest').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const lobbies = pgTable('lobbies', {
  id: uuid('id').primaryKey().defaultRandom(),
  hostUserId: uuid('host_user_id').references(() => users.id, { onDelete: 'set null' }),
  inviteCode: varchar('invite_code', { length: 12 }).notNull().unique(),
  status: varchar('status', { length: 16 }).notNull().default('open'),
  settings: jsonb('settings').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const tableSeats = pgTable('table_seats', {
  id: uuid('id').primaryKey().defaultRandom(),
  lobbyId: uuid('lobby_id').notNull().references(() => lobbies.id, { onDelete: 'cascade' }),
  seatIndex: integer('seat_index').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  stack: integer('stack').notNull().default(0),
  sittingOut: boolean('sitting_out').default(false).notNull(),
  sitOutNextHand: boolean('sit_out_next_hand').default(false).notNull(),
  sitOutBlindOwed: boolean('sit_out_blind_owed').default(false).notNull(),
  waitingForReentryBlind: boolean('waiting_for_reentry_blind').default(false).notNull(),
  seatedAt: timestamp('seated_at'),
});

export const handHistories = pgTable('hand_histories', {
  id: uuid('id').primaryKey().defaultRandom(),
  lobbyId: uuid('lobby_id').notNull().references(() => lobbies.id),
  handNumber: integer('hand_number').notNull(),
  data: jsonb('data').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const playerSessions = pgTable('player_sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lobbyId: uuid('lobby_id').references(() => lobbies.id, { onDelete: 'set null' }),
  disconnectedAt: timestamp('disconnected_at'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
