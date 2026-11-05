import crypto from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { pool } from './db.js';

export const SESSION_COOKIE = 'sid';

export interface SessionUser {
  id: number;
  username: string;
  displayName: string | null;
  isAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

// Hash factice : on vérifie quand même un mot de passe quand le pseudo n'existe pas,
// pour qu'on ne puisse pas deviner les pseudos existants au temps de réponse.
let dummyHash: Promise<string> | null = null;

/** Retourne l'utilisateur si le pseudo et le mot de passe sont bons, sinon null. */
export async function checkCredentials(username: string, password: string): Promise<SessionUser | null> {
  const { rows } = await pool.query<{
    id: number;
    username: string;
    display_name: string | null;
    password_hash: string;
    is_admin: boolean;
    disabled: boolean;
  }>('SELECT id, username, display_name, password_hash, is_admin, disabled FROM users WHERE lower(username) = lower($1)', [
    username,
  ]);
  const row = rows[0];
  if (!row) {
    dummyHash ??= hash(crypto.randomBytes(16).toString('hex'));
    await verify(await dummyHash, password).catch(() => false);
    return null;
  }
  const ok = await verify(row.password_hash, password).catch(() => false);
  if (!ok || row.disabled) return null;
  return { id: row.id, username: row.username, displayName: row.display_name, isAdmin: row.is_admin };
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(reply: FastifyReply, request: FastifyRequest, userId: number): Promise<void> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 24 * 3600 * 1000);
  await pool.query(
    'INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5)',
    [hashToken(token), userId, expires, request.ip, request.headers['user-agent'] ?? null],
  );
  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto', // en HTTPS derrière le proxy, en HTTP sur le réseau local
    expires,
  });
}

export async function destroySession(reply: FastifyReply, request: FastifyRequest): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Lit le cookie de session et remplit request.user (appelé avant chaque requête). */
export async function loadSession(request: FastifyRequest): Promise<void> {
  request.user = null;
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return;
  const { rows } = await pool.query<{ id: number; username: string; display_name: string | null; is_admin: boolean }>(
    `SELECT u.id, u.username, u.display_name, u.is_admin
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND NOT u.disabled`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (row) request.user = { id: row.id, username: row.username, displayName: row.display_name, isAdmin: row.is_admin };
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) await reply.code(401).send({ error: 'Non connecté' });
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) await reply.code(401).send({ error: 'Non connecté' });
  else if (!request.user.isAdmin) await reply.code(403).send({ error: 'Réservé à l’administrateur' });
}

/** Crée le compte admin au premier démarrage si ADMIN_USERNAME / ADMIN_PASSWORD sont définis. */
export async function ensureAdmin(log: { info: (msg: string) => void; warn: (msg: string) => void }): Promise<void> {
  const { rows } = await pool.query('SELECT 1 FROM users WHERE is_admin LIMIT 1');
  if (rows.length > 0) return;
  if (!config.adminUsername || !config.adminPassword) {
    log.warn('Aucun compte admin : définis ADMIN_USERNAME et ADMIN_PASSWORD puis redémarre.');
    return;
  }
  await pool.query('INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, true)', [
    config.adminUsername,
    await hashPassword(config.adminPassword),
  ]);
  log.info(`Compte admin "${config.adminUsername}" créé.`);
}
