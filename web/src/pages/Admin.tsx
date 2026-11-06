import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  api,
  formatDateTime,
  formatShootingDate,
  userLabel,
  type AdminShooting,
  type AdminUser,
} from '../api';
import { useAuth } from '../auth';
import { AccessList } from '../components/AccessList';
import { generatePassword, PasswordField } from '../components/PasswordField';

export function AdminTabs() {
  return (
    <div className="page-header">
      <h1>Administration</h1>
      <nav className="tabs">
        <NavLink to="/admin/users">Utilisateurs</NavLink>
        <NavLink to="/admin/shootings">Accès par shooting</NavLink>
        <NavLink to="/admin/activity">Suivi</NavLink>
      </nav>
    </div>
  );
}

/**
 * Enregistre automatiquement une liste d'accès à chaque changement.
 * Les envois sont faits l'un après l'autre, et seul le dernier état compte.
 */
function useAutoSave(save: (ids: number[]) => Promise<unknown>, onError: (message: string) => void) {
  const [saving, setSaving] = useState(false);
  const pending = useRef<number[] | null>(null);
  const running = useRef(false);

  return {
    saving,
    queue: useCallback(
      async (ids: number[]) => {
        pending.current = ids;
        if (running.current) return;
        running.current = true;
        setSaving(true);
        try {
          while (pending.current) {
            const next = pending.current;
            pending.current = null;
            await save(next);
          }
        } catch (err) {
          onError(err instanceof Error ? err.message : 'Erreur');
        } finally {
          running.current = false;
          setSaving(false);
        }
      },
      [save, onError],
    ),
  };
}

// ---------------------------------------------------------------------------
// Liste des utilisateurs
// ---------------------------------------------------------------------------

export function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api
      .get<{ users: AdminUser[] }>('/api/admin/users')
      .then((r) => setUsers(r.users))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <>
      <AdminTabs />
      <div className="section-head">
        <p className="muted">
          Chaque personne ne voit que les shootings que tu lui ouvres. Les nouveaux dossiers sont cachés par défaut.
        </p>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          Nouvel utilisateur
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {users === null && !error && <p className="muted">Chargement…</p>}

      <div className="user-list">
        {users?.map((u) => (
          <Link key={u.id} to={`/admin/users/${u.id}`} className={`user-row ${u.disabled ? 'is-disabled' : ''}`}>
            <div className="avatar" aria-hidden>
              {userLabel(u).slice(0, 1).toUpperCase()}
            </div>
            <div className="user-main">
              <strong>{userLabel(u)}</strong>
              {u.displayName && <span className="muted small"> @{u.username}</span>}
              {u.isAdmin && <span className="badge">admin</span>}
              {u.disabled && <span className="badge badge-off">désactivé</span>}
              <div className="muted small">Dernière connexion : {formatDateTime(u.lastLoginAt)}</div>
            </div>
            <div className="user-count muted small">
              {u.isAdmin ? 'tous les shootings' : `${u.shootingIds.length} shooting${u.shootingIds.length > 1 ? 's' : ''}`}
            </div>
          </Link>
        ))}
      </div>

      {creating && <CreateUserDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateUserDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState(generatePassword);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<{ id: number; username: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const usernameValid = /^[A-Za-z0-9._-]{2,40}$/.test(username);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!usernameValid) {
      setError('Pseudo : 2 à 40 caractères, lettres sans accents, chiffres, « . », « _ » ou « - ».');
      return;
    }
    if (password.length < 8) {
      setError('Le mot de passe doit faire au moins 8 caractères.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const r = await api.post<{ id: number }>('/api/admin/users', {
        username,
        displayName: displayName || null,
        password,
      });
      setCreated({ id: r.id, username, password });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSubmitting(false);
    }
  }

  const message = created
    ? `Tes photos sont disponibles ici : ${window.location.origin}\nPseudo : ${created.username}\nMot de passe : ${created.password}`
    : '';

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      // presse-papiers indisponible : le texte reste affiché
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        {created ? (
          <>
            <h2>Compte créé</h2>
            <p className="muted">Message à envoyer à la personne :</p>
            <pre className="credentials">{message}</pre>
            <button className="btn btn-ghost btn-block" onClick={copyMessage}>
              {copied ? 'Copié ✓' : 'Copier le message'}
            </button>
            <p className="muted small">Le mot de passe ne sera plus affiché ensuite (tu pourras en générer un nouveau).</p>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => navigate(`/admin/users/${created.id}`)}>
                Choisir ses shootings →
              </button>
            </div>
          </>
        ) : (
          <form className="form" onSubmit={onSubmit}>
            <h2>Nouvel utilisateur</h2>
            <label className="field">
              Pseudo (pour se connecter)
              <input
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value.trim())}
                placeholder="ex. chloe.m"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            </label>
            <label className="field">
              Nom affiché (facultatif)
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="ex. Chloé Martin"
                maxLength={80}
              />
            </label>
            <PasswordField value={password} onChange={setPassword} required />
            {error && <p className="error">{error}</p>}
            <div className="modal-actions gap">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Annuler
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                Créer le compte
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fiche d'un utilisateur
// ---------------------------------------------------------------------------

export function AdminUserPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { user: me } = useAuth();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [shootings, setShootings] = useState<AdminShooting[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [u, s] = await Promise.all([
        api.get<{ user: AdminUser }>(`/api/admin/users/${id}`),
        api.get<{ shootings: AdminShooting[] }>('/api/admin/shootings'),
      ]);
      setUser(u.user);
      setDisplayName(u.user.displayName ?? '');
      setChecked(new Set(u.user.shootingIds));
      setShootings(s.shootings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    (ids: number[]) => api.put(`/api/admin/users/${id}/access`, { shootingIds: ids }),
    [id],
  );
  const onSaveError = useCallback(
    (message: string) => {
      setError(`Accès non enregistrés : ${message}`);
      void load();
    },
    [load],
  );
  const { saving, queue } = useAutoSave(save, onSaveError);

  function flash(message: string) {
    setError(null);
    setNotice(message);
    setTimeout(() => setNotice(null), 2500);
  }

  async function update(body: object, message: string) {
    try {
      await api.patch(`/api/admin/users/${id}`, body);
      await load();
      flash(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function remove() {
    if (!user) return;
    if (!window.confirm(`Supprimer définitivement le compte « ${userLabel(user)} » ?\nL'historique de ses consultations est conservé.`)) {
      return;
    }
    try {
      await api.del(`/api/admin/users/${id}`);
      navigate('/admin/users');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  if (error && !user) {
    return (
      <>
        <Link to="/admin/users" className="back-link">← Utilisateurs</Link>
        <p className="error">{error}</p>
      </>
    );
  }
  if (!user || !shootings) return <p className="muted">Chargement…</p>;

  const isMe = me?.id === user.id;

  return (
    <>
      <Link to="/admin/users" className="back-link">← Utilisateurs</Link>
      <div className="page-header">
        <div>
          <h1>
            {userLabel(user)}
            {user.isAdmin && <span className="badge">admin</span>}
            {user.disabled && <span className="badge badge-off">désactivé</span>}
          </h1>
          <p className="muted small">
            Pseudo : {user.username} · Créé le {formatDateTime(user.createdAt)} · Dernière connexion :{' '}
            {formatDateTime(user.lastLoginAt)}
          </p>
        </div>
        <Link to={`/admin/activity?userId=${user.id}${user.isAdmin ? '&includeAdmin=1' : ''}`} className="btn btn-ghost">
          Voir son activité
        </Link>
      </div>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <section className="panel">
        <h2>Shootings accessibles</h2>
        {user.isAdmin ? (
          <p className="muted">Un admin voit tous les shootings.</p>
        ) : (
          <AccessList
            items={shootings.map((s) => ({
              id: s.id,
              label: s.title,
              sublabel: `${formatShootingDate(s)} · ${s.imageCount} photos`,
            }))}
            checked={checked}
            onChange={(next) => {
              setChecked(next);
              void queue([...next]);
            }}
            saving={saving}
            searchPlaceholder="Rechercher un shooting…"
            emptyText="Aucun shooting pour l’instant."
          />
        )}
      </section>

      <section className="panel">
        <h2>Nom affiché</h2>
        <form
          className="field-row"
          onSubmit={(e) => {
            e.preventDefault();
            void update({ displayName: displayName || null }, 'Nom enregistré');
          }}
        >
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={user.username} maxLength={80} />
          <button className="btn btn-ghost" type="submit" disabled={(user.displayName ?? '') === displayName}>
            Enregistrer
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Nouveau mot de passe</h2>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (password.length < 8) return setError('Le mot de passe doit faire au moins 8 caractères.');
            void update({ password }, 'Mot de passe changé').then(() => setPassword(''));
          }}
        >
          <PasswordField value={password} onChange={setPassword} label="Mot de passe" />
          <p className="muted small">
            {isMe ? 'Tes autres appareils seront déconnectés.' : 'La personne sera déconnectée et devra utiliser le nouveau mot de passe.'}
          </p>
          <div>
            <button className="btn btn-ghost" type="submit" disabled={!password}>
              Changer le mot de passe
            </button>
          </div>
        </form>
      </section>

      {!isMe && !user.isAdmin && (
        <section className="panel">
          <h2>Compte</h2>
          <div className="field-row">
            {user.disabled ? (
              <button className="btn btn-ghost" onClick={() => update({ disabled: false }, 'Compte réactivé')}>
                Réactiver le compte
              </button>
            ) : (
              <button className="btn btn-ghost" onClick={() => update({ disabled: true }, 'Compte désactivé')}>
                Désactiver le compte
              </button>
            )}
            <button className="btn btn-danger" onClick={remove}>
              Supprimer le compte
            </button>
          </div>
          <p className="muted small">Un compte désactivé ne peut plus se connecter, mais garde ses accès si tu le réactives.</p>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Accès par shooting
// ---------------------------------------------------------------------------

export function AdminShootingsPage() {
  const [params, setParams] = useSearchParams();
  const openId = Number(params.get('open')) || null;
  const [shootings, setShootings] = useState<AdminShooting[] | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, u] = await Promise.all([
        api.get<{ shootings: AdminShooting[] }>('/api/admin/shootings'),
        api.get<{ users: AdminUser[] }>('/api/admin/users'),
      ]);
      setShootings(s.shootings);
      setUsers(u.users.filter((x) => !x.isAdmin));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Fait défiler jusqu'au shooting ouvert depuis sa galerie.
  useEffect(() => {
    if (openId && shootings) document.getElementById(`shooting-${openId}`)?.scrollIntoView({ block: 'center' });
  }, [openId, shootings]);

  const names = new Map(users.map((u) => [u.id, userLabel(u)]));

  return (
    <>
      <AdminTabs />
      {error && <p className="error">{error}</p>}
      {shootings === null && !error && <p className="muted">Chargement…</p>}
      <div className="shooting-access-list">
        {shootings?.map((s) => {
          const open = s.id === openId;
          return (
            <div key={s.id} id={`shooting-${s.id}`} className={`panel ${open ? 'is-open' : ''}`}>
              <button className="panel-toggle" onClick={() => setParams(open ? {} : { open: String(s.id) }, { replace: true })}>
                <div>
                  <strong>{s.title}</strong>
                  <div className="muted small">
                    {formatShootingDate(s)} · {s.imageCount} photos
                    {s.rawCount > 0 && ` · ${s.rawCount} RAW${s.rawsShared ? ' (partagés)' : ''}`}
                  </div>
                </div>
                <div className="chips">
                  {s.userIds.length === 0 ? (
                    <span className="muted small">Caché pour tout le monde</span>
                  ) : (
                    s.userIds.map((uid) => (
                      <span key={uid} className="chip">
                        {names.get(uid) ?? '?'}
                      </span>
                    ))
                  )}
                </div>
              </button>
              {open && (
                <ShootingAccess
                  shooting={s}
                  users={users}
                  onSaved={(userIds) =>
                    setShootings((prev) => prev?.map((x) => (x.id === s.id ? { ...x, userIds } : x)) ?? prev)
                  }
                  onRawsChange={(rawsShared) =>
                    setShootings((prev) => prev?.map((x) => (x.id === s.id ? { ...x, rawsShared } : x)) ?? prev)
                  }
                  onError={(m) => {
                    setError(`Accès non enregistrés : ${m}`);
                    void load();
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function ShootingAccess({
  shooting,
  users,
  onSaved,
  onRawsChange,
  onError,
}: {
  shooting: AdminShooting;
  users: AdminUser[];
  onSaved: (userIds: number[]) => void;
  onRawsChange: (shared: boolean) => void;
  onError: (message: string) => void;
}) {
  const [checked, setChecked] = useState(() => new Set(shooting.userIds));
  const save = useCallback(
    async (ids: number[]) => {
      await api.put(`/api/admin/shootings/${shooting.id}/access`, { userIds: ids });
      onSaved([...ids].sort((a, b) => a - b));
    },
    [shooting.id, onSaved],
  );
  const { saving, queue } = useAutoSave(save, onError);
  const [rawsShared, setRawsShared] = useState(shooting.rawsShared);

  async function toggleRaws(shared: boolean) {
    setRawsShared(shared);
    try {
      await api.patch(`/api/admin/shootings/${shooting.id}`, { rawsShared: shared });
      onRawsChange(shared);
    } catch (err) {
      setRawsShared(!shared);
      onError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  return (
    <div className="panel-body">
      {shooting.rawCount > 0 && (
        <label className="switch panel-switch">
          <input type="checkbox" checked={rawsShared} onChange={(e) => toggleRaws(e.target.checked)} />
          <span className="switch-track" aria-hidden />
          Partager les RAW ({shooting.rawCount}) · visibles en aperçu filigrané, jamais téléchargeables
        </label>
      )}
      <AccessList
        items={users.map((u) => ({
          id: u.id,
          label: userLabel(u),
          sublabel: u.disabled ? 'désactivé' : u.displayName ? `@${u.username}` : undefined,
        }))}
        checked={checked}
        onChange={(next) => {
          setChecked(next);
          void queue([...next]);
        }}
        saving={saving}
        searchPlaceholder="Rechercher une personne…"
        emptyText="Aucun utilisateur. Crée d’abord un compte dans l’onglet Utilisateurs."
      />
    </div>
  );
}
