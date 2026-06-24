import { Redis } from 'ioredis';
import { config } from '../config.js';

let redis: Redis | null = null;
const memoryFallback = new Map<string, string>();

export function getRedis(): Redis | null {
  if (redis) return redis;
  try {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    return redis;
  } catch {
    return null;
  }
}

export async function redisGet(key: string): Promise<string | null> {
  const r = getRedis();
  if (r) {
    try {
      await r.connect().catch(() => {});
      return await r.get(key);
    } catch {
      /* fallback */
    }
  }
  return memoryFallback.get(key) ?? null;
}

export async function redisSet(key: string, value: string, ttlSec?: number): Promise<void> {
  const r = getRedis();
  if (r) {
    try {
      await r.connect().catch(() => {});
      if (ttlSec) await r.setex(key, ttlSec, value);
      else await r.set(key, value);
      return;
    } catch {
      /* fallback */
    }
  }
  memoryFallback.set(key, value);
}

export async function redisDel(key: string): Promise<void> {
  const r = getRedis();
  if (r) {
    try {
      await r.del(key);
      return;
    } catch {
      /* fallback */
    }
  }
  memoryFallback.delete(key);
}

/**
 * Liveness check for the readiness probe: returns true only if Redis answers PING. Resolves false
 * (rather than throwing) when Redis is unconfigured or unreachable so the caller can report status.
 */
export async function redisPing(): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  try {
    await r.connect().catch(() => {});
    return (await r.ping()) === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Close the Redis connection cleanly (graceful shutdown). Falls back to a hard disconnect if the
 * QUIT handshake fails, and resets the singleton so a later getRedis() can reconnect (e.g. in tests).
 */
export async function closeRedis(): Promise<void> {
  if (!redis) return;
  try {
    await redis.quit();
  } catch {
    try { redis.disconnect(); } catch { /* already gone */ }
  }
  redis = null;
}

export const keys = {
  tableState: (lobbyId: string) => `table:${lobbyId}:state`,
  presence: (lobbyId: string) => `table:${lobbyId}:presence`,
  chat: (lobbyId: string) => `chat:${lobbyId}:messages`,
  bjState: (lobbyId: string) => `blackjack:${lobbyId}:state`,
};
