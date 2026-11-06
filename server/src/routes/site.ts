import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { loadSignature } from '../signature.js';

/** Infos publiques du site (accessibles aussi depuis la page de connexion). */
export async function siteRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/site', async () => ({ name: config.siteName }));

  app.get('/api/signature', async (_request, reply) => {
    const signature = await loadSignature().catch(() => null);
    if (!signature) return reply.code(404).send({ error: 'Pas de signature' });
    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.type('image/png').send(signature.png);
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
