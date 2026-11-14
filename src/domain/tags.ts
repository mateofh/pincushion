// Etiquetas: parseo de la entrada del usuario y clave normalizada. Reglas puras.
//
// - El nombre conserva mayúsculas y acentos tal como se escribió por primera vez; la clave decide la unicidad.
// - Las comas separan etiquetas siempre (también dentro de cada elemento de un array), así que un nombre nunca
//   contiene comas y "a, b" se puede volver a parsear sin ambigüedad.
// - Las longitudes se cuentan en caracteres (un emoji cuenta 1), como `length()` de SQLite.
import { ValidationError } from './errors.ts';
import { charLength, singleLine } from './text.ts';

export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS_PER_BOOKMARK = 20;

export interface ParsedTag {
  name: string;
  key: string;
}

/** Clave de unicidad: minúsculas, espacios colapsados, NFC. "Masa  Madre" → "masa madre". Idempotente. */
export function tagKey(name: string): string {
  return singleLine(name).replace(/^#+\s*/, '').toLocaleLowerCase('es');
}

function cleanTagName(raw: string): string {
  return singleLine(raw).replace(/^#+\s*/, '');
}

function tooLong(): ValidationError {
  return new ValidationError('tags', `Cada etiqueta puede tener hasta ${MAX_TAG_LENGTH} caracteres.`);
}

/** Acepta "a, b" o ["a","b"]. Quita vacíos, `#` inicial y duplicados por clave (gana la primera escritura). */
export function parseTags(input: string | string[] | undefined): ParsedTag[] {
  const pieces = (Array.isArray(input) ? input : [input ?? '']).flatMap((x) => (typeof x === 'string' ? x.split(',') : []));
  const seen = new Set<string>();
  const out: ParsedTag[] = [];
  for (const r of pieces) {
    const name = cleanTagName(r);
    if (!name) continue;
    if (charLength(name) > MAX_TAG_LENGTH) throw tooLong();
    const key = name.toLocaleLowerCase('es');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, key });
  }
  if (out.length > MAX_TAGS_PER_BOOKMARK) throw new ValidationError('tags', `Puedes poner hasta ${MAX_TAGS_PER_BOOKMARK} etiquetas por enlace.`);
  return out;
}

/** Una sola etiqueta (acción de lote "Añadir etiqueta", renombrar). Lanza si queda vacía, es larga o trae comas. */
export function validateTagName(input: string | undefined, field = 'tags'): ParsedTag {
  const name = cleanTagName(input ?? '');
  if (!name) throw new ValidationError(field, 'Escribe el nombre de la etiqueta.');
  if (name.includes(',')) throw new ValidationError(field, 'El nombre de una etiqueta no puede llevar comas.');
  if (charLength(name) > MAX_TAG_LENGTH) throw new ValidationError(field, `Cada etiqueta puede tener hasta ${MAX_TAG_LENGTH} caracteres.`);
  return { name, key: name.toLocaleLowerCase('es') };
}

/** Une etiquetas existentes con nuevas (fusión de duplicados): conserva el orden y el nombre de las existentes. */
export function mergeTags(existing: readonly ParsedTag[], incoming: readonly ParsedTag[]): ParsedTag[] {
  const seen = new Set(existing.map((t) => t.key));
  const out = [...existing];
  for (const t of incoming) {
    if (seen.has(t.key)) continue;
    seen.add(t.key);
    out.push(t);
  }
  return out;
}
