// Estado de la Biblioteca en la URL: lectura de parámetros y construcción de enlaces.
// Solo presentación (no hay reglas de negocio aquí): los filtros los aplica bookmarkService.list.
import { parseId } from '../../domain/authz.ts';
import type { SortKey, ViewMode } from '../../server/contracts.ts';

export const SORT_KEYS: readonly SortKey[] = ['recientes', 'antiguos', 'titulo', 'dominio'];
const MAX_TAG_FILTERS = 5;

export interface LibraryParams {
  /** Solo si viene en la URL; si no, manda la cookie `pc_vista`. */
  vista: ViewMode | null;
  coleccion: number | 'sin-coleccion' | null;
  etiquetas: string[];
  favoritos: boolean;
  orden: SortKey;
  cursor: string | undefined;
}

export function parseLibraryParams(sp: URLSearchParams): LibraryParams {
  const v = sp.get('vista');
  const c = sp.get('coleccion');
  const o = sp.get('orden');
  const etiquetas = [...new Set(sp.getAll('etiqueta').map((t) => t.trim().slice(0, 80)).filter(Boolean))].slice(0, MAX_TAG_FILTERS);
  const cursor = sp.get('cursor');
  return {
    vista: v === 'tarjetas' || v === 'lista' ? v : null,
    coleccion: c === 'sin-coleccion' ? 'sin-coleccion' : parseId(c),
    etiquetas,
    favoritos: sp.get('favoritos') === '1',
    orden: SORT_KEYS.includes(o as SortKey) ? (o as SortKey) : 'recientes',
    cursor: cursor && cursor.length <= 500 ? cursor : undefined,
  };
}

export interface LibraryHrefInput {
  vista?: ViewMode | null;
  coleccion?: number | 'sin-coleccion' | null;
  etiquetas?: string[];
  favoritos?: boolean;
  orden?: SortKey;
  cursor?: string | null;
}

/** Pares (nombre, valor) de la query de la Biblioteca, en orden estable y sin valores por defecto. */
export function libraryPairs(p: LibraryHrefInput): [string, string][] {
  const out: [string, string][] = [];
  if (p.vista) out.push(['vista', p.vista]);
  if (p.coleccion !== null && p.coleccion !== undefined) out.push(['coleccion', String(p.coleccion)]);
  for (const t of p.etiquetas ?? []) out.push(['etiqueta', t]);
  if (p.favoritos) out.push(['favoritos', '1']);
  if (p.orden && p.orden !== 'recientes') out.push(['orden', p.orden]);
  if (p.cursor) out.push(['cursor', p.cursor]);
  return out;
}

export function libraryHref(p: LibraryHrefInput): string {
  const pairs = libraryPairs(p);
  if (pairs.length === 0) return '/';
  return `/?${new URLSearchParams(pairs).toString()}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
