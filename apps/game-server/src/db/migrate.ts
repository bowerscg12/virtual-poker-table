import { getPool } from './client.js';

const SQL = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name VARCHAR(64) NOT NULL,
  email VARCHAR(255),
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
`;

async function main() {
  const pool = getPool();
  await pool.query(SQL);
  console.log('Migration complete');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
