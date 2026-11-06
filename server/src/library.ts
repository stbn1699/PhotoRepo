import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';
import { pool } from './db.js';
import { findRawPreview, RAW_EXTENSIONS } from './raw.js';

/**
 * Les versions possibles d'une image. "original" est la seule obligatoire.
 * "raw" = le fichier brut de l'appareil (dossier Raws/), visible seulement si l'admin le partage,
 * et jamais téléchargeable.
 */
export const VERSIONS = ['original', 'carre', 'story', 'raw'] as const;
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

export function parseImageNumber(fileName: string, extensions: Set<string> = IMAGE_EXTENSIONS): number | null {
  if (!extensions.has(path.extname(fileName).toLowerCase())) return null;
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
  /** Pour un RAW : où se trouve l'aperçu JPEG intégré, et comment le tourner. */
  raw?: { offset: number; length: number; rotate: number };
}

export type ImageVersions = Partial<Record<Version, ImageFile>>;

export interface ShootingIndex {
  /** numéro → versions disponibles (une image a au moins une originale ou un RAW) */
  images: Map<number, ImageVersions>;
  /** fichiers ignorés car un autre fichier avait déjà le même numéro dans la même version */
  duplicates: string[];
}

const INDEX_TTL_MS = 30_000;
interface CachedIndex {
  builtAt: number;
  index: Promise<ShootingIndex>;
  refreshing?: Promise<ShootingIndex>;
}
const indexCache = new Map<string, CachedIndex>();

/**
 * Index d'un dossier de shooting, gardé en mémoire. Au-delà de 30 s, on répond quand même tout
 * de suite avec l'index connu et on le relit en arrière-plan : personne n'attend la relecture.
 * `fresh` (relecture des dossiers) force une relecture complète et l'attend.
 */
export function getShootingIndex(folderName: string, { fresh = false } = {}): Promise<ShootingIndex> {
  const cached = indexCache.get(folderName);
  if (cached && !fresh) {
    if (Date.now() - cached.builtAt >= INDEX_TTL_MS && !cached.refreshing) {
      const refreshing = buildIndex(folderName);
      cached.refreshing = refreshing;
      refreshing
        .then(() => indexCache.set(folderName, { builtAt: Date.now(), index: refreshing }))
        .catch(() => {
          cached.refreshing = undefined; // on garde l'ancien index, nouvel essai plus tard
        });
    }
    return cached.index;
  }
  if (cached?.refreshing && fresh) return cached.refreshing;
  const index = buildIndex(folderName);
  index
    .then(() => indexCache.set(folderName, { builtAt: Date.now(), index }))
    .catch(() => {
      if (indexCache.get(folderName)?.index === index) indexCache.delete(folderName);
    });
  if (!cached) indexCache.set(folderName, { builtAt: Date.now(), index });
  return index;
}

/** Exécute `fn` sur chaque élément, au plus `limit` à la fois, en gardant l'ordre des résultats. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Lectures de fichiers en parallèle (utile surtout si les photos sont sur un partage réseau).
const IO_CONCURRENCY = 16;

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
    // D'abord le tri (premier fichier gardé pour chaque numéro), puis les lectures en parallèle.
    const kept: { number: number; name: string }[] = [];
    const seen = new Set<number>();
    for (const name of names) {
      const number = parseImageNumber(name);
      if (number === null) continue;
      if (seen.has(number)) {
        duplicates.push(path.relative(shootingDir, path.join(dir, name)));
        continue;
      }
      seen.add(number);
      kept.push({ number, name });
    }
    const read = await mapLimit(kept, IO_CONCURRENCY, async ({ number, name }) => {
      const filePath = path.join(dir, name);
      const stat = await fs.stat(filePath);
      const size = await getImageSize(filePath, stat.size, stat.mtimeMs);
      return size ? { number, file: { path: filePath, name, size: stat.size, mtimeMs: stat.mtimeMs, ...size } } : null;
    });
    for (const r of read) if (r) files.set(r.number, r.file); // les fichiers illisibles sont ignorés
    byVersion.set(version, files);
  }

  const originals = byVersion.get('original')!;

  // RAW : dans Raws/<même nom de dossier>/ à la racine du lecteur. Tous sont gardés, même sans
  // photo retouchée du même numéro (la modèle peut ainsi repérer des photos non retenues).
  // Les .xmp, .jpg, vidéos… sont ignorés.
  const rawDir = await findRawDir(folderName);
  if (rawDir) {
    const raws = new Map<number, ImageFile>();
    const names = (await fs.readdir(rawDir, { withFileTypes: true }))
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
    const kept: { number: number; name: string }[] = [];
    const seen = new Set<number>();
    for (const name of names) {
      const number = parseImageNumber(name, RAW_EXTENSIONS);
      if (number === null) continue;
      if (seen.has(number)) {
        duplicates.push(path.join(path.basename(path.dirname(rawDir)), path.basename(rawDir), name));
        continue;
      }
      seen.add(number);
      kept.push({ number, name });
    }
    const read = await mapLimit(kept, IO_CONCURRENCY, async ({ number, name }) => {
      const filePath = path.join(rawDir, name);
      const stat = await fs.stat(filePath);
      const info = await getRawInfo(filePath, stat.size, stat.mtimeMs);
      if (!info) return null; // format non reconnu
      const file: ImageFile = {
        path: filePath,
        name,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        width: info.width,
        height: info.height,
        raw: { offset: info.offset, length: info.length, rotate: info.rotate },
      };
      return { number, file };
    });
    for (const r of read) if (r) raws.set(r.number, r.file);
    byVersion.set('raw', raws);
  }

  // Une image = un numéro qui a une originale et/ou un RAW (carré et story suivent l'originale).
  const images = new Map<number, ImageVersions>();
  const numbers = new Set([...originals.keys(), ...(byVersion.get('raw')?.keys() ?? [])]);
  for (const number of [...numbers].sort((a, b) => a - b)) {
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

// Dossier Raws/ à la racine du lecteur (nom sans tenir compte des majuscules), relu toutes les 30 s.
let rawRoot: { at: number; dir: Promise<{ path: string; folders: Map<string, string> } | null> } | null = null;

const folderKey = (name: string) => name.normalize('NFC').toLowerCase().trim();

async function findRawDir(folderName: string): Promise<string | null> {
  if (!rawRoot || Date.now() - rawRoot.at > INDEX_TTL_MS) {
    rawRoot = {
      at: Date.now(),
      dir: (async () => {
        const entries = await fs.readdir(config.photosRoot, { withFileTypes: true });
        const root = entries.find((e) => e.isDirectory() && ['raws', 'raw'].includes(e.name.toLowerCase()));
        if (!root) return null;
        const rootPath = path.join(config.photosRoot, root.name);
        const folders = new Map<string, string>();
        for (const e of await fs.readdir(rootPath, { withFileTypes: true })) {
          if (e.isDirectory()) folders.set(folderKey(e.name), path.join(rootPath, e.name));
        }
        return { path: rootPath, folders };
      })().catch(() => null),
    };
  }
  const root = await rawRoot.dir;
  return root?.folders.get(folderKey(folderName)) ?? null;
}

// Dimensions des images (lues dans l'en-tête du fichier), mémorisées sur disque
// pour ne pas relire 200 fichiers à chaque redémarrage. Pour les RAW, on mémorise aussi
// l'emplacement de l'aperçu JPEG intégré.
const sizesFile = () => path.join(config.cacheDir, 'sizes.json');
interface KnownSize {
  width: number;
  height: number;
  offset?: number;
  length?: number;
  rotate?: number;
}
let sizes: Map<string, KnownSize> | null = null;
let saveTimer: NodeJS.Timeout | null = null;

async function loadSizes(): Promise<Map<string, KnownSize>> {
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

async function getRawInfo(filePath: string, size: number, mtimeMs: number) {
  const known = await loadSizes();
  const key = `raw|${filePath}|${size}|${Math.round(mtimeMs)}`;
  const hit = known.get(key);
  if (hit && hit.offset !== undefined && hit.length !== undefined) {
    return { width: hit.width, height: hit.height, offset: hit.offset, length: hit.length, rotate: hit.rotate ?? 0 };
  }
  try {
    const preview = await findRawPreview(filePath);
    if (!preview) return null;
    known.set(key, preview);
    return preview;
  } catch {
    return null;
  }
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
    let rawCount = 0;
    try {
      const index = await getShootingIndex(entry.name, { fresh: true });
      imageCount = [...index.images.values()].filter((v) => v.original).length;
      rawCount = [...index.images.values()].filter((v) => v.raw).length;
    } catch {
      continue; // dossier illisible
    }
    const { rows } = await pool.query<{ inserted: boolean }>(
      `INSERT INTO shootings (folder_name, title, shot_date, date_precision, image_count, raw_count, present)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (folder_name) DO UPDATE
         SET title = EXCLUDED.title,
             shot_date = EXCLUDED.shot_date,
             date_precision = EXCLUDED.date_precision,
             image_count = EXCLUDED.image_count,
             raw_count = EXCLUDED.raw_count,
             present = true
       RETURNING (xmax = 0) AS inserted`,
      [entry.name, parsed.title, parsed.date, parsed.precision, imageCount, rawCount],
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
