// Inserta enlaces directamente con SQL (los servicios son de otro stream).
import type { App } from '../../../src/server/context.ts';

export interface BookmarkSeed {
  url?: string;
  domain?: string;
  title?: string;
  titleSource?: 'page' | 'user' | 'fallback';
  description?: string;
  excerpt?: string;
  status?: 'pending' | 'retrying' | 'succeeded' | 'failed' | 'skipped';
  attempts?: number;
  nextAttemptAt?: number | null;
  leaseUntil?: number | null;
  trashedAt?: number | null;
}

let n = 0;

export function insertBookmark(app: App, userId: number, s: BookmarkSeed = {}): number {
  const now = app.clock.now();
  const url = s.url ?? `https://example.com/pagina-${++n}`;
  const u = new URL(url);
  const domain = s.domain ?? u.hostname.replace(/^www\./, '');
  return app.db.run(
    `INSERT INTO bookmarks (user_id, url, normalized_url, domain, title, title_source, description, excerpt,
       fetch_status, fetch_attempts, next_attempt_at, lease_until, created_at, updated_at, trashed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId, url, `${domain}${u.port ? ':' + u.port : ''}${u.pathname}${u.search}`, domain, s.title ?? domain, s.titleSource ?? 'fallback',
    s.description ?? '', s.excerpt ?? '', s.status ?? 'pending', s.attempts ?? 0,
    s.nextAttemptAt === undefined ? now : s.nextAttemptAt, s.leaseUntil ?? null, now, now, s.trashedAt ?? null,
  ).lastInsertRowid;
}

export interface BookmarkRow {
  id: number;
  title: string;
  title_source: string;
  description: string;
  excerpt: string;
  fetch_status: string;
  fetch_attempts: number;
  next_attempt_at: number | null;
  fetch_error_code: string | null;
  lease_until: number | null;
  fetched_at: number | null;
}

export function getBookmark(app: App, id: number): BookmarkRow {
  return app.db.get<BookmarkRow>('SELECT * FROM bookmarks WHERE id = ?', id)!;
}
