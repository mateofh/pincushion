// Utilidades de texto compartidas por las reglas de dominio. Puras.

/** Longitud en caracteres (puntos de código), igual que `length()` de SQLite sobre TEXT. Un emoji cuenta 1. */
export function charLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

// Controles de dirección explícitos (embedding/override/isolate) usados para disfrazar texto ("Trojan Source").
// El texto RTL normal no los necesita.
const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/g;
// Caracteres invisibles que no aportan nada en títulos, etiquetas o nombres. Se conserva U+200D (ZWJ) por los emojis.
const INVISIBLE = /[\u00ad\u180e\u200b\u200c\u200e\u200f\u2060-\u2064\ufeff\ufff9-\ufffb]/g;

/**
 * Normaliza a NFC, sustituye surrogates sueltos, quita controles bidi e invisibles y convierte
 * los separadores de línea Unicode a `\n`. No recorta ni colapsa espacios.
 */
export function stripUnsafeChars(s: string): string {
  return s
    .toWellFormed()
    .normalize('NFC')
    .replace(/\r\n?|[\u0085\u2028\u2029]/g, '\n')
    .replace(BIDI_CONTROLS, '')
    .replace(INVISIBLE, '');
}

/** Texto de una sola línea: sin controles, espacios colapsados y recortado. */
export function singleLine(s: string): string {
  return stripUnsafeChars(s)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
