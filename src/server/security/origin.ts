// Chequeo de origen para métodos mutantes (defensa en profundidad además del token CSRF y de checkOrigin de Astro).
// Compara contra APP_ORIGIN, que es la fuente de verdad (no el Host de la petición).

export interface OriginCheckInput {
  method: string;
  origin: string | null;
  secFetchSite: string | null;
  appOrigin: string;
  /** En desarrollo se acepta además cualquier petición same-origin (p. ej. 127.0.0.1 vs localhost). */
  dev?: boolean;
}

export function isMutating(method: string): boolean {
  const m = method.toUpperCase();
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
}

/** true si la petición puede seguir. Sin Origin ni Sec-Fetch-Site (clientes no navegador) se deja pasar al CSRF. */
export function originAllowed(i: OriginCheckInput): boolean {
  if (!isMutating(i.method)) return true;
  const site = i.secFetchSite?.toLowerCase() ?? null;
  if (site === 'cross-site' || site === 'same-site') return false;
  // Con `Referrer-Policy: no-referrer` los navegadores mandan `Origin: null` en los POST de formularios
  // del propio sitio: 'null' cuenta como ausente y decide Sec-Fetch-Site.
  if (i.origin !== null && i.origin !== '' && i.origin !== 'null') {
    if (i.origin === i.appOrigin) return true;
    return Boolean(i.dev && site === 'same-origin');
  }
  // Sin Origin útil: los navegadores modernos mandan Sec-Fetch-Site; 'same-origin' o 'none' (acción del usuario) valen.
  return site === null || site === '' || site === 'same-origin' || site === 'none';
}
