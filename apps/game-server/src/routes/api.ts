import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthUser, CreateLobbyRequest } from '@vct/shared-types';
import { RULES_PRESETS } from '@vct/shared-types';
import { guestLogin, getUserById, loginUser, registerUser, toAuthResponse, updateUserDisplayName } from '../services/auth.js';
import {
  autoSeatPlayer,
  createLobby,
  getLobbyById,
  getLobbyByInvite,
  withLobbyEntryLock,
} from '../services/lobby.js';
import { getHandHistories } from '../services/game-manager.js';
import { createSession } from '../services/session.js';

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
    const user = await getUserById(userId);
    if (!user) throw app.httpErrors.notFound();
    return { user };
  });

  app.patch('/auth/me', { onRequest: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as { sub: string }).sub;
    const body = z.object({ displayName: displayNameSchema }).parse(req.body);
    const user = await updateUserDisplayName(userId, body.displayName);
    if (!user) return reply.status(404).send({ error: 'User not found' });
    return { user };
  });

  /** Try to extract an existing authenticated user from the request JWT. Returns null if missing/invalid. */
  async function tryGetAuthUser(req: Parameters<typeof app.authenticate>[0]): Promise<AuthUser | null> {
    try {
      await req.jwtVerify();
      const userId = (req.user as { sub: string }).sub;
      return getUserById(userId);
    } catch {
      return null;
    }
  }

  /**
   * Create a new table.
   * If a valid JWT is provided, the existing user is reused (no new guest created).
   * Otherwise a guest user is created from the displayName in the body.
   * Body: { displayName?, presetId?, settings? }
   * Returns: { user, token, sessionId, lobby }
   */
  app.post('/lobbies', async (req, reply) => {
    const body = z
      .object({
        displayName: displayNameSchema.optional(),
        presetId: z.string().optional(),
        settings: z.any().optional(),
        avatar: z.any().optional(),
      })
      .parse(req.body);

    const authUser = await tryGetAuthUser(req);
    let user: AuthUser;

    if (authUser) {
      user = authUser;
    } else {
      if (!body.displayName) {
        return reply.status(400).send({ error: 'Display name required' });
      }
      user = await guestLogin(body.displayName, body.avatar);
    }

    const token = await reply.jwtSign({ sub: user.id });
    const lobbyReq: CreateLobbyRequest = { presetId: body.presetId, settings: body.settings };
    try {
      const lobby = await createLobby(user.id, lobbyReq);
      const sessionId = await createSession(user.id, lobby.id);
      return { user, token, sessionId, lobby };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Invalid lobby settings' });
    }
  });

  /**
   * Join an existing table.
   * If a valid JWT is provided, the existing user is reused and name checks are skipped.
   * Otherwise a guest user is created after name uniqueness validation.
   * Body: { displayName?, avatar? }
   * Returns: { user, token, sessionId }
   */
  app.post('/lobbies/:id/enter', async (req, reply) => {
    const { id: lobbyId } = req.params as { id: string };
    const body = z.object({ displayName: displayNameSchema.optional(), avatar: z.any().optional() }).parse(req.body);

    const lobby = await getLobbyById(lobbyId);
    if (!lobby) return reply.status(404).send({ error: 'Lobby not found' });

    const authUser = await tryGetAuthUser(req);

    if (authUser) {
      // Authenticated path — skip name uniqueness check, use existing identity
      return withLobbyEntryLock(lobbyId, async () => {
        const freshLobby = await getLobbyById(lobbyId);
        if (!freshLobby) return reply.status(404).send({ error: 'Lobby not found' });

        const alreadySeated = freshLobby.seats.some((s) => s.userId === authUser.id);
        const hasOpenSeat = alreadySeated || freshLobby.seats.some((s) => !s.userId);
        if (!hasOpenSeat) {
          return reply.status(409).send({ error: 'Table is full', code: 'TABLE_FULL' });
        }

        const seatResult = await autoSeatPlayer(lobbyId, authUser.id, authUser.displayName);
        if (!seatResult || 'error' in seatResult) {
          const r = seatResult as { error: string; code?: string } | null;
          return reply.status(409).send({ error: r?.error ?? 'Could not join table', code: r?.code ?? 'SEAT_FAILED' });
        }

        const token = await reply.jwtSign({ sub: authUser.id });
        const sessionId = await createSession(authUser.id, lobbyId);
        return { user: authUser, token, sessionId };
      });
    }

    // Guest path — existing behavior
    return withLobbyEntryLock(lobbyId, async () => {
      const freshLobby = await getLobbyById(lobbyId);
      if (!freshLobby) return reply.status(404).send({ error: 'Lobby not found' });

      const hasOpenSeat = freshLobby.seats.some((s) => !s.userId);
      if (!hasOpenSeat) {
        return reply.status(409).send({ error: 'Table is full', code: 'TABLE_FULL' });
      }

      if (!body.displayName) {
        return reply.status(400).send({ error: 'Display name required' });
      }

      // Name uniqueness check — case-insensitive, trimmed
      const normalizedNew = body.displayName.toLowerCase().trim();
      const nameTaken = freshLobby.seats.some(
        (s) => s.displayName && s.displayName.toLowerCase().trim() === normalizedNew
      );
      if (nameTaken) {
        return reply.status(409).send({
          error: 'That name is already taken at this table. Please choose another name.',
          code: 'NAME_TAKEN',
        });
      }

      const user = await guestLogin(body.displayName, body.avatar);
      const seatResult = await autoSeatPlayer(lobbyId, user.id, body.displayName);
      if (!seatResult || 'error' in seatResult) {
        return reply.status(409).send({ error: seatResult?.error ?? 'Could not join table', code: 'SEAT_FAILED' });
      }

      const token = await reply.jwtSign({ sub: user.id });
      const sessionId = await createSession(user.id, lobbyId);
      return { user, token, sessionId };
    });
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
