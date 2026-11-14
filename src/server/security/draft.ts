// Borrador de un formulario enviado con la sesión expirada (N5): se guarda cifrado (AES-256-GCM) en una
// cookie de corta vida y, tras volver a entrar, se ofrece reenviarlo. Nunca incluye `_csrf` ni contraseñas.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { AstroCookies } from 'astro';
import type { Config } from '../config.ts';
import { cookieName, safeReturnPath } from '../http.ts';
import { securityKey } from './keys.ts';

export const DRAFT_MAX_BYTES = 16 * 1024;
export const DRAFT_TTL_MS = 15 * 60 * 1000;
/** Trozos de cookie: ~3800 caracteres cada uno (límite de 4 KB por cookie), como mucho 3. */
const CHUNK = 3800;
const MAX_CHUNKS = 3;
const NAMES = ['pc_draft', 'pc_draft1', 'pc_draft2'] as const;
const EXCLUDED = /^_csrf$|pass|contrase|token|secret/i;

export type DraftField = [name: string, value: string];

export interface Draft {
  v: 1;
  /** Usuario de la sesión expirada: solo él puede recuperar el borrador. */
  uid: number;
  /** Ruta (con query) a la que iba el POST original. */
  path: string;
  /** Página desde la que se envió (para "Volver sin reenviar"). */
  next: string;
  fields: DraftField[];
  exp: number;
}

/** Extrae los campos de texto conservables. null si no queda nada o si superan DRAFT_MAX_BYTES. */
export function draftFields(form: FormData): DraftField[] | null {
  const out: DraftField[] = [];
  let bytes = 0;
  for (const [name, value] of form.entries()) {
    if (typeof value !== 'string' || EXCLUDED.test(name) || name.length > 100) continue;
    bytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 8;
    if (bytes > DRAFT_MAX_BYTES) return null;
    out.push([name, value]);
  }
  return out.length ? out : null;
}

export function sealDraft(secret: string, draft: Draft): string {
  const key = securityKey(secret, 'draft');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plain = deflateRawSync(Buffer.from(JSON.stringify(draft), 'utf8'));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
}

export function openDraft(secret: string, sealed: string | null | undefined, now: number): Draft | null {
  if (!sealed || sealed.length > CHUNK * MAX_CHUNKS || !/^[A-Za-z0-9_-]+$/.test(sealed)) return null;
  try {
    const buf = Buffer.from(sealed, 'base64url');
    if (buf.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', securityKey(secret, 'draft'), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
    const d = JSON.parse(inflateRawSync(plain, { maxOutputLength: DRAFT_MAX_BYTES * 4 }).toString('utf8')) as Draft;
    if (d.v !== 1 || typeof d.uid !== 'number' || typeof d.exp !== 'number' || d.exp <= now) return null;
    if (!Array.isArray(d.fields) || !d.fields.every((f) => Array.isArray(f) && typeof f[0] === 'string' && typeof f[1] === 'string')) return null;
    const path = safeReturnPath(d.path, '');
    if (!path) return null;
    return { ...d, path, next: safeReturnPath(d.next) };
  } catch {
    return null;
  }
}

function opts(config: Config, maxAge: number) {
  return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: config.secureCookies, maxAge };
}

/** Para borrar una cookie __Host- el navegador exige los mismos atributos (Secure, Path=/). */
function delOpts(config: Config) {
  return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: config.secureCookies };
}

/** Guarda el borrador sellado en hasta 3 cookies. false si no cabe (no se guarda nada). */
export function writeDraftCookies(cookies: AstroCookies, config: Config, sealed: string): boolean {
  if (sealed.length > CHUNK * MAX_CHUNKS) return false;
  NAMES.forEach((base, i) => {
    const part = sealed.slice(i * CHUNK, (i + 1) * CHUNK);
    if (part) cookies.set(cookieName(config, base), part, opts(config, DRAFT_TTL_MS / 1000));
    else if (cookies.has(cookieName(config, base))) cookies.delete(cookieName(config, base), delOpts(config));
  });
  return true;
}

export function readDraftCookies(cookies: AstroCookies, config: Config): string | null {
  let sealed = '';
  for (const base of NAMES) {
    const v = cookies.get(cookieName(config, base))?.value;
    if (!v) break;
    sealed += v;
  }
  return sealed || null;
}

export function hasDraftCookies(cookies: AstroCookies, config: Config): boolean {
  return cookies.has(cookieName(config, NAMES[0]));
}

export function clearDraftCookies(cookies: AstroCookies, config: Config): void {
  for (const base of NAMES) if (cookies.has(cookieName(config, base))) cookies.delete(cookieName(config, base), delOpts(config));
}

/** Lee y valida el borrador del usuario indicado; si no es suyo o caducó, lo borra. */
export function takeValidDraft(cookies: AstroCookies, config: Config, userId: number, now: number): Draft | null {
  if (!hasDraftCookies(cookies, config)) return null;
  const d = openDraft(config.APP_SECRET, readDraftCookies(cookies, config), now);
  if (!d || d.uid !== userId) {
    clearDraftCookies(cookies, config);
    return null;
  }
  return d;
}
