// Traduce lo que escribe el usuario a una consulta FTS5 segura.
// "fermentacion lenta" → '"fermentacion lenta" OR ("fermentacion" AND "lenta"*)': la frase exacta sale en un solo <mark>.
// Con comillas del usuario ("…") solo se busca la frase exacta.
import { ValidationError } from './errors.ts';

export const MAX_QUERY_LENGTH = 200;

function terms(s: string): string[] {
  return (s.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 12);
}

/** null si no hay nada que buscar. */
export function buildMatchQuery(input: string): string | null {
  if (input.length > MAX_QUERY_LENGTH) throw new ValidationError('q', `La búsqueda puede tener hasta ${MAX_QUERY_LENGTH} caracteres.`);
  const trimmed = input.trim();
  const quoted = /^"(.+)"$/.exec(trimmed);
  if (quoted) {
    const t = terms(quoted[1]!);
    return t.length ? `"${t.join(' ')}"` : null;
  }
  const t = terms(trimmed);
  if (t.length === 0) return null;
  const q = t.map((x) => `"${x}"`);
  if (t.length === 1) return `${q[0]}*`;
  return `"${t.join(' ')}" OR (${q.slice(0, -1).join(' AND ')} AND ${q.at(-1)}*)`;
}
