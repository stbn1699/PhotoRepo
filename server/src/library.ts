import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { pool } from './db.js';

/** Sous-dossiers d'un shooting, un par version d'image. */
export const VERSIONS = ['original', 'carre', 'story'] as const;
export type Version = (typeof VERSIONS)[number];

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);

// "26-11-04 Shooting Glam'Street" ou "26-08 Vacances Italie"
const FOLDER_RE = /^(\d{2})-(\d{2})(?:-(\d{2}))?\s+(.+)$/;

// Le numéro de l'image est le nombre après le dernier "_" : "glam-street_carre_12.jpg" → 12
const IMAGE_NUMBER_RE = /_(\d+)\.[^.]+$/;

export interface ParsedFolder {
  date: string; // YYYY-MM-DD (le 1er du mois si le jour est absent)
  precision: 'day' | 'month';
  title: string;
}

export function parseFolderName(name: string): ParsedFolder | null {
  const m = FOLDER_RE.exec(name.trim());
  if (!m) return null;
  const year = 2000 + Number(m[1]);
  const month = Number(m[2]);
  const day = m[3] ? Number(m[3]) : 1;
  if (month < 1 || month > 12) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${year}-${pad(month)}-${pad(day)}`,
    precision: m[3] ? 'day' : 'month',
    title: m[4].trim(),
  };
}

export function parseImageNumber(fileName: string): number | null {
  if (!IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase())) return null;
  const m = IMAGE_NUMBER_RE.exec(fileName);
  return m ? Number(m[1]) : null;
}

/** Trouve le sous-dossier d'une version, sans tenir compte des majuscules ("Original", "CARRE"…). */
async function findVersionDir(shootingDir: string, version: Version): Promise<string | null> {
  const entries = await fs.readdir(shootingDir, { withFileTypes: true });
  const match = entries.find((e) => e.isDirectory() && e.name.toLowerCase() === version);
  return match ? path.join(shootingDir, match.name) : null;
}

/** Liste les images d'une version : numéro → nom de fichier. */
export async function listVersionImages(folderName: string, version: Version): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const dir = await findVersionDir(path.join(config.photosRoot, folderName), version);
  if (!dir) return result;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const n = parseImageNumber(entry.name);
    if (n !== null && !result.has(n)) result.set(n, entry.name);
  }
  return result;
}

export interface ScanResult {
  found: number;
  added: number;
  removed: number;
}

let scanning: Promise<ScanResult> | null = null;

/** Parcourt le dossier racine et met à jour la table des shootings. */
export function scanLibrary(): Promise<ScanResult> {
  // Un seul scan à la fois : un appel pendant un scan en cours attend le même résultat.
  scanning ??= doScan().finally(() => {
    scanning = null;
  });
  return scanning;
}

async function doScan(): Promise<ScanResult> {
  const entries = await fs.readdir(config.photosRoot, { withFileTypes: true });
  const seen: string[] = [];
  let added = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const parsed = parseFolderName(entry.name);
    if (!parsed) continue; // dossier des RAW, autres dossiers…

    const originals = await listVersionImages(entry.name, 'original');
    const { rows } = await pool.query<{ inserted: boolean }>(
      `INSERT INTO shootings (folder_name, title, shot_date, date_precision, image_count, present)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (folder_name) DO UPDATE
         SET title = EXCLUDED.title,
             shot_date = EXCLUDED.shot_date,
             date_precision = EXCLUDED.date_precision,
             image_count = EXCLUDED.image_count,
             present = true
       RETURNING (xmax = 0) AS inserted`,
      [entry.name, parsed.title, parsed.date, parsed.precision, originals.size],
    );
    if (rows[0]?.inserted) added++;
    seen.push(entry.name);
  }

  // Les dossiers disparus sont masqués (pas supprimés : les accès reviennent si le dossier revient).
  const removed = await pool.query(
    `UPDATE shootings SET present = false WHERE present AND NOT (folder_name = ANY($1::text[]))`,
    [seen],
  );

  return { found: seen.length, added, removed: removed.rowCount ?? 0 };
}
