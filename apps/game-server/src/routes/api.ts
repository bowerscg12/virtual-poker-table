import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthUser, CreateLobbyRequest, CreateTemplateRequest } from '@vct/shared-types';
import { RULES_PRESETS } from '@vct/shared-types';
import { guestLogin, getUserById, loginUser, registerUser, toAuthResponse, updateUserAvatar, updateUserDisplayName } from '../services/auth.js';
import {
  autoSeatPlayer,
  createLobby,
  getActiveSeatForUser,
  getLobbyById,
  getLobbyByInvite,
  removeSeat,
  withLobbyEntryLock,
} from '../services/lobby.js';
import { getHandHistories } from '../services/game-manager.js';
import { createSession, deleteSessionsByUserId } from '../services/session.js';
import { createTemplate, deleteTemplate, getTemplatesForUser } from '../services/templates.js';

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  const displayNameSchema = z.string().trim().min(1).max(10);

  app.post('/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z
      .object({
        displayName: displayNameSchema,
        username: z.string().min(3).max(20),
        password: z.string().min(6),
      })
      .parse(req.body);
    let user;
    try {
      user = await registerUser(body.displayName, body.username, body.password);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Registration failed';
      return reply.status(400).send({ error: msg });
    }
    const token = await reply.jwtSign({ sub: user.id });
    return toAuthResponse(user, token);
  });

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({ username: z.string(), password: z.string() }).parse(req.body);
    const user = await loginUser(body.username, body.password);
    if (!user) return reply.status(401).send({ error: 'Invalid credentials' });
    const token = await reply.jwtSign({ sub: user.id });
    return toAuthResponse(user, token);
  });

  app.post('/auth/guest', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
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
  app.post('/lobbies', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
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
      if (body.avatar) {
        await updateUserAvatar(authUser.id, body.avatar);
        user = { ...authUser, avatar: body.avatar };
      } else {
        user = authUser;
      }
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
      const msg = error instanceof Error ? error.message : 'Invalid lobby settings';
      // Log the full error so database-level details (column missing, constraint, etc.) are visible in server logs.
      app.log.error({ err: error }, `createLobby failed: ${msg}`);
      return reply.status(400).send({ error: msg });
    }
  });

  /**
   * Join an existing table.
   * If a valid JWT is provided, the existing user is reused and name checks are skipped.
   * Otherwise a guest user is created after name uniqueness validation.
   * Body: { displayName?, avatar? }
   * Returns: { user, token, sessionId }
   */
  app.post('/lobbies/:id/enter', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
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

        if (body.avatar) await updateUserAvatar(authUser.id, body.avatar);

        const seatResult = await autoSeatPlayer(lobbyId, authUser.id, authUser.displayName);
        if (!seatResult || 'error' in seatResult) {
          const r = seatResult as { error: string; code?: string } | null;
          return reply.status(409).send({ error: r?.error ?? 'Could not join table', code: r?.code ?? 'SEAT_FAILED' });
        }

        const token = await reply.jwtSign({ sub: authUser.id });
        const sessionId = await createSession(authUser.id, lobbyId);
        const user = body.avatar ? { ...authUser, avatar: body.avatar } : authUser;
        return { user, token, sessionId };
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

  /** Return the player's active reserved seat, if any. */
  app.get('/me/seat', { onRequest: [app.authenticate] }, async (req) => {
    const userId = (req.user as { sub: string }).sub;
    const seat = await getActiveSeatForUser(userId);
    return { seat };
  });

  /** Release the player's active reserved seat (decline rejoin). */
  app.delete('/me/seat', { onRequest: [app.authenticate] }, async (req) => {
    const userId = (req.user as { sub: string }).sub;
    const seat = await getActiveSeatForUser(userId);
    if (seat) {
      await removeSeat(seat.lobbyId, userId);
      await deleteSessionsByUserId(userId);
    }
    return { ok: true };
  });

  app.get('/presets', async () => ({ presets: RULES_PRESETS }));

  // ── Lobby Templates ────────────────────────────────────────────────────────

  app.get('/templates', { onRequest: [app.authenticate] }, async (req) => {
    const userId = (req.user as { sub: string }).sub;
    const templates = await getTemplatesForUser(userId);
    return { templates };
  });

  app.post('/templates', { onRequest: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as { sub: string }).sub;
    const body = z
      .object({ name: z.string().min(1).max(64), settings: z.any() })
      .parse(req.body);

    const user = await getUserById(userId);
    if (!user || user.isGuest) {
      return reply.status(403).send({ error: 'Templates are only available to registered accounts' });
    }

    try {
      const template = await createTemplate(userId, body as CreateTemplateRequest);
      return reply.status(201).send({ template });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save template';
      return reply.status(400).send({ error: msg });
    }
  });

  app.delete('/templates/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as { sub: string }).sub;
    const { id } = req.params as { id: string };
    const deleted = await deleteTemplate(userId, id);
    if (!deleted) return reply.status(404).send({ error: 'Template not found' });
    return { ok: true };
  });

  app.get('/health', { config: { rateLimit: false } }, async () => ({ ok: true }));
}
