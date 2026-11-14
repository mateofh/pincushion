// Reglas de un enlace: validación de campos, fusión al guardar un duplicado, nombres de colección y cursores.
import { ValidationError } from './errors.ts';

export const LIMITS = { title: 300, description: 1000, excerpt: 8000, collectionName: 80 } as const;

/** Quita caracteres de control (salvo saltos de línea) y espacios sobrantes. */
export function cleanText(s: string | undefined, max: number, field: string, multiline = false): string {
  const v = (s ?? '').normalize('NFC').replace(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, ' ').trim();
  const collapsed = multiline ? v.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : v.replace(/\s+/g, ' ');
  if (collapsed.length > max) throw new ValidationError(field, `Máximo ${max} caracteres.`);
  return collapsed;
}

export function collectionKey(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
}

export function validateCollectionName(name: string): string {
  const v = cleanText(name, LIMITS.collectionName, 'collection');
  if (!v) throw new ValidationError('collection', 'Escribe un nombre para la colección.');
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
 * - Desde la web (formulario "Actualizar enlace"): lo escrito por el usuario reemplaza.
 * - Desde el bookmarklet: solo rellena lo que no editó el usuario (title_source != 'user') y nunca vacía.
 */
export function mergeOnDuplicate(existing: ExistingFields, incoming: IncomingFields, source: 'web' | 'bookmarklet'): Partial<ExistingFields> {
  const out: Partial<ExistingFields> = {};
  const title = incoming.title?.trim();
  const description = incoming.description?.trim();
  if (source === 'web') {
    if (title && title !== existing.title) Object.assign(out, { title, titleSource: 'user' as const });
    if (description !== undefined && description !== existing.description) out.description = description;
    return out;
  }
  if (existing.titleSource !== 'user' && title && title !== existing.title) Object.assign(out, { title, titleSource: 'page' as const });
  if (!existing.description && description) out.description = description;
  return out;
}

// Cursor opaco para paginación por (clave de orden, id).
export function encodeCursor(sortValue: string | number, id: number): string {
  return Buffer.from(JSON.stringify([sortValue, id])).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): { sortValue: string | number; id: number } | null {
  if (!cursor || cursor.length > 500) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(v) && v.length === 2 && (typeof v[0] === 'string' || typeof v[0] === 'number') && Number.isInteger(v[1])) {
      return { sortValue: v[0], id: v[1] as number };
    }
  } catch {
    /* cursor inválido */
  }
  return null;
}
