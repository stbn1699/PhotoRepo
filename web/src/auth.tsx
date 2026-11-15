import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type User } from './api';

interface AuthState {
  user: User | null;
  loading: boolean;
  siteName: string;
  /** Version du serveur (pour repérer une page restée sur une ancienne version). */
  serverVersion: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [siteName, setSiteName] = useState('Galerie');
  const [serverVersion, setServerVersion] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ name: string; version: string | null }>('/api/site')
      .then((s) => {
        setSiteName(s.name);
        setServerVersion(s.version);
        document.title = s.name;
      })
      .catch(() => {});
    api
      .get<{ user: User }>('/api/auth/me')
      .then((r) => setUser(r.user))
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 401)) console.error(err);
      })
      .finally(() => setLoading(false));
  }, []);

  // Un onglet peut rester ouvert des jours sans être rechargé (surtout sur téléphone) : on revérifie
  // la version du serveur quand on revient sur l'onglet et toutes les 5 minutes.
  useEffect(() => {
    const check = () =>
      api
        .get<{ version: string | null }>('/api/site')
        .then((s) => setServerVersion(s.version))
        .catch(() => {});
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(check, 5 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api.post<{ user: User }>('/api/auth/login', { username, password });
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => {});
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, siteName, serverVersion, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}
