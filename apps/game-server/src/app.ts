import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { registerApiRoutes } from './routes/api.js';
import { registerClient, setTokenVerifier } from './ws/handler.js';
import { logger } from './logger.js';

/**
 * Construct and fully configure the Fastify app (plugins, auth, routes, WS endpoint) WITHOUT
 * listening. Kept separate from the server entrypoint (index.ts) so it can be built in a test —
 * `await buildApp(); await app.ready()` exercises the entire plugin/route registration path and
 * catches startup-config errors (e.g. an invalid Fastify option) that never surface in unit tests.
 */
export async function buildApp() {
  // Fastify v5 takes a pre-built logger via `loggerInstance`; the `logger` option is config-only
  // and rejects an instance with FST_ERR_LOG_INVALID_LOGGER_CONFIG.
  const app = Fastify({ loggerInstance: logger, trustProxy: true });

  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry in ${Math.ceil(context.ttl / 1000)}s.`,
    }),
  });

  await app.register(cors, { origin: config.webOrigin, credentials: true });
  await app.register(sensible);
  await app.register(jwt, { secret: config.jwtSecret });
  app.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  await app.register(websocket);
  await app.register(registerApiRoutes, { prefix: '/api' });

  setTokenVerifier(async (token) => app.jwt.verify<{ sub: string }>(token));

  app.get('/ws', { websocket: true, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, (socket) => {
    registerClient(socket);
  });

  return app;
}
