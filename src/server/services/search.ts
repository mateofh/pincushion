// Búsqueda de texto completo sobre título, descripción y excerpt (FTS5 `bookmarks_fts`, bm25 10/4/1).
// Resaltado con centinelas \u0002/\u0003 → highlightToHtml (texto escapado + <mark>).
// Paginación por offset (el orden por relevancia no tiene una clave estable para keyset): el cursor es
// encodeCursor('offset', n) y se limita a MAX_OFFSET. Excluye la papelera y filtra siempre por user_id.
import type { App } from '../context.ts';
import type { Bookmark, Page, SearchHit, SearchQuery, SearchService } from '../contracts.ts';
import { buildMatchQuery } from '../../domain/search-query.ts';
import { highlightToHtml } from '../../domain/highlight.ts';
import { decodeCursor, encodeCursor } from '../../domain/bookmark-rules.ts';
import { BOOKMARK_COLUMNS, BOOKMARK_JOINS, IDS_IN, hydrate, idsParam, libraryFilters, type BookmarkRow } from '../repos/bookmark-rows.ts';

export const SEARCH_PAGE_SIZE = 50;
export const SEARCH_MAX_PAGE_SIZE = 100;
export const MAX_OFFSET = 10_000;
const SNIPPET_TOKENS = 32;

export interface RawSearchHit {
  bookmark: Bookmark;
  /** Texto con centinelas \u0002…\u0003 (sin escapar). */
  titleMarked: string;
  excerptMarked: string;
  descriptionMarked: string;
}

export interface SearchServiceImpl extends SearchService {
  /** Como search pero sin convertir a HTML (para quien quiera otro formato). */
  searchRaw(userId: number, q: SearchQuery): Page<RawSearchHit>;
}

function offsetFrom(cursor: string | undefined): number {
  const c = decodeCursor(cursor);
  if (!c || c.sortValue !== 'offset' || c.id < 0) return 0;
  return Math.min(c.id, MAX_OFFSET);
}

export function searchService(app: App): SearchServiceImpl {
  const db = app.db;

  function searchRaw(userId: number, q: SearchQuery): Page<RawSearchHit> {
    const match = buildMatchQuery(q.q ?? ''); // lanza ValidationError si q > 200
    if (!match) return { items: [], nextCursor: null, total: 0 };
    const w = libraryFilters(db, userId, q);
    if (!w) return { items: [], nextCursor: null, total: 0 };
    const limit = q.limit === undefined || !Number.isFinite(q.limit) ? SEARCH_PAGE_SIZE : Math.max(1, Math.min(SEARCH_MAX_PAGE_SIZE, Math.trunc(q.limit)));
    const offset = offsetFrom(q.cursor);
    const where = `bookmarks_fts MATCH ? AND ${w.sql.join(' AND ')}`;
    const params = [match, ...w.params];

    // Fase 1: solo ids ordenados por relevancia (+ total con una ventana): no calcula resaltados para todo lo que coincide.
    const ranked = db.all<{ id: number; total: number }>(
      `SELECT id, COUNT(*) OVER () AS total FROM (
         SELECT b.id, b.created_at, bm25(bookmarks_fts, 10.0, 4.0, 1.0) AS score
           FROM bookmarks_fts JOIN bookmarks b ON b.id = bookmarks_fts.rowid
          WHERE ${where})
        ORDER BY score, created_at DESC, id DESC
        LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    );
    const total = ranked.length
      ? ranked[0]!.total
      : db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM bookmarks_fts JOIN bookmarks b ON b.id = bookmarks_fts.rowid WHERE ${where}`, ...params)!.n;
    if (ranked.length === 0) return { items: [], nextCursor: null, total };

    // Fase 2: highlight()/snippet() solo para la página. Exigen el MATCH en el mismo cursor FTS; `+rowid` evita que
    // SQLite busque fila a fila (con prefijos cada búsqueda re-expande el término: ~25× más lento) y recorre las
    // coincidencias una sola vez, calculando el resaltado solo para los ids de la página.
    const pageIds = idsParam(ranked.map((r) => r.id));
    const marks = new Map(
      db
        .all<{ id: number; title_hl: string | null; description_hl: string | null; excerpt_hl: string | null }>(
          `SELECT rowid AS id,
                  highlight(bookmarks_fts, 0, char(2), char(3)) AS title_hl,
                  snippet(bookmarks_fts, 1, char(2), char(3), '…', ${SNIPPET_TOKENS}) AS description_hl,
                  snippet(bookmarks_fts, 2, char(2), char(3), '…', ${SNIPPET_TOKENS}) AS excerpt_hl
             FROM bookmarks_fts
            WHERE bookmarks_fts MATCH ? AND +rowid ${IDS_IN}`,
          match, pageIds,
        )
        .map((r) => [r.id, r]),
    );
    // Fase 3: columnas del enlace (otra vez filtradas por user_id).
    const byId = new Map(
      db
        .all<BookmarkRow>(`SELECT ${BOOKMARK_COLUMNS} FROM bookmarks b ${BOOKMARK_JOINS} WHERE b.user_id = ? AND b.id ${IDS_IN}`, userId, pageIds)
        .map((r) => [r.id, r]),
    );
    const rows = ranked
      .map((r) => byId.get(r.id))
      .filter((r): r is BookmarkRow => r !== undefined)
      .map((r) => ({ ...r, title_hl: marks.get(r.id)?.title_hl ?? null, description_hl: marks.get(r.id)?.description_hl ?? null, excerpt_hl: marks.get(r.id)?.excerpt_hl ?? null }));
    const bookmarks = hydrate(db, userId, rows);
    const next = offset + ranked.length;
    return {
      items: rows.map((r, i) => ({
        bookmark: bookmarks[i]!,
        titleMarked: r.title_hl ?? r.title,
        excerptMarked: r.excerpt_hl ?? '',
        descriptionMarked: r.description_hl ?? '',
      })),
      nextCursor: next < total && next <= MAX_OFFSET ? encodeCursor('offset', next) : null,
      total,
    };
  }

  function search(userId: number, q: SearchQuery): Page<SearchHit> {
    const page = searchRaw(userId, q);
    return {
      ...page,
      items: page.items.map((h) => ({
        bookmark: h.bookmark,
        titleHtml: highlightToHtml(h.titleMarked),
        excerptHtml: highlightToHtml(h.excerptMarked),
        descriptionHtml: highlightToHtml(h.descriptionMarked),
      })),
    };
  }

  return { search, searchRaw };
}
