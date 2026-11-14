// Cola de metadatos: la propia fila de `bookmarks` es la cola (fetch_status, next_attempt_at, lease_until).
// - claim atómico con UPDATE … RETURNING y lease; el valor de lease_until actúa de testigo al escribir.
// - un lease vencido cuenta como intento fallido ('timeout') y vuelve a retrying (o failed si se agotan).
// - la escritura del resultado va en UNA transacción y nunca pisa el título editado por el usuario.
import { randomBytes } from 'node:crypto';
import type { App } from '../context.ts';
import type { Logger } from '../log.ts';
import { LEASE_MS, MAX_ATTEMPTS, nextFetchState, type FetchOutcome, type FetchStatus } from '../../domain/fetch-state.ts';
import { PageFetchError, type PageMetadata } from '../adapters/types.ts';

export const FAVICON_FRESH_MS = 30 * 24 * 60 * 60 * 1000;
export const FAVICON_FAILED_RETRY_MS = 24 * 60 * 60 * 1000;
const TITLE_MAX = 300;
const DESCRIPTION_MAX = 1000;
const EXCERPT_MAX = 8000;

export interface ClaimedJob {
  bookmarkId: number;
  userId: number;
  url: string;
  domain: string;
  /** Intentos previos (sin contar el que se va a hacer). */
  attempts: number;
  /** Testigo del lease: la escritura final exige que siga siendo este valor. */
  leaseUntil: number;
}

export interface RunResult {
  bookmarkId: number;
  status: FetchStatus;
  /** false si el intento no terminó (presupuesto agotado o lease perdido): el worker lo retomará. */
  finished: boolean;
  errorCode: string | null;
}

export interface RunOptions {
  /** Jitter del backoff en [−1, 1]. Por defecto aleatorio. */
  jitter?: () => number;
  /** Cancela el intento sin contarlo (lo deja para el worker). */
  signal?: AbortSignal;
  timeoutMs?: number;
}

const defaultJitter = () => Math.random() * 2 - 1;

interface ClaimRow {
  id: number;
  user_id: number;
  url: string;
  domain: string;
  fetch_attempts: number;
  lease_until: number;
}

const toJob = (r: ClaimRow): ClaimedJob => ({
  bookmarkId: r.id,
  userId: r.user_id,
  url: r.url,
  domain: r.domain,
  attempts: r.fetch_attempts,
  leaseUntil: r.lease_until,
});

/** Pone el enlace en la cola para obtener metadatos cuanto antes (también "Reintentar"). */
export function enqueueFetch(app: App, bookmarkId: number): boolean {
  const now = app.clock.now();
  const r = app.db.run(
    `UPDATE bookmarks SET fetch_status = 'pending', fetch_attempts = 0, next_attempt_at = ?, fetch_error_code = NULL, lease_until = NULL
     WHERE id = ?`,
    now, bookmarkId,
  );
  return r.changes > 0;
}

/** Leases vencidos → intento fallido por timeout: retrying (o failed si se agotaron los intentos). */
export function reclaimExpiredLeases(app: App, now = app.clock.now()): number {
  return app.db.run(
    `UPDATE bookmarks SET
       fetch_attempts = fetch_attempts + 1,
       fetch_status = CASE WHEN fetch_attempts + 1 >= ? THEN 'failed' ELSE 'retrying' END,
       next_attempt_at = CASE WHEN fetch_attempts + 1 >= ? THEN NULL ELSE ? END,
       fetch_error_code = 'timeout',
       lease_until = NULL
     WHERE lease_until IS NOT NULL AND lease_until <= ? AND fetch_status IN ('pending', 'retrying')`,
    MAX_ATTEMPTS, MAX_ATTEMPTS, now, now,
  ).changes;
}

/** Reclama hasta `limit` trabajos vencidos de forma atómica y les pone lease. */
export function claimDue(app: App, limit: number): ClaimedJob[] {
  if (limit <= 0) return [];
  return app.db.transaction(() => {
    const now = app.clock.now();
    reclaimExpiredLeases(app, now);
    const rows = app.db.all<ClaimRow>(
      `UPDATE bookmarks SET lease_until = ?
       WHERE id IN (
         SELECT id FROM bookmarks
         WHERE fetch_status IN ('pending', 'retrying')
           AND COALESCE(next_attempt_at, 0) <= ?
           AND (lease_until IS NULL OR lease_until <= ?)
           AND trashed_at IS NULL
         ORDER BY COALESCE(next_attempt_at, 0), id
         LIMIT ?)
       RETURNING id, user_id, url, domain, fetch_attempts, lease_until`,
      now + LEASE_MS, now, now, limit,
    );
    return rows.map(toJob);
  });
}

/** Reclama un enlace concreto (sin esperar a next_attempt_at), si no lo tiene otro worker. */
export function claimOne(app: App, bookmarkId: number): ClaimedJob | null {
  return app.db.transaction(() => {
    const now = app.clock.now();
    reclaimExpiredLeases(app, now);
    const row = app.db.get<ClaimRow>(
      `UPDATE bookmarks SET lease_until = ?
       WHERE id = ? AND fetch_status IN ('pending', 'retrying') AND (lease_until IS NULL OR lease_until <= ?)
       RETURNING id, user_id, url, domain, fetch_attempts, lease_until`,
      now + LEASE_MS, bookmarkId, now,
    );
    return row ? toJob(row) : null;
  });
}

function jobId(): string {
  return randomBytes(6).toString('hex');
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

const INTERRUPTED = Symbol('interrupted');

/** Espera `p` o la cancelación de `signal` (lo que ocurra antes). */
function raceSignal<T>(p: Promise<T>, signal?: AbortSignal): Promise<T | typeof INTERRUPTED> {
  if (!signal) return p;
  if (signal.aborted) {
    p.catch(() => {});
    return Promise.resolve(INTERRUPTED);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      p.catch(() => {});
      resolve(INTERRUPTED);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(signal.aborted ? INTERRUPTED : v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) resolve(INTERRUPTED);
        else reject(e);
      },
    );
  });
}

function outcomeOf(err: unknown): FetchOutcome {
  if (err instanceof PageFetchError) {
    if (err.code === 'not_html') return { kind: 'skipped' };
    return { kind: 'error', code: err.code, retryable: err.retryable };
  }
  return { kind: 'error', code: 'network', retryable: true };
}

const clip = (s: string | null | undefined, max: number): string | null => {
  if (s == null) return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

/** Ejecuta un trabajo ya reclamado: fetch, nuevo estado, escritura transaccional y favicon. */
export async function executeJob(app: App, job: ClaimedJob, opts: RunOptions = {}): Promise<RunResult> {
  const log = app.log.child({ job_id: jobId(), bookmark_id: job.bookmarkId });
  const started = Date.now();
  const domain = hostOf(job.url);
  let meta: PageMetadata | null = null;
  let outcome: FetchOutcome;
  try {
    const r = await raceSignal(app.fetcher.fetchMetadata(job.url, { signal: opts.signal, timeoutMs: opts.timeoutMs }), opts.signal);
    if (r === INTERRUPTED) return release(app, job, log);
    meta = r;
    outcome = { kind: 'succeeded' };
  } catch (err) {
    if (opts.signal?.aborted) return release(app, job, log);
    outcome = outcomeOf(err);
  }

  const now = app.clock.now();
  const state = nextFetchState(job.attempts, outcome, now, (opts.jitter ?? defaultJitter)());
  const title = clip(meta?.title, TITLE_MAX);
  const description = clip(meta?.description, DESCRIPTION_MAX);
  const excerpt = clip(meta?.excerpt, EXCERPT_MAX);
  const written = app.db.transaction(() =>
    app.db.run(
      `UPDATE bookmarks SET
         title = CASE WHEN title_source != 'user' AND ?1 IS NOT NULL THEN ?1 ELSE title END,
         title_source = CASE WHEN title_source != 'user' AND ?1 IS NOT NULL THEN 'page' ELSE title_source END,
         description = CASE WHEN description = '' AND ?2 IS NOT NULL THEN ?2 ELSE description END,
         excerpt = CASE WHEN excerpt = '' AND ?3 IS NOT NULL THEN ?3 ELSE excerpt END,
         fetch_status = ?4, fetch_attempts = ?5, next_attempt_at = ?6, fetch_error_code = ?7,
         fetched_at = ?8, lease_until = NULL, updated_at = ?8
       WHERE id = ?9 AND lease_until = ?10`,
      title, description, excerpt, state.status, state.attempts, state.nextAttemptAt, state.errorCode, now, job.bookmarkId, job.leaseUntil,
    ).changes,
  );
  if (!written) {
    log.warn('job.lease_lost', { domain });
    return { bookmarkId: job.bookmarkId, status: currentStatus(app, job.bookmarkId), finished: false, errorCode: null };
  }
  log.info('job.done', {
    domain,
    status: state.status,
    attempts: state.attempts,
    error_code: state.errorCode,
    duration_ms: Date.now() - started,
  });

  if (state.status === 'succeeded' || state.status === 'skipped') {
    const base = meta?.finalUrl ?? job.url;
    let faviconUrl = meta?.faviconUrl ?? null;
    if (!faviconUrl) {
      try {
        faviconUrl = new URL('/favicon.ico', base).href;
      } catch {
        faviconUrl = null;
      }
    }
    if (faviconUrl) await refreshFavicon(app, job, faviconUrl, opts, log);
  }
  return { bookmarkId: job.bookmarkId, status: state.status, finished: true, errorCode: state.errorCode };
}

function currentStatus(app: App, bookmarkId: number): FetchStatus {
  return app.db.get<{ fetch_status: FetchStatus }>('SELECT fetch_status FROM bookmarks WHERE id = ?', bookmarkId)?.fetch_status ?? 'pending';
}

/** Suelta el lease sin contar el intento y deja el enlace listo para el worker. */
function release(app: App, job: ClaimedJob, log: Logger): RunResult {
  app.db.run(
    'UPDATE bookmarks SET lease_until = NULL, next_attempt_at = ? WHERE id = ? AND lease_until = ?',
    app.clock.now(), job.bookmarkId, job.leaseUntil,
  );
  log.info('job.deferred', { domain: hostOf(job.url) });
  return { bookmarkId: job.bookmarkId, status: currentStatus(app, job.bookmarkId), finished: false, errorCode: null };
}

/** Obtiene y guarda el favicon por (user_id, domain) salvo que haya uno reciente. */
async function refreshFavicon(app: App, job: ClaimedJob, url: string, opts: RunOptions, log: Logger): Promise<void> {
  const now = app.clock.now();
  const row = app.db.get<{ status: string; fetched_at: number }>(
    'SELECT status, fetched_at FROM favicons WHERE user_id = ? AND domain = ?', job.userId, job.domain,
  );
  if (row?.status === 'succeeded' && now - row.fetched_at < FAVICON_FRESH_MS) return;
  if (row?.status === 'failed' && now - row.fetched_at < FAVICON_FAILED_RETRY_MS) return;
  let data;
  try {
    const r = await raceSignal(app.fetcher.fetchFavicon(url, { signal: opts.signal }), opts.signal);
    if (r === INTERRUPTED) return;
    data = r;
  } catch {
    data = null;
  }
  const at = app.clock.now();
  if (data) {
    app.db.run(
      `INSERT INTO favicons (user_id, domain, status, content_type, bytes, fetched_at, last_error_code)
       VALUES (?, ?, 'succeeded', ?, ?, ?, NULL)
       ON CONFLICT (user_id, domain) DO UPDATE SET status = 'succeeded', content_type = excluded.content_type,
         bytes = excluded.bytes, fetched_at = excluded.fetched_at, last_error_code = NULL`,
      job.userId, job.domain, data.contentType, data.bytes, at,
    );
    log.info('favicon.saved', { domain: job.domain, bytes: data.bytes.length });
  } else {
    // Si ya había uno bueno (caducado), se conserva; solo se anota el fallo.
    app.db.run(
      `INSERT INTO favicons (user_id, domain, status, content_type, bytes, fetched_at, last_error_code)
       VALUES (?, ?, 'failed', NULL, NULL, ?, 'invalid')
       ON CONFLICT (user_id, domain) DO UPDATE SET fetched_at = excluded.fetched_at, last_error_code = 'invalid'`,
      job.userId, job.domain, at,
    );
    log.info('favicon.failed', { domain: job.domain });
  }
}

/** Reclama y ejecuta el trabajo de un enlace. null si no existe o ya lo tiene otro worker / no está en cola. */
export async function runFetch(app: App, bookmarkId: number, opts: RunOptions = {}): Promise<RunResult | null> {
  const job = claimOne(app, bookmarkId);
  if (!job) return null;
  return executeJob(app, job, opts);
}

/**
 * Para el bookmarklet: intenta obtener metadatos y favicon dentro de `budgetMs`. Si no alcanza, suelta el
 * lease sin contar el intento (queda 'pending' con next_attempt_at = now) para que el worker lo retome.
 */
export async function runInline(app: App, bookmarkId: number, opts: { budgetMs: number; jitter?: () => number }): Promise<RunResult | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(0, opts.budgetMs));
  timer.unref?.();
  try {
    return await runFetch(app, bookmarkId, { signal: ctrl.signal, jitter: opts.jitter });
  } finally {
    clearTimeout(timer);
  }
}
