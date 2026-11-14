// Sesiones server-side. El token vive solo en la cookie; en la DB se guarda su sha256.
import type { AstroCookies } from 'astro';
import type { App } from '../context.ts';
import type { Config } from '../config.ts';
import { randomToken, sha256, verifyPassword } from '../crypto.ts';
import { cookieName } from '../http.ts';

export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 14 * 24 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000;

export interface SessionUser {
  id: number;
  email: string;
  timezone: string;
}

export interface ActiveSession {
  id: string;
  csrfSecret: string;
  user: SessionUser;
}

export type SessionLookup =
  | { status: 'active'; session: ActiveSession }
  /** Caducada o revocada. userId permite atar el borrador de N5 al mismo usuario. */
  | { status: 'expired'; userId: number }
  | { status: 'none' };

export function createSession(app: App, userId: number): { token: string; session: ActiveSession } {
  const token = randomToken(32);
  const id = sha256(token);
  const csrfSecret = randomToken(24);
  const now = app.clock.now();
  app.db.run(
    'INSERT INTO sessions (id, user_id, csrf_secret, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    id, userId, csrfSecret, now, now, now + SESSION_ABSOLUTE_MS,
  );
  const user = app.db.get<SessionUser>('SELECT id, email, timezone FROM users WHERE id = ?', userId)!;
  return { token, session: { id, csrfSecret, user } };
}

export function lookupSession(app: App, token: string | undefined): SessionLookup {
  if (!token || token.length > 100) return { status: 'none' };
  const id = sha256(token);
  const row = app.db.get<{
    id: string; csrf_secret: string; last_seen_at: number; expires_at: number; revoked_at: number | null;
    user_id: number; email: string; timezone: string;
  }>(
    `SELECT s.id, s.csrf_secret, s.last_seen_at, s.expires_at, s.revoked_at, u.id AS user_id, u.email, u.timezone
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    id,
  );
  if (!row) return { status: 'none' };
  const now = app.clock.now();
  if (row.revoked_at !== null || row.expires_at <= now || row.last_seen_at + SESSION_IDLE_MS <= now) {
    return { status: 'expired', userId: row.user_id };
  }
  if (now - row.last_seen_at > TOUCH_EVERY_MS) app.db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', now, id);
  return {
    status: 'active',
    session: { id: row.id, csrfSecret: row.csrf_secret, user: { id: row.user_id, email: row.email, timezone: row.timezone } },
  };
}

/** Revoca una sesión. Devuelve true si estaba activa (no revocada). */
export function revokeSession(app: App, sessionId: string): boolean {
  return app.db.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', app.clock.now(), sessionId).changes > 0;
}

/** Revoca la sesión a la que apunta un token de cookie (si existe). */
export function revokeSessionByToken(app: App, token: string | undefined): boolean {
  if (!token || token.length > 100) return false;
  return revokeSession(app, sha256(token));
}

/** Revoca todas las sesiones del usuario (salvo `except`, p. ej. la actual). Devuelve cuántas se revocaron. */
export function revokeAllForUser(app: App, userId: number, opts: { except?: string } = {}): number {
  const now = app.clock.now();
  if (opts.except) {
    return app.db.run(
      'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id <> ?', now, userId, opts.except,
    ).changes;
  }
  return app.db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', now, userId).changes;
}

/** Borra sesiones caducadas o revocadas hace tiempo (mantenimiento). */
export function purgeSessions(app: App, graceMs = 7 * 24 * 60 * 60 * 1000): number {
  const cutoff = app.clock.now() - graceMs;
  return app.db.run('DELETE FROM sessions WHERE expires_at < ? OR revoked_at < ?', cutoff, cutoff).changes;
}

// ---------- cookie de sesión ----------

export function sessionCookieName(config: Config): string {
  return cookieName(config, 'pc_session');
}

export function setSessionCookie(cookies: AstroCookies, config: Config, token: string): void {
  cookies.set(sessionCookieName(config), token, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge: SESSION_ABSOLUTE_MS / 1000,
  });
}

/** Borra la cookie con los mismos atributos con los que se creó (necesario para __Host-). */
export function clearSessionCookie(cookies: AstroCookies, config: Config): void {
  cookies.delete(sessionCookieName(config), { path: '/', httpOnly: true, sameSite: 'lax', secure: config.secureCookies });
}

/** Verifica credenciales. Hace el mismo trabajo de hashing exista o no el usuario. */
export async function authenticate(app: App, email: string, password: string): Promise<SessionUser | null> {
  const row = app.db.get<{ id: number; email: string; timezone: string; password_hash: string }>(
    'SELECT id, email, timezone, password_hash FROM users WHERE email = ?',
    email.trim().toLowerCase(),
  );
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  return row && ok ? { id: row.id, email: row.email, timezone: row.timezone } : null;
}

// Hash de una contraseña aleatoria, para igualar tiempos cuando el email no existe.
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
