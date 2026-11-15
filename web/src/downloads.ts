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
export function triggerDownload(url: string, fileName?: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName ?? '';
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

/**
 * Télécharge un fichier dans la mémoire du navigateur en signalant la progression (octets reçus).
 * Le fichier n'est rendu qu'une fois complet.
 */
export async function fetchWithProgress(
  url: string,
  signal: AbortSignal,
  onProgress: (received: number, total: number | null) => void,
): Promise<Blob> {
  const res = await fetch(url, { signal, credentials: 'same-origin' });
  if (!res.ok || !res.body) throw new Error(`Erreur ${res.status}`);
  const total = Number(res.headers.get('content-length')) || null;
  const reader = res.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array<ArrayBuffer>);
    received += value.byteLength;
    onProgress(received, total);
  }
  if (total !== null && received !== total) throw new Error('Téléchargement incomplet');
  return new Blob(chunks, { type: res.headers.get('content-type') ?? 'application/octet-stream' });
}

/** Enregistre sur l'appareil un fichier déjà téléchargé en mémoire (instantané, sans réseau). */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, fileName);
  // On laisse au navigateur le temps de copier le fichier avant de libérer la mémoire.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
