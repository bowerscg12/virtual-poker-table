import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config.js';
import * as schema from './schema.js';

let pool: pg.Pool | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const isRemote = !config.databaseUrl.includes('localhost') && !config.databaseUrl.includes('127.0.0.1');
    pool = new pg.Pool({
      connectionString: config.databaseUrl.replace(/[?&]sslmode=[^&]+/, ''),
      ssl: isRemote ? { rejectUnauthorized: false } : undefined,
      // Fail fast on an unreachable/misconfigured DB instead of hanging the caller. Without this,
      // the boot-time `SELECT 1` in initLobbyStore() can block past Cloud Run's startup deadline and
      // the container is killed for "failing to listen on $PORT" — even though the port bind itself
      // is fine. A bounded timeout lets initLobbyStore's try/catch fall back to memory mode instead.
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

export function getDb() {
  if (!db) {
    db = drizzle(getPool(), { schema });
  }
  return db;
}

/**
 * Liveness check for the readiness probe: returns true only if a trivial query succeeds. Resolves
 * false (rather than throwing) when the pool can't reach Postgres so the caller can report status.
 */
export async function pingDb(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}
