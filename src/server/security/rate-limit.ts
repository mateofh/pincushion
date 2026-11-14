// Rate limiting de ventana fija sobre la tabla rate_limits, más la IP del cliente.
// La clave guardada es sha256("scope:valor"): nunca se guarda la IP ni el email en claro.
import type { App } from '../context.ts';
import { sha256 } from '../crypto.ts';

export interface RateLimitResult {
  allowed: boolean;
  /** Segundos hasta que se abre la siguiente ventana (0 si está permitido). */
  retryAfterS: number;
  /** Peticiones que quedan en la ventana actual. */
  remaining: number;
}

/**
 * Cuenta un intento en la ventana fija actual (alineada a múltiplos de windowMs) y dice si cabe.
 * Atómico: un solo UPSERT … RETURNING, así dos peticiones simultáneas no se pisan.
 */
export function hit(app: App, scope: string, key: string, limit: number, windowMs: number): RateLimitResult {
  if (!Number.isFinite(limit) || limit < 1) throw new Error('rate-limit: limit debe ser ≥ 1');
  if (!Number.isFinite(windowMs) || windowMs < 1000) throw new Error('rate-limit: windowMs debe ser ≥ 1000');
  const now = app.clock.now();
  const windowStart = now - (now % windowMs);
  const row = app.db.get<{ count: number; window_start: number }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
       window_start = excluded.window_start
     RETURNING count, window_start`,
    rateLimitKey(scope, key), windowStart,
  )!;
  const allowed = row.count <= limit;
  return {
    allowed,
    retryAfterS: allowed ? 0 : Math.max(1, Math.ceil((row.window_start + windowMs - now) / 1000)),
    remaining: Math.max(0, limit - row.count),
  };
}

export function rateLimitKey(scope: string, key: string): string {
  return sha256(`${scope}:${key}`);
}

/** Borra contadores cuya ventana terminó hace más de maxWindowMs (mantenimiento). */
export function purgeRateLimits(app: App, maxWindowMs = 60 * 60 * 1000): number {
  return app.db.run('DELETE FROM rate_limits WHERE window_start < ?', app.clock.now() - maxWindowMs).changes;
}

/** Mensaje visible estándar para un 429. */
export function tooManyMessage(retryAfterS: number): string {
  return `Demasiados intentos, espera ${Math.max(1, Math.ceil(retryAfterS))} s`;
}

// ---------- límites de login ----------

export const LOGIN_IP_WINDOW_MS = 60 * 1000;
export const LOGIN_EMAIL_IP_LIMIT = 20;
export const LOGIN_EMAIL_IP_WINDOW_MS = 60 * 60 * 1000;

/**
 * Límites de login: RATE_LIMIT_LOGIN_PER_MIN por IP y 20/h por (email, IP).
 * El segundo es por par para que alguien desde otra IP no pueda bloquear al dueño.
 */
export function hitLogin(app: App, ip: string, email: string): RateLimitResult {
  const byIp = hit(app, 'login:ip', ip, app.config.RATE_LIMIT_LOGIN_PER_MIN, LOGIN_IP_WINDOW_MS);
  if (!byIp.allowed) return byIp;
  return hit(app, 'login:email-ip', `${email.trim().toLowerCase()}|${ip}`, LOGIN_EMAIL_IP_LIMIT, LOGIN_EMAIL_IP_WINDOW_MS);
}

// ---------- IP del cliente ----------

export interface IpContext {
  request: Request;
  /** Dirección del socket (Astro la expone como clientAddress; puede lanzar si el adaptador no la da). */
  readonly clientAddress?: string;
  locals?: { app?: { config: { TRUST_PROXY: boolean } } };
}

/**
 * IP del cliente. Por defecto, la del socket. Solo con TRUST_PROXY se usa X-Forwarded-For, y en ese caso
 * la entrada más a la derecha (la que añadió nuestro proxy; las de la izquierda las controla el cliente).
 */
export function clientIp(ctx: IpContext, trustProxy = ctx.locals?.app?.config.TRUST_PROXY ?? false): string {
  if (trustProxy) {
    const xff = ctx.request.headers.get('x-forwarded-for');
    if (xff) {
      const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
      const last = parts.at(-1);
      if (last && isPlausibleIp(last)) return normalizeIp(last);
    }
  }
  let socket: string | undefined;
  try {
    socket = ctx.clientAddress;
  } catch {
    socket = undefined;
  }
  return socket ? normalizeIp(socket) : 'desconocida';
}

function isPlausibleIp(s: string): boolean {
  return s.length <= 45 && /^[0-9a-fA-F:.]+$/.test(s);
}

/** Quita el prefijo IPv4-mapeado (::ffff:1.2.3.4 → 1.2.3.4) para no contar dos veces la misma IP. */
function normalizeIp(s: string): string {
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s);
  return (m ? m[1]! : s).toLowerCase();
}

/** Para páginas: responde con la página 429 (mensaje humano + Retry-After). */
export function rateLimitedPage(ctx: { rewrite(p: string): Promise<Response> }, retryAfterS: number): Promise<Response> {
  return ctx.rewrite(`/429?espera=${Math.max(1, Math.ceil(retryAfterS))}`);
}
