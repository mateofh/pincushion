// Ajustes de la cuenta: zona horaria, cambio de contraseña y cierre de sesiones, con auditoría.
import type { App } from '../context.ts';
import { hashPassword, verifyPassword } from '../crypto.ts';
import { revokeAllForUser, revokeSession } from './sessions.ts';
import { audit } from '../security/audit.ts';
import { hit } from '../security/rate-limit.ts';

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

/** Zonas comunes para el select de Ajustes (valor IANA → etiqueta en español). */
export const COMMON_TIMEZONES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'Europe/Madrid', label: 'Madrid' },
  { value: 'Atlantic/Canary', label: 'Canarias' },
  { value: 'Europe/Lisbon', label: 'Lisboa' },
  { value: 'Europe/London', label: 'Londres' },
  { value: 'Europe/Paris', label: 'París' },
  { value: 'Europe/Berlin', label: 'Berlín' },
  { value: 'Europe/Rome', label: 'Roma' },
  { value: 'America/Mexico_City', label: 'Ciudad de México' },
  { value: 'America/Guatemala', label: 'Guatemala' },
  { value: 'America/Costa_Rica', label: 'Costa Rica' },
  { value: 'America/Panama', label: 'Panamá' },
  { value: 'America/Havana', label: 'La Habana' },
  { value: 'America/Santo_Domingo', label: 'Santo Domingo' },
  { value: 'America/Puerto_Rico', label: 'Puerto Rico' },
  { value: 'America/Bogota', label: 'Bogotá' },
  { value: 'America/Caracas', label: 'Caracas' },
  { value: 'America/Guayaquil', label: 'Guayaquil' },
  { value: 'America/Lima', label: 'Lima' },
  { value: 'America/La_Paz', label: 'La Paz' },
  { value: 'America/Santiago', label: 'Santiago de Chile' },
  { value: 'America/Asuncion', label: 'Asunción' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires' },
  { value: 'America/Montevideo', label: 'Montevideo' },
  { value: 'America/Sao_Paulo', label: 'São Paulo' },
  { value: 'America/New_York', label: 'Nueva York' },
  { value: 'America/Chicago', label: 'Chicago' },
  { value: 'America/Denver', label: 'Denver' },
  { value: 'America/Los_Angeles', label: 'Los Ángeles' },
  { value: 'Asia/Tokyo', label: 'Tokio' },
  { value: 'Australia/Sydney', label: 'Sídney' },
  { value: 'UTC', label: 'UTC (tiempo universal)' },
];

const TZ_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;

/** Zona IANA válida para este Node (incluye alias como UTC). */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length < 1 || tz.length > 64 || !TZ_SHAPE.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('es', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Mensaje de error de la contraseña nueva, o null si vale. */
export function newPasswordProblem(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `La contraseña nueva debe tener al menos ${PASSWORD_MIN} caracteres.`;
  if (pw.length > PASSWORD_MAX) return `La contraseña nueva no puede tener más de ${PASSWORD_MAX} caracteres.`;
  if (pw.trim().length === 0) return 'La contraseña nueva no puede ser solo espacios.';
  return null;
}

export type TimezoneResult = { ok: true; timezone: string } | { ok: false; message: string };

export function setTimezone(app: App, userId: number, tz: string): TimezoneResult {
  if (!isValidTimeZone(tz)) return { ok: false, message: 'Elige una zona horaria de la lista.' };
  app.db.run('UPDATE users SET timezone = ?, updated_at = ? WHERE id = ?', tz, app.clock.now(), userId);
  return { ok: true, timezone: tz };
}

export interface PasswordChangeInput {
  userId: number;
  /** Sesión actual: se conserva; las demás se revocan. */
  sessionId: string;
  current: string;
  next: string;
  confirm: string;
  requestId?: string;
}

export type PasswordChangeResult =
  | { ok: true; revoked: number }
  | { ok: false; field: 'current' | 'next' | 'confirm' | 'form'; message: string; retryAfterS?: number };

export const PASSWORD_CHANGE_LIMIT = 10;
export const PASSWORD_CHANGE_WINDOW_MS = 60 * 60 * 1000;

export async function changePassword(app: App, input: PasswordChangeInput): Promise<PasswordChangeResult> {
  if (!input.current) return { ok: false, field: 'current', message: 'Escribe tu contraseña actual.' };
  const problem = newPasswordProblem(input.next);
  if (problem) return { ok: false, field: 'next', message: problem };
  if (input.next !== input.confirm) return { ok: false, field: 'confirm', message: 'Las contraseñas nuevas no coinciden.' };

  // Con una sesión robada, la contraseña actual sería un oráculo: se limita por usuario.
  const limit = hit(app, 'password:user', String(input.userId), PASSWORD_CHANGE_LIMIT, PASSWORD_CHANGE_WINDOW_MS);
  if (!limit.allowed) {
    return { ok: false, field: 'form', message: `Demasiados intentos, espera ${limit.retryAfterS} s`, retryAfterS: limit.retryAfterS };
  }

  const row = app.db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', input.userId);
  if (!row || !(await verifyPassword(input.current.slice(0, PASSWORD_MAX), row.password_hash))) {
    return { ok: false, field: 'current', message: 'La contraseña actual no es correcta.' };
  }
  if (input.next === input.current) return { ok: false, field: 'next', message: 'La contraseña nueva debe ser distinta de la actual.' };

  const hash = await hashPassword(input.next);
  const revoked = app.db.transaction(() => {
    app.db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hash, app.clock.now(), input.userId);
    const n = revokeAllForUser(app, input.userId, { except: input.sessionId });
    audit(app, 'password.changed', { userId: input.userId, requestId: input.requestId, meta: { other_sessions_revoked: n } });
    return n;
  });
  return { ok: true, revoked };
}

/** Cierra la sesión actual (Salir). */
export function logout(app: App, userId: number, sessionId: string, requestId?: string): void {
  if (revokeSession(app, sessionId)) audit(app, 'session.revoked', { userId, requestId, meta: { reason: 'logout' } });
}

/** Cierra todas las sesiones del usuario, incluida la actual. */
export function logoutEverywhere(app: App, userId: number, requestId?: string): number {
  return app.db.transaction(() => {
    const n = revokeAllForUser(app, userId);
    audit(app, 'sessions.revoked_all', { userId, requestId, meta: { count: n } });
    return n;
  });
}
