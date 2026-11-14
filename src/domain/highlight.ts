// Convierte texto con centinelas \u0002…\u0003 (de highlight()/snippet() de FTS5) en HTML seguro con <mark>.
// Es el único HTML que la app inserta con set:html: todo el texto se escapa antes y la única etiqueta que puede
// aparecer en la salida es <mark> / </mark> (sin atributos), siempre bien anidada y nunca vacía.

/** Centinelas para `highlight(bookmarks_fts, col, HIGHLIGHT_OPEN, HIGHLIGHT_CLOSE)` y `snippet(...)`. */
export const HIGHLIGHT_OPEN = '\u0002';
export const HIGHLIGHT_CLOSE = '\u0003';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

/** Escapa texto para contenido o atributo HTML entre comillas. */
export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"'`]/g, (c) => ESC[c]!);
}

/** Quita controles (salvo \t y \n, y los centinelas) y surrogates sueltos antes de escapar. */
function sanitize(s: string): string {
  return s.toWellFormed().replace(/[\u0000\u0001\u0004-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
}

export function highlightToHtml(marked: string): string {
  if (typeof marked !== 'string' || !marked) return '';
  let open = false;
  let pending = ''; // texto escapado dentro de un <mark> abierto
  let out = '';
  for (const part of sanitize(marked).split(/([\u0002\u0003])/)) {
    if (part === HIGHLIGHT_OPEN) {
      open = true;
    } else if (part === HIGHLIGHT_CLOSE) {
      if (open && pending) out += `<mark>${pending}</mark>`;
      open = false;
      pending = '';
    } else if (part) {
      if (open) pending += escapeHtml(part);
      else out += escapeHtml(part);
    }
  }
  if (open && pending) out += `<mark>${pending}</mark>`;
  return out;
}
