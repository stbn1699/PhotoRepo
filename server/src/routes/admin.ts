import type { FastifyInstance } from 'fastify';
import { hashPassword, requireAdmin } from '../auth.js';
import { pool } from '../db.js';
import { warmCache } from '../images.js';

const idParams = {
  type: 'object',
  properties: { id: { type: 'integer', minimum: 1, maximum: 2147483647 } },
  required: ['id'],
} as const;

const usernameSchema = { type: 'string', pattern: '^[A-Za-z0-9._-]{2,40}$' } as const;
const displayNameSchema = { type: ['string', 'null'], maxLength: 80 } as const;
const passwordSchema = { type: 'string', minLength: 8, maxLength: 200 } as const;
const idListSchema = {
  type: 'array',
  maxItems: 10000,
  uniqueItems: true,
  items: { type: 'integer', minimum: 1, maximum: 2147483647 },
} as const;

const USER_COLUMNS = `
  u.id, u.username, u.display_name AS "displayName", u.is_admin AS "isAdmin", u.disabled,
  u.created_at AS "createdAt", u.last_login_at AS "lastLoginAt",
  COALESCE((SELECT array_agg(a.shooting_id ORDER BY a.shooting_id) FROM shooting_access a WHERE a.user_id = u.id), '{}') AS "shootingIds"`;

function cleanDisplayName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);

  // ---------------------------------------------------------------- utilisateurs

  app.get('/api/admin/users', async () => {
    const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users u ORDER BY u.is_admin DESC, lower(u.username)`);
    return { users: rows };
  });

  app.get<{ Params: { id: number } }>('/api/admin/users/:id', { schema: { params: idParams } }, async (request, reply) => {
    const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [request.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Utilisateur introuvable' });
    return { user: rows[0] };
  });

  app.post<{ Body: { username: string; displayName?: string | null; password: string } }>(
    '/api/admin/users',
    {
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          additionalProperties: false,
          properties: { username: usernameSchema, displayName: displayNameSchema, password: passwordSchema },
        },
      },
    },
    async (request, reply) => {
      const { username, displayName, password } = request.body;
      try {
        const { rows } = await pool.query<{ id: number }>(
          'INSERT INTO users (username, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
          [username, cleanDisplayName(displayName), await hashPassword(password)],
        );
        return reply.code(201).send({ id: rows[0].id });
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          return reply.code(409).send({ error: 'Ce pseudo est déjà pris' });
        }
        throw err;
      }
    },
  );

  app.patch<{
    Params: { id: number };
    Body: { displayName?: string | null; password?: string; disabled?: boolean };
  }>(
    '/api/admin/users/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { displayName: displayNameSchema, password: passwordSchema, disabled: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { displayName, password, disabled } = request.body;
      if (disabled === true && id === request.user!.id) {
        return reply.code(400).send({ error: 'Tu ne peux pas désactiver ton propre compte' });
      }
      const { rows } = await pool.query('SELECT 1 FROM users WHERE id = $1', [id]);
      if (!rows[0]) return reply.code(404).send({ error: 'Utilisateur introuvable' });

      if (displayName !== undefined) {
        await pool.query('UPDATE users SET display_name = $2 WHERE id = $1', [id, cleanDisplayName(displayName)]);
      }
      if (password !== undefined) {
        await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, await hashPassword(password)]);
      }
      if (disabled !== undefined) {
        await pool.query('UPDATE users SET disabled = $2 WHERE id = $1', [id, disabled]);
      }
      // Nouveau mot de passe ou compte désactivé : on déconnecte cette personne partout
      // (sauf la session en cours si l'admin change son propre mot de passe).
      if (password !== undefined || disabled === true) {
        await pool.query('DELETE FROM sessions WHERE user_id = $1 AND ($1 <> $2 OR $3::boolean)', [
          id,
          request.user!.id,
          disabled === true,
        ]);
      }
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: number } }>('/api/admin/users/:id', { schema: { params: idParams } }, async (request, reply) => {
    const { id } = request.params;
    if (id === request.user!.id) return reply.code(400).send({ error: 'Tu ne peux pas supprimer ton propre compte' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ username: string; is_admin: boolean }>(
        'SELECT username, is_admin FROM users WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Utilisateur introuvable' });
      }
      if (rows[0].is_admin) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Un compte admin ne peut pas être supprimé ici' });
      }
      // On garde l'historique : le pseudo est recopié dans les événements avant suppression.
      await client.query(
        `UPDATE events SET details = COALESCE(details, '{}'::jsonb) || jsonb_build_object('deletedUser', $2::text)
          WHERE user_id = $1`,
        [id, rows[0].username],
      );
      await client.query('DELETE FROM users WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return { ok: true };
  });

  /** Remplace la liste des shootings accessibles à un utilisateur. */
  app.put<{ Params: { id: number }; Body: { shootingIds: number[] } }>(
    '/api/admin/users/:id/access',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['shootingIds'],
          additionalProperties: false,
          properties: { shootingIds: idListSchema },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT 1 FROM users WHERE id = $1', [id]);
        if (!rows[0]) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'Utilisateur introuvable' });
        }
        await client.query('DELETE FROM shooting_access WHERE user_id = $1 AND NOT (shooting_id = ANY($2::int[]))', [
          id,
          request.body.shootingIds,
        ]);
        await client.query(
          `INSERT INTO shooting_access (user_id, shooting_id)
           SELECT $1, s.id FROM shootings s WHERE s.id = ANY($2::int[])
           ON CONFLICT DO NOTHING`,
          [id, request.body.shootingIds],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      return { ok: true };
    },
  );

  // ---------------------------------------------------------------- shootings

  /** Tous les shootings présents, avec la liste des utilisateurs qui y ont accès. */
  app.get('/api/admin/shootings', async () => {
    const { rows } = await pool.query(
      `SELECT s.id, s.title, s.shot_date AS "date", s.date_precision AS "datePrecision", s.image_count AS "imageCount",
              s.raws_shared AS "rawsShared", s.raw_count AS "rawCount",
              COALESCE((SELECT array_agg(a.user_id ORDER BY a.user_id) FROM shooting_access a WHERE a.shooting_id = s.id), '{}') AS "userIds"
         FROM shootings s
        WHERE s.present
        ORDER BY s.shot_date DESC, s.title`,
    );
    return { shootings: rows };
  });

  /** Réglages d'un shooting : partage des RAW (désactivé par défaut). */
  app.patch<{ Params: { id: number }; Body: { rawsShared: boolean } }>(
    '/api/admin/shootings/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['rawsShared'],
          additionalProperties: false,
          properties: { rawsShared: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const { rowCount } = await pool.query('UPDATE shootings SET raws_shared = $2 WHERE id = $1', [
        request.params.id,
        request.body.rawsShared,
      ]);
      if (!rowCount) return reply.code(404).send({ error: 'Shooting introuvable' });
      // RAW partagés : on prépare leurs miniatures en arrière-plan.
      if (request.body.rawsShared) void warmCache(app.log).catch(() => {});
      return { ok: true };
    },
  );

  /** Remplace la liste des utilisateurs qui ont accès à un shooting. */
  app.put<{ Params: { id: number }; Body: { userIds: number[] } }>(
    '/api/admin/shootings/:id/access',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['userIds'],
          additionalProperties: false,
          properties: { userIds: idListSchema },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT 1 FROM shootings WHERE id = $1', [id]);
        if (!rows[0]) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'Shooting introuvable' });
        }
        await client.query('DELETE FROM shooting_access WHERE shooting_id = $1 AND NOT (user_id = ANY($2::int[]))', [
          id,
          request.body.userIds,
        ]);
        await client.query(
          `INSERT INTO shooting_access (user_id, shooting_id)
           SELECT u.id, $1 FROM users u WHERE u.id = ANY($2::int[])
           ON CONFLICT DO NOTHING`,
          [id, request.body.userIds],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      return { ok: true };
    },
  );
}
