// Colecciones: listado con conteos, creación idempotente, renombrar, borrar (enlaces a "Sin colección") y conteos globales.
// Los conteos cuentan solo enlaces fuera de la papelera.
import type { App } from '../context.ts';
import type { CollectionRef, CollectionService, CollectionSummary } from '../contracts.ts';
import { collectionKey, validateCollectionName } from '../../domain/bookmark-rules.ts';
import { ValidationError } from '../../domain/errors.ts';
import { ensureCollection } from '../repos/taxonomy.ts';

/** Reetiqueta el campo de un ValidationError (los formularios de colecciones usan `name`). */
function asField<T>(field: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof ValidationError) throw new ValidationError(field, err.message);
    throw err;
  }
}

// Ids en la papelera vía el índice cubriente bookmarks_library: evita leer filas enteras (trashed_at está detrás del
// excerpt, en páginas de desbordamiento) al contar.
const TRASHED_IDS = 'SELECT id FROM bookmarks WHERE user_id = ? AND trashed_at IS NOT NULL';
const TRASHED_IDS_P1 = 'SELECT id FROM bookmarks WHERE user_id = ?1 AND trashed_at IS NOT NULL';

export function collectionService(app: App): CollectionService {
  const db = app.db;

  function list(userId: number): CollectionSummary[] {
    return db.all<CollectionSummary>(
      `SELECT c.id, c.name,
              (SELECT COUNT(*) FROM bookmarks b
                WHERE b.user_id = c.user_id AND b.collection_id = c.id AND b.id NOT IN (${TRASHED_IDS})) AS count
         FROM collections c
        WHERE c.user_id = ?
        ORDER BY c.name COLLATE NOCASE, c.id`,
      userId, userId,
    );
  }

  function create(userId: number, name: string): CollectionRef {
    return asField('name', () => db.transaction(() => ensureCollection(db, userId, name, app.clock.now())));
  }

  function rename(userId: number, id: number, rawName: string): CollectionRef | null {
    if (!Number.isSafeInteger(id)) return null;
    const name = asField('name', () => validateCollectionName(rawName));
    const key = collectionKey(name);
    return db.transaction(() => {
      const current = db.get<{ id: number }>('SELECT id FROM collections WHERE user_id = ? AND id = ?', userId, id);
      if (!current) return null;
      const clash = db.get<{ id: number }>('SELECT id FROM collections WHERE user_id = ? AND name_key = ? AND id <> ?', userId, key, id);
      if (clash) throw new ValidationError('name', 'Ya tienes una colección con ese nombre.');
      db.run('UPDATE collections SET name = ?, name_key = ?, updated_at = ? WHERE user_id = ? AND id = ?', name, key, app.clock.now(), userId, id);
      return { id, name };
    });
  }

  function remove(userId: number, id: number): number | null {
    if (!Number.isSafeInteger(id)) return null;
    return db.transaction(() => {
      if (!db.get('SELECT 1 FROM collections WHERE user_id = ? AND id = ?', userId, id)) return null;
      // Se mueven también los de la papelera (la FK lo exige); se devuelve el total movido.
      const moved = db.run('UPDATE bookmarks SET collection_id = NULL, updated_at = ? WHERE user_id = ? AND collection_id = ?', app.clock.now(), userId, id).changes;
      db.run('DELETE FROM collections WHERE user_id = ? AND id = ?', userId, id);
      return moved;
    });
  }

  function counts(userId: number): { all: number; favorites: number; unsorted: number; trash: number } {
    const r = db.get<{ all: number; favorites: number; unsorted: number; trash: number }>(
      `SELECT (SELECT COUNT(*) FROM bookmarks WHERE user_id = ?1 AND trashed_at IS NULL) AS "all",
              (SELECT COUNT(*) FROM bookmarks WHERE user_id = ?1 AND is_favorite = 1 AND id NOT IN (${TRASHED_IDS_P1})) AS favorites,
              (SELECT COUNT(*) FROM bookmarks WHERE user_id = ?1 AND collection_id IS NULL AND id NOT IN (${TRASHED_IDS_P1})) AS unsorted,
              (SELECT COUNT(*) FROM bookmarks WHERE user_id = ?1 AND trashed_at IS NOT NULL) AS trash`,
      userId,
    )!;
    return { all: r.all, favorites: r.favorites, unsorted: r.unsorted, trash: r.trash };
  }

  return { list, create, rename, remove, counts };
}
