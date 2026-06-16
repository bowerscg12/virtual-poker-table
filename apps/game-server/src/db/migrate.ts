import { getPool } from './client.js';

const SQL = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name VARCHAR(64) NOT NULL,
  username VARCHAR(30),
  password_hash TEXT,
  avatar_url TEXT,
  is_guest BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lobbies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id UUID NOT NULL REFERENCES users(id),
  invite_code VARCHAR(12) NOT NULL UNIQUE,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  settings JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS table_seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id UUID NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
  seat_index INTEGER NOT NULL,
  user_id UUID REFERENCES users(id),
  stack INTEGER NOT NULL DEFAULT 0,
  sitting_out BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(lobby_id, seat_index)
);

CREATE TABLE IF NOT EXISTS hand_histories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id UUID NOT NULL REFERENCES lobbies(id),
  hand_number INTEGER NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lobbies_invite ON lobbies(invite_code);

CREATE TABLE IF NOT EXISTS player_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lobby_id UUID REFERENCES lobbies(id) ON DELETE SET NULL,
  disconnected_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_sessions_user ON player_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_player_sessions_expires ON player_sessions(expires_at);

ALTER TABLE table_seats ADD COLUMN IF NOT EXISTS sit_out_next_hand BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE table_seats ADD COLUMN IF NOT EXISTS sit_out_blind_owed BOOLEAN NOT NULL DEFAULT false;

-- Guest-lifecycle: make host_user_id nullable with ON DELETE SET NULL so deleted guest
-- hosts don't block cleanup. Idempotent — safe to re-run.
ALTER TABLE lobbies ALTER COLUMN host_user_id DROP NOT NULL;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lobbies_host_user_id_fkey'
  ) THEN
    ALTER TABLE lobbies DROP CONSTRAINT lobbies_host_user_id_fkey;
  END IF;
END $$;
ALTER TABLE lobbies ADD CONSTRAINT lobbies_host_user_id_fkey
  FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Guest-lifecycle: ensure table_seats.user_id also NULLs on user delete.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'table_seats_user_id_fkey'
  ) THEN
    ALTER TABLE table_seats DROP CONSTRAINT table_seats_user_id_fkey;
  END IF;
END $$;
ALTER TABLE table_seats ADD CONSTRAINT table_seats_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Partial index makes guest-cleanup queries fast regardless of how many non-guest rows exist.
CREATE INDEX IF NOT EXISTS idx_users_guest_created ON users(created_at) WHERE is_guest = true;

-- Rename legacy email column to username for existing databases.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email'
  ) THEN
    ALTER TABLE users RENAME COLUMN email TO username;
    ALTER TABLE users ALTER COLUMN username TYPE VARCHAR(30);
  END IF;
END $$;

-- Add username/password columns if the users table predates auth support.
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Unique index on username (partial: guests have NULL username).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL;

-- Add table_seats columns added after initial schema.
ALTER TABLE table_seats ADD COLUMN IF NOT EXISTS waiting_for_reentry_blind BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE table_seats ADD COLUMN IF NOT EXISTS seated_at TIMESTAMP;
ALTER TABLE table_seats ADD COLUMN IF NOT EXISTS next_hand_blind BOOLEAN NOT NULL DEFAULT false;

-- Lobby Templates: per-user saved game-setting presets.
CREATE TABLE IF NOT EXISTS lobby_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(64) NOT NULL,
  settings    JSONB NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lobby_templates_user ON lobby_templates(user_id);

-- Chip wallet columns on users.
ALTER TABLE users ADD COLUMN IF NOT EXISTS chip_balance INTEGER NOT NULL DEFAULT 5000;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_daily_claim TIMESTAMP;

-- Tournament tables.
CREATE TABLE IF NOT EXISTS tournaments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_code          VARCHAR(8) NOT NULL UNIQUE,
  status               VARCHAR(16) NOT NULL DEFAULT 'waiting',
  variant              VARCHAR(32) NOT NULL DEFAULT 'holdem',
  buy_in               INTEGER NOT NULL,
  starting_stack       INTEGER NOT NULL,
  num_tables           INTEGER NOT NULL DEFAULT 1,
  seats_per_table      INTEGER NOT NULL DEFAULT 9,
  scheduled_start      TIMESTAMP NOT NULL,
  blind_schedule       JSONB NOT NULL,
  prize_pool           INTEGER NOT NULL DEFAULT 0,
  current_blind_level  INTEGER NOT NULL DEFAULT 0,
  blind_level_started_at TIMESTAMP,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tournaments_invite ON tournaments(invite_code);
CREATE INDEX IF NOT EXISTS idx_tournaments_host ON tournaments(host_user_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);

-- Link lobbies to a parent tournament (null for cash-game tables).
ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS tournament_registrations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id      UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name       VARCHAR(64) NOT NULL,
  registration_order INTEGER NOT NULL,
  table_lobby_id     UUID REFERENCES lobbies(id) ON DELETE SET NULL,
  seat_index         INTEGER,
  current_stack      INTEGER,
  bust_position      INTEGER,
  prize_awarded      INTEGER,
  status             VARCHAR(16) NOT NULL DEFAULT 'registered',
  registered_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tournament_regs_tournament ON tournament_registrations(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_regs_user ON tournament_registrations(user_id);

CREATE TABLE IF NOT EXISTS tournament_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       VARCHAR(64) NOT NULL,
  settings   JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tournament_templates_user ON tournament_templates(user_id);

-- Lifetime aggregate stats: one row per authenticated user.
-- biggest_session_loss stored as absolute value (positive integer).
-- best_hand_rank: -1 = none, 0 = high_card, 9 = royal_flush.
-- vpip_hands / raise_hands / call_hands / fold_hands feed archetype calculation.
CREATE TABLE IF NOT EXISTS player_lifetime_stats (
  user_id                UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  lifetime_profit        INTEGER NOT NULL DEFAULT 0,
  winning_sessions       INTEGER NOT NULL DEFAULT 0,
  losing_sessions        INTEGER NOT NULL DEFAULT 0,
  hands_played           INTEGER NOT NULL DEFAULT 0,
  hands_won              INTEGER NOT NULL DEFAULT 0,
  biggest_pot_won        INTEGER NOT NULL DEFAULT 0,
  biggest_pot_lost       INTEGER NOT NULL DEFAULT 0,
  biggest_session_gain   INTEGER NOT NULL DEFAULT 0,
  biggest_session_loss   INTEGER NOT NULL DEFAULT 0,
  best_hand_rank         INTEGER NOT NULL DEFAULT -1,
  best_hand_description  TEXT,
  favorite_game_mode     VARCHAR(32),
  archetype              VARCHAR(32),
  vpip_hands             INTEGER NOT NULL DEFAULT 0,
  raise_hands            INTEGER NOT NULL DEFAULT 0,
  call_hands             INTEGER NOT NULL DEFAULT 0,
  fold_hands             INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Per canonical starting-hand stats per user (e.g. "AKs", "AA", "72o").
CREATE TABLE IF NOT EXISTS player_hole_hand_stats (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canonical_hand VARCHAR(8) NOT NULL,
  times_dealt    INTEGER NOT NULL DEFAULT 0,
  times_won      INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, canonical_hand)
);
CREATE INDEX IF NOT EXISTS idx_player_hole_hand_stats_user ON player_hole_hand_stats(user_id);

-- Per game-variant stats per user.
CREATE TABLE IF NOT EXISTS player_game_mode_stats (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_mode    VARCHAR(32) NOT NULL,
  hands_played INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, game_mode)
);
CREATE INDEX IF NOT EXISTS idx_player_game_mode_stats_user ON player_game_mode_stats(user_id);

-- The 5 cards (Card[]) making up the best hand a player has ever made.
ALTER TABLE player_lifetime_stats ADD COLUMN IF NOT EXISTS best_hand_cards JSONB;
`;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL not set — skipping migrations (server will use in-memory fallback)');
    return;
  }
  const pool = getPool();
  await pool.query(SQL);
  console.log('Migration complete');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
