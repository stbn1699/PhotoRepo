import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireUser, type SessionUser } from '../auth.js';
import { logEvent, pool } from '../db.js';
import { getRendition, type Rendition } from '../images.js';
import { getShootingIndex, isVersion, VERSIONS, type ImageFile } from '../library.js';

interface ShootingRow {
  id: number;
  folder_name: string;
  title: string;
  date: string;
  date_precision: 'day' | 'month';
  raws_shared: boolean;
}

/** Les RAW ne sont visibles que si l'admin les a partagés pour ce shooting (l'admin les voit toujours). */
function canSeeRaws(user: SessionUser, shooting: ShootingRow): boolean {
  return user.isAdmin || shooting.raws_shared;
}

/** Le shooting si l'utilisateur y a accès, sinon null (même réponse s'il n'existe pas, pour ne rien dévoiler). */
async function findAccessibleShooting(user: SessionUser, id: number): Promise<ShootingRow | null> {
  const { rows } = await pool.query<ShootingRow>(
    `SELECT s.id, s.folder_name, s.title, s.shot_date AS date, s.date_precision, s.raws_shared
       FROM shootings s
      WHERE s.id = $1 AND s.present
        AND ($2::boolean OR EXISTS (
              SELECT 1 FROM shooting_access a WHERE a.shooting_id = s.id AND a.user_id = $3))`,
    [id, user.isAdmin, user.id],
  );
  return rows[0] ?? null;
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

/** Jeton de version ajouté aux URL : change quand le fichier change, ce qui permet un cache navigateur long. */
function versionToken(image: ImageFile): string {
  return `${Math.round(image.mtimeMs).toString(36)}${image.size.toString(36)}`;
}

function contentDisposition(type: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function sendFile(reply: FastifyReply, filePath: string, size: number, type: string) {
  reply.header('Content-Type', type);
  reply.header('Content-Length', size);
  return reply.send(fs.createReadStream(filePath));
}

const idParam = { type: 'integer', minimum: 1, maximum: 2147483647 } as const;

export async function galleryRoutes(app: FastifyInstance): Promise<void> {
  /** Détail d'un shooting : la liste de ses images et des versions disponibles. */
  app.get<{ Params: { id: number } }>(
    '/api/shootings/:id',
    {
      preHandler: requireUser,
      schema: { params: { type: 'object', properties: { id: idParam }, required: ['id'] } },
    },
    async (request, reply) => {
      const user = request.user!;
      const shooting = await findAccessibleShooting(user, request.params.id);
      if (!shooting) return reply.code(404).send({ error: 'Shooting introuvable' });

      const index = await getShootingIndex(shooting.folder_name);
      const showRaws = canSeeRaws(user, shooting);
      // Sans partage des RAW, les numéros qui n'ont qu'un RAW n'apparaissent pas du tout.
      const images = [...index.images.entries()]
        .filter(([, versions]) => versions.original || showRaws)
        .map(([number, versions]) => ({
          number,
          versions: Object.fromEntries(
            VERSIONS.filter((v) => versions[v] && (v !== 'raw' || showRaws)).map((v) => {
              const f = versions[v]!;
              return [v, { width: f.width, height: f.height, size: f.size, name: f.name, token: versionToken(f) }];
            }),
          ),
        }));

      // Likes : les miens, et pour l'admin ceux des modèles (photo → prénoms).
      const myLikes = await pool.query<{ image_number: number }>(
        'SELECT image_number FROM likes WHERE user_id = $1 AND shooting_id = $2',
        [user.id, shooting.id],
      );
      let likedBy: Record<number, string[]> | undefined;
      if (user.isAdmin) {
        const { rows } = await pool.query<{ image_number: number; name: string }>(
          `SELECT l.image_number, COALESCE(u.display_name, u.username) AS name
             FROM likes l JOIN users u ON u.id = l.user_id
            WHERE l.shooting_id = $1 AND NOT u.is_admin
            ORDER BY l.created_at`,
          [shooting.id],
        );
        likedBy = {};
        for (const r of rows) (likedBy[r.image_number] ??= []).push(r.name);
      }

      await logEvent({ userId: user.id, type: 'view_shooting', shootingId: shooting.id, ip: request.ip });
      return {
        shooting: {
          id: shooting.id,
          title: shooting.title,
          date: shooting.date,
          datePrecision: shooting.date_precision,
          imageCount: images.filter((i) => 'original' in i.versions).length,
          rawsShared: shooting.raws_shared,
        },
        images,
        myLikes: myLikes.rows.map((r) => r.image_number),
        likedBy,
        // Visible uniquement par l'admin : fichiers ignorés car leur numéro était déjà pris.
        duplicates: user.isAdmin ? index.duplicates : undefined,
      };
    },
  );

  /**
   * Fichier d'une image :
   *  - thumb   : miniature pour la galerie
   *  - preview : aperçu pour la vue en grand (enregistré comme "vue")
   *  - original: le fichier d'origine, pleine qualité (?download=1 → enregistré comme "téléchargement")
   */
  app.get<{
    Params: { id: number; number: number; version: string; kind: string };
    Querystring: { download?: string; batch?: string };
  }>(
    '/api/shootings/:id/images/:number/:version/:kind',
    {
      preHandler: requireUser,
      schema: {
        params: {
          type: 'object',
          properties: {
            id: idParam,
            number: { type: 'integer', minimum: 0, maximum: 2147483647 },
            version: { type: 'string', enum: [...VERSIONS] },
            kind: { type: 'string', enum: ['thumb', 'preview', 'original'] },
          },
          required: ['id', 'number', 'version', 'kind'],
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { id, number, version, kind } = request.params;
      if (!isVersion(version)) return reply.code(400).send({ error: 'Version inconnue' });

      const shooting = await findAccessibleShooting(user, id);
      if (!shooting) return reply.code(404).send({ error: 'Image introuvable' });
      if (version === 'raw') {
        if (!canSeeRaws(user, shooting)) return reply.code(404).send({ error: 'Image introuvable' });
        // Les RAW ne sont jamais téléchargeables, même pour l'admin : seuls les aperçus filigranés sont servis.
        if (kind === 'original') return reply.code(403).send({ error: 'Les fichiers RAW ne sont pas téléchargeables' });
      }
      const image = (await getShootingIndex(shooting.folder_name)).images.get(number)?.[version];
      if (!image) return reply.code(404).send({ error: 'Image introuvable' });

      if (kind === 'original') {
        const download = request.query.download === '1';
        if (download) {
          await logEvent({
            userId: user.id,
            type: 'download_image',
            shootingId: shooting.id,
            imageNumber: number,
            version,
            details: request.query.batch ? { batch: true } : null,
            ip: request.ip,
          });
        }
        reply.header('Cache-Control', 'private, no-cache');
        reply.header('Content-Disposition', contentDisposition(download ? 'attachment' : 'inline', image.name));
        const type = MIME[path.extname(image.name).toLowerCase()] ?? 'application/octet-stream';
        return sendFile(reply, image.path, image.size, type);
      }

      const file = await getRendition(image, kind as Rendition);
      // L'URL contient un jeton qui change avec le fichier : le navigateur peut garder l'image longtemps.
      // Aperçus RAW : pas de cache navigateur (ils ne restent pas sur le téléphone de la personne).
      reply.header('Cache-Control', version === 'raw' ? 'private, no-store' : 'private, max-age=31536000, immutable');
      const stat = await fs.promises.stat(file);
      return sendFile(reply, file, stat.size, 'image/webp');
    },
  );

  /**
   * Signale qu'une photo a été affichée en grand. Envoyé par le site au moment où la photo
   * est vraiment montrée (les photos voisines préchargées ne comptent pas).
   */
  app.post<{ Params: { id: number; number: number; version: string } }>(
    '/api/shootings/:id/images/:number/:version/view',
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
      schema: {
        params: {
          type: 'object',
          properties: {
            id: idParam,
            number: { type: 'integer', minimum: 0, maximum: 2147483647 },
            version: { type: 'string', enum: [...VERSIONS] },
          },
          required: ['id', 'number', 'version'],
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { id, number, version } = request.params;
      if (!isVersion(version)) return reply.code(400).send({ error: 'Version inconnue' });
      const shooting = await findAccessibleShooting(user, id);
      if (!shooting) return reply.code(404).send({ error: 'Image introuvable' });
      if (version === 'raw' && !canSeeRaws(user, shooting)) return reply.code(404).send({ error: 'Image introuvable' });
      if (!(await getShootingIndex(shooting.folder_name)).images.get(number)?.[version]) {
        return reply.code(404).send({ error: 'Image introuvable' });
      }
      await logEvent({ userId: user.id, type: 'view_image', shootingId: shooting.id, imageNumber: number, version, ip: request.ip });
      return { ok: true };
    },
  );

  /** Aimer / ne plus aimer une photo (toutes versions confondues : c'est le numéro qui compte). */
  const likeSchema = {
    params: {
      type: 'object',
      properties: { id: idParam, number: { type: 'integer', minimum: 0, maximum: 2147483647 } },
      required: ['id', 'number'],
    },
  } as const;

  app.put<{ Params: { id: number; number: number } }>(
    '/api/shootings/:id/images/:number/like',
    { preHandler: requireUser, schema: likeSchema, config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = request.user!;
      const { id, number } = request.params;
      const shooting = await findAccessibleShooting(user, id);
      if (!shooting) return reply.code(404).send({ error: 'Image introuvable' });
      const versions = (await getShootingIndex(shooting.folder_name)).images.get(number);
      // La photo doit être visible pour cette personne (un RAW seul ne compte que si les RAW sont partagés).
      if (!versions || !(versions.original || (versions.raw && canSeeRaws(user, shooting)))) {
        return reply.code(404).send({ error: 'Image introuvable' });
      }
      const { rowCount } = await pool.query(
        'INSERT INTO likes (user_id, shooting_id, image_number) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [user.id, shooting.id, number],
      );
      if (rowCount) {
        await logEvent({ userId: user.id, type: 'like_image', shootingId: shooting.id, imageNumber: number, ip: request.ip });
      }
      return { liked: true };
    },
  );

  app.delete<{ Params: { id: number; number: number } }>(
    '/api/shootings/:id/images/:number/like',
    { preHandler: requireUser, schema: likeSchema, config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = request.user!;
      const shooting = await findAccessibleShooting(user, request.params.id);
      if (!shooting) return reply.code(404).send({ error: 'Image introuvable' });
      await pool.query('DELETE FROM likes WHERE user_id = $1 AND shooting_id = $2 AND image_number = $3', [
        user.id,
        shooting.id,
        request.params.number,
      ]);
      return { liked: false };
    },
  );

  /** Image de couverture d'un shooting (miniature de sa première photo). */
  app.get<{ Params: { id: number } }>(
    '/api/shootings/:id/cover',
    {
      preHandler: requireUser,
      schema: { params: { type: 'object', properties: { id: idParam }, required: ['id'] } },
    },
    async (request, reply) => {
      const shooting = await findAccessibleShooting(request.user!, request.params.id);
      if (!shooting) return reply.code(404).send({ error: 'Introuvable' });
      const first = [...(await getShootingIndex(shooting.folder_name)).images.values()].find((v) => v.original);
      if (!first?.original) return reply.code(404).send({ error: 'Aucune image' });
      const file = await getRendition(first.original, 'thumb');
      const stat = await fs.promises.stat(file);
      reply.header('Cache-Control', 'private, max-age=600');
      return sendFile(reply, file, stat.size, 'image/webp');
    },
  );
}
