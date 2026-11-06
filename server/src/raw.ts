// Lecture des fichiers RAW (NEF Nikon, DNG) sans les développer : ces fichiers sont au format TIFF
// et l'appareil y intègre un aperçu JPEG en pleine définition. On retrouve cet aperçu dans la
// structure du fichier et on ne lit que ses octets.
import fs from 'node:fs/promises';

export const RAW_EXTENSIONS = new Set(['.nef', '.dng']);

export interface RawPreview {
  offset: number; // position du JPEG dans le fichier
  length: number; // taille du JPEG
  width: number; // dimensions affichées (orientation déjà appliquée)
  height: number;
  rotate: number; // rotation à appliquer au JPEG : 0, 90, 180 ou 270
}

const ORIENTATION_ROTATION: Record<number, number> = { 3: 180, 6: 90, 8: 270 };

type Handle = Awaited<ReturnType<typeof fs.open>>;

async function readAt(fh: Handle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

/** Trouve le plus grand aperçu JPEG du fichier RAW, ou null si le format n'est pas reconnu. */
export async function findRawPreview(filePath: string): Promise<RawPreview | null> {
  const fh = await fs.open(filePath, 'r');
  try {
    const { size } = await fh.stat();
    const header = await readAt(fh, 0, 8);
    if (header.length < 8) return null;
    const order = header.toString('latin1', 0, 2);
    if (order !== 'II' && order !== 'MM') return null;
    const le = order === 'II';
    const u16 = (b: Buffer, o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
    const u32 = (b: Buffer, o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
    if (u16(header, 2) !== 42) return null;

    let orientation = 1;
    const candidates: { offset: number; length: number }[] = [];
    const visited = new Set<number>();

    // Parcourt un répertoire TIFF (IFD), ses sous-répertoires et le suivant.
    async function walk(offset: number, depth: number, isFirst: boolean): Promise<void> {
      if (!offset || offset + 2 > size || visited.has(offset) || depth > 4 || visited.size > 32) return;
      visited.add(offset);
      const count = u16(await readAt(fh, offset, 2), 0);
      if (count === 0 || count > 1000) return;
      const entries = await readAt(fh, offset + 2, count * 12 + 4);
      let jpegOffset = 0;
      let jpegLength = 0;
      const subIfds: number[] = [];
      for (let i = 0; i < count; i++) {
        const p = i * 12;
        if (p + 12 > entries.length) break;
        const tag = u16(entries, p);
        const type = u16(entries, p + 2);
        const n = u32(entries, p + 4);
        const value = type === 3 && n === 1 ? u16(entries, p + 8) : u32(entries, p + 8);
        if (tag === 0x0112 && isFirst) orientation = value;
        else if (tag === 0x0201) jpegOffset = value;
        else if (tag === 0x0202) jpegLength = value;
        else if (tag === 0x014a) {
          if (n === 1) subIfds.push(value);
          else if (n <= 8) {
            const list = await readAt(fh, value, n * 4);
            for (let k = 0; k * 4 + 4 <= list.length; k++) subIfds.push(u32(list, k * 4));
          }
        }
      }
      if (jpegOffset && jpegLength && jpegOffset + jpegLength <= size) {
        candidates.push({ offset: jpegOffset, length: jpegLength });
      }
      for (const sub of subIfds) await walk(sub, depth + 1, false);
      if (entries.length >= count * 12 + 4) await walk(u32(entries, count * 12), depth + 1, false);
    }

    await walk(u32(header, 4), 0, true);
    if (candidates.length === 0) return null;
    const best = candidates.reduce((a, b) => (b.length > a.length ? b : a));
    const dims = await readJpegSize(fh, best.offset, best.length);
    if (!dims) return null;
    const rotate = ORIENTATION_ROTATION[orientation] ?? 0;
    const swap = rotate === 90 || rotate === 270;
    return {
      ...best,
      rotate,
      width: swap ? dims.height : dims.width,
      height: swap ? dims.width : dims.height,
    };
  } finally {
    await fh.close();
  }
}

/** Lit les dimensions d'un JPEG en parcourant ses segments (sans le charger en entier). */
async function readJpegSize(fh: Handle, start: number, length: number): Promise<{ width: number; height: number } | null> {
  const soi = await readAt(fh, start, 2);
  if (soi[0] !== 0xff || soi[1] !== 0xd8) return null;
  let pos = start + 2;
  const end = start + length;
  for (let i = 0; i < 200 && pos + 4 <= end; i++) {
    const seg = await readAt(fh, pos, 9);
    if (seg.length < 4 || seg[0] !== 0xff) return null;
    const marker = seg[1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      pos += 2;
      continue;
    }
    const segLength = seg.readUInt16BE(2);
    // SOF0 à SOF15 (sauf DHT C4, JPG C8, DAC CC) : contient la hauteur puis la largeur.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (seg.length < 9) return null;
      return { height: seg.readUInt16BE(5), width: seg.readUInt16BE(7) };
    }
    pos += 2 + segLength;
  }
  return null;
}

/** Lit l'aperçu JPEG intégré au RAW. */
export async function readRawPreview(filePath: string, preview: Pick<RawPreview, 'offset' | 'length'>): Promise<Buffer> {
  const fh = await fs.open(filePath, 'r');
  try {
    return await readAt(fh, preview.offset, preview.length);
  } finally {
    await fh.close();
  }
}
