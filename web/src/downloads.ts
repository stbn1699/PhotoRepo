export interface DownloadItem {
  url: string;
  name: string;
  size: number;
}

/**
 * Téléchargement direct d'un fichier, comme « Télécharger l'image » : le serveur répond avec
 * « Content-Disposition: attachment », le navigateur l'enregistre (Téléchargements sur ordinateur
 * et Android, app Fichiers sur iPhone).
 */
export function triggerDownload(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} Ko`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} Mo`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} Go`;
}
