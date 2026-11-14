// Máquina de estados de la obtención de metadatos (la fila del enlace es la cola).
//
//   pending ──► succeeded            (HTML leído)
//      │    ──► skipped              (no es HTML: PDF, imagen…; se guarda sin vista previa)
//      │    ──► failed               (error no reintentable: 4xx salvo 408/429, dirección bloqueada…)
//      └────► retrying ──► (mismas salidas que pending; tras MAX_ATTEMPTS intentos fallidos → failed)
//   lease vencido (el worker murió a mitad) → cuenta como intento fallido reintentable ('lease_expired').
//   failed/skipped/succeeded/retrying ──"Reintentar" del dueño──► pending (contador a 0).
//
// Esperas entre intentos: 30 s · 2 min · 10 min, ±20 % de jitter. Con MAX_ATTEMPTS = 4 se usan las tres esperas
// (~12,5 min en total antes de `failed`). failed es terminal hasta que el dueño pide "Reintentar".

export type FetchStatus = 'pending' | 'retrying' | 'succeeded' | 'failed' | 'skipped';

export const FETCH_STATUSES: readonly FetchStatus[] = ['pending', 'retrying', 'succeeded', 'failed', 'skipped'];

/** Intentos totales (el primero + uno tras cada espera de BACKOFF_MS). */
export const MAX_ATTEMPTS = 4;
/** Espera antes del intento 2, 3 y 4 (ms). */
export const BACKOFF_MS = [30_000, 120_000, 600_000] as const;
/** Amplitud del jitter: la espera real está en [base·(1−J), base·(1+J)]. */
export const BACKOFF_JITTER = 0.2;
export const LEASE_MS = 60_000;

export type FetchOutcome =
  | { kind: 'succeeded' }
  | { kind: 'skipped' } // no es HTML (PDF, imagen…): se guarda sin vista previa
  | { kind: 'error'; code: string; retryable: boolean };

export interface FetchState {
  status: FetchStatus;
  attempts: number;
  nextAttemptAt: number | null;
  errorCode: string | null;
}

/** Normaliza un jitter a [−1, 1]; valores no finitos cuentan como 0. */
function clampJitter(jitter: number): number {
  if (typeof jitter !== 'number' || !Number.isFinite(jitter)) return 0;
  return Math.max(-1, Math.min(1, jitter));
}

/** Espera (ms) tras el intento número `attempts` (1-based) que falló de forma reintentable. `jitter` en [−1, 1]. */
export function backoffDelay(attempts: number, jitter = 0): number {
  const idx = Math.max(0, Math.min(Math.floor(attempts) - 1, BACKOFF_MS.length - 1));
  const base = BACKOFF_MS[idx]!;
  return Math.round(base * (1 + BACKOFF_JITTER * clampJitter(jitter)));
}

/** Jitter uniforme en [−1, 1] a partir de un número en [0, 1) (p. ej. `Math.random()`), para inyectarlo en pruebas. */
export function jitterFrom(random01: number): number {
  return clampJitter(random01 * 2 - 1);
}

/** Calcula el siguiente estado tras un intento. `attemptsBefore` no incluye el intento actual. `jitter` en [−1, 1]. */
export function nextFetchState(attemptsBefore: number, outcome: FetchOutcome, now: number, jitter = 0): FetchState {
  const before = Number.isFinite(attemptsBefore) && attemptsBefore > 0 ? Math.floor(attemptsBefore) : 0;
  const attempts = before + 1;
  if (outcome.kind === 'succeeded') return { status: 'succeeded', attempts, nextAttemptAt: null, errorCode: null };
  if (outcome.kind === 'skipped') return { status: 'skipped', attempts, nextAttemptAt: null, errorCode: 'not_html' };
  if (!outcome.retryable || attempts >= MAX_ATTEMPTS) return { status: 'failed', attempts, nextAttemptAt: null, errorCode: outcome.code };
  return { status: 'retrying', attempts, nextAttemptAt: now + backoffDelay(attempts, jitter), errorCode: outcome.code };
}

/** Lease vencido (worker caído a mitad de un intento): cuenta como intento fallido reintentable. */
export function leaseExpiredState(attemptsBefore: number, now: number, jitter = 0): FetchState {
  return nextFetchState(attemptsBefore, { kind: 'error', code: 'lease_expired', retryable: true }, now, jitter);
}

/** "Reintentar" del dueño: vuelve a pending desde failed/skipped/succeeded. */
export function manualRetry(now: number): FetchState {
  return { status: 'pending', attempts: 0, nextAttemptAt: now, errorCode: null };
}

/** Si el botón "Reintentar" tiene sentido: todo salvo un enlace que aún no se intentó. */
export function canRetryManually(status: FetchStatus): boolean {
  return status !== 'pending';
}

/** Si el worker debe reclamarlo: pendiente o reintentando, con la espera cumplida y sin lease vigente. */
export function isDue(status: FetchStatus, nextAttemptAt: number | null, now: number, leaseUntil: number | null = null): boolean {
  if (status !== 'pending' && status !== 'retrying') return false;
  if (leaseUntil !== null && leaseUntil > now) return false;
  return nextAttemptAt === null || nextAttemptAt <= now;
}

/** Fin del lease al reclamar un enlace. */
export function leaseUntil(now: number): number {
  return now + LEASE_MS;
}

/** Si un estado HTTP merece reintento: 5xx, 408 y 429. El resto de 4xx es fallo terminal inmediato. */
export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/** Transiciones permitidas (incluye "Reintentar" del dueño hacia pending). */
export const FETCH_TRANSITIONS: Readonly<Record<FetchStatus, readonly FetchStatus[]>> = {
  pending: ['succeeded', 'skipped', 'retrying', 'failed'],
  retrying: ['succeeded', 'skipped', 'retrying', 'failed', 'pending'],
  succeeded: ['pending'],
  skipped: ['pending'],
  failed: ['pending'],
};

export function canTransition(from: FetchStatus, to: FetchStatus): boolean {
  return FETCH_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isFetchStatus(v: unknown): v is FetchStatus {
  return typeof v === 'string' && (FETCH_STATUSES as readonly string[]).includes(v);
}

const LABELS: Record<FetchStatus, string> = {
  pending: 'Obteniendo datos…',
  retrying: 'Reintentando…',
  succeeded: 'Datos obtenidos',
  failed: 'No se pudo leer la página',
  skipped: 'Sin vista previa',
};

export function fetchStatusLabel(s: FetchStatus): string {
  return LABELS[s];
}
