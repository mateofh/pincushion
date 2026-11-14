// Utilidades puras de las pantallas de Guardar y del bookmarklet: lectura de formularios, textos de estado y
// construcción de enlaces. Sin acceso a la DB ni reglas de negocio (esas viven en src/server/services/).
import type { DuplicateInfo } from '../../server/contracts.ts';
import { formatShortDate } from '../../domain/dates.ts';
import { formString, safeReturnPath } from '../../server/http.ts';

export interface SaveValues {
  url: string;
  title: string;
  description: string;
  excerpt: string;
  tags: string;
  collection: string;
  newCollection: string;
  favorite: boolean;
  volver: string;
  /** URL (normalizada por URL.href) para la que se obtuvieron título/descripción/texto. */
  fetchedUrl: string;
}

export type SaveErrors = Partial<Record<'url' | 'title' | 'description' | 'excerpt' | 'tags' | 'collection' | 'form', string>>;

export type FetchNote =
  | { kind: 'none' }
  | { kind: 'ok'; domain: string }
  | { kind: 'fail'; detail: string; skipped?: boolean }
  | { kind: 'limit'; message: string };

export function emptyValues(volver = '/'): SaveValues {
  return { url: '', title: '', description: '', excerpt: '', tags: '', collection: '', newCollection: '', favorite: false, volver, fetchedUrl: '' };
}

export function readValues(form: FormData): SaveValues {
  return {
    url: formString(form, 'url', 2200).trim(),
    title: formString(form, 'title', 1000),
    description: formString(form, 'description', 5000),
    excerpt: formString(form, 'excerpt', 20000),
    tags: formString(form, 'tags', 2000),
    collection: formString(form, 'collection', 20),
    newCollection: formString(form, 'new_collection', 200),
    favorite: formString(form, 'favorite', 5) === '1',
    volver: safeReturnPath(formString(form, 'volver', 1000), '/'),
    fetchedUrl: formString(form, 'fetched_url', 2200),
  };
}

export const FETCH_TIMEOUT_MS = 4000;
export const PREVIEW_LIMIT_PER_MIN = 30;

export function clip(s: string | null | undefined, max: number): string {
  const t = (s ?? '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return (/[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut).trimEnd();
}

/** Detalle humano de un fallo de obtención de datos, según PageFetchError.code. */
export function fetchFailureDetail(code: string): string {
  switch (code) {
    case 'timeout':
      return 'La página tardó demasiado en responder.';
    case 'http_error':
      return 'La página rechazó la petición o devolvió un error.';
    case 'blocked_address':
      return 'Esa dirección no se puede leer desde Pincushion.';
    case 'too_large':
      return 'La página es demasiado grande para leerla.';
    case 'too_many_redirects':
      return 'La página redirige demasiadas veces.';
    case 'not_html':
      return 'Este enlace no es una página web (puede ser un PDF o una imagen), así que no hay vista previa.';
    case 'invalid_url':
      return 'La dirección no es válida.';
    default:
      return 'No hubo respuesta de la página.';
  }
}

/** "Ya lo guardaste el 3 nov en Lectura" / "…está en la papelera". */
export function duplicateText(d: DuplicateInfo, timeZone: string, now: number): { lead: string; rest: string } {
  const when = formatShortDate(d.createdAt, timeZone, now);
  if (d.trashed) {
    return { lead: `Este enlace está en la papelera (lo guardaste el ${when})`, rest: 'guardarlo lo restaurará y sumará las etiquetas.' };
  }
  const where = d.collection ? ` en ${d.collection.name}` : '';
  return { lead: `Ya lo guardaste el ${when}${where}`, rest: 'Guardar actualizará ese enlace y sumará las etiquetas.' };
}

/** "se sumó 1 etiqueta" / "se sumaron 2 etiquetas". */
export function addedTagsText(n: number): string {
  return n === 1 ? 'se sumó 1 etiqueta' : `se sumaron ${n} etiquetas`;
}

// ---------- bookmarklet ----------

export const TEST_PAGE_PATH = '/bookmarklet/pagina-de-prueba';
export const TEST_PAGE_TITLE = 'Página de prueba de Pincushion';
export const TEST_PAGE_DESCRIPTION = 'Esta página solo sirve para comprobar que tu bookmarklet funciona: no se guarda nada.';

/** true si la dirección que envía el bookmarklet es la página de prueba de esta instalación. */
export function isTestPage(rawUrl: string, appOrigin: string): boolean {
  try {
    const u = new URL(rawUrl);
    return u.origin === new URL(appOrigin).origin && u.pathname === TEST_PAGE_PATH;
  } catch {
    return false;
  }
}

/** Dirección del popup con los mismos datos que enviaría el bookmarklet desde la página de prueba. */
export function probePopupHref(appOrigin: string, token: string): string {
  const o = new URL(appOrigin).origin;
  const e = encodeURIComponent;
  return `${o}/bookmarklet/guardar#v=1&t=${token}&u=${e(o + TEST_PAGE_PATH)}&ti=${e(TEST_PAGE_TITLE)}&de=${e(TEST_PAGE_DESCRIPTION)}`;
}
