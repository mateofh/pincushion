// Middleware global: request id, sesión, autorización por defecto denegada, origen, CSRF, borrador de
// formularios con sesión expirada (N5), cabeceras de seguridad y logs.
import { defineMiddleware } from 'astro:middleware';
import { randomUUID } from 'node:crypto';
import { getApp } from './server/context.ts';
import { lookupSession, sessionCookieName } from './server/auth/sessions.ts';
import { safeReturnPath } from './server/http.ts';
import { safeEqual } from './server/crypto.ts';
import { originAllowed, isMutating } from './server/security/origin.ts';
import {
  DRAFT_MAX_BYTES,
  DRAFT_TTL_MS,
  clearDraftCookies,
  draftFields,
  hasDraftCookies,
  sealDraft,
  writeDraftCookies,
} from './server/security/draft.ts';

/** Rutas accesibles sin sesión. Todo lo demás exige sesión (denegar por defecto). */
const PUBLIC_EXACT = new Set([
  '/entrar',
  '/healthz',
  '/bookmarklet/guardar',
  '/bookmarklet/pagina-de-prueba',
  '/403',
  '/404',
  '/429',
  '/500',
  '/favicon.svg',
]);
const PUBLIC_PREFIX = ['/_astro/', '/vendor/'];
/** Rutas autenticadas por token propio (sin sesión ni CSRF de sesión). */
const TOKEN_AUTH = new Set(['/bookmarklet/guardar']);
/** Páginas con secretos o datos de la cuenta: nunca en caché. */
const NO_STORE_PREFIX = ['/bookmarklet', '/ajustes', '/entrar'];
/** POST con sesión expirada que no merece borrador (no hay nada que conservar o es sensible). */
const NO_DRAFT = new Set(['/salir', '/entrar']);
/** Tope de cuerpo que se intenta leer para el borrador (el borrador en sí es ≤ 16 KB). */
const DRAFT_BODY_MAX = 64 * 1024;

function isPublic(path: string, dev: boolean): boolean {
  if (PUBLIC_EXACT.has(path)) return true;
  if (PUBLIC_PREFIX.some((p) => path.startsWith(p))) return true;
  if (dev && (path.startsWith('/_dev/') || path.startsWith('/@') || path.startsWith('/node_modules/') || path.startsWith('/src/'))) return true;
  return false;
}

function matchesPrefix(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(p + '/'));
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

function withSecurityHeaders(res: Response, requestId: string, secure: boolean, dev: boolean, noStore: boolean): Response {
  const h = res.headers;
  try {
    h.set('X-Request-Id', requestId);
    if (!dev && !h.has('Content-Security-Policy')) h.set('Content-Security-Policy', CSP);
    h.set('Referrer-Policy', 'no-referrer');
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('X-Frame-Options', 'DENY');
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
    if (secure) h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (noStore) h.set('Cache-Control', 'no-store');
    else if (!h.has('Cache-Control')) h.set('Cache-Control', 'private, no-cache');
    return res;
  } catch {
    // Respuestas con cabeceras inmutables (p. ej. redirecciones nativas): se clonan.
    const copy = new Response(res.body, res);
    return withSecurityHeaders(copy, requestId, secure, dev, noStore);
  }
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  const started = performance.now();
  const app = getApp();
  const { config } = app;
  const dev = import.meta.env.DEV;
  const incomingId = ctx.request.headers.get('x-request-id');
  const requestId = incomingId && /^[A-Za-z0-9-]{8,64}$/.test(incomingId) ? incomingId : randomUUID();
  const path = ctx.url.pathname;
  const method = ctx.request.method;

  ctx.locals.requestId = requestId;
  ctx.locals.app = app;
  ctx.locals.csrf = '';
  ctx.locals.sessionExpired = false;

  const lookup = lookupSession(app, ctx.cookies.get(sessionCookieName(config))?.value);
  let expiredUserId: number | null = null;
  if (lookup.status === 'active') {
    ctx.locals.session = lookup.session;
    ctx.locals.user = lookup.session.user;
    ctx.locals.csrf = lookup.session.csrfSecret;
  } else if (lookup.status === 'expired') {
    ctx.locals.sessionExpired = true;
    expiredUserId = lookup.userId;
  }

  const log = app.log.child({ request_id: requestId });
  let res: Response;
  try {
    res = await guard();
  } catch (err) {
    log.error('request.failed', { method, path, err });
    throw err;
  }
  const out = withSecurityHeaders(res, requestId, config.secureCookies, dev, matchesPrefix(path, NO_STORE_PREFIX));
  if (!path.startsWith('/_astro/') && !path.startsWith('/vendor/')) {
    log.info('request', { method, path, status: out.status, ms: Math.round(performance.now() - started), user_id: ctx.locals.user?.id });
  }
  return out;

  async function guard(): Promise<Response> {
    const isHtmx = ctx.request.headers.get('hx-request') === 'true';
    const mutating = isMutating(method);

    // 1. Origen: en métodos mutantes, Origin / Sec-Fetch-Site deben corresponder a APP_ORIGIN.
    if (
      mutating &&
      !originAllowed({
        method,
        origin: ctx.request.headers.get('origin'),
        secFetchSite: ctx.request.headers.get('sec-fetch-site'),
        appOrigin: config.APP_ORIGIN,
        dev,
      })
    ) {
      log.warn('origin.rejected', { method, path });
      return forbidden();
    }

    // 2. Autenticación: denegar por defecto.
    if (!ctx.locals.session && !isPublic(path, dev)) {
      const back = method === 'GET' ? path + ctx.url.search : (refererPath() ?? '/');
      const qs = new URLSearchParams({ next: safeReturnPath(back) });
      if (ctx.locals.sessionExpired) qs.set('expirada', '1');
      const target = `/entrar?${qs}`;
      if (isHtmx) return new Response(null, { status: 401, headers: { 'HX-Redirect': target } });
      if (mutating && expiredUserId !== null && !NO_DRAFT.has(path)) await saveDraft(expiredUserId, safeReturnPath(back));
      return new Response(null, { status: 303, headers: { Location: target } });
    }

    // 3. CSRF en todo método mutante con sesión (salvo rutas con token propio).
    if (mutating && ctx.locals.session && !TOKEN_AUTH.has(path)) {
      const sent = ctx.request.headers.get('x-csrf-token') ?? (await csrfFromBody());
      if (!sent || !safeEqual(sent, ctx.locals.csrf)) {
        log.warn('csrf.rejected', { method, path });
        return forbidden();
      }
      // Cualquier envío autenticado válido (incluido "Reenviar cambios") deja obsoleto el borrador.
      if (hasDraftCookies(ctx.cookies, config) && path !== '/entrar') clearDraftCookies(ctx.cookies, config);
    }
    return next();
  }

  function forbidden(): Promise<Response> {
    // Se conserva el request id para que el código de referencia de la página 403 coincida con X-Request-Id.
    const headers = new Headers(ctx.request.headers);
    headers.set('x-request-id', requestId);
    return ctx.rewrite(new Request(new URL('/403', ctx.url), { headers }));
  }

  /** N5: guarda el formulario (sin _csrf ni contraseñas) cifrado en una cookie corta para reenviarlo tras entrar. */
  async function saveDraft(userId: number, from: string): Promise<void> {
    const type = ctx.request.headers.get('content-type') ?? '';
    if (!type.includes('application/x-www-form-urlencoded') && !type.includes('multipart/form-data')) return;
    const length = Number(ctx.request.headers.get('content-length') ?? '0');
    if (length > DRAFT_BODY_MAX) {
      log.warn('draft.too_large', { path });
      return;
    }
    let form: FormData;
    try {
      form = await ctx.request.clone().formData();
    } catch {
      return;
    }
    const fields = draftFields(form);
    if (!fields) {
      log.info('draft.skipped', { path, reason: 'vacío o mayor que ' + DRAFT_MAX_BYTES });
      return;
    }
    const sealed = sealDraft(config.APP_SECRET, {
      v: 1,
      uid: userId,
      path: safeReturnPath(path + ctx.url.search),
      next: from,
      fields,
      exp: app.clock.now() + DRAFT_TTL_MS,
    });
    if (!writeDraftCookies(ctx.cookies, config, sealed)) log.warn('draft.too_large', { path });
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
      return u.origin === config.APP_ORIGIN || u.origin === ctx.url.origin ? u.pathname + u.search : null;
    } catch {
      return null;
    }
  }
});
