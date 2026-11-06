import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';

// Signature du photographe : le même fichier que celui utilisé par Lightroom (blanc sur fond
// transparent), lu directement sur le NAS. Si tu la changes, le site suit.
export const signaturePath = () => path.join(config.photosRoot, process.env.SIGNATURE_FILE || 'copyright.png');

let cached: { mtimeMs: number; png: Buffer } | null = null;

/** La signature sans ses marges transparentes, ou null si le fichier n'existe pas. */
export async function loadSignature(): Promise<{ png: Buffer; mtimeMs: number } | null> {
  let stat;
  try {
    stat = await fs.stat(signaturePath());
  } catch {
    return null;
  }
  if (cached?.mtimeMs !== stat.mtimeMs) {
    const png = await sharp(signaturePath()).trim().png().toBuffer();
    cached = { mtimeMs: stat.mtimeMs, png };
  }
  return cached;
}

/**
 * Calque de filigrane pour les aperçus RAW : la signature répétée en diagonale sur toute
 * l'image, semi-transparente. Sans signature : des bandes diagonales.
 */
export async function watermarkLayer(width: number, height: number): Promise<Buffer> {
  const signature = await loadSignature().catch(() => null);
  const tileWidth = Math.max(100, Math.round(Math.max(width, height) * 0.17));

  let tile: Buffer;
  if (signature) {
    // Signature réduite en deux couches : une ombre sombre légèrement décalée (visible sur les
    // zones claires) et la signature blanche par-dessus (visible sur les zones sombres).
    const resized = await sharp(signature.png).resize({ width: tileWidth }).ensureAlpha().toBuffer();
    const meta0 = await sharp(resized).metadata();
    const withAlpha = (rgba: number[]) =>
      sharp(resized)
        .composite([{ input: Buffer.from(rgba), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: 'in' }])
        .png()
        .toBuffer();
    const white = await withAlpha([255, 255, 255, 110]);
    const shadow = await withAlpha([0, 0, 0, 70]);
    const offset = Math.max(1, Math.round(tileWidth / 120));
    const layered = await sharp({
      create: {
        width: (meta0.width ?? tileWidth) + offset,
        height: (meta0.height ?? tileWidth) + offset,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        { input: shadow, left: offset, top: offset },
        { input: white, left: 0, top: 0 },
      ])
      .png()
      .toBuffer();
    const rotated = await sharp(layered)
      .rotate(-24, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const pad = Math.round(tileWidth * 0.12);
    tile = await sharp(rotated)
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  } else {
    const s = tileWidth;
    tile = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><path d="M0 ${s} L${s} 0" stroke="white" stroke-opacity="0.25" stroke-width="${Math.max(2, s / 40)}"/></svg>`,
      ),
    )
      .png()
      .toBuffer();
  }

  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: tile, tile: true }])
    .png()
    .toBuffer();
}
