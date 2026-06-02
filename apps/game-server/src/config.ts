export const config = {
  port: parseInt(process.env.PORT ?? process.env.GAME_SERVER_PORT ?? '3001', 10),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://vct:vct@localhost:5432/virtual_card_table',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
};
