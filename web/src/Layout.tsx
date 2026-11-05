import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './auth';
import { Signature } from './components/Signature';

export function Layout({ children }: { children: ReactNode }) {
  const { user, siteName, logout } = useAuth();
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
      <main className="content">{children}</main>
    </div>
  );
}
