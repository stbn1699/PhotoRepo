import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { migrate, pool, waitForDatabase } from './db.js';
import { ensureAdmin, loadSession } from './auth.js';
import { scanLibrary } from './library.js';
import { authRoutes } from './routes/auth.js';
import { shootingRoutes } from './routes/shootings.js';
import { galleryRoutes } from './routes/gallery.js';
import { adminRoutes } from './routes/admin.js';
import { activityRoutes } from './routes/activity.js';
import { siteRoutes } from './routes/site.js';
import { warmCache } from './images.js';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  trustProxy: config.trustProxy,
});

await app.register(cookie);
await app.register(rateLimit, {
  global: false,
  errorResponseBuilder: (_request, context) => ({
    statusCode: 429,
    error: `Trop de tentatives. Réessaie dans ${context.after}.`,
  }),
});

// Données envoyées invalides : message en français (le site vérifie déjà les champs avant l'envoi).
app.setErrorHandler((error: { validation?: unknown; statusCode?: number }, request, reply) => {
  if (error.validation) return reply.code(400).send({ error: 'Données invalides' });
  if (error.statusCode === 429) return reply.code(429).send(error);
  request.log.error(error);
  return reply.code(error.statusCode && error.statusCode < 500 ? error.statusCode : 500).send({ error: 'Erreur du serveur' });
});

app.decorateRequest('user', null);
app.addHook('onRequest', async (request) => {
  if (request.url.startsWith('/api/')) await loadSession(request);
});


await app.register(siteRoutes);
await app.register(authRoutes);
await app.register(shootingRoutes);
await app.register(galleryRoutes);
await app.register(adminRoutes);
await app.register(activityRoutes);

// En production, le même serveur sert le site React compilé.
if (config.webDist && fs.existsSync(config.webDist)) {
  await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
  const indexHtml = fs.readFileSync(path.join(config.webDist, 'index.html'));
  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/api/')) {
      return reply.type('text/html').send(indexHtml);
    }
    return reply.code(404).send({ error: 'Introuvable' });
  });
}

await waitForDatabase(app.log);
await migrate();
await ensureAdmin(app.log);

async function runScan(): Promise<void> {
  try {
    const result = await scanLibrary();
    app.log.info(result, 'Dossiers scannés');
  } catch (err) {
    app.log.error(err, `Impossible de lire ${config.photosRoot}`);
    return;
  }
  // Prépare les miniatures en tâche de fond (sans bloquer le site).
  warmCache(app.log).catch((err) => app.log.error(err, 'Erreur pendant la préparation des images'));
}
const scanTimer = setInterval(runScan, config.scanIntervalMinutes * 60 * 1000);

// Ménage des sessions expirées, une fois par jour.
const cleanupTimer = setInterval(
  () => pool.query('DELETE FROM sessions WHERE expires_at < now()').catch((err) => app.log.error(err)),
  24 * 3600 * 1000,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    clearInterval(scanTimer);
    clearInterval(cleanupTimer);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: '0.0.0.0' });
// Premier scan après le démarrage, pour que le site réponde tout de suite.
void runScan();
