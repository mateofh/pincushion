// Utilidades puras de presentación para los componentes de ui/.

/** Fecha corta en español ("3 nov 2026") en la zona horaria del usuario. */
export function formatDate(ms: number, timeZone = 'Europe/Madrid'): string {
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(ms).replace(/\./g, '');
}

export function isoDate(ms: number): string {
  return new Date(ms).toISOString();
}

/** Inicial del dominio para el monograma ("www.example.com" → "E"). */
export function monogramLetter(domain: string): string {
  const clean = domain.replace(/^www\./i, '');
  const m = clean.match(/[\p{L}\p{N}]/u);
  return (m ? m[0] : '?').toLocaleUpperCase('es');
}

/** Índice 0–7 estable derivado del dominio (elige uno de los 8 colores del monograma). */
export function hueIndex(domain: string): number {
  let h = 0;
  for (const ch of domain.replace(/^www\./i, '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 8;
}
