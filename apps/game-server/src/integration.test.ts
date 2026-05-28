import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import sensible from '@fastify/sensible';
import { initLobbyStore } from './services/lobby.js';
import { registerApiRoutes } from './routes/api.js';

describe('API integration', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    await initLobbyStore();
    app = Fastify();
    await app.register(cors);
    await app.register(sensible);
    await app.register(jwt, { secret: 'test-secret' });
    app.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    });
    await registerApiRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('health check', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('guest auth and create lobby', async () => {
    const guest = await app.inject({
      method: 'POST',
      url: '/auth/guest',
      payload: { displayName: 'Tester' },
    });
    expect(guest.statusCode).toBe(200);
    const { token } = guest.json() as { token: string };

    const lobby = await app.inject({
      method: 'POST',
      url: '/lobbies',
      headers: { authorization: `Bearer ${token}` },
      payload: { presetId: 'nlhe-standard' },
    });
    expect(lobby.statusCode).toBe(200);
    const body = lobby.json() as { lobby: { inviteCode: string } };
    expect(body.lobby.inviteCode).toBeTruthy();
  });
});
