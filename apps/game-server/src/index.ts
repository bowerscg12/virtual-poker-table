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
import {
  bjHandlerDeps,
  registerClient,
  setTokenVerifier,
  startBotTurnWatchdog,
  stopBotTurnWatchdog,
} from './ws/handler.js';
import { closeAllClients } from './ws/connection.js';
import { closeRedis } from './store/redis.js';
import { closeDb } from './db/client.js';
import { logger } from './logger.js';

async function main() {
  await initLobbyStore();
  await recoverInterruptedHands();
  await recoverBlackjackLobbies(bjHandlerDeps()).catch((err) => {
    logger.error({ err }, '[startup] Blackjack recovery failed');
  });
  await tournamentManager.recoverTournamentTimers().catch((err) => {
    logger.error({ err }, '[startup] Tournament timer recovery failed');
  });

  // Mark all sessions as disconnected so that crash-survivor sessions get a fresh
  // reconnect window (SEAT_RELEASE_MS) measured from this restart, not the original connect.
  // Players who actively reconnect will have their session cleared by markSessionConnected().
  try {
    await markAllSessionsDisconnected();
    logger.info('[startup] Marked pre-existing sessions as disconnected (server restart)');
  } catch (err) {
    logger.error({ err }, '[startup] Failed to mark sessions as disconnected');
  }

  // Delete any lobbies that are already clearly abandoned (closed status or all sessions expired).
  try {
    await cleanupAbandonedLobbies();
  } catch (err) {
    logger.error({ err }, '[startup] Initial lobby cleanup failed');
  }

  // Delete expired finished/cancelled tournaments on startup.
  try {
    await cleanupExpiredTournaments();
  } catch (err) {
    logger.error({ err }, '[startup] Initial tournament cleanup failed');
  }

  const app = Fastify({ logger, trustProxy: true });

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
  logger.info({ port: config.port }, 'Game server listening');

  // Self-healing safety net: guarantees no AI seat can ever permanently stall a hand even if its
  // normal turn timer is lost. Runs independently of the per-action scheduling path.
  startBotTurnWatchdog();

  // Hourly maintenance: expire orphaned sessions, delete abandoned guests, remove stale lobbies.
  const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
  const cleanupInterval = setInterval(async () => {
    try {
      await cleanExpiredSessions();
      await cleanupExpiredGuests();
      await cleanupAbandonedLobbies();
      await cleanupExpiredTournaments();
    } catch (err) {
      logger.error({ err }, '[cleanup] Periodic cleanup failed');
    }
  }, CLEANUP_INTERVAL_MS);

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  // Cloud Run sends SIGTERM on every deploy/scale-down and SIGKILLs ~10s later. Drain in-flight
  // work cleanly so deploys don't hard-kill live tables: stop background loops, close client sockets
  // with "service restart" (clients auto-reconnect into the Redis-recovered table), stop accepting
  // new connections, then release the DB/Redis pools. Authoritative game state already persists to
  // Redis on every action, so there is nothing to flush here.
  let shuttingDown = false;
  async function shutdown(signal: string, exitCode: number): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, '[shutdown] signal received — draining');

    clearInterval(cleanupInterval);
    stopBotTurnWatchdog();

    // Hard cap on the drain so a hung connection can't keep us alive until SIGKILL.
    const forceTimer = setTimeout(() => {
      logger.error('[shutdown] Drain timed out after 8s — forcing exit');
      process.exit(exitCode);
    }, 8000);
    forceTimer.unref();

    try {
      closeAllClients();
      await app.close();
      await closeRedis();
      await closeDb();
      logger.info('[shutdown] Drain complete');
    } catch (err) {
      logger.error({ err }, '[shutdown] Error during drain');
    } finally {
      clearTimeout(forceTimer);
      process.exit(exitCode);
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
  process.on('SIGINT', () => void shutdown('SIGINT', 0));

  // An uncaught exception leaves the process in an undefined state — log it, drain best-effort, and
  // exit non-zero so the orchestrator restarts a clean instance (which recovers tables from Redis).
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, '[fatal] Uncaught exception');
    void shutdown('uncaughtException', 1);
  });

  // A rejected promise without a handler is usually an isolated bug on one code path. Log it with
  // full context but DO NOT crash — taking down every table on the instance over one stray rejection
  // is the opposite of resilient for a multi-tenant server.
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, '[error] Unhandled promise rejection');
  });
}

main().catch((err) => {
  logger.fatal({ err }, '[fatal] Server failed to start');
  process.exit(1);
});
