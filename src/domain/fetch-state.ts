// Máquina de estados de la obtención de metadatos (la fila del enlace es la cola).
// pending → succeeded | skipped | retrying → failed. failed es terminal hasta que el dueño pide "Reintentar".

export type FetchStatus = 'pending' | 'retrying' | 'succeeded' | 'failed' | 'skipped';

export const MAX_ATTEMPTS = 3;
/** Espera antes del intento 2 y 3 (ms). */
export const BACKOFF_MS = [30_000, 120_000, 600_000] as const;
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

/** Calcula el siguiente estado tras un intento. `attemptsBefore` no incluye el intento actual. `jitter` en [−1, 1]. */
export function nextFetchState(attemptsBefore: number, outcome: FetchOutcome, now: number, jitter = 0): FetchState {
  const attempts = attemptsBefore + 1;
  if (outcome.kind === 'succeeded') return { status: 'succeeded', attempts, nextAttemptAt: null, errorCode: null };
  if (outcome.kind === 'skipped') return { status: 'skipped', attempts, nextAttemptAt: null, errorCode: 'not_html' };
  if (!outcome.retryable || attempts >= MAX_ATTEMPTS) return { status: 'failed', attempts, nextAttemptAt: null, errorCode: outcome.code };
  const base = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!;
  const delay = Math.round(base * (1 + 0.2 * Math.max(-1, Math.min(1, jitter))));
  return { status: 'retrying', attempts, nextAttemptAt: now + delay, errorCode: outcome.code };
}

/** "Reintentar" del dueño: vuelve a pending desde failed/skipped/succeeded. */
export function manualRetry(now: number): FetchState {
  return { status: 'pending', attempts: 0, nextAttemptAt: now, errorCode: null };
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
