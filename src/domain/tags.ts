// Etiquetas: parseo de la entrada del usuario y clave normalizada. Reglas puras.
import { ValidationError } from './errors.ts';

export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS_PER_BOOKMARK = 20;

export interface ParsedTag {
  name: string;
  key: string;
}

/** Clave de unicidad: minúsculas, espacios colapsados, NFC. "Masa  Madre" → "masa madre". */
export function tagKey(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
}

/** Acepta "a, b" o ["a","b"]. Quita vacíos y duplicados por clave (gana la primera escritura). */
export function parseTags(input: string | string[] | undefined): ParsedTag[] {
  const raw = Array.isArray(input) ? input : (input ?? '').split(',');
  const seen = new Set<string>();
  const out: ParsedTag[] = [];
  for (const r of raw) {
    const name = r.normalize('NFC').trim().replace(/\s+/g, ' ').replace(/^#/, '');
    if (!name) continue;
    if (name.length > MAX_TAG_LENGTH) throw new ValidationError('tags', `Cada etiqueta puede tener hasta ${MAX_TAG_LENGTH} caracteres.`);
    const key = tagKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, key });
  }
  if (out.length > MAX_TAGS_PER_BOOKMARK) throw new ValidationError('tags', `Puedes poner hasta ${MAX_TAGS_PER_BOOKMARK} etiquetas por enlace.`);
  return out;
}
