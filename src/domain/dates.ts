// Fechas para mostrar. Los instantes se guardan en ms UTC; la zona IANA del usuario solo se usa al formatear.
// Formato fijo en español, independiente del ICU del servidor: "3 nov 2026", "3 nov 2026, 10:42".
// Una zona inválida no rompe la página: se formatea en UTC.

export const DEFAULT_TIME_ZONE = 'UTC';
export const DAY_MS = 24 * 60 * 60 * 1000;
/** La papelera se purga sola 30 días después de mover el enlace. */
export const TRASH_RETENTION_DAYS = 30;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * DAY_MS;

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'] as const;

/** true si es un nombre IANA que el runtime conoce ("Europe/Madrid", "America/Bogota", "UTC"). Rechaza offsets. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Zonas IANA disponibles, para el selector de Ajustes. */
export function listTimeZones(): string[] {
  return Intl.supportedValuesOf('timeZone');
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsIn(ms: number, timeZone: string): { year: number; month: number; day: number; hour: string; minute: string } {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) throw new RangeError('Instante inválido');
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const { type, value } of f.formatToParts(ms)) p[type] = value;
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: (p.hour ?? '00').padStart(2, '0'), minute: (p.minute ?? '00').padStart(2, '0') };
}

/** "3 nov 2026" en la zona del usuario. */
export function formatSavedDate(ms: number, timeZone: string): string {
  const p = partsIn(ms, timeZone);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

/** "3 nov" si es del mismo año que `now` en esa zona; si no, "3 nov 2025". Para avisos como «Ya lo guardaste el 3 nov». */
export function formatShortDate(ms: number, timeZone: string, now: number): string {
  const p = partsIn(ms, timeZone);
  const n = partsIn(now, timeZone);
  return p.year === n.year ? `${p.day} ${MONTHS[p.month - 1]}` : `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

/** "10:42" (24 h) en la zona del usuario. */
export function formatTime(ms: number, timeZone: string): string {
  const p = partsIn(ms, timeZone);
  return `${p.hour}:${p.minute}`;
}

/** "3 nov 2026, 10:42" (24 h) en la zona del usuario. */
export function formatDateTime(ms: number, timeZone: string): string {
  const p = partsIn(ms, timeZone);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${p.hour}:${p.minute}`;
}

/** Fecha ISO para `<time datetime>` (UTC). */
export function isoInstant(ms: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) throw new RangeError('Instante inválido');
  return new Date(ms).toISOString();
}

/** Instante en que la purga elimina un enlace movido a la papelera en `trashedAt`. */
export function trashPurgeAt(trashedAt: number): number {
  return trashedAt + TRASH_RETENTION_MS;
}

/** true si el mantenimiento ya debe eliminarlo. */
export function isTrashExpired(trashedAt: number, now: number): boolean {
  return now >= trashPurgeAt(trashedAt);
}

/** Días completos que faltan para la purga (0 si ya venció). "Se elimina en N días". */
export function daysUntilPurge(trashedAt: number, now: number): number {
  return Math.max(0, Math.ceil((trashPurgeAt(trashedAt) - now) / DAY_MS));
}
