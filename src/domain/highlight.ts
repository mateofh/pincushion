// Convierte texto con centinelas \u0002…\u0003 (de highlight()/snippet() de FTS5) en HTML seguro con <mark>.
// Es el único HTML que la app inserta con set:html: todo el texto se escapa antes.

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]!);
}

export function highlightToHtml(marked: string): string {
  let open = false;
  let out = '';
  for (const part of marked.split(/([\u0002\u0003])/)) {
    if (part === '\u0002') {
      if (!open) out += '<mark>';
      open = true;
    } else if (part === '\u0003') {
      if (open) out += '</mark>';
      open = false;
    } else {
      out += escapeHtml(part);
    }
  }
  if (open) out += '</mark>';
  return out;
}
