import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { initLobbyStore } from './services/lobby.js';
import { cleanupExpiredGuests } from './services/guest-cleanup.js';
import { cleanExpiredSessions } from './services/session.js';
import { registerApiRoutes } from './routes/api.js';
import { registerClient, setTokenVerifier } from './ws/handler.js';

async function main() {
  await initLobbyStore();

  const app = Fastify({ logger: true, trustProxy: true });

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

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`Game server listening on http://localhost:${config.port}`);

  // Hourly maintenance: expire orphaned sessions and delete abandoned guest accounts.
  const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
  setInterval(async () => {
    try {
      await cleanExpiredSessions();
      await cleanupExpiredGuests();
    } catch (err) {
      console.error('[cleanup] Periodic cleanup failed:', err);
    }
  }, CLEANUP_INTERVAL_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
