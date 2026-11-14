// Normalización de URLs para detectar duplicados. Reglas puras, sin I/O.
//
// - `parseUserUrl` valida lo que escribe la persona (o envía el bookmarklet) y devuelve la URL que se guarda y se abre.
// - `normalizeUrl` produce la clave de duplicados `(user_id, normalized_url)`; nunca se abre ni se muestra.
// - `domainOf` es el dominio para mostrar y para agrupar favicons.
// - `unsavableReason` explica en español por qué una página no se puede guardar (popup del bookmarklet).
//
// Decisiones documentadas:
// - El parámetro `si` solo se trata como tracking en YouTube y Spotify (en otros sitios puede ser significativo).
// - No se quita `ref` genérico: en GitHub y otros sitios selecciona ramas o contenido.
// - Se aceptan IPs literales (v4 y v6 entre corchetes) y `localhost`; la guarda SSRF del fetcher decide si se piden.
// - En la query, `+` y `%20` son equivalentes (ambos significan espacio en formularios); el orden relativo de valores
//   repetidos de una misma clave se conserva (`?a=2&a=1` ≠ `?a=1&a=2`).

export class InvalidUrlError extends Error {
  constructor(message = 'La URL no es válida') {
    super(message);
    this.name = 'InvalidUrlError';
  }
}

/** Máximo de caracteres de la URL (entrada y forma serializada que se guarda). */
export const MAX_URL_LENGTH = 2048;

export const URL_MESSAGES = {
  empty: 'Escribe una dirección.',
  invalid: 'La URL no es válida',
  tooLong: `La URL es demasiado larga (máximo ${MAX_URL_LENGTH} caracteres).`,
  scheme: 'Solo se aceptan direcciones http o https',
  credentials: 'La URL no puede incluir usuario o contraseña',
  host: 'La URL debe incluir un dominio completo, por ejemplo ejemplo.com.',
} as const;

const TRACKING_EXACT = new Set([
  'fbclid',
  'gclid',
  'gclsrc',
  'gbraid',
  'wbraid',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'igsh',
  'ref_src',
  'ref_url',
  '_hsenc',
  '_hsmi',
  '__hssc',
  '__hstc',
  '__hsfp',
  'hsctatracking',
  'yclid',
  'ysclid',
  'twclid',
  'ttclid',
  'li_fat_id',
  'mkt_tok',
  '_ga',
  '_gl',
  'oly_anon_id',
  'oly_enc_id',
  'vero_id',
  'vero_conv',
  'wickedid',
  'rb_clickid',
  's_cid',
  '_branch_match_id',
  'epik',
]);

/** Parámetros que solo son tracking en ciertos sitios (host sin www.). */
const TRACKING_BY_HOST: Array<{ hosts: RegExp; params: Set<string> }> = [
  { hosts: /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/, params: new Set(['si', 'feature', 'pp']) },
  { hosts: /(^|\.)spotify\.com$/, params: new Set(['si', 'context']) },
];

function isTrackingParam(name: string, host: string): boolean {
  const k = name.toLowerCase();
  if (k.startsWith('utm_') || TRACKING_EXACT.has(k)) return true;
  return TRACKING_BY_HOST.some((r) => r.hosts.test(host) && r.params.has(k));
}

// Esquemas que no son páginas web públicas, con el motivo para el popup del bookmarklet.
const BROWSER_INTERNAL = new Set([
  'about',
  'chrome',
  'edge',
  'brave',
  'opera',
  'vivaldi',
  'arc',
  'firefox',
  'resource',
  'chrome-search',
  'chrome-untrusted',
  'devtools',
  'safari-resource',
]);
const EXTENSION = new Set(['chrome-extension', 'moz-extension', 'safari-extension', 'safari-web-extension', 'ms-browser-extension', 'extension']);
const NO_ADDRESS = new Set(['data', 'blob', 'javascript', 'vbscript', 'filesystem']);

const UNSAVABLE_MESSAGES = {
  empty: 'No llegó la dirección de la página, así que no se puede guardar.',
  file: 'Los archivos de tu equipo (file:) no se pueden guardar: solo páginas web http o https.',
  internal: 'Las páginas internas del navegador (como about: o chrome:) no se pueden guardar.',
  extension: 'Las páginas de extensiones del navegador no se pueden guardar.',
  noAddress: 'Esta página no tiene una dirección web que se pueda guardar.',
  viewSource: 'Abre la página normal (sin view-source:) para guardarla.',
  other: 'Solo se pueden guardar páginas web con dirección http o https.',
} as const;

/** Devuelve el esquema explícito (en minúsculas) o null si la entrada no trae esquema (p. ej. `ejemplo.com:8080/x`). */
function explicitScheme(raw: string): string | null {
  const m = /^([a-z][a-z0-9+.-]*):(.*)$/is.exec(raw);
  if (!m) return null;
  const scheme = m[1]!.toLowerCase();
  const rest = m[2]!;
  if (rest.startsWith('//')) return scheme;
  if (scheme === 'http' || scheme === 'https') return scheme;
  if (BROWSER_INTERNAL.has(scheme) || EXTENSION.has(scheme) || NO_ADDRESS.has(scheme) || scheme === 'file' || scheme === 'view-source') return scheme;
  // "host:puerto/ruta" sin esquema: lo que sigue a los dos puntos es un número de puerto.
  if (/^\d+(?:[/?#]|$)/.test(rest)) return null;
  return scheme;
}

const CONTROL_OR_SPACE = /[\u0000-\u0020\u007f-\u009f\u00a0\u1680\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff]/;

function hostIsAcceptable(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname.startsWith('[') && hostname.endsWith(']')) return true; // IPv6 literal
  const h = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
  if (h === 'localhost') return true;
  const labels = h.split('.');
  if (labels.length < 2) return false;
  return labels.every((l) => l.length > 0 && l.length <= 63);
}

/** Parsea entrada del usuario: recorta, añade https:// si falta, exige http/https. Lanza `InvalidUrlError` con mensaje en español. */
export function parseUserUrl(input: string): URL {
  const raw = (typeof input === 'string' ? input : '').trim();
  if (!raw) throw new InvalidUrlError(URL_MESSAGES.empty);
  if (raw.length > MAX_URL_LENGTH) throw new InvalidUrlError(URL_MESSAGES.tooLong);
  if (CONTROL_OR_SPACE.test(raw)) throw new InvalidUrlError(URL_MESSAGES.invalid);
  const scheme = explicitScheme(raw);
  if (scheme !== null && scheme !== 'http' && scheme !== 'https') throw new InvalidUrlError(URL_MESSAGES.scheme);
  const withScheme = scheme !== null ? raw : raw.startsWith('//') ? `https:${raw}` : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new InvalidUrlError(URL_MESSAGES.invalid);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new InvalidUrlError(URL_MESSAGES.scheme);
  if (u.username || u.password) throw new InvalidUrlError(URL_MESSAGES.credentials);
  if (!hostIsAcceptable(u.hostname)) throw new InvalidUrlError(URL_MESSAGES.host);
  if (u.href.length > MAX_URL_LENGTH) throw new InvalidUrlError(URL_MESSAGES.tooLong);
  return u;
}

/** Dominio para mostrar y agrupar favicons: minúsculas, punycode, sin `www.` ni punto final. */
export function domainOf(u: URL): string {
  let h = u.hostname.toLowerCase();
  if (h.endsWith('.') && !h.startsWith('[')) h = h.slice(0, -1);
  if (h.startsWith('www.') && h.length > 4 && h.slice(4).includes('.')) h = h.slice(4);
  return h;
}

const UNRESERVED = /[A-Za-z0-9\-._~]/;

/** Decodifica %XX de caracteres no reservados y pone en mayúsculas el resto de escapes. Mantiene mayúsculas del path. */
function normalizePercentEncoding(s: string): string {
  return s.replace(/%([0-9a-fA-F]{2})/g, (_m, hex: string) => {
    const ch = String.fromCharCode(parseInt(hex, 16));
    return UNRESERVED.test(ch) ? ch : `%${hex.toUpperCase()}`;
  });
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Clave de duplicados: ignora esquema (http = https), `www.`, puerto por defecto, fragmento (salvo rutas `#!`/`#/`),
 * barras finales, parámetros de tracking y el orden de la query. Formato: `host[:puerto]ruta[?query][#!ruta]`.
 */
export function normalizeUrl(u: URL): string {
  const host = domainOf(u);
  const isDefaultPort = u.port === '' || (u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443');
  const port = isDefaultPort ? '' : `:${u.port}`;
  const path = normalizePercentEncoding(u.pathname).replace(/\/+$/, '');
  const params = [...u.searchParams.entries()].filter(([k]) => !isTrackingParam(k, host));
  params.sort(([a], [b]) => compareCodeUnits(a, b)); // sort estable: conserva el orden de valores repetidos
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  let hash = '';
  if (u.hash.startsWith('#!') || u.hash.startsWith('#/')) {
    const route = normalizePercentEncoding(u.hash).replace(/\/+$/, '');
    if (route !== '#' && route !== '#!') hash = route;
  }
  return `${host}${port}${path}${query}${hash}`;
}

/**
 * Motivo (en español) por el que una página no se puede guardar, o null si se puede.
 * Pensado para la dirección que envía el bookmarklet (`location.href`), que siempre trae esquema.
 */
export function unsavableReason(rawUrl: string): string | null {
  const raw = (typeof rawUrl === 'string' ? rawUrl : '').trim();
  if (!raw) return UNSAVABLE_MESSAGES.empty;
  const scheme = explicitScheme(raw);
  if (scheme === 'file') return UNSAVABLE_MESSAGES.file;
  if (scheme === 'view-source') return UNSAVABLE_MESSAGES.viewSource;
  if (scheme !== null && BROWSER_INTERNAL.has(scheme)) return UNSAVABLE_MESSAGES.internal;
  if (scheme !== null && EXTENSION.has(scheme)) return UNSAVABLE_MESSAGES.extension;
  if (scheme !== null && NO_ADDRESS.has(scheme)) return UNSAVABLE_MESSAGES.noAddress;
  if (scheme !== null && scheme !== 'http' && scheme !== 'https') return UNSAVABLE_MESSAGES.other;
  try {
    parseUserUrl(raw);
    return null;
  } catch (e) {
    return e instanceof InvalidUrlError ? e.message : URL_MESSAGES.invalid;
  }
}
