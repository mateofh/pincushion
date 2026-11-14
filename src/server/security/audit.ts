// Auditoría de eventos de seguridad (append-only). Nunca guarda contraseñas, tokens ni emails en claro.
import type { App } from '../context.ts';
import { hmac } from '../crypto.ts';
import { securityKey } from './keys.ts';

export type AuditType =
  | 'login.succeeded'
  | 'login.failed'
  | 'session.revoked'
  | 'sessions.revoked_all'
  | 'token.rotated'
  | 'password.changed';

export interface AuditInput {
  userId?: number | null;
  requestId?: string | null;
  meta?: Record<string, string | number | boolean | null>;
}

export function audit(app: App, type: AuditType, input: AuditInput = {}): void {
  app.db.run(
    'INSERT INTO audit_events (user_id, type, request_id, meta_json, created_at) VALUES (?, ?, ?, ?, ?)',
    input.userId ?? null,
    type,
    input.requestId ?? null,
    JSON.stringify(input.meta ?? {}),
    app.clock.now(),
  );
}

/** Hash con clave del email normalizado: permite correlacionar intentos sin poder leer el email. */
export function emailHash(app: App, email: string): string {
  return hmac(securityKey(app.config.APP_SECRET, 'audit'), `email:${email.trim().toLowerCase()}`).slice(0, 22);
}

/** Igual para la IP (dato personal): sirve para ver ráfagas desde una misma dirección. */
export function ipHash(app: App, ip: string): string {
  return hmac(securityKey(app.config.APP_SECRET, 'audit'), `ip:${ip}`).slice(0, 22);
}
