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

export const keys = {
  tableState: (lobbyId: string) => `table:${lobbyId}:state`,
  presence: (lobbyId: string) => `table:${lobbyId}:presence`,
  chat: (lobbyId: string) => `chat:${lobbyId}:messages`,
  bjState: (lobbyId: string) => `blackjack:${lobbyId}:state`,
};
