export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? data.message ?? `Erreur ${res.status}`);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
};

export interface User {
  id: number;
  username: string;
  displayName: string | null;
  isAdmin: boolean;
}

export interface Shooting {
  id: number;
  title: string;
  date: string; // YYYY-MM-DD
  datePrecision: 'day' | 'month';
  imageCount: number;
}

export function formatShootingDate(s: Pick<Shooting, 'date' | 'datePrecision'>): string {
  const [y, m, d] = s.date.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return s.datePrecision === 'day'
    ? date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

export type Version = 'original' | 'carre' | 'story';
export const VERSIONS: Version[] = ['original', 'carre', 'story'];
export const VERSION_LABELS: Record<Version, string> = { original: 'Originale', carre: 'Carré', story: 'Story' };

export interface ImageVersionInfo {
  width: number;
  height: number;
  size: number;
  name: string;
  token: string; // change quand le fichier change (cache navigateur)
}

export interface GalleryImage {
  number: number;
  versions: Partial<Record<Version, ImageVersionInfo>>;
}

export interface ShootingDetail {
  shooting: Shooting;
  images: GalleryImage[];
  duplicates?: string[];
}

export function imageUrl(
  shootingId: number,
  number: number,
  version: Version,
  kind: 'thumb' | 'preview',
  token: string,
): string {
  return `/api/shootings/${shootingId}/images/${number}/${version}/${kind}?v=${token}`;
}

export function originalUrl(shootingId: number, number: number, version: Version, batch = false): string {
  return `/api/shootings/${shootingId}/images/${number}/${version}/original?download=1${batch ? '&batch=1' : ''}`;
}
