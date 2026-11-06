import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth.js';
import { pool } from '../db.js';

const EVENT_GROUPS = {
  views: ['view_shooting', 'view_image'],
  downloads: ['download_image', 'download_zip'],
  likes: ['like_image'],
  logins: ['login', 'login_failed', 'logout'],
} as const;
type EventGroup = keyof typeof EVENT_GROUPS;

const filterProps = {
  userId: { type: 'integer', minimum: 1, maximum: 2147483647 },
  shootingId: { type: 'integer', minimum: 1, maximum: 2147483647 },
  days: { type: 'integer', minimum: 1, maximum: 3650 },
  includeAdmin: { type: 'boolean', default: false },
} as const;

interface Filters {
  userId?: number;
  shootingId?: number;
  days?: number;
  includeAdmin?: boolean;
}

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);

  /** Résumé par personne et par shooting : visites, photos vues, photos téléchargées. */
  app.get<{ Querystring: Filters }>(
    '/api/admin/activity/summary',
    { schema: { querystring: { type: 'object', properties: filterProps } } },
    async (request) => {
      const { userId, shootingId, days, includeAdmin } = request.query;
      const { rows } = await pool.query(
        `SELECT e.user_id AS "userId", u.username, u.display_name AS "displayName",
                e.shooting_id AS "shootingId", s.title, s.image_count AS "imageCount",
                count(*) FILTER (WHERE e.type = 'view_shooting')::int AS visits,
                count(DISTINCT e.image_number) FILTER (WHERE e.type = 'view_image')::int AS viewed,
                count(DISTINCT e.image_number) FILTER (WHERE e.type = 'download_image')::int AS downloaded,
                (SELECT count(*) FROM likes l WHERE l.user_id = e.user_id AND l.shooting_id = e.shooting_id)::int AS liked,
                max(e.created_at) AS "lastAt"
           FROM events e
           JOIN users u ON u.id = e.user_id
           JOIN shootings s ON s.id = e.shooting_id
          WHERE ($1::int IS NULL OR e.user_id = $1)
            AND ($2::int IS NULL OR e.shooting_id = $2)
            AND ($3::int IS NULL OR e.created_at > now() - make_interval(days => $3))
            AND ($4::boolean OR NOT u.is_admin)
          GROUP BY e.user_id, u.username, u.display_name, e.shooting_id, s.title, s.image_count
          ORDER BY "lastAt" DESC`,
        [userId ?? null, shootingId ?? null, days ?? null, includeAdmin ?? false],
      );
      return { rows };
    },
  );

  /** Détail image par image pour une personne et un shooting. */
  app.get<{ Querystring: { userId: number; shootingId: number } }>(
    '/api/admin/activity/detail',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['userId', 'shootingId'],
          properties: { userId: filterProps.userId, shootingId: filterProps.shootingId },
        },
      },
    },
    async (request, reply) => {
      const { userId, shootingId } = request.query;
      const [user, shooting, images, visits, likes] = await Promise.all([
        pool.query('SELECT id, username, display_name AS "displayName" FROM users WHERE id = $1', [userId]),
        pool.query('SELECT id, title FROM shootings WHERE id = $1', [shootingId]),
        pool.query(
          `SELECT image_number AS number, version, type, count(*)::int AS count,
                  min(created_at) AS "firstAt", max(created_at) AS "lastAt"
             FROM events
            WHERE user_id = $1 AND shooting_id = $2 AND type IN ('view_image', 'download_image')
            GROUP BY image_number, version, type
            ORDER BY image_number`,
          [userId, shootingId],
        ),
        pool.query(
          `SELECT count(*)::int AS count, min(created_at) AS "firstAt", max(created_at) AS "lastAt"
             FROM events WHERE user_id = $1 AND shooting_id = $2 AND type = 'view_shooting'`,
          [userId, shootingId],
        ),
        pool.query<{ image_number: number }>(
          'SELECT image_number FROM likes WHERE user_id = $1 AND shooting_id = $2 ORDER BY image_number',
          [userId, shootingId],
        ),
      ]);
      if (!user.rows[0] || !shooting.rows[0]) return reply.code(404).send({ error: 'Introuvable' });
      return {
        user: user.rows[0],
        shooting: shooting.rows[0],
        images: images.rows,
        visits: visits.rows[0],
        likes: likes.rows.map((r) => r.image_number),
      };
    },
  );

  /** Journal chronologique (du plus récent au plus ancien), par pages. */
  app.get<{ Querystring: Filters & { group?: EventGroup; before?: number; limit?: number } }>(
    '/api/admin/activity/events',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            ...filterProps,
            group: { type: 'string', enum: Object.keys(EVENT_GROUPS) },
            before: { type: 'integer', minimum: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 1000, default: 300 },
          },
        },
      },
    },
    async (request) => {
      const { userId, shootingId, days, includeAdmin, group, before, limit = 300 } = request.query;
      const types = group ? [...EVENT_GROUPS[group]] : Object.values(EVENT_GROUPS).flat();
      const { rows } = await pool.query(
        `SELECT e.id::int AS id, e.type, e.created_at AS "at",
                e.user_id AS "userId", u.username, u.display_name AS "displayName",
                e.shooting_id AS "shootingId", s.title,
                e.image_number AS "number", e.version, e.details, e.ip
           FROM events e
           LEFT JOIN users u ON u.id = e.user_id
           LEFT JOIN shootings s ON s.id = e.shooting_id
          WHERE e.type = ANY($1::text[])
            AND ($2::bigint IS NULL OR e.id < $2)
            AND ($3::int IS NULL OR e.user_id = $3)
            AND ($4::int IS NULL OR e.shooting_id = $4)
            AND ($5::int IS NULL OR e.created_at > now() - make_interval(days => $5))
            AND ($6::boolean OR u.id IS NULL OR NOT u.is_admin)
          ORDER BY e.id DESC
          LIMIT $7`,
        [types, before ?? null, userId ?? null, shootingId ?? null, days ?? null, includeAdmin ?? false, limit + 1],
      );
      const hasMore = rows.length > limit;
      const events = hasMore ? rows.slice(0, limit) : rows;
      return { events, nextBefore: hasMore ? events[events.length - 1].id : null };
    },
  );
}
