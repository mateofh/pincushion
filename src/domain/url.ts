// Normalización de URLs para detectar duplicados. Reglas puras, sin I/O.
// ESQUELETO (Ola 0) funcional; el stream de dominio completa casos y tests.

export class InvalidUrlError extends Error {
  constructor(message = 'La URL no es válida') {
    super(message);
    this.name = 'InvalidUrlError';
  }
}

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref_src|_hsenc|_hsmi|yclid)$/i;

/** Parsea entrada del usuario: recorta, añade https:// si falta, exige http/https. */
export function parseUserUrl(input: string): URL {
  const raw = input.trim();
  if (!raw || raw.length > 2048) throw new InvalidUrlError();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new InvalidUrlError();
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new InvalidUrlError('Solo se aceptan direcciones http o https');
  if (!u.hostname || !u.hostname.includes('.') && u.hostname !== 'localhost') throw new InvalidUrlError();
  if (u.username || u.password) throw new InvalidUrlError('La URL no puede incluir usuario o contraseña');
  return u;
}

/** Dominio para mostrar y agrupar favicons (sin www.). */
export function domainOf(u: URL): string {
  return u.hostname.toLowerCase().replace(/^www\./, '');
}

/** Clave de duplicados: ignora esquema, www., puerto por defecto, fragmento, barra final y tracking. */
export function normalizeUrl(u: URL): string {
  const host = domainOf(u);
  const port = u.port && !((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) ? `:${u.port}` : '';
  let path = u.pathname.replace(/\/+$/, '');
  if (path === '') path = '';
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.length ? '?' + new URLSearchParams(params).toString() : '';
  const keepHash = u.hash.startsWith('#!') || u.hash.startsWith('#/') ? u.hash : '';
  return `${host}${port}${path}${query}${keepHash}`;
}
