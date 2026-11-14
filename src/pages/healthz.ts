// Salud: DB accesible, migraciones al día y estado de la cola de metadatos. Sin datos de usuarios.
import type { APIRoute } from 'astro';
import { pendingMigrations } from '../server/db/sqlite.ts';

export const GET: APIRoute = ({ locals }) => {
  const { app } = locals;
  try {
    const pending = pendingMigrations(app.db);
    const now = app.clock.now();
    const queue = app.db.get<{ due: number; failed: number; oldest: number | null }>(
      `SELECT
         SUM(CASE WHEN fetch_status IN ('pending','retrying') AND next_attempt_at <= ? THEN 1 ELSE 0 END) AS due,
         SUM(CASE WHEN fetch_status = 'failed' THEN 1 ELSE 0 END) AS failed,
         MIN(CASE WHEN fetch_status IN ('pending','retrying') THEN next_attempt_at END) AS oldest
       FROM bookmarks`,
      now,
    );
    const ok = pending.length === 0;
    return Response.json(
      {
        status: ok ? 'ok' : 'degraded',
        db: 'ok',
        migrations: ok ? 'up_to_date' : { pending },
        queue: { due: queue?.due ?? 0, failed: queue?.failed ?? 0, oldest_due_age_ms: queue?.oldest ? Math.max(0, now - queue.oldest) : 0 },
      },
      { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    app.log.error('healthz.failed', { err, request_id: locals.requestId });
    return Response.json({ status: 'error', db: 'unreachable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
};
