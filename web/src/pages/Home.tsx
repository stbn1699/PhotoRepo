import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatShootingDate, type Shooting } from '../api';
import { useAuth } from '../auth';

export function HomePage() {
  const { user } = useAuth();
  const [shootings, setShootings] = useState<Shooting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(() => {
    api
      .get<{ shootings: Shooting[] }>('/api/shootings')
      .then((r) => setShootings(r.shootings))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  async function rescan() {
    setScanning(true);
    try {
      await api.post('/api/admin/rescan');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setScanning(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>{user?.isAdmin ? 'Tous les shootings' : 'Mes shootings'}</h1>
        {user?.isAdmin && (
          <button className="btn btn-ghost" onClick={rescan} disabled={scanning}>
            {scanning ? 'Lecture…' : 'Relire les dossiers'}
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {shootings === null && !error && <p className="muted">Chargement…</p>}
      {shootings?.length === 0 && (
        <p className="empty">
          {user?.isAdmin ? 'Aucun dossier de shooting trouvé.' : 'Aucun shooting n’est encore partagé avec toi.'}
        </p>
      )}

      <div className="shooting-grid">
        {shootings?.map((s) => (
          <Link key={s.id} to={`/shooting/${s.id}`} className="shooting-card">
            <div className="shooting-cover" aria-hidden />
            <div className="shooting-info">
              <h2>{s.title}</h2>
              <p className="muted">
                {formatShootingDate(s)} · {s.imageCount} photo{s.imageCount > 1 ? 's' : ''}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
