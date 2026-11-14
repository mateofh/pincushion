// Servicio de enlaces. ESQUELETO (Ola 0): guardar con fusión, listar y buscar.
// El stream de datos lo completa (lote, papelera, colecciones, etiquetas, paginación, filtros).
import type { App } from '../context.ts';
import { domainOf, normalizeUrl, parseUserUrl } from '../../domain/url.ts';

export interface BookmarkRow {
  id: number;
  url: string;
  domain: string;
  title: string;
  description: string;
  excerpt: string;
  is_favorite: number;
  fetch_status: string;
  created_at: number;
}

export interface SaveInput {
  url: string;
  title?: string;
  description?: string;
  tags?: string[];
}

export interface SaveResult {
  id: number;
  created: boolean;
}

export function saveBookmark(app: App, userId: number, input: SaveInput): SaveResult {
  const u = parseUserUrl(input.url);
  const normalized = normalizeUrl(u);
  const domain = domainOf(u);
  const now = app.clock.now();
  const title = (input.title ?? '').trim().slice(0, 300);
  const description = (input.description ?? '').trim().slice(0, 1000);
  return app.db.transaction(() => {
    const existing = app.db.get<{ id: number }>('SELECT id FROM bookmarks WHERE user_id = ? AND normalized_url = ?', userId, normalized);
    let id: number;
    if (existing) {
      id = existing.id;
      app.db.run('UPDATE bookmarks SET updated_at = ? WHERE id = ? AND user_id = ?', now, id, userId);
    } else {
      id = app.db.run(
        `INSERT INTO bookmarks (user_id, url, normalized_url, domain, title, title_source, description, created_at, updated_at, next_attempt_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        userId, u.toString(), normalized, domain, title || domain, title ? 'user' : 'fallback', description, now, now, now,
      ).lastInsertRowid;
    }
    for (const raw of input.tags ?? []) {
      const name = raw.trim().slice(0, 40);
      if (!name) continue;
      const key = name.toLowerCase();
      app.db.run('INSERT OR IGNORE INTO tags (user_id, name, name_key, created_at) VALUES (?, ?, ?, ?)', userId, name, key, now);
      app.db.run(
        'INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id, user_id) SELECT ?, id, ? FROM tags WHERE user_id = ? AND name_key = ?',
        id, userId, userId, key,
      );
    }
    return { id, created: !existing };
  });
}

export function listBookmarks(app: App, userId: number, limit = 50): BookmarkRow[] {
  return app.db.all<BookmarkRow>(
    `SELECT id, url, domain, title, description, excerpt, is_favorite, fetch_status, created_at
       FROM bookmarks WHERE user_id = ? AND trashed_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ?`,
    userId, limit,
  );
}

export function searchBookmarks(app: App, userId: number, q: string, limit = 50): (BookmarkRow & { title_hl: string; excerpt_hl: string })[] {
  const terms = q.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [];
  if (terms.length === 0) return [];
  const quoted = terms.map((t) => `"${t}"`);
  const match = terms.length > 1 ? `"${terms.join(' ')}" OR (${quoted.slice(0, -1).join(' AND ')} AND ${quoted.at(-1)}*)` : `${quoted[0]}*`;
  return app.db.all(
    `SELECT b.id, b.url, b.domain, b.title, b.description, b.excerpt, b.is_favorite, b.fetch_status, b.created_at,
            highlight(bookmarks_fts, 0, char(2), char(3)) AS title_hl,
            snippet(bookmarks_fts, 2, char(2), char(3), '…', 24) AS excerpt_hl
       FROM bookmarks_fts JOIN bookmarks b ON b.id = bookmarks_fts.rowid
      WHERE bookmarks_fts MATCH ? AND b.user_id = ? AND b.trashed_at IS NULL
      ORDER BY bm25(bookmarks_fts, 10.0, 4.0, 1.0) LIMIT ?`,
    match, userId, limit,
  );
}
