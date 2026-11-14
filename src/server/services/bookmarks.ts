// Servicio de enlaces: guardar/fusionar, editar, favorito, papelera, lote, reintentar metadatos y listado paginado.
// Todas las funciones reciben userId y filtran por él: un id ajeno se comporta igual que uno inexistente.
import type { App } from '../context.ts';
import type { Db } from '../db/sqlite.ts';
import type {
  Bookmark,
  BookmarkService,
  BulkAction,
  DuplicateInfo,
  LibraryQuery,
  Page,
  SaveInput,
  SaveOutcome,
  SaveSource,
  SortKey,
} from '../contracts.ts';
import { InvalidUrlError, domainOf, normalizeUrl, parseUserUrl } from '../../domain/url.ts';
import { LIMITS, cleanText, decodeCursor, encodeCursor, mergeOnDuplicate, type TitleSource } from '../../domain/bookmark-rules.ts';
import { parseTags } from '../../domain/tags.ts';
import { ValidationError } from '../../domain/errors.ts';
import { manualRetry } from '../../domain/fetch-state.ts';
import { BOOKMARK_COLUMNS, BOOKMARK_JOINS, IDS_IN, getBookmark, hydrate, idsParam, libraryFilters, loadTags, type BookmarkRow } from '../repos/bookmark-rows.ts';
import { ensureCollection, ensureTags, findCollection, linkTags } from '../repos/taxonomy.ts';
import { searchService } from './search.ts';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limit)));
}

/** Recorta a `max` sin partir un par sustituto. */
function truncate(v: string, max: number): string {
  if (v.length <= max) return v;
  let cut = v.slice(0, max);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return cut.trimEnd();
}

/** Limpia un campo de texto. `lenient` recorta en vez de lanzar ValidationError (bookmarklet, excerpt). */
function text(s: string, max: number, field: string, multiline: boolean, lenient: boolean): string {
  if (!lenient) return cleanText(s, max, field, multiline);
  return truncate(cleanText(s, Number.MAX_SAFE_INTEGER, field, multiline), max);
}

/** Una coma siempre separa etiquetas, también dentro de un elemento del array. */
function splitTags(tags: string[] | undefined): string[] {
  return (tags ?? []).flatMap((t) => (typeof t === 'string' ? t.split(',') : []));
}

interface ExistingRow {
  id: number;
  domain: string;
  title: string;
  title_source: TitleSource;
  description: string;
  excerpt: string;
  collection_id: number | null;
  is_favorite: number;
  trashed_at: number | null;
}

const EXISTING_COLUMNS = 'id, domain, title, title_source, description, excerpt, collection_id, is_favorite, trashed_at';

/** undefined = no tocar; null = "Sin colección"; número = colección del usuario. */
function resolveCollection(db: Db, userId: number, input: Pick<SaveInput, 'collectionId' | 'newCollectionName'>, now: number): number | null | undefined {
  if (input.newCollectionName !== undefined && input.newCollectionName.trim() !== '') {
    return ensureCollection(db, userId, input.newCollectionName, now).id;
  }
  if (input.collectionId === null) return null;
  if (input.collectionId === undefined) return undefined;
  if (!findCollection(db, userId, input.collectionId)) throw new ValidationError('collection', 'Esa colección no existe.');
  return input.collectionId;
}

/** UPDATE dinámico sobre un enlace del usuario. */
function applyUpdate(db: Db, userId: number, id: number, sets: Record<string, string | number | null>): void {
  const cols = Object.keys(sets);
  if (cols.length === 0) return;
  db.run(
    `UPDATE bookmarks SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND user_id = ?`,
    ...cols.map((c) => sets[c]!), id, userId,
  );
}

function excerptMax(app: App): number {
  return Math.min(app.config.EXCERPT_MAX_CHARS, LIMITS.excerpt);
}

// ---------- listado paginado por cursor ----------

interface SortSpec {
  col: string;
  dir: 'ASC' | 'DESC';
  type: 'number' | 'string';
  value: (r: BookmarkRow) => string | number;
}

const SORTS: Record<SortKey, SortSpec> = {
  recientes: { col: 'b.created_at', dir: 'DESC', type: 'number', value: (r) => r.created_at },
  antiguos: { col: 'b.created_at', dir: 'ASC', type: 'number', value: (r) => r.created_at },
  titulo: { col: 'b.title COLLATE NOCASE', dir: 'ASC', type: 'string', value: (r) => r.title },
  dominio: { col: 'b.domain', dir: 'ASC', type: 'string', value: (r) => r.domain },
};

function empty<T>(): Page<T> {
  return { items: [], nextCursor: null, total: 0 };
}

// ---------- fábrica ----------

export function bookmarkService(app: App): BookmarkService {
  const db = app.db;

  function save(userId: number, input: SaveInput, source: SaveSource): SaveOutcome {
    const u = parseUserUrl(input.url);
    const url = u.toString();
    const normalized = normalizeUrl(u);
    if (url.length > 2048 || normalized.length > 2048) throw new InvalidUrlError('La URL es demasiado larga');
    const domain = domainOf(u);
    const lenient = source === 'bookmarklet';
    const title = input.title === undefined ? undefined : text(input.title, LIMITS.title, 'title', false, lenient);
    const description = input.description === undefined ? undefined : text(input.description, LIMITS.description, 'description', true, lenient);
    const excerpt = input.excerpt === undefined ? undefined : text(input.excerpt, excerptMax(app), 'excerpt', true, true);
    const tags = parseTags(splitTags(input.tags));
    const now = app.clock.now();

    return db.transaction(() => {
      const collectionId = resolveCollection(db, userId, input, now);
      const tagRefs = ensureTags(db, userId, tags, now);
      const ex = db.get<ExistingRow>(`SELECT ${EXISTING_COLUMNS} FROM bookmarks WHERE user_id = ? AND normalized_url = ?`, userId, normalized);

      if (!ex) {
        const titleSource: TitleSource = title ? (source === 'web' ? 'user' : 'page') : 'fallback';
        const id = db.run(
          `INSERT INTO bookmarks (user_id, url, normalized_url, domain, title, title_source, description, excerpt,
                                  collection_id, is_favorite, fetch_status, next_attempt_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
          userId, url, normalized, domain, title || domain, titleSource, description ?? '', excerpt ?? '',
          collectionId ?? null, input.isFavorite ? 1 : 0, now, now, now,
        ).lastInsertRowid;
        linkTags(db, userId, id, tagRefs.map((t) => t.id));
        return { bookmark: getBookmark(db, userId, id)!, created: true, restored: false };
      }

      // Duplicado: fusiona (etiquetas = unión) según el origen.
      const sets: Record<string, string | number | null> = {};
      const merged = mergeOnDuplicate({ title: ex.title, titleSource: ex.title_source, description: ex.description }, { title, description }, source);
      if (merged.title !== undefined) sets.title = merged.title;
      if (merged.titleSource !== undefined) sets.title_source = merged.titleSource;
      if (merged.description !== undefined) sets.description = merged.description;
      let restored = false;
      if (source === 'web') {
        if (excerpt && excerpt !== ex.excerpt) sets.excerpt = excerpt;
        if (collectionId !== undefined && collectionId !== ex.collection_id) sets.collection_id = collectionId;
        if (input.isFavorite !== undefined && (input.isFavorite ? 1 : 0) !== ex.is_favorite) sets.is_favorite = input.isFavorite ? 1 : 0;
        if (ex.trashed_at !== null) {
          sets.trashed_at = null;
          restored = true;
        }
      } else {
        // El bookmarklet solo rellena huecos: nunca restaura, nunca quita favorito ni cambia de colección.
        if (!ex.excerpt && excerpt) sets.excerpt = excerpt;
        if (ex.collection_id === null && typeof collectionId === 'number') sets.collection_id = collectionId;
        if (input.isFavorite === true && ex.is_favorite === 0) sets.is_favorite = 1;
      }
      sets.updated_at = now;
      applyUpdate(db, userId, ex.id, sets);
      linkTags(db, userId, ex.id, tagRefs.map((t) => t.id));
      return { bookmark: getBookmark(db, userId, ex.id)!, created: false, restored };
    });
  }

  function findDuplicate(userId: number, rawUrl: string): DuplicateInfo | null {
    let normalized: string;
    try {
      normalized = normalizeUrl(parseUserUrl(rawUrl));
    } catch {
      return null;
    }
    const row = db.get<{ id: number; title: string; created_at: number; trashed_at: number | null; collection_id: number | null; collection_name: string | null }>(
      `SELECT b.id, b.title, b.created_at, b.trashed_at, b.collection_id, c.name AS collection_name
         FROM bookmarks b ${BOOKMARK_JOINS} WHERE b.user_id = ? AND b.normalized_url = ?`,
      userId, normalized,
    );
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      trashed: row.trashed_at !== null,
      tags: loadTags(db, userId, [row.id]).get(row.id) ?? [],
      collection: row.collection_id !== null && row.collection_name !== null ? { id: row.collection_id, name: row.collection_name } : null,
    };
  }

  function get(userId: number, id: number): Bookmark | null {
    return getBookmark(db, userId, id);
  }

  function update(userId: number, id: number, patch: Omit<SaveInput, 'url'>): Bookmark | null {
    if (!Number.isSafeInteger(id)) return null;
    const title = patch.title === undefined ? undefined : text(patch.title, LIMITS.title, 'title', false, false);
    const description = patch.description === undefined ? undefined : text(patch.description, LIMITS.description, 'description', true, false);
    const excerpt = patch.excerpt === undefined ? undefined : text(patch.excerpt, excerptMax(app), 'excerpt', true, true);
    const tags = patch.tags === undefined ? undefined : parseTags(splitTags(patch.tags));
    const now = app.clock.now();
    return db.transaction(() => {
      const ex = db.get<ExistingRow>(`SELECT ${EXISTING_COLUMNS} FROM bookmarks WHERE user_id = ? AND id = ?`, userId, id);
      if (!ex) return null;
      const sets: Record<string, string | number | null> = {};
      if (title !== undefined) {
        if (!title) {
          if (ex.title_source !== 'fallback' || ex.title !== ex.domain) Object.assign(sets, { title: ex.domain, title_source: 'fallback' });
        } else if (title !== ex.title) Object.assign(sets, { title, title_source: 'user' });
      }
      if (description !== undefined && description !== ex.description) sets.description = description;
      if (excerpt !== undefined && excerpt !== ex.excerpt) sets.excerpt = excerpt;
      const collectionId = resolveCollection(db, userId, patch, now);
      if (collectionId !== undefined && collectionId !== ex.collection_id) sets.collection_id = collectionId;
      if (patch.isFavorite !== undefined && (patch.isFavorite ? 1 : 0) !== ex.is_favorite) sets.is_favorite = patch.isFavorite ? 1 : 0;
      let tagsChanged = false;
      if (tags !== undefined) {
        const refs = ensureTags(db, userId, tags, now);
        const keep = idsParam(refs.map((t) => t.id));
        tagsChanged = db.run(`DELETE FROM bookmark_tags WHERE user_id = ? AND bookmark_id = ? AND tag_id NOT ${IDS_IN}`, userId, id, keep).changes > 0;
        tagsChanged = linkTags(db, userId, id, refs.map((t) => t.id)) > 0 || tagsChanged;
      }
      if (Object.keys(sets).length || tagsChanged) {
        sets.updated_at = now;
        applyUpdate(db, userId, id, sets);
      }
      return getBookmark(db, userId, id);
    });
  }

  function setFavorite(userId: number, id: number, value: boolean): Bookmark | null {
    if (!Number.isSafeInteger(id)) return null;
    db.run('UPDATE bookmarks SET is_favorite = ?, updated_at = ? WHERE user_id = ? AND id = ? AND is_favorite <> ?', value ? 1 : 0, app.clock.now(), userId, id, value ? 1 : 0);
    return getBookmark(db, userId, id);
  }

  function trash(userId: number, ids: number[]): number {
    const now = app.clock.now();
    return db.run(`UPDATE bookmarks SET trashed_at = ?, updated_at = ? WHERE user_id = ? AND trashed_at IS NULL AND id ${IDS_IN}`, now, now, userId, idsParam(ids)).changes;
  }

  function restore(userId: number, ids: number[]): number {
    return db.run(`UPDATE bookmarks SET trashed_at = NULL, updated_at = ? WHERE user_id = ? AND trashed_at IS NOT NULL AND id ${IDS_IN}`, app.clock.now(), userId, idsParam(ids)).changes;
  }

  function purge(userId: number, ids: number[]): number {
    return db.transaction(() => db.run(`DELETE FROM bookmarks WHERE user_id = ? AND trashed_at IS NOT NULL AND id ${IDS_IN}`, userId, idsParam(ids)).changes);
  }

  function emptyTrash(userId: number): number {
    return db.transaction(() => db.run('DELETE FROM bookmarks WHERE user_id = ? AND trashed_at IS NOT NULL', userId).changes);
  }

  function list(userId: number, q: LibraryQuery): Page<Bookmark> {
    const sort = SORTS[q.sort ?? 'recientes'] ?? SORTS.recientes;
    const limit = clampLimit(q.limit);
    const w = libraryFilters(db, userId, q);
    if (!w) return empty();
    const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM bookmarks b WHERE ${w.sql.join(' AND ')}`, ...w.params)!.n;
    const where = [...w.sql];
    const params = [...w.params];
    const cur = decodeCursor(q.cursor);
    if (cur && typeof cur.sortValue === sort.type) {
      where.push(`(${sort.col}, b.id) ${sort.dir === 'DESC' ? '<' : '>'} (?, ?)`);
      params.push(cur.sortValue, cur.id);
    }
    const rows = db.all<BookmarkRow>(
      `SELECT ${BOOKMARK_COLUMNS} FROM bookmarks b ${BOOKMARK_JOINS}
        WHERE ${where.join(' AND ')}
        ORDER BY ${sort.col} ${sort.dir}, b.id ${sort.dir}
        LIMIT ?`,
      ...params, limit + 1,
    );
    const more = rows.length > limit;
    const pageRows = more ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    return {
      items: hydrate(db, userId, pageRows),
      nextCursor: more && last ? encodeCursor(sort.value(last), last.id) : null,
      total,
    };
  }

  function listTrash(userId: number, cursor?: string): Page<Bookmark> {
    const limit = DEFAULT_PAGE_SIZE;
    const total = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ? AND trashed_at IS NOT NULL', userId)!.n;
    const where = ['b.user_id = ?', 'b.trashed_at IS NOT NULL'];
    const params: (string | number)[] = [userId];
    const cur = decodeCursor(cursor);
    if (cur && typeof cur.sortValue === 'number') {
      where.push('(b.trashed_at, b.id) < (?, ?)');
      params.push(cur.sortValue, cur.id);
    }
    const rows = db.all<BookmarkRow>(
      `SELECT ${BOOKMARK_COLUMNS} FROM bookmarks b ${BOOKMARK_JOINS}
        WHERE ${where.join(' AND ')} ORDER BY b.trashed_at DESC, b.id DESC LIMIT ?`,
      ...params, limit + 1,
    );
    const more = rows.length > limit;
    const pageRows = more ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    return {
      items: hydrate(db, userId, pageRows),
      nextCursor: more && last ? encodeCursor(last.trashed_at!, last.id) : null,
      total,
    };
  }

  function bulk(userId: number, ids: number[], action: BulkAction): number {
    const idList = idsParam(ids);
    if (idList === '[]') return 0;
    const now = app.clock.now();
    const active = `user_id = ? AND trashed_at IS NULL AND id ${IDS_IN}`;
    return db.transaction(() => {
      switch (action.kind) {
        case 'add-tag': {
          let parsed;
          try {
            parsed = parseTags(action.tag);
          } catch (err) {
            if (err instanceof ValidationError) throw new ValidationError('tag', err.message);
            throw err;
          }
          if (parsed.length === 0) throw new ValidationError('tag', 'Escribe una etiqueta.');
          if (parsed.length > 1) throw new ValidationError('tag', 'Añade una sola etiqueta (sin comas).');
          const [tag] = ensureTags(db, userId, parsed, now);
          return db.run(
            `INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id, user_id)
             SELECT id, ?, user_id FROM bookmarks WHERE ${active}`,
            tag!.id, userId, idList,
          ).changes;
        }
        case 'remove-tag':
          if (!Number.isSafeInteger(action.tagId)) return 0;
          return db.run(
            `DELETE FROM bookmark_tags WHERE user_id = ? AND tag_id = ?
               AND bookmark_id IN (SELECT id FROM bookmarks WHERE ${active})`,
            userId, action.tagId, userId, idList,
          ).changes;
        case 'move':
        case 'move-new': {
          let target: number | null;
          if (action.kind === 'move-new') target = ensureCollection(db, userId, action.collectionName, now).id;
          else if (action.collectionId === null) target = null;
          else {
            if (!findCollection(db, userId, action.collectionId)) return 0; // colección ajena o inexistente: se ignora
            target = action.collectionId;
          }
          return db.run(`UPDATE bookmarks SET collection_id = ?, updated_at = ? WHERE ${active} AND collection_id IS NOT ?`, target, now, userId, idList, target).changes;
        }
        case 'favorite': {
          const v = action.value ? 1 : 0;
          return db.run(`UPDATE bookmarks SET is_favorite = ?, updated_at = ? WHERE ${active} AND is_favorite <> ?`, v, now, userId, idList, v).changes;
        }
        case 'trash':
          return db.run(`UPDATE bookmarks SET trashed_at = ?, updated_at = ? WHERE ${active}`, now, now, userId, idList).changes;
        default:
          return 0;
      }
    });
  }

  function requestRefetch(userId: number, id: number): Bookmark | null {
    if (!Number.isSafeInteger(id)) return null;
    const s = manualRetry(app.clock.now());
    db.run(
      `UPDATE bookmarks SET fetch_status = ?, fetch_attempts = ?, next_attempt_at = ?, fetch_error_code = ?, lease_until = NULL, updated_at = ?
        WHERE user_id = ? AND id = ?`,
      s.status, s.attempts, s.nextAttemptAt, s.errorCode, app.clock.now(), userId, id,
    );
    return getBookmark(db, userId, id);
  }

  return { save, findDuplicate, get, update, setFavorite, trash, restore, purge, emptyTrash, list, listTrash, bulk, requestRefetch };
}

// ---------- Envoltorios de Ola 0 (los usan las páginas esqueleto; se retiran en Ola 2) ----------

/** Forma de fila que consumen las páginas de Ola 0. */
export interface LegacyBookmarkRow {
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

export interface LegacySaveInput {
  url: string;
  title?: string;
  description?: string;
  tags?: string[];
}

function toLegacy(b: Bookmark): LegacyBookmarkRow {
  return {
    id: b.id,
    url: b.url,
    domain: b.domain,
    title: b.title,
    description: b.description,
    excerpt: b.excerpt,
    is_favorite: b.isFavorite ? 1 : 0,
    fetch_status: b.fetchStatus,
    created_at: b.createdAt,
  };
}

/** @deprecated Usa bookmarkService(app).save. */
export function saveBookmark(app: App, userId: number, input: LegacySaveInput): { id: number; created: boolean } {
  const r = bookmarkService(app).save(
    userId,
    {
      url: input.url,
      title: input.title === undefined ? undefined : input.title.slice(0, LIMITS.title),
      description: input.description === undefined ? undefined : input.description.slice(0, LIMITS.description),
      tags: input.tags?.map((t) => t.trim().slice(0, 40)),
    },
    'web',
  );
  return { id: r.bookmark.id, created: r.created };
}

/** @deprecated Usa bookmarkService(app).list. */
export function listBookmarks(app: App, userId: number, limit = DEFAULT_PAGE_SIZE): LegacyBookmarkRow[] {
  return bookmarkService(app).list(userId, { limit }).items.map(toLegacy);
}

/** @deprecated Usa searchService(app).search. Devuelve el texto con centinelas \u0002/\u0003 (para highlightToHtml). */
export function searchBookmarks(app: App, userId: number, q: string, limit = DEFAULT_PAGE_SIZE): (LegacyBookmarkRow & { title_hl: string; excerpt_hl: string })[] {
  if (q.length > 200) return [];
  return searchService(app)
    .searchRaw(userId, { q, limit })
    .items.map((h) => ({ ...toLegacy(h.bookmark), title_hl: h.titleMarked, excerpt_hl: h.excerptMarked }));
}
