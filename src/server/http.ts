// Utilidades HTTP compartidas por páginas y middleware: flash firmado, redirecciones seguras, errores.
import type { AstroCookies } from 'astro';
import { hmac, safeEqual, subkey } from './crypto.ts';
import type { Config } from './config.ts';

export type FlashKind = 'success' | 'error' | 'info';
export interface Flash {
  kind: FlashKind;
  message: string;
  /** Acción opcional mostrada junto al mensaje (p. ej. Deshacer). */
  action?: { label: string; href?: string; post?: string; fields?: Record<string, string> };
}

export function cookieName(config: Config, base: string): string {
  return config.secureCookies ? `__Host-${base}` : base;
}

function cookieOpts(config: Config, maxAge: number) {
  return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: config.secureCookies, maxAge };
}

export function setFlash(cookies: AstroCookies, config: Config, flash: Flash): void {
  const body = Buffer.from(JSON.stringify(flash)).toString('base64url');
  const sig = hmac(subkey(config.APP_SECRET, 'flash'), body);
  cookies.set(cookieName(config, 'pc_flash'), `${body}.${sig}`, cookieOpts(config, 60));
}

export function takeFlash(cookies: AstroCookies, config: Config): Flash | null {
  const name = cookieName(config, 'pc_flash');
  const raw = cookies.get(name)?.value;
  if (!raw) return null;
  cookies.delete(name, { path: '/' });
  const [body, sig] = raw.split('.');
  if (!body || !sig || !safeEqual(sig, hmac(subkey(config.APP_SECRET, 'flash'), body))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Flash;
  } catch {
    return null;
  }
}

/** Devuelve una ruta interna segura o el fallback. Rechaza esquemas, //host, \ y caracteres de control. */
export function safeReturnPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1000) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\\]/.test(value)) return fallback;
  try {
    const u = new URL(value, 'http://pincushion.invalid');
    if (u.origin !== 'http://pincushion.invalid') return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}

/** 303 See Other: el navegador hace GET al destino (patrón PRG). */
export function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function formString(form: FormData, key: string, max = 10_000): string {
  const v = form.get(key);
  return typeof v === 'string' ? v.slice(0, max) : '';
}
