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
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
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

export interface AdminUser {
  id: number;
  username: string;
  displayName: string | null;
  isAdmin: boolean;
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  shootingIds: number[];
}

export interface AdminShooting extends Shooting {
  userIds: number[];
}

export function userLabel(u: Pick<AdminUser, 'username' | 'displayName'>): string {
  return u.displayName || u.username;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return 'jamais';
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

export interface ActivitySummaryRow {
  userId: number;
  username: string;
  displayName: string | null;
  shootingId: number;
  title: string;
  imageCount: number;
  visits: number;
  viewed: number;
  downloaded: number;
  lastAt: string;
}

export type ActivityEventType =
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'view_shooting'
  | 'view_image'
  | 'download_image'
  | 'download_zip';

export interface ActivityEvent {
  id: number;
  type: ActivityEventType;
  at: string;
  userId: number | null;
  username: string | null;
  displayName: string | null;
  shootingId: number | null;
  title: string | null;
  number: number | null;
  version: Version | null;
  details: { username?: string; deletedUser?: string; batch?: boolean } | null;
  ip: string | null;
}

export interface ActivityDetail {
  user: { id: number; username: string; displayName: string | null };
  shooting: { id: number; title: string };
  images: { number: number; version: Version; type: 'view_image' | 'download_image'; count: number; firstAt: string; lastAt: string }[];
  visits: { count: number; firstAt: string | null; lastAt: string | null };
}
