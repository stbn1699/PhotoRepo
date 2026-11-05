import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireUser } from '../auth.js';
import { pool } from '../db.js';
import { scanLibrary } from '../library.js';

export async function shootingRoutes(app: FastifyInstance): Promise<void> {
  /** Shootings visibles : tous pour l'admin, sinon seulement ceux auxquels l'utilisateur a accès. */
  app.get('/api/shootings', { preHandler: requireUser }, async (request) => {
    const user = request.user!;
    const { rows } = await pool.query(
      `SELECT s.id, s.title, s.shot_date AS "date", s.date_precision AS "datePrecision",
              s.image_count AS "imageCount"
         FROM shootings s
        WHERE s.present
          AND ($1::boolean OR EXISTS (
                SELECT 1 FROM shooting_access a WHERE a.shooting_id = s.id AND a.user_id = $2))
        ORDER BY s.shot_date DESC, s.title`,
      [user.isAdmin, user.id],
    );
    return { shootings: rows };
  });

  /** Relance la lecture des dossiers du NAS (sinon elle a lieu automatiquement toutes les X minutes). */
  app.post('/api/admin/rescan', { preHandler: requireAdmin }, async () => {
    return scanLibrary();
  });
}
