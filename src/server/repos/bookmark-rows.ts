// Lectura de enlaces: columnas, mapeo fila → Bookmark y carga de etiquetas por página (sin N+1).
// Todas las consultas filtran por user_id.
import type { Db } from '../db/sqlite.ts';
import type { Bookmark, CollectionRef, FetchStatus, LibraryQuery, TagRef } from '../contracts.ts';

export interface BookmarkRow {
  id: number;
  url: string;
  domain: string;
  title: string;
  title_source: Bookmark['titleSource'];
  description: string;
  excerpt: string;
  collection_id: number | null;
  collection_name: string | null;
  is_favorite: number;
  fetch_status: FetchStatus;
  fetch_error_code: string | null;
  has_favicon: number;
  created_at: number;
  updated_at: number;
  trashed_at: number | null;
}

/** Columnas de `bookmarks b` + colección + favicon. Requiere `FROM bookmarks b ${BOOKMARK_JOINS}`. */
export const BOOKMARK_COLUMNS = `
  b.id, b.url, b.domain, b.title, b.title_source, b.description, b.excerpt,
  b.collection_id, c.name AS collection_name, b.is_favorite, b.fetch_status, b.fetch_error_code,
  EXISTS (SELECT 1 FROM favicons f WHERE f.user_id = b.user_id AND f.domain = b.domain AND f.status = 'succeeded') AS has_favicon,
  b.created_at, b.updated_at, b.trashed_at`;

export const BOOKMARK_JOINS = 'LEFT JOIN collections c ON c.id = b.collection_id AND c.user_id = b.user_id';

/** Parámetro único con una lista de ids (se usa con `IN (SELECT value FROM json_each(?))`). */
export function idsParam(ids: readonly number[]): string {
  return JSON.stringify([...new Set(ids.filter((n) => Number.isSafeInteger(n) && n > 0))]);
}

export const IDS_IN = 'IN (SELECT value FROM json_each(?))';

/** Etiquetas de varios enlaces en una sola consulta, ordenadas por nombre. */
export function loadTags(db: Db, userId: number, bookmarkIds: readonly number[]): Map<number, TagRef[]> {
  const out = new Map<number, TagRef[]>();
  if (bookmarkIds.length === 0) return out;
  const rows = db.all<{ bookmark_id: number; id: number; name: string }>(
    `SELECT bt.bookmark_id, t.id, t.name
       FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id AND t.user_id = bt.user_id
      WHERE bt.user_id = ? AND bt.bookmark_id ${IDS_IN}
      ORDER BY t.name COLLATE NOCASE, t.id`,
    userId, idsParam(bookmarkIds),
  );
  for (const r of rows) {
    let list = out.get(r.bookmark_id);
    if (!list) out.set(r.bookmark_id, (list = []));
    list.push({ id: r.id, name: r.name });
  }
  return out;
}

export function toBookmark(row: BookmarkRow, tags: TagRef[]): Bookmark {
  const collection: CollectionRef | null =
    row.collection_id != null && row.collection_name != null ? { id: row.collection_id, name: row.collection_name } : null;
  return {
    id: row.id,
    url: row.url,
    domain: row.domain,
    title: row.title,
    titleSource: row.title_source,
    description: row.description,
    excerpt: row.excerpt,
    collection,
    tags,
    isFavorite: row.is_favorite === 1,
    fetchStatus: row.fetch_status,
    fetchErrorCode: row.fetch_error_code,
    hasFavicon: row.has_favicon === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    trashedAt: row.trashed_at,
  };
}

/** Mapea filas a Bookmark cargando las etiquetas de todas en una consulta. */
export function hydrate(db: Db, userId: number, rows: BookmarkRow[]): Bookmark[] {
  const tags = loadTags(db, userId, rows.map((r) => r.id));
  return rows.map((r) => toBookmark(r, tags.get(r.id) ?? []));
}

export function getBookmark(db: Db, userId: number, id: number): Bookmark | null {
  if (!Number.isSafeInteger(id)) return null;
  const row = db.get<BookmarkRow>(
    `SELECT ${BOOKMARK_COLUMNS} FROM bookmarks b ${BOOKMARK_JOINS} WHERE b.user_id = ? AND b.id = ?`,
    userId, id,
  );
  return row ? hydrate(db, userId, [row])[0]! : null;
}

export interface Where {
  sql: string[];
  params: (string | number)[];
}

/** Filtros de la Biblioteca. null si alguna etiqueta pedida no existe (resultado vacío seguro). */
export function libraryFilters(db: Db, userId: number, q: Pick<LibraryQuery, 'collection' | 'tags' | 'favorites'>): Where | null {
  const w: Where = { sql: ['b.user_id = ?', 'b.trashed_at IS NULL'], params: [userId] };
  if (q.collection === 'sin-coleccion') w.sql.push('b.collection_id IS NULL');
  else if (typeof q.collection === 'number') {
    w.sql.push('b.collection_id = ?');
    w.params.push(q.collection);
  }
  if (q.favorites) w.sql.push('b.is_favorite = 1');
  const keys = [...new Set((q.tags ?? []).filter((k) => typeof k === 'string' && k !== ''))];
  if (keys.length) {
    const found = db.all<{ id: number }>(
      `SELECT id FROM tags WHERE user_id = ? AND name_key IN (SELECT value FROM json_each(?))`,
      userId, JSON.stringify(keys),
    );
    if (found.length !== keys.length) return null;
    for (const t of found) {
      w.sql.push('EXISTS (SELECT 1 FROM bookmark_tags bt WHERE bt.bookmark_id = b.id AND bt.tag_id = ?)');
      w.params.push(t.id);
    }
  }
  return w;
}

