import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';
import { pool } from './db.js';
import { getShootingIndex, VERSIONS, type ImageFile } from './library.js';

// Pas de cache interne de libvips : on traite de grosses images une par une, inutile de les garder en mémoire.
sharp.cache(false);

/** Tailles générées : miniature pour la galerie, aperçu pour la vue en grand. */
export const RENDITIONS = {
  thumb: { maxSize: 800, quality: 74 },
  preview: { maxSize: 2048, quality: 82 },
} as const;
export type Rendition = keyof typeof RENDITIONS;

// ---------------------------------------------------------------------------
// File d'attente : on limite le nombre de conversions simultanées pour ne pas
// saturer le NAS. Les demandes des visiteurs passent avant la préparation en tâche de fond.
// ---------------------------------------------------------------------------

type Job = () => void;
const queues: { high: Job[]; low: Job[] } = { high: [], low: [] };
let running = 0;

function runNext(): void {
  while (running < config.imageConcurrency) {
    const job = queues.high.shift() ?? queues.low.shift();
    if (!job) return;
    running++;
    job();
  }
}

function enqueue<T>(priority: 'high' | 'low', task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queues[priority].push(() => {
      task()
        .then(resolve, reject)
        .finally(() => {
          running--;
          runNext();
        });
    });
    runNext();
  });
}

// ---------------------------------------------------------------------------
// Génération et cache des miniatures / aperçus
// ---------------------------------------------------------------------------

function cachePath(image: ImageFile, rendition: Rendition): string {
  // La clé change si le fichier est modifié (taille ou date), donc un nouvel export Lightroom
  // produit automatiquement une nouvelle miniature.
  const key = crypto
    .createHash('sha1')
    .update(`${image.path}|${image.size}|${Math.round(image.mtimeMs)}|${rendition}`)
    .digest('hex');
  return path.join(config.cacheDir, rendition, key.slice(0, 2), `${key}.webp`);
}

const inFlight = new Map<string, Promise<string>>();

/** Retourne le chemin du fichier généré (le crée si besoin). */
export async function getRendition(
  image: ImageFile,
  rendition: Rendition,
  priority: 'high' | 'low' = 'high',
): Promise<string> {
  const target = cachePath(image, rendition);
  try {
    await fs.access(target);
    return target;
  } catch {
    // pas encore généré
  }
  let pending = inFlight.get(target);
  if (!pending) {
    pending = enqueue(priority, () => render(image, rendition, target)).finally(() => inFlight.delete(target));
    inFlight.set(target, pending);
  }
  return pending;
}

async function render(image: ImageFile, rendition: Rendition, target: string): Promise<string> {
  const { maxSize, quality } = RENDITIONS[rendition];
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await sharp(image.path)
      .rotate() // applique l'orientation EXIF
      .resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toFile(tmp);
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return target;
}

// ---------------------------------------------------------------------------
// Préparation en tâche de fond : génère d'avance miniatures puis aperçus de tous
// les shootings, pour que les galeries s'ouvrent vite même la première fois.
// ---------------------------------------------------------------------------

let warming = false;

export async function warmCache(log: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void }): Promise<void> {
  if (warming) return;
  warming = true;
  try {
    const { rows } = await pool.query<{ folder_name: string }>(
      'SELECT folder_name FROM shootings WHERE present ORDER BY shot_date DESC',
    );
    for (const rendition of ['thumb', 'preview'] as const) {
      let generated = 0;
      for (const { folder_name } of rows) {
        let index;
        try {
          index = await getShootingIndex(folder_name);
        } catch {
          continue;
        }
        const jobs: Promise<unknown>[] = [];
        for (const versions of index.images.values()) {
          for (const v of VERSIONS) {
            const image = versions[v];
            if (!image) continue;
            jobs.push(
              fs.access(cachePath(image, rendition)).catch(() => {
                generated++;
                return getRendition(image, rendition, 'low').catch((err) =>
                  log.warn({ err: String(err), file: image.path }, 'Conversion impossible'),
                );
              }),
            );
          }
        }
        await Promise.all(jobs);
      }
      if (generated > 0) log.info({ rendition, generated }, 'Images préparées');
    }
  } finally {
    warming = false;
  }
}
