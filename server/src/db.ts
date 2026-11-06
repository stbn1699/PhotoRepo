import pg from 'pg';
import { config } from './config.js';

// Les colonnes "date" restent des chaînes "YYYY-MM-DD" (pas de décalage de fuseau horaire).
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

const migrations: string[] = [
  // 1 : schéma initial
  `
  CREATE TABLE users (
    id            serial PRIMARY KEY,
    username      text NOT NULL,
    display_name  text,
    password_hash text NOT NULL,
    is_admin      boolean NOT NULL DEFAULT false,
    disabled      boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz
  );
  CREATE UNIQUE INDEX users_username_unique ON users (lower(username));

  CREATE TABLE sessions (
    token_hash  text PRIMARY KEY,
    user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    ip          text,
    user_agent  text
  );
  CREATE INDEX sessions_user_idx ON sessions (user_id);

  CREATE TABLE shootings (
    id             serial PRIMARY KEY,
    folder_name    text NOT NULL UNIQUE,
    title          text NOT NULL,
    shot_date      date NOT NULL,
    date_precision text NOT NULL CHECK (date_precision IN ('day', 'month')),
    image_count    integer NOT NULL DEFAULT 0,
    present        boolean NOT NULL DEFAULT true,
    discovered_at  timestamptz NOT NULL DEFAULT now()
  );

  -- Par défaut personne n'a accès à rien : seules les lignes ici donnent l'accès.
  CREATE TABLE shooting_access (
    user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shooting_id integer NOT NULL REFERENCES shootings(id) ON DELETE CASCADE,
    granted_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, shooting_id)
  );

  -- Journal : connexions, consultations, téléchargements.
  CREATE TABLE events (
    id           bigserial PRIMARY KEY,
    user_id      integer REFERENCES users(id) ON DELETE SET NULL,
    type         text NOT NULL,
    shooting_id  integer REFERENCES shootings(id) ON DELETE SET NULL,
    image_number integer,
    version      text,
    details      jsonb,
    ip           text,
    created_at   timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX events_created_idx ON events (created_at DESC);
  CREATE INDEX events_user_idx ON events (user_id, created_at DESC);
  `,
  // 2 : partage des RAW par shooting (désactivé par défaut)
  `
  ALTER TABLE shootings
    ADD COLUMN raws_shared boolean NOT NULL DEFAULT false,
    ADD COLUMN raw_count integer NOT NULL DEFAULT 0;
  `,
  // 3 : likes (favoris des modèles), un par photo (numéro), toutes versions confondues
  `
  CREATE TABLE likes (
    user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shooting_id  integer NOT NULL REFERENCES shootings(id) ON DELETE CASCADE,
    image_number integer NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, shooting_id, image_number)
  );
  CREATE INDEX likes_shooting_idx ON likes (shooting_id, image_number);
  `,
];

/** Attend que la base réponde (au démarrage du NAS, Postgres peut être plus lent que le site). */
export async function waitForDatabase(log: { warn: (msg: string) => void }, attempts = 30): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      log.warn(`Base de données pas encore prête (essai ${i}/${attempts}), nouvel essai dans 2 s…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const { rows } = await client.query<{ version: number }>('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.version));
    for (let i = 0; i < migrations.length; i++) {
      const version = i + 1;
      if (applied.has(version)) continue;
      await client.query('BEGIN');
      try {
        await client.query(migrations[i]);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    client.release();
  }
}

export type EventType =
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'view_shooting'
  | 'view_image'
  | 'download_image'
  | 'like_image'
  | 'download_zip';

export async function logEvent(event: {
  userId: number | null;
  type: EventType;
  shootingId?: number | null;
  imageNumber?: number | null;
  version?: string | null;
  details?: Record<string, unknown> | null;
  ip?: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO events (user_id, type, shooting_id, image_number, version, details, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      event.userId,
      event.type,
      event.shootingId ?? null,
      event.imageNumber ?? null,
      event.version ?? null,
      event.details ? JSON.stringify(event.details) : null,
      event.ip ?? null,
    ],
  );
}
