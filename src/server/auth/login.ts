// Flujo de login: rate limit, verificación, rotación de sesión y auditoría. La página solo pinta el resultado.
import type { App } from '../context.ts';
import { authenticate, createSession, revokeSessionByToken, type ActiveSession } from './sessions.ts';
import { hitLogin } from '../security/rate-limit.ts';
import { audit, emailHash, ipHash } from '../security/audit.ts';

export interface LoginInput {
  email: string;
  password: string;
  ip: string;
  requestId?: string;
  /** Token de la cookie de sesión que traía la petición (activa o no): se revoca al entrar. */
  previousToken?: string;
}

export type LoginResult =
  | { kind: 'ok'; token: string; session: ActiveSession }
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'rate_limited'; retryAfterS: number };

export const LOGIN_EMAIL_MAX = 254;
export const LOGIN_PASSWORD_MAX = 200;

export async function attemptLogin(app: App, input: LoginInput): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase().slice(0, LOGIN_EMAIL_MAX);
  const password = input.password.slice(0, LOGIN_PASSWORD_MAX);
  if (!email || !password) return { kind: 'missing' };

  const limit = hitLogin(app, input.ip, email);
  if (!limit.allowed) {
    app.log.warn('login.rate_limited', { request_id: input.requestId, retry_after_s: limit.retryAfterS });
    return { kind: 'rate_limited', retryAfterS: limit.retryAfterS };
  }

  const user = await authenticate(app, email, password);
  if (!user) {
    const known = app.db.get<{ id: number }>('SELECT id FROM users WHERE email = ?', email);
    audit(app, 'login.failed', {
      userId: known?.id ?? null,
      requestId: input.requestId,
      meta: { reason: 'bad_credentials', email_hash: emailHash(app, email), ip_hash: ipHash(app, input.ip) },
    });
    return { kind: 'invalid' };
  }

  // Rotación: la sesión anterior de este navegador (si la había) deja de valer y se emite un id nuevo.
  revokeSessionByToken(app, input.previousToken);
  const { token, session } = createSession(app, user.id);
  audit(app, 'login.succeeded', { userId: user.id, requestId: input.requestId, meta: { ip_hash: ipHash(app, input.ip) } });
  return { kind: 'ok', token, session };
}
