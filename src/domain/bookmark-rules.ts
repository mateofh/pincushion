// Reglas de un enlace: validación de campos, fusión al guardar un duplicado, nombres de colección y cursores.
import { ValidationError } from './errors.ts';
import { charLength, singleLine, stripUnsafeChars } from './text.ts';

export const LIMITS = { title: 300, description: 1000, excerpt: 8000, collectionName: 80 } as const;

/**
 * Limpia texto del usuario o de una página: NFC, sin caracteres de control ni controles bidi/invisibles,
 * espacios colapsados y recortado. Con `multiline` conserva saltos de línea (CRLF → LF, máximo una línea en blanco).
 * Lanza `ValidationError(field)` si supera `max` caracteres (contados como `length()` de SQLite).
 */
export function cleanText(s: string | undefined, max: number, field: string, multiline = false): string {
  const input = typeof s === 'string' ? s : '';
  let v: string;
  if (multiline) {
    v = stripUnsafeChars(input)
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, ' ')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } else {
    v = singleLine(input);
  }
  if (charLength(v) > max) throw new ValidationError(field, `Máximo ${max} caracteres.`);
  return v;
}

/** Recorta (sin lanzar) a `max` caracteres, para textos que vienen de páginas ajenas (título, excerpt). */
export function truncateText(s: string, max: number): string {
  if (charLength(s) <= max) return s;
  const chars = [...s].slice(0, max);
  return chars.join('').trimEnd();
}

export function collectionKey(name: string): string {
  return singleLine(name).toLocaleLowerCase('es');
}

/** Nombres que confundirían con la entrada virtual "Sin colección" de la barra lateral. */
const RESERVED_COLLECTION_KEYS = new Set(['sin colección', 'sin coleccion', 'sin-coleccion', 'sin-colección']);

export function validateCollectionName(name: string): string {
  const v = cleanText(name, LIMITS.collectionName, 'collection');
  if (!v) throw new ValidationError('collection', 'Escribe un nombre para la colección.');
  if (RESERVED_COLLECTION_KEYS.has(collectionKey(v))) throw new ValidationError('collection', 'Ese nombre está reservado: elige otro.');
  return v;
}

export type TitleSource = 'page' | 'user' | 'fallback';

export interface ExistingFields {
  title: string;
  titleSource: TitleSource;
  description: string;
}

export interface IncomingFields {
  title?: string;
  description?: string;
}

/**
 * Qué campos actualizar cuando se guarda una URL que ya existe.
 * - Desde la web (formulario "Actualizar enlace"): lo escrito por el usuario reemplaza. Un título vacío no borra
 *   (el título es obligatorio); una descripción vacía explícita sí la borra; `undefined` no toca.
 * - Desde el bookmarklet: solo rellena lo que no editó el usuario (title_source != 'user') y nunca vacía.
 * Devuelve solo los campos que cambian (objeto vacío = nada que actualizar).
 */
export function mergeOnDuplicate(existing: ExistingFields, incoming: IncomingFields, source: 'web' | 'bookmarklet'): Partial<ExistingFields> {
  const out: Partial<ExistingFields> = {};
  const title = typeof incoming.title === 'string' ? incoming.title.trim() : undefined;
  const description = typeof incoming.description === 'string' ? incoming.description.trim() : undefined;
  if (source === 'web') {
    if (title && title !== existing.title) {
      out.title = title;
      out.titleSource = 'user';
    }
    if (description !== undefined && description !== existing.description) out.description = description;
    return out;
  }
  if (existing.titleSource !== 'user' && title && title !== existing.title) {
    out.title = title;
    out.titleSource = 'page';
  }
  if (!existing.description && description) out.description = description;
  return out;
}

// Cursor opaco para paginación por (clave de orden, id).
const MAX_CURSOR_LENGTH = 500;
const MAX_SORT_STRING = 300;

export function encodeCursor(sortValue: string | number, id: number): string {
  return Buffer.from(JSON.stringify([sortValue, id])).toString('base64url');
}

/**
 * Decodifica un cursor de `encodeCursor`. Devuelve null (= primera página) ante cualquier manipulación:
 * caracteres fuera de base64url, JSON inválido, forma distinta de `[valor, id]`, números no finitos o no seguros,
 * id ≤ 0, cadenas largas o codificación no canónica.
 */
export function decodeCursor(cursor: string | undefined): { sortValue: string | number; id: number } | null {
  if (typeof cursor !== 'string' || !cursor || cursor.length > MAX_CURSOR_LENGTH) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(v) || v.length !== 2) return null;
    const [sortValue, id] = v as [unknown, unknown];
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;
    if (typeof sortValue === 'number') {
      if (!Number.isFinite(sortValue)) return null;
    } else if (typeof sortValue === 'string') {
      if (sortValue.length > MAX_SORT_STRING || sortValue !== sortValue.toWellFormed()) return null;
    } else {
      return null;
    }
    if (encodeCursor(sortValue, id) !== cursor) return null;
    return { sortValue, id };
  } catch {
    return null;
  }
}
