import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CreateLobbyRequest } from '@vct/shared-types';
import { RULES_PRESETS } from '@vct/shared-types';
import { guestLogin, loginUser, registerUser, toAuthResponse } from '../services/auth.js';
import {
  createLobby,
  getLobbyById,
  getLobbyByInvite,
} from '../services/lobby.js';
import { getHandHistories } from '../services/game-manager.js';

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  const displayNameSchema = z.string().trim().min(1).max(10);

  app.post('/auth/register', async (req, reply) => {
    const body = z
      .object({
        displayName: displayNameSchema,
        email: z.string().email().optional(),
        password: z.string().min(6).optional(),
      })
      .parse(req.body);
    const user = await registerUser(body.displayName, body.email, body.password);
    const token = await reply.jwtSign({ sub: user.id });
    return toAuthResponse(user, token);
  });

  app.post('/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
    const user = await loginUser(body.email, body.password);
    if (!user) return reply.status(401).send({ error: 'Invalid credentials' });
    const token = await reply.jwtSign({ sub: user.id });
    return toAuthResponse(user, token);
  });

  app.post('/auth/guest', async (req, reply) => {
    const body = z.object({ displayName: displayNameSchema }).parse(req.body);
    const user = await guestLogin(body.displayName);
    const token = await reply.jwtSign({ sub: user.id });
    return toAuthResponse(user, token);
  });

  app.get('/auth/me', { onRequest: [app.authenticate] }, async (req) => {
    const userId = (req.user as { sub: string }).sub;
    const { getUserById } = await import('../services/auth.js');
    const user = await getUserById(userId);
    if (!user) throw app.httpErrors.notFound();
    return { user };
  });

  app.post('/lobbies', { onRequest: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as { sub: string }).sub;
    const body = req.body as CreateLobbyRequest;
    try {
      const lobby = await createLobby(userId, body);
      const token = await reply.jwtSign({ sub: userId });
      return { lobby, token };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Invalid lobby settings' });
    }
  });

  app.get('/lobbies/invite/:code', async (req) => {
    const { code } = req.params as { code: string };
    const lobby = await getLobbyByInvite(code);
    if (!lobby) throw app.httpErrors.notFound('Lobby not found');
    return { lobby };
  });

  app.get('/lobbies/:id', async (req) => {
    const { id } = req.params as { id: string };
    const lobby = await getLobbyById(id);
    if (!lobby) throw app.httpErrors.notFound();
    return { lobby };
  });

  app.get('/lobbies/:id/hands', async (req) => {
    const { id } = req.params as { id: string };
    return { hands: getHandHistories(id) };
  });

  app.get('/presets', async () => ({ presets: RULES_PRESETS }));

  app.get('/health', async () => ({ ok: true }));
}
