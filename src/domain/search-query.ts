// Traduce lo que escribe el usuario a una consulta FTS5 segura.
// "fermentacion lenta" → '"fermentacion lenta" OR ("fermentacion" AND "lenta"*)': la frase exacta sale en un solo <mark>.
// Con comillas del usuario ("…") solo se busca la frase exacta (sin prefijo); el texto fuera de comillas se añade
// como términos con prefijo unidos por AND: '"masa madre" receta' → '"masa madre" AND "receta"*'.
//
// Seguridad: cada término solo contiene letras, números y marcas combinantes Unicode (\p{L}\p{N}\p{M}) y siempre va
// entre comillas dobles, así que operadores (AND, OR, NOT, NEAR), comillas, `*`, `^`, `:`, `-`, `+` y paréntesis del
// usuario nunca llegan a FTS5 como sintaxis. Emojis y símbolos se ignoran (el tokenizador unicode61 tampoco los indexa).
import { ValidationError } from './errors.ts';

export const MAX_QUERY_LENGTH = 200;
/** Máximo de términos que se usan (el resto se ignora) para acotar el coste de la consulta. */
export const MAX_QUERY_TERMS = 12;

function terms(s: string): string[] {
  return s.normalize('NFKC').match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) ?? [];
}

interface ParsedQuery {
  phrases: string[][];
  loose: string[];
}

function parse(input: string): ParsedQuery {
  const phrases: string[][] = [];
  let budget = MAX_QUERY_TERMS;
  // Las comillas tipográficas cuentan como rectas.
  const s = input.replace(/[“”«»„]/g, '"');
  const outside: string[] = [];
  let last = 0;
  for (const m of s.matchAll(/"([^"]*)"/g)) {
    outside.push(s.slice(last, m.index));
    last = m.index + m[0].length;
    const t = terms(m[1]!).slice(0, budget);
    budget -= t.length;
    if (t.length) phrases.push(t);
  }
  outside.push(s.slice(last));
  const loose = terms(outside.join(' ')).slice(0, budget);
  return { phrases, loose };
}

const q = (t: string) => `"${t}"`;

/** null si no hay nada que buscar. Lanza `ValidationError('q')` si la entrada es demasiado larga. */
export function buildMatchQuery(input: string): string | null {
  if (typeof input !== 'string') return null;
  if (input.length > MAX_QUERY_LENGTH) throw new ValidationError('q', `La búsqueda puede tener hasta ${MAX_QUERY_LENGTH} caracteres.`);
  const { phrases, loose } = parse(input.trim());
  if (phrases.length === 0) {
    if (loose.length === 0) return null;
    if (loose.length === 1) return `${q(loose[0]!)}*`;
    return `"${loose.join(' ')}" OR (${loose.slice(0, -1).map(q).join(' AND ')} AND ${q(loose.at(-1)!)}*)`;
  }
  const parts = [...phrases.map((p) => q(p.join(' '))), ...loose.map((t) => `${q(t)}*`)];
  return parts.join(' AND ');
}

/** Términos que se buscarán (para mensajes como «N resultados para …» o pruebas). */
export function queryTerms(input: string): string[] {
  if (typeof input !== 'string' || input.length > MAX_QUERY_LENGTH) return [];
  const { phrases, loose } = parse(input.trim());
  return [...phrases.flat(), ...loose];
}
