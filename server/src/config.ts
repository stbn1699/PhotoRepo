import path from 'node:path';

// En dev, on lit le fichier .env à la racine du repo (en prod, Docker fournit les variables).
for (const file of ['.env', '../.env']) {
  try {
    process.loadEnvFile(file);
    break;
  } catch {
    // fichier absent : on essaie le suivant
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  photosRoot: path.resolve(required('PHOTOS_ROOT')),
  siteName: process.env.SITE_NAME || 'Galerie',
  adminUsername: process.env.ADMIN_USERNAME || undefined,
  adminPassword: process.env.ADMIN_PASSWORD || undefined,
  sessionDays: Number(process.env.SESSION_DAYS ?? 30),
  scanIntervalMinutes: Number(process.env.SCAN_INTERVAL_MINUTES ?? 5),
  // À laisser à true derrière le reverse proxy Synology (pour avoir la vraie IP des visiteurs).
  trustProxy: process.env.TRUST_PROXY !== 'false',
  // Dossier du site React compilé (servi par le même serveur en production).
  webDist: process.env.WEB_DIST ? path.resolve(process.env.WEB_DIST) : undefined,
};
