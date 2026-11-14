// Valeurs fixées au moment de la construction du site (voir vite.config.ts).
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

export const APP_VERSION = __APP_VERSION__;
export const BUILD_TIME = __BUILD_TIME__;

/** « v13 · 14/11 20:15 » */
export function versionLabel(): string {
  const built = new Date(BUILD_TIME).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `v${APP_VERSION} · ${built.replace(',', '')}`;
}
