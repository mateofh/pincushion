// Worker de la cola de metadatos. ESQUELETO (Ola 0): el stream de integraciones implementa
// processDue (claim con lease, fetch, reintentos con backoff) y el mantenimiento horario.
import type { App } from '../context.ts';

export async function processDue(_app: App, _opts: { limit?: number } = {}): Promise<number> {
  return 0;
}

export async function runMaintenance(_app: App): Promise<void> {}

let started = false;

/** Arranca los intervalos una sola vez por proceso (si JOBS_INLINE_WORKER está activo). */
export function startWorkerOnce(app: App): void {
  if (started || !app.config.JOBS_INLINE_WORKER) return;
  started = true;
  const tick = setInterval(() => {
    processDue(app).catch((err) => app.log.error('worker.tick_failed', { err }));
  }, 2000);
  const maint = setInterval(() => {
    runMaintenance(app).catch((err) => app.log.error('maintenance.failed', { err }));
  }, 60 * 60 * 1000);
  tick.unref();
  maint.unref();
}
