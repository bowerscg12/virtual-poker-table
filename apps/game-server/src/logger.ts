import { pino } from 'pino';

/**
 * Shared structured logger. Fastify and every service log through this single pino instance, so HTTP
 * request logs and operational logs land in one JSON stream that Cloud Logging can query by field
 * (filter on lobbyId / userId / event instead of grepping free text). Level via LOG_LEVEL (default
 * "info"); error objects passed as `{ err }` are serialized with stack traces by pino's std serializer.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'game-server' },
  formatters: {
    // Emit the level as its label ("info"/"error") rather than a number — friendlier in Cloud Logging.
    level: (label) => ({ level: label }),
  },
});
