// Worker de la cola de metadatos y mantenimiento horario.
import type { App } from '../context.ts';
import { claimDue, executeJob, reclaimExpiredLeases, type RunOptions } from './queue.ts';

export { enqueueFetch, claimDue, claimOne, runFetch, runInline, executeJob, reclaimExpiredLeases } from './queue.ts';
export type { ClaimedJob, RunResult, RunOptions } from './queue.ts';

export const DEFAULT_CONCURRENCY = 2;
const DAY = 24 * 60 * 60 * 1000;
export const TRASH_RETENTION_MS = 30 * DAY;
export const SESSION_RETENTION_MS = 7 * DAY;
export const RATE_LIMIT_RETENTION_MS = 1 * DAY;
export const AUDIT_RETENTION_MS = 365 * DAY;

export interface ProcessOptions {
  /** Máximo de trabajos en esta pasada (por defecto 10). */
  limit?: number;
  /** Trabajos simultáneos (por defecto 2). */
  concurrency?: number;
  jitter?: RunOptions['jitter'];
}

/**
 * Procesa trabajos vencidos con concurrencia acotada. Cada hueco reclama de uno en uno, para que el
 * lease solo empiece a correr cuando el trabajo arranca. Devuelve cuántos trabajos ejecutó.
 */
export async function processDue(app: App, opts: ProcessOptions = {}): Promise<number> {
  const limit = opts.limit ?? 10;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  let taken = 0;
  const slot = async () => {
    while (taken < limit) {
      taken++;
      const [job] = claimDue(app, 1);
      if (!job) {
        taken--;
        return;
      }
      try {
        await executeJob(app, job, { jitter: opts.jitter });
      } catch (err) {
        app.log.error('job.crashed', { bookmark_id: job.bookmarkId, err });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, limit) }, slot));
  return taken;
}

export interface MaintenanceResult {
  trashedPurged: number;
  sessionsPurged: number;
  rateLimitsPurged: number;
  auditPurged: number;
  faviconsPurged: number;
  leasesReclaimed: number;
}

/** Retención: papelera > 30 d, sesiones caducadas/revocadas > 7 d, rate limits viejos, audit > 365 d, favicons huérfanos, leases vencidos. */
export async function runMaintenance(app: App): Promise<MaintenanceResult> {
  const now = app.clock.now();
  const result = app.db.transaction((): MaintenanceResult => {
    const trashedPurged = app.db.run('DELETE FROM bookmarks WHERE trashed_at IS NOT NULL AND trashed_at < ?', now - TRASH_RETENTION_MS).changes;
    const sessionsPurged = app.db.run(
      'DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)',
      now - SESSION_RETENTION_MS, now - SESSION_RETENTION_MS,
    ).changes;
    const rateLimitsPurged = app.db.run('DELETE FROM rate_limits WHERE window_start < ?', now - RATE_LIMIT_RETENTION_MS).changes;
    const auditPurged = app.db.run('DELETE FROM audit_events WHERE created_at < ?', now - AUDIT_RETENTION_MS).changes;
    const faviconsPurged = app.db.run(
      `DELETE FROM favicons WHERE NOT EXISTS (
         SELECT 1 FROM bookmarks b WHERE b.user_id = favicons.user_id AND b.domain = favicons.domain)`,
    ).changes;
    const leasesReclaimed = reclaimExpiredLeases(app, now);
    return { trashedPurged, sessionsPurged, rateLimitsPurged, auditPurged, faviconsPurged, leasesReclaimed };
  });
  app.log.info('maintenance.done', { ...result });
  return result;
}

let started = false;

/** Arranca los intervalos una sola vez por proceso (si JOBS_INLINE_WORKER está activo). */
export function startWorkerOnce(app: App): void {
  if (started || !app.config.JOBS_INLINE_WORKER) return;
  started = true;
  let busy = false;
  const tick = setInterval(() => {
    if (busy) return;
    busy = true;
    processDue(app)
      .catch((err) => app.log.error('worker.tick_failed', { err }))
      .finally(() => {
        busy = false;
      });
  }, 2000);
  const maintenance = () => runMaintenance(app).catch((err) => app.log.error('maintenance.failed', { err }));
  const first = setTimeout(maintenance, 30_000);
  const maint = setInterval(maintenance, 60 * 60 * 1000);
  tick.unref();
  first.unref();
  maint.unref();
}
