const DEV_JWT_SECRET = 'dev-secret-change-in-production';

/**
 * Resolve the JWT signing secret. In production a missing (or still-default) secret means every auth
 * token would be signed with a value that is public in this repo — letting anyone forge a token for
 * any user. Fail fast at boot so a misconfigured deploy crashes visibly instead of running insecurely.
 * The convenient dev fallback is allowed only outside production.
 */
function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production' && (!secret || secret === DEV_JWT_SECRET)) {
    throw new Error('JWT_SECRET must be set to a secure, non-default value in production');
  }
  return secret ?? DEV_JWT_SECRET;
}

export const config = {
  port: parseInt(process.env.PORT ?? process.env.GAME_SERVER_PORT ?? '3001', 10),
  jwtSecret: resolveJwtSecret(),
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://vct:vct@localhost:5432/virtual_card_table',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
};
