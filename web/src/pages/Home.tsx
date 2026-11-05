import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatShootingDate, type Shooting } from '../api';
import { useAuth } from '../auth';
import { FadeImage } from '../components/FadeImage';

export function HomePage() {
  const { user } = useAuth();
  const [shootings, setShootings] = useState<Shooting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // À l'arrivée sur l'accueil, le serveur relit les dossiers du NAS avant de répondre.
  const load = useCallback((refresh: boolean) => {
    api
      .get<{ shootings: Shooting[] }>(`/api/shootings${refresh ? '?refresh=1' : ''}`)
      .then((r) => setShootings(r.shootings))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => load(true), [load]);

  async function rescan() {
    setScanning(true);
    try {
      await api.post('/api/admin/rescan');
      load(false);
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
      {shootings?.length === 0 && (
        <p className="empty">
          {user?.isAdmin ? 'Aucun dossier de shooting trouvé.' : 'Aucun shooting n’est encore partagé avec toi.'}
        </p>
      )}

      <div className="shooting-grid" aria-busy={shootings === null}>
        {shootings === null && !error && <ShootingSkeletons />}
        {shootings?.map((s) => (
          <Link key={s.id} to={`/shooting/${s.id}`} className="shooting-card">
            <div className="shooting-cover" aria-hidden>
              {s.imageCount > 0 && <FadeImage src={`/api/shootings/${s.id}/cover`} alt="" loading="lazy" />}
            </div>
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

/** Cartes « fantômes » affichées pendant le chargement. */
function ShootingSkeletons() {
  // Largeurs variées pour que ça ressemble à de vrais titres.
  const titles = ['70%', '55%', '82%', '62%', '48%', '75%'];
  return (
    <>
      {titles.map((width, i) => (
        <div key={i} className="shooting-card skeleton-card" aria-hidden>
          <div className="shooting-cover skeleton" />
          <div className="shooting-info">
            <div className="skeleton skeleton-line" style={{ width }} />
            <div className="skeleton skeleton-line skeleton-line-small" style={{ width: '40%' }} />
          </div>
        </div>
      ))}
    </>
  );
}
