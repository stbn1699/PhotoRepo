import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';
import { pool } from './db.js';

/** Les versions possibles d'une image. "original" est la seule obligatoire. */
export const VERSIONS = ['original', 'carre', 'story'] as const;
export type Version = (typeof VERSIONS)[number];

export function isVersion(value: string): value is Version {
  return (VERSIONS as readonly string[]).includes(value);
}

// Noms de sous-dossiers acceptés (comparés sans accents, majuscules, espaces ni tirets).
const VERSION_DIR_ALIASES: Record<string, Version> = {
  original: 'original',
  originale: 'original',
  originals: 'original',
  originaux: 'original',
  carre: 'carre',
  carres: 'carre',
  square: 'carre',
  story: 'story',
  stories: 'story',
  storys: 'story',
  storyinsta: 'story',
  storyinstagram: 'story',
};

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);

// "26-11-04 Shooting Glam'Street" ou "26-08 Vacances Italie"
const FOLDER_RE = /^(\d{2})-(\d{2})(?:-(\d{2}))?\s+(.+)$/;

// Le numéro de l'image = le dernier nombre juste avant l'extension :
// "glam-street_carre_12.jpg" → 12, "Abeille-07.jpg" → 7
const IMAGE_NUMBER_RE = /(\d+)\.[^.]+$/;

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

function versionOfDir(dirName: string): Version | null {
  const key = dirName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
  return VERSION_DIR_ALIASES[key] ?? null;
}

// ---------------------------------------------------------------------------
// Index d'un shooting : quelles images existent, dans quelles versions.
// ---------------------------------------------------------------------------

export interface ImageFile {
  path: string; // chemin absolu
  name: string; // nom du fichier
  size: number;
  mtimeMs: number;
  width: number;
  height: number;
}

export type ImageVersions = Partial<Record<Version, ImageFile>>;

export interface ShootingIndex {
  /** numéro → versions disponibles (seules les images qui ont une originale sont gardées) */
  images: Map<number, ImageVersions>;
  /** fichiers ignorés car un autre fichier avait déjà le même numéro dans la même version */
  duplicates: string[];
}

const INDEX_TTL_MS = 30_000;
const indexCache = new Map<string, { builtAt: number; index: Promise<ShootingIndex> }>();

/** Index d'un dossier de shooting (gardé 30 s en mémoire pour ne pas relire le disque à chaque requête). */
export function getShootingIndex(folderName: string, { fresh = false } = {}): Promise<ShootingIndex> {
  const cached = indexCache.get(folderName);
  if (!fresh && cached && Date.now() - cached.builtAt < INDEX_TTL_MS) return cached.index;
  const index = buildIndex(folderName);
  indexCache.set(folderName, { builtAt: Date.now(), index });
  index.catch(() => indexCache.delete(folderName));
  return index;
}

async function buildIndex(folderName: string): Promise<ShootingIndex> {
  const shootingDir = path.join(config.photosRoot, folderName);
  const entries = await fs.readdir(shootingDir, { withFileTypes: true });

  // Les originales sont dans "original/" ; à défaut, directement à la racine du dossier.
  const dirs: { version: Version; dir: string }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const version = versionOfDir(entry.name);
    if (version && !dirs.some((d) => d.version === version)) {
      dirs.push({ version, dir: path.join(shootingDir, entry.name) });
    }
  }
  if (!dirs.some((d) => d.version === 'original')) dirs.push({ version: 'original', dir: shootingDir });

  const byVersion = new Map<Version, Map<number, ImageFile>>();
  const duplicates: string[] = [];

  for (const { version, dir } of dirs) {
    const files = new Map<number, ImageFile>();
    const names = (await fs.readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
    for (const name of names) {
      const number = parseImageNumber(name);
      if (number === null) continue;
      if (files.has(number)) {
        duplicates.push(path.relative(shootingDir, path.join(dir, name)));
        continue;
      }
      const filePath = path.join(dir, name);
      const stat = await fs.stat(filePath);
      const size = await getImageSize(filePath, stat.size, stat.mtimeMs);
      if (!size) continue; // fichier illisible
      files.set(number, { path: filePath, name, size: stat.size, mtimeMs: stat.mtimeMs, ...size });
    }
    byVersion.set(version, files);
  }

  const images = new Map<number, ImageVersions>();
  const originals = byVersion.get('original')!;
  for (const number of [...originals.keys()].sort((a, b) => a - b)) {
    const versions: ImageVersions = {};
    for (const v of VERSIONS) {
      const file = byVersion.get(v)?.get(number);
      if (file) versions[v] = file;
    }
    images.set(number, versions);
  }
  scheduleSaveSizes();
  return { images, duplicates };
}

// Dimensions des images (lues dans l'en-tête du fichier), mémorisées sur disque
// pour ne pas relire 200 fichiers à chaque redémarrage.
const sizesFile = () => path.join(config.cacheDir, 'sizes.json');
let sizes: Map<string, { width: number; height: number }> | null = null;
let saveTimer: NodeJS.Timeout | null = null;

async function loadSizes(): Promise<Map<string, { width: number; height: number }>> {
  if (sizes) return sizes;
  try {
    sizes = new Map(Object.entries(JSON.parse(await fs.readFile(sizesFile(), 'utf8'))));
  } catch {
    sizes = new Map();
  }
  return sizes;
}

function scheduleSaveSizes(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    if (!sizes) return;
    await fs.mkdir(config.cacheDir, { recursive: true });
    const tmp = `${sizesFile()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(Object.fromEntries(sizes)));
    await fs.rename(tmp, sizesFile());
  }, 5000);
}

async function getImageSize(filePath: string, size: number, mtimeMs: number) {
  const known = await loadSizes();
  const key = `${filePath}|${size}|${Math.round(mtimeMs)}`;
  const hit = known.get(key);
  if (hit) return hit;
  try {
    const meta = await sharp(filePath).metadata();
    if (!meta.width || !meta.height) return null;
    // Orientation EXIF 5 à 8 : l'image est tournée de 90°, largeur et hauteur s'inversent.
    const rotated = (meta.orientation ?? 1) >= 5;
    const value = rotated ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
    known.set(key, value);
    return value;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scan du dossier racine
// ---------------------------------------------------------------------------

export interface ScanResult {
  found: number;
  added: number;
  removed: number;
}

let scanning: Promise<ScanResult> | null = null;
let lastScanAt = 0;

/** Parcourt le dossier racine et met à jour la table des shootings. */
export function scanLibrary(): Promise<ScanResult> {
  // Un seul scan à la fois : un appel pendant un scan en cours attend le même résultat.
  scanning ??= doScan().finally(() => {
    scanning = null;
    lastScanAt = Date.now();
  });
  return scanning;
}

/**
 * Relit les dossiers si la dernière lecture date de plus de `maxAgeMs`
 * (évite de relire le NAS à chaque visite de l'accueil). Renvoie null si rien n'a été relu.
 */
export async function refreshLibrary(maxAgeMs: number): Promise<ScanResult | null> {
  if (scanning) return scanning;
  if (Date.now() - lastScanAt < maxAgeMs) return null;
  return scanLibrary();
}

async function doScan(): Promise<ScanResult> {
  const entries = await fs.readdir(config.photosRoot, { withFileTypes: true });
  const seen: string[] = [];
  let added = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const parsed = parseFolderName(entry.name);
    if (!parsed) continue; // dossier des RAW, corbeille, autres dossiers…

    let imageCount = 0;
    try {
      imageCount = (await getShootingIndex(entry.name, { fresh: true })).images.size;
    } catch {
      continue; // dossier illisible
    }
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
      [entry.name, parsed.title, parsed.date, parsed.precision, imageCount],
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
