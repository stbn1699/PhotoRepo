import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { LoginPage } from './pages/Login';
import { HomePage } from './pages/Home';
import { ShootingPage } from './pages/Shooting';
import { Layout } from './Layout';
import { AdminShootingsPage, AdminUserPage, AdminUsersPage } from './pages/Admin';
import './styles.css';

/** Toute page protégée renvoie vers /login si on n'est pas connecté. */
function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="page-loading" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Layout>{children}</Layout>;
}

/** Pages réservées à l'admin : les autres sont renvoyés à l'accueil. */
function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user?.isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Protected><HomePage /></Protected>} />
          <Route path="/shooting/:id" element={<Protected><ShootingPage /></Protected>} />
          <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
          <Route path="/admin/users" element={<Protected><AdminOnly><AdminUsersPage /></AdminOnly></Protected>} />
          <Route path="/admin/users/:id" element={<Protected><AdminOnly><AdminUserPage /></AdminOnly></Protected>} />
          <Route path="/admin/shootings" element={<Protected><AdminOnly><AdminShootingsPage /></AdminOnly></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
