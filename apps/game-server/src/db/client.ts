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

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}
