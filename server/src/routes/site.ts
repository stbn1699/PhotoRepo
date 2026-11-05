import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

// Signature affichée sur le site : le même fichier que celui utilisé par Lightroom,
// lu directement sur le NAS (si tu la changes, le site suit).
const signaturePath = () => path.join(config.photosRoot, process.env.SIGNATURE_FILE || 'copyright.png');

let cached: { mtimeMs: number; png: Buffer } | null = null;

async function loadSignature(): Promise<Buffer | null> {
  let stat;
  try {
    stat = await fs.stat(signaturePath());
  } catch {
    return null;
  }
  if (cached?.mtimeMs !== stat.mtimeMs) {
    // On enlève les marges transparentes pour pouvoir la caler précisément dans la page.
    const png = await sharp(signaturePath()).trim().png().toBuffer();
    cached = { mtimeMs: stat.mtimeMs, png };
  }
  return cached.png;
}

/** Infos publiques du site (accessibles aussi depuis la page de connexion). */
export async function siteRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/site', async () => ({ name: config.siteName }));

  app.get('/api/signature', async (_request, reply) => {
    const png = await loadSignature().catch(() => null);
    if (!png) return reply.code(404).send({ error: 'Pas de signature' });
    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.type('image/png').send(png);
  });

  // Permet d'« ajouter à l'écran d'accueil » sur téléphone, avec le nom et l'icône du site.
  app.get('/api/manifest.webmanifest', async (_request, reply) => {
    reply.type('application/manifest+json');
    return {
      name: config.siteName,
      short_name: config.siteName,
      start_url: '/',
      display: 'standalone',
      background_color: '#0f0f10',
      theme_color: '#0f0f10',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    };
  });
}
