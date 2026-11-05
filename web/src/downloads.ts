export interface DownloadItem {
  url: string;
  name: string;
  size: number;
}

/**
 * Téléphone/tablette capable d'envoyer des fichiers au menu « Partager » (→ « Enregistrer les images »).
 * Nécessite HTTPS. Sur ordinateur on préfère le téléchargement classique.
 */
export function canShareFiles(): boolean {
  if (!window.isSecureContext || typeof navigator.canShare !== 'function') return false;
  if (!window.matchMedia('(pointer: coarse)').matches) return false;
  try {
    return navigator.canShare({ files: [new File([new Uint8Array(1)], 'test.jpg', { type: 'image/jpeg' })] });
  } catch {
    return false;
  }
}

/** Le navigateur sait enregistrer dans un dossier choisi (Chrome, Edge sur ordinateur). */
export function canPickFolder(): boolean {
  return 'showDirectoryPicker' in window;
}

// Un téléphone garde les photos en mémoire avant de les enregistrer : on envoie par paquets.
const BATCH_MAX_FILES = 10;
const BATCH_MAX_BYTES = 150 * 1024 * 1024;

export function splitInBatches(items: DownloadItem[]): DownloadItem[][] {
  const batches: DownloadItem[][] = [];
  let current: DownloadItem[] = [];
  let bytes = 0;
  for (const item of items) {
    if (current.length > 0 && (current.length >= BATCH_MAX_FILES || bytes + item.size > BATCH_MAX_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += item.size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Télécharge un fichier en mémoire, en signalant la progression (octets reçus). */
export async function fetchAsFile(item: DownloadItem, signal: AbortSignal, onBytes: (n: number) => void): Promise<File> {
  const res = await fetch(item.url, { signal, credentials: 'same-origin' });
  if (!res.ok || !res.body) throw new Error(`Impossible de récupérer ${item.name}`);
  const reader = res.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array<ArrayBuffer>);
    onBytes(value.byteLength);
  }
  return new File(chunks, item.name, { type: res.headers.get('content-type') ?? 'image/jpeg' });
}

/** Téléchargement classique d'un fichier (dossier Téléchargements de l'ordinateur). */
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

// Types minimaux pour l'API de choix de dossier (pas encore dans les types TypeScript du DOM).
export interface DirectoryHandle {
  getFileHandle(name: string, options: { create: boolean }): Promise<{
    createWritable(): Promise<WritableStream<Uint8Array>>;
  }>;
}

export async function pickFolder(): Promise<DirectoryHandle> {
  const picker = (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirectoryHandle> })
    .showDirectoryPicker;
  return picker({ mode: 'readwrite', startIn: 'pictures' });
}

/** Enregistre un fichier directement dans le dossier choisi, sans le garder en mémoire. */
export async function saveToFolder(
  dir: DirectoryHandle,
  item: DownloadItem,
  signal: AbortSignal,
  onBytes: (n: number) => void,
): Promise<void> {
  const res = await fetch(item.url, { signal, credentials: 'same-origin' });
  if (!res.ok || !res.body) throw new Error(`Impossible de récupérer ${item.name}`);
  const handle = await dir.getFileHandle(item.name, { create: true });
  const writable = await handle.createWritable();
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      onBytes(chunk.byteLength);
      controller.enqueue(chunk);
    },
  });
  await res.body.pipeThrough(counter).pipeTo(writable, { signal });
}
