// Colecciones y etiquetas: creación idempotente por clave normalizada y comprobación de propiedad.
// Las usan los servicios de enlaces, colecciones y etiquetas. Todo filtra por user_id.
import type { Db } from '../db/sqlite.ts';
import type { CollectionRef, TagRef } from '../contracts.ts';
import { collectionKey, validateCollectionName } from '../../domain/bookmark-rules.ts';
import type { ParsedTag } from '../../domain/tags.ts';

/** Crea la colección si no existe (por name_key) y la devuelve. Valida el nombre (ValidationError field 'collection'). */
export function ensureCollection(db: Db, userId: number, rawName: string, now: number): CollectionRef {
  const name = validateCollectionName(rawName);
  const key = collectionKey(name);
  db.run(
    'INSERT OR IGNORE INTO collections (user_id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    userId, name, key, now, now,
  );
  return db.get<CollectionRef>('SELECT id, name FROM collections WHERE user_id = ? AND name_key = ?', userId, key)!;
}

export function findCollection(db: Db, userId: number, id: number): CollectionRef | null {
  if (!Number.isSafeInteger(id)) return null;
  return db.get<CollectionRef>('SELECT id, name FROM collections WHERE user_id = ? AND id = ?', userId, id) ?? null;
}

/** Crea (si hace falta) las etiquetas y devuelve sus ids, en el orden recibido. Conserva el nombre existente. */
export function ensureTags(db: Db, userId: number, tags: readonly ParsedTag[], now: number): TagRef[] {
  const out: TagRef[] = [];
  for (const t of tags) {
    db.run('INSERT OR IGNORE INTO tags (user_id, name, name_key, created_at) VALUES (?, ?, ?, ?)', userId, t.name, t.key, now);
    out.push(db.get<TagRef>('SELECT id, name FROM tags WHERE user_id = ? AND name_key = ?', userId, t.key)!);
  }
  return out;
}

/** Enlaza etiquetas a un enlace (idempotente). El enlace debe ser del usuario: la FK compuesta lo garantiza. */
export function linkTags(db: Db, userId: number, bookmarkId: number, tagIds: readonly number[]): number {
  let added = 0;
  for (const tagId of tagIds) {
    added += db.run('INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id, user_id) VALUES (?, ?, ?)', bookmarkId, tagId, userId).changes;
  }
  return added;
}
