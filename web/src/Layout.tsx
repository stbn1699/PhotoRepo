import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './auth';
import { Signature } from './components/Signature';
import { APP_VERSION, versionLabel } from './version';

export function Layout({ children }: { children: ReactNode }) {
  const { user, siteName, serverVersion, logout } = useAuth();
  // Le serveur a été mis à jour mais cette page date d'avant : on propose de recharger.
  const outdated = !!serverVersion && serverVersion !== APP_VERSION && APP_VERSION !== 'dev';
  return (
    <div className="layout">
      <header className="topbar">
        <Link to="/" className="brand" aria-label={siteName}>
          <Signature className="signature-topbar" label={siteName} fallback={siteName} />
        </Link>
        <div className="topbar-right">
          {user?.isAdmin && (
            <Link to="/admin" className="btn btn-ghost">
              Admin
            </Link>
          )}
          <span className="whoami">
            {user?.displayName || user?.username}
            {user?.isAdmin && <span className="badge">admin</span>}
          </span>
          <button className="btn btn-ghost" onClick={logout}>
            Déconnexion
          </button>
        </div>
      </header>
      {outdated && (
        <div className="update-banner">
          Une nouvelle version du site est disponible.
          <button className="btn btn-primary btn-small" onClick={() => window.location.reload()}>
            Recharger
          </button>
        </div>
      )}
      <main className="content">{children}</main>
      {user?.isAdmin && (
        <footer className="version-footer" title="Version du site (visible seulement par l'admin)">
          {versionLabel()}
          {serverVersion && serverVersion !== APP_VERSION && ` · serveur v${serverVersion}`}
        </footer>
      )}
    </div>
  );
}
