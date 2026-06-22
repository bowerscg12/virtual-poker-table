import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { initLobbyStore } from './services/lobby.js';
import { recoverInterruptedHands } from './services/game-manager.js';
import { tournamentManager } from './services/tournament-manager.js';
import { cleanupExpiredGuests } from './services/guest-cleanup.js';
import { cleanExpiredSessions, markAllSessionsDisconnected } from './services/session.js';
import { cleanupAbandonedLobbies } from './services/lobby-cleanup.js';
import { cleanupExpiredTournaments } from './services/tournament-cleanup.js';
import { registerApiRoutes } from './routes/api.js';
import { recoverBlackjackLobbies } from './ws/blackjack-handler.js';
import { bjHandlerDeps, registerClient, setTokenVerifier, startBotTurnWatchdog } from './ws/handler.js';

async function main() {
  await initLobbyStore();
  await recoverInterruptedHands();
  await recoverBlackjackLobbies(bjHandlerDeps()).catch((err) => {
    console.error('[startup] Blackjack recovery failed:', err);
  });
  await tournamentManager.recoverTournamentTimers().catch((err) => {
    console.error('[startup] Tournament timer recovery failed:', err);
  });

  // Mark all sessions as disconnected so that crash-survivor sessions get a fresh
  // reconnect window (SEAT_RELEASE_MS) measured from this restart, not the original connect.
  // Players who actively reconnect will have their session cleared by markSessionConnected().
  try {
    await markAllSessionsDisconnected();
    console.log('[startup] Marked pre-existing sessions as disconnected (server restart)');
  } catch (err) {
    console.error('[startup] Failed to mark sessions as disconnected:', err);
  }

  // Delete any lobbies that are already clearly abandoned (closed status or all sessions expired).
  try {
    await cleanupAbandonedLobbies();
  } catch (err) {
    console.error('[startup] Initial lobby cleanup failed:', err);
  }

  // Delete expired finished/cancelled tournaments on startup.
  try {
    await cleanupExpiredTournaments();
  } catch (err) {
    console.error('[startup] Initial tournament cleanup failed:', err);
  }

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

  // Self-healing safety net: guarantees no AI seat can ever permanently stall a hand even if its
  // normal turn timer is lost. Runs independently of the per-action scheduling path.
  startBotTurnWatchdog();

  // Hourly maintenance: expire orphaned sessions, delete abandoned guests, remove stale lobbies.
  const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
  setInterval(async () => {
    try {
      await cleanExpiredSessions();
      await cleanupExpiredGuests();
      await cleanupAbandonedLobbies();
      await cleanupExpiredTournaments();
    } catch (err) {
      console.error('[cleanup] Periodic cleanup failed:', err);
    }
  }, CLEANUP_INTERVAL_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
