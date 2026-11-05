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

app.decorateRequest('user', null);
app.addHook('onRequest', async (request) => {
  if (request.url.startsWith('/api/')) await loadSession(request);
});

app.get('/api/site', async () => ({ name: config.siteName }));

await app.register(authRoutes);
await app.register(shootingRoutes);

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
  }
}
await runScan();
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
