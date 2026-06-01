import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { initLobbyStore } from './services/lobby.js';
import { registerApiRoutes } from './routes/api.js';
import { registerClient, setTokenVerifier } from './ws/handler.js';

async function main() {
  await initLobbyStore();

  const app = Fastify({ logger: true });

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
  await registerApiRoutes(app);

  setTokenVerifier(async (token) => app.jwt.verify<{ sub: string }>(token));

  app.get('/ws', { websocket: true }, (socket) => {
    registerClient(socket);
  });

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`Game server listening on http://localhost:${config.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
