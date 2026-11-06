import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  api,
  formatDateTime,
  imageUrl,
  userLabel,
  VERSION_LABELS,
  type ActivityDetail,
  type ActivityEvent,
  type ActivitySummaryRow,
  type AdminShooting,
  type AdminUser,
  type ShootingDetail,
  type Version,
} from '../api';
import { AdminTabs } from './Admin';

const PERIODS = [
  { value: '7', label: '7 derniers jours' },
  { value: '30', label: '30 derniers jours' },
  { value: '90', label: '3 derniers mois' },
  { value: '', label: 'Depuis le début' },
];

const JOURNAL_GROUPS = [
  { value: '', label: 'Tout' },
  { value: 'likes', label: 'Favoris' },
  { value: 'downloads', label: 'Téléchargements' },
  { value: 'views', label: 'Consultations' },
  { value: 'logins', label: 'Connexions' },
];

function percent(n: number, total: number): string {
  return total > 0 ? `${Math.round((n / total) * 100)} %` : '';
}

// ---------------------------------------------------------------------------
// Page principale : filtres, résumé, journal
// ---------------------------------------------------------------------------

export function ActivityPage() {
  const [params, setParams] = useSearchParams();
  const userId = params.get('userId') ?? '';
  const shootingId = params.get('shootingId') ?? '';
  const days = params.get('days') ?? '30';
  const includeAdmin = params.get('includeAdmin') === '1';
  const group = params.get('group') ?? '';

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [shootings, setShootings] = useState<AdminShooting[]>([]);
  const [summary, setSummary] = useState<ActivitySummaryRow[] | null>(null);
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // "30 jours" est la valeur par défaut, "Depuis le début" doit donc être noté explicitement.
    if (key === 'days' && !value) next.set('days', 'all');
    setParams(next, { replace: true });
  }

  useEffect(() => {
    Promise.all([
      api.get<{ users: AdminUser[] }>('/api/admin/users'),
      api.get<{ shootings: AdminShooting[] }>('/api/admin/shootings'),
    ])
      .then(([u, s]) => {
        setUsers(u.users);
        setShootings(s.shootings);
      })
      .catch((err) => setError(err.message));
  }, []);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (userId) q.set('userId', userId);
    if (shootingId) q.set('shootingId', shootingId);
    if (days && days !== 'all') q.set('days', days);
    if (includeAdmin) q.set('includeAdmin', 'true');
    return q;
  }, [userId, shootingId, days, includeAdmin]);

  useEffect(() => {
    setSummary(null);
    api
      .get<{ rows: ActivitySummaryRow[] }>(`/api/admin/activity/summary?${query}`)
      .then((r) => setSummary(r.rows))
      .catch((err) => setError(err.message));
  }, [query]);

  const loadEvents = useCallback(
    async (before: number | null) => {
      const q = new URLSearchParams(query);
      if (group) q.set('group', group);
      if (before) q.set('before', String(before));
      const r = await api.get<{ events: ActivityEvent[]; nextBefore: number | null }>(`/api/admin/activity/events?${q}`);
      setEvents((prev) => (before && prev ? [...prev, ...r.events] : r.events));
      setNextBefore(r.nextBefore);
    },
    [query, group],
  );

  useEffect(() => {
    setEvents(null);
    loadEvents(null).catch((err) => setError(err.message));
  }, [loadEvents]);

  const totals = useMemo(() => {
    const t = { people: new Set<number>(), visits: 0, viewed: 0, downloaded: 0, liked: 0 };
    for (const r of summary ?? []) {
      t.people.add(r.userId);
      t.visits += r.visits;
      t.viewed += r.viewed;
      t.downloaded += r.downloaded;
      t.liked += r.liked;
    }
    return t;
  }, [summary]);

  return (
    <>
      <AdminTabs />

      <div className="filters">
        <select value={userId} onChange={(e) => setFilter('userId', e.target.value)} aria-label="Personne">
          <option value="">Toutes les personnes</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {userLabel(u)}
              {u.isAdmin ? ' (admin)' : ''}
            </option>
          ))}
        </select>
        <select value={shootingId} onChange={(e) => setFilter('shootingId', e.target.value)} aria-label="Shooting">
          <option value="">Tous les shootings</option>
          {shootings.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <select value={days === 'all' ? '' : days} onChange={(e) => setFilter('days', e.target.value)} aria-label="Période">
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <label className="checkbox">
          <input type="checkbox" checked={includeAdmin} onChange={(e) => setFilter('includeAdmin', e.target.checked ? '1' : '')} />
          Inclure mes propres actions
        </label>
      </div>

      {error && <p className="error">{error}</p>}

      <section className="panel">
        <h2>Résumé</h2>
        {summary === null ? (
          <p className="muted">Chargement…</p>
        ) : summary.length === 0 ? (
          <p className="muted">Aucune activité sur cette période.</p>
        ) : (
          <>
            <div className="stats">
              <Stat value={totals.people.size} label={totals.people.size > 1 ? 'personnes' : 'personne'} />
              <Stat value={totals.visits} label={totals.visits > 1 ? 'visites de galerie' : 'visite de galerie'} />
              <Stat value={totals.viewed} label="photos vues en grand" />
              <Stat value={totals.liked} label="photos aimées" />
              <Stat value={totals.downloaded} label="photos téléchargées" />
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Personne</th>
                    <th>Shooting</th>
                    <th className="num">Visites</th>
                    <th className="num">Vues</th>
                    <th className="num">Aimées</th>
                    <th className="num">Téléchargées</th>
                    <th>Dernière activité</th>
                    <th aria-label="Détail" />
                  </tr>
                </thead>
                <tbody>
                  {summary.map((r) => (
                    <tr key={`${r.userId}-${r.shootingId}`}>
                      <td>{userLabel(r)}</td>
                      <td>{r.title}</td>
                      <td className="num">{r.visits}</td>
                      <td className="num">
                        {r.viewed} / {r.imageCount}
                      </td>
                      <td className="num">{r.liked > 0 ? <span className="liked-count">♥ {r.liked}</span> : '0'}</td>
                      <td className="num">
                        <strong>{r.downloaded}</strong> / {r.imageCount}
                        <div className="muted small">{percent(r.downloaded, r.imageCount)}</div>
                      </td>
                      <td className="muted small">{formatDateTime(r.lastAt)}</td>
                      <td>
                        <Link to={`/admin/activity/${r.userId}/${r.shootingId}`} className="btn btn-ghost btn-small">
                          Détail
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <div className="panel-title-row">
          <h2>Journal</h2>
          <div className="segmented">
            {JOURNAL_GROUPS.map((g) => (
              <button key={g.value} className={g.value === group ? 'active' : ''} onClick={() => setFilter('group', g.value)}>
                {g.label}
              </button>
            ))}
          </div>
        </div>
        {events === null ? (
          <p className="muted">Chargement…</p>
        ) : events.length === 0 ? (
          <p className="muted">Rien à afficher.</p>
        ) : (
          <>
            <Journal events={events} />
            {nextBefore && (
              <button className="btn btn-ghost" onClick={() => loadEvents(nextBefore).catch((err) => setError(err.message))}>
                Voir plus ancien
              </button>
            )}
          </>
        )}
      </section>
    </>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span className="muted small">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Journal : les actions répétées (téléchargement de 12 photos d'affilée…) sont regroupées
// ---------------------------------------------------------------------------

interface EventGroup {
  key: string;
  type: ActivityEvent['type'];
  first: ActivityEvent; // le plus récent
  items: ActivityEvent[];
}

const GROUP_WINDOW_MS = 15 * 60 * 1000;
const GROUPABLE = new Set(['view_image', 'download_image', 'like_image', 'view_shooting', 'login_failed']);

function groupEvents(events: ActivityEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  for (const e of events) {
    const last = groups[groups.length - 1];
    const oldest = last?.items[last.items.length - 1];
    if (
      last &&
      oldest &&
      GROUPABLE.has(e.type) &&
      last.type === e.type &&
      last.first.userId === e.userId &&
      last.first.shootingId === e.shootingId &&
      new Date(oldest.at).getTime() - new Date(e.at).getTime() < GROUP_WINDOW_MS
    ) {
      last.items.push(e);
    } else {
      groups.push({ key: String(e.id), type: e.type, first: e, items: [e] });
    }
  }
  return groups;
}

function personName(e: ActivityEvent): string {
  if (e.username) return e.displayName || e.username;
  if (e.details?.deletedUser) return `${e.details.deletedUser} (supprimé)`;
  return 'Quelqu’un';
}

/** "n° 1, 2, 5" (avec la version si ce n'est pas l'originale), sans doublons. */
function describeImages(items: ActivityEvent[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const e of [...items].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))) {
    const label = `${e.number}${e.version && e.version !== 'original' ? ` (${VERSION_LABELS[e.version]})` : ''}`;
    if (!seen.has(label)) {
      seen.add(label);
      parts.push(label);
    }
  }
  return `n° ${parts.join(', ')}`;
}

function distinctCount(items: ActivityEvent[]): number {
  return new Set(items.map((e) => `${e.number}-${e.version}`)).size;
}

function Journal({ events }: { events: ActivityEvent[] }) {
  const groups = useMemo(() => groupEvents(events), [events]);
  return (
    <ul className="journal">
      {groups.map((g) => {
        const e = g.first;
        const who = <strong>{personName(e)}</strong>;
        const where = e.shootingId ? (
          <Link to={`/admin/activity/${e.userId}/${e.shootingId}`}>{e.title}</Link>
        ) : null;
        const n = distinctCount(g.items);
        let icon = '•';
        let text: ReactNode;
        switch (g.type) {
          case 'download_image':
            icon = '⬇';
            text = (
              <>
                {who} a téléchargé {n} photo{n > 1 ? 's' : ''} de {where}
              </>
            );
            break;
          case 'like_image':
            icon = '♥';
            text = (
              <>
                {who} a aimé {n} photo{n > 1 ? 's' : ''} de {where}
              </>
            );
            break;
          case 'view_image':
            icon = '👁';
            text = (
              <>
                {who} a regardé {n} photo{n > 1 ? 's' : ''} en grand dans {where}
              </>
            );
            break;
          case 'view_shooting':
            icon = '▦';
            text = (
              <>
                {who} a ouvert la galerie {where}
              </>
            );
            break;
          case 'login':
            icon = '→';
            text = <>{who} s’est connecté·e</>;
            break;
          case 'logout':
            icon = '←';
            text = <>{who} s’est déconnecté·e</>;
            break;
          case 'login_failed':
            icon = '!';
            text = (
              <>
                {g.items.length > 1 ? `${g.items.length} échecs` : 'Échec'} de connexion avec le pseudo «{' '}
                {e.details?.username ?? '?'} »
              </>
            );
            break;
          default:
            text = (
              <>
                {who} : {g.type}
              </>
            );
        }
        const showImages = g.type === 'download_image' || g.type === 'view_image' || g.type === 'like_image';
        return (
          <li key={g.key} className={`journal-item type-${g.type}`}>
            <span className="journal-icon" aria-hidden>
              {icon}
            </span>
            <div className="journal-text">
              <div>{text}</div>
              {showImages && <div className="muted small">{describeImages(g.items)}</div>}
            </div>
            <time className="muted small" dateTime={e.at} title={e.ip ? `IP ${e.ip}` : undefined}>
              {formatDateTime(e.at)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Détail : une personne × un shooting, photo par photo
// ---------------------------------------------------------------------------

type DetailFilter = 'all' | 'liked' | 'viewed' | 'downloaded' | 'untouched';

export function ActivityDetailPage() {
  const { userId, shootingId } = useParams();
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [gallery, setGallery] = useState<ShootingDetail | null>(null);
  const [filter, setFilter] = useState<DetailFilter>('all');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<ActivityDetail>(`/api/admin/activity/detail?userId=${userId}&shootingId=${shootingId}`),
      api.get<ShootingDetail>(`/api/shootings/${shootingId}`).catch(() => null), // dossier peut-être supprimé
    ])
      .then(([d, g]) => {
        setDetail(d);
        setGallery(g);
      })
      .catch((err) => setError(err.message));
  }, [userId, shootingId]);

  // Par numéro d'image : versions vues / téléchargées, nombre de fois, dernière date.
  const byNumber = useMemo(() => {
    const map = new Map<number, { viewed: Set<Version>; downloaded: Map<Version, number>; lastAt: string }>();
    for (const row of detail?.images ?? []) {
      const entry = map.get(row.number) ?? { viewed: new Set(), downloaded: new Map(), lastAt: row.lastAt };
      if (row.type === 'view_image') entry.viewed.add(row.version);
      else entry.downloaded.set(row.version, row.count);
      if (row.lastAt > entry.lastAt) entry.lastAt = row.lastAt;
      map.set(row.number, entry);
    }
    return map;
  }, [detail]);

  if (error) {
    return (
      <>
        <Link to="/admin/activity" className="back-link">← Suivi</Link>
        <p className="error">{error}</p>
      </>
    );
  }
  if (!detail) return <p className="muted">Chargement…</p>;

  const images = gallery?.images ?? [];
  const likedSet = new Set(detail.likes);
  const total = images.length;
  const viewedCount = images.filter((i) => byNumber.get(i.number)?.viewed.size).length;
  const downloadedCount = images.filter((i) => byNumber.get(i.number)?.downloaded.size).length;

  const visible = images.filter((img) => {
    const a = byNumber.get(img.number);
    if (filter === 'liked') return likedSet.has(img.number);
    if (filter === 'viewed') return !!a?.viewed.size;
    if (filter === 'downloaded') return !!a?.downloaded.size;
    if (filter === 'untouched') return !a && !likedSet.has(img.number);
    return true;
  });

  return (
    <>
      <Link to={`/admin/activity?userId=${detail.user.id}`} className="back-link">
        ← Suivi
      </Link>
      <div className="page-header">
        <div>
          <h1>
            {userLabel(detail.user)} · {detail.shooting.title}
          </h1>
          <p className="muted small">
            {detail.visits.count} visite{detail.visits.count > 1 ? 's' : ''} de la galerie
            {detail.visits.lastAt && ` · dernière le ${formatDateTime(detail.visits.lastAt)}`}
          </p>
        </div>
        {gallery && (
          <Link to={`/shooting/${detail.shooting.id}`} className="btn btn-ghost">
            Ouvrir la galerie
          </Link>
        )}
      </div>

      <div className="stats">
        <Stat value={likedSet.size} label="aimées ♥" />
        <Stat value={viewedCount} label={`/ ${total} vues en grand`} />
        <Stat value={downloadedCount} label={`/ ${total} téléchargées`} />
      </div>

      {!gallery && <p className="muted">Ce dossier n’existe plus sur le NAS : les miniatures ne sont pas disponibles.</p>}

      {gallery && (
        <>
          <div className="segmented detail-filter">
            {(
              [
                ['all', `Toutes (${total})`],
                ['liked', `Aimées (${likedSet.size})`],
                ['downloaded', `Téléchargées (${downloadedCount})`],
                ['viewed', `Vues (${viewedCount})`],
                ['untouched', `Jamais ouvertes (${images.filter((i) => !byNumber.has(i.number) && !likedSet.has(i.number)).length})`],
              ] as [DetailFilter, string][]
            ).map(([value, label]) => (
              <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>

          <div className="activity-grid">
            {visible.map((img) => {
              const a = byNumber.get(img.number);
              // Miniature de l'originale, ou du RAW si la photo n'a pas été retouchée.
              const thumbVersion: Version = img.versions.original ? 'original' : 'raw';
              const info = img.versions[thumbVersion]!;
              return (
                <div key={img.number} className={`activity-tile ${a ? '' : 'is-untouched'}`}>
                  <img src={imageUrl(detail.shooting.id, img.number, thumbVersion, 'thumb', info.token)} alt="" loading="lazy" />
                  <div className="activity-tile-info">
                    <span className="muted small">n° {img.number}</span>
                    {likedSet.has(img.number) && <span className="tag tag-like">♥</span>}
                    {a?.downloaded.size ? (
                      <span className="tag tag-download" title={`Dernière activité : ${formatDateTime(a.lastAt)}`}>
                        ⬇ {[...a.downloaded.keys()].map((v) => VERSION_LABELS[v]).join(', ')}
                      </span>
                    ) : a?.viewed.size ? (
                      <span className="tag tag-view" title={`Dernière activité : ${formatDateTime(a.lastAt)}`}>
                        👁 vue
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
