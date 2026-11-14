import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function git(args: string): string {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return ''; // pas de git (ex. dans Docker) : la version vient alors de APP_VERSION
  }
}

/**
 * Numéro de version affiché à l'admin : le nombre de commits (il augmente à chaque version),
 * suivi de « + » s'il y a des modifications pas encore commitées.
 */
function appVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  const count = git('rev-list --count HEAD');
  if (!count) return 'dev';
  return `${count}${git('status --porcelain') ? '+' : ''}`;
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 5173,
    // En dev, les appels /api partent vers le serveur Node.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
