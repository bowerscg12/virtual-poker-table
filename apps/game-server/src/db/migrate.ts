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
