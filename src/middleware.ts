// Middleware global: request id, sesión, autorización por defecto denegada, CSRF, cabeceras de seguridad y logs.
import { defineMiddleware } from 'astro:middleware';
import { randomUUID } from 'node:crypto';
import { getApp } from './server/context.ts';
import { lookupSession } from './server/auth/sessions.ts';
import { cookieName } from './server/http.ts';
import { safeEqual } from './server/crypto.ts';

/** Rutas accesibles sin sesión. Todo lo demás exige sesión (denegar por defecto). */
const PUBLIC_EXACT = new Set(['/entrar', '/healthz', '/bookmarklet/guardar', '/bookmarklet/pagina-de-prueba', '/404', '/500']);
const PUBLIC_PREFIX = ['/_astro/', '/vendor/', '/favicon'];
/** Rutas autenticadas por token propio (sin sesión ni CSRF de sesión). */
const TOKEN_AUTH = new Set(['/bookmarklet/guardar']);

function isPublic(path: string, dev: boolean): boolean {
  if (PUBLIC_EXACT.has(path)) return true;
  if (PUBLIC_PREFIX.some((p) => path.startsWith(p))) return true;
  if (dev && (path.startsWith('/_dev/') || path.startsWith('/@') || path.startsWith('/node_modules/') || path.startsWith('/src/'))) return true;
  return false;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

function withSecurityHeaders(res: Response, requestId: string, secure: boolean, dev: boolean): Response {
  const h = res.headers;
  try {
    h.set('X-Request-Id', requestId);
    if (!dev && !h.has('Content-Security-Policy')) h.set('Content-Security-Policy', CSP);
    h.set('Referrer-Policy', 'no-referrer');
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('X-Frame-Options', 'DENY');
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
    if (secure) h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (!h.has('Cache-Control')) h.set('Cache-Control', 'private, no-cache');
    return res;
  } catch {
    // Respuestas con cabeceras inmutables (p. ej. redirecciones nativas): se clonan.
    const copy = new Response(res.body, res);
    return withSecurityHeaders(copy, requestId, secure, dev);
  }
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  const started = performance.now();
  const app = getApp();
  const dev = import.meta.env.DEV;
  const incomingId = ctx.request.headers.get('x-request-id');
  const requestId = incomingId && /^[A-Za-z0-9-]{8,64}$/.test(incomingId) ? incomingId : randomUUID();
  const path = ctx.url.pathname;
  const method = ctx.request.method;

  ctx.locals.requestId = requestId;
  ctx.locals.app = app;
  ctx.locals.csrf = '';
  ctx.locals.sessionExpired = false;

  const lookup = lookupSession(app, ctx.cookies.get(cookieName(app.config, 'pc_session'))?.value);
  if (lookup.status === 'active') {
    ctx.locals.session = lookup.session;
    ctx.locals.user = lookup.session.user;
    ctx.locals.csrf = lookup.session.csrfSecret;
  } else if (lookup.status === 'expired') {
    ctx.locals.sessionExpired = true;
  }

  const log = app.log.child({ request_id: requestId });
  let res: Response;
  try {
    res = await guard();
  } catch (err) {
    log.error('request.failed', { method, path, err });
    throw err;
  }
  const out = withSecurityHeaders(res, requestId, app.config.secureCookies, dev);
  if (!path.startsWith('/_astro/') && !path.startsWith('/vendor/')) {
    log.info('request', { method, path, status: out.status, ms: Math.round(performance.now() - started), user_id: ctx.locals.user?.id });
  }
  return out;

  async function guard(): Promise<Response> {
    const isHtmx = ctx.request.headers.get('hx-request') === 'true';
    if (!ctx.locals.session && !isPublic(path, dev)) {
      const next = method === 'GET' ? path + ctx.url.search : (refererPath() ?? '/');
      const qs = new URLSearchParams({ next });
      if (ctx.locals.sessionExpired) qs.set('expirada', '1');
      const target = `/entrar?${qs}`;
      if (isHtmx) return new Response(null, { status: 401, headers: { 'HX-Redirect': target } });
      return new Response(null, { status: 303, headers: { Location: target } });
    }

    const mutating = method !== 'GET' && method !== 'HEAD';
    if (mutating && ctx.locals.session && !TOKEN_AUTH.has(path)) {
      const sent = ctx.request.headers.get('x-csrf-token') ?? (await csrfFromBody());
      if (!sent || !safeEqual(sent, ctx.locals.csrf)) {
        log.warn('csrf.rejected', { method, path });
        return ctx.rewrite(new Request(new URL('/403', ctx.url), { headers: ctx.request.headers }));
      }
    }
    return next();
  }

  async function csrfFromBody(): Promise<string | null> {
    const type = ctx.request.headers.get('content-type') ?? '';
    if (!type.includes('application/x-www-form-urlencoded') && !type.includes('multipart/form-data')) return null;
    try {
      const v = (await ctx.request.clone().formData()).get('_csrf');
      return typeof v === 'string' ? v : null;
    } catch {
      return null;
    }
  }

  function refererPath(): string | null {
    const ref = ctx.request.headers.get('referer');
    if (!ref) return null;
    try {
      const u = new URL(ref);
      return u.origin === ctx.url.origin ? u.pathname + u.search : null;
    } catch {
      return null;
    }
  }
});
