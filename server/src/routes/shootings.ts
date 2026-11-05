import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireUser } from '../auth.js';
import { pool } from '../db.js';
import { warmCache } from '../images.js';
import { refreshLibrary, scanLibrary } from '../library.js';

export async function shootingRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Shootings visibles : tous pour l'admin, sinon seulement ceux auxquels l'utilisateur a accès.
   * Avec ?refresh=1 (arrivée sur l'accueil), relit d'abord les dossiers du NAS si la dernière
   * lecture date de plus de 15 s, sans attendre plus de 4 s.
   */
  app.get<{ Querystring: { refresh?: string } }>('/api/shootings', { preHandler: requireUser }, async (request) => {
    const user = request.user!;
    if (request.query.refresh === '1') {
      const refresh = refreshLibrary(15_000)
        .then((result) => {
          // Nouveau dossier : on prépare ses miniatures tout de suite.
          if (result && result.added > 0) void warmCache(app.log).catch(() => {});
        })
        .catch((err) => request.log.error(err, 'Relecture des dossiers impossible'));
      await Promise.race([refresh, new Promise((r) => setTimeout(r, 4000))]);
    }
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
