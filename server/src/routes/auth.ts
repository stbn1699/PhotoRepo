import type { FastifyInstance } from 'fastify';
import { checkCredentials, createSession, destroySession, requireUser } from '../auth.js';
import { logEvent } from '../db.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { username: string; password: string } }>(
    '/api/auth/login',
    {
      // Max 10 tentatives par 15 minutes et par IP, contre les attaques par force brute.
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', minLength: 1, maxLength: 100 },
            password: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const { username, password } = request.body;
      const user = await checkCredentials(username.trim(), password);
      if (!user) {
        await logEvent({ userId: null, type: 'login_failed', details: { username }, ip: request.ip });
        return reply.code(401).send({ error: 'Pseudo ou mot de passe incorrect' });
      }
      await createSession(reply, request, user.id);
      await logEvent({ userId: user.id, type: 'login', ip: request.ip });
      return { user };
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    if (request.user) await logEvent({ userId: request.user.id, type: 'logout', ip: request.ip });
    await destroySession(reply, request);
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireUser }, async (request) => {
    return { user: request.user };
  });
}
