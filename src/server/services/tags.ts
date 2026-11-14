// Etiquetas: listado con conteos (enlaces fuera de la papelera), renombrar con detección de conflicto y borrar.
import type { App } from '../context.ts';
import type { TagRef, TagService, TagSummary } from '../contracts.ts';
import { parseTags } from '../../domain/tags.ts';
import { ValidationError } from '../../domain/errors.ts';

export function tagService(app: App): TagService {
  const db = app.db;

  function list(userId: number): TagSummary[] {
    // Conteo por el índice (tag_id, bookmark_id) restando los de la papelera (índice cubriente bookmarks_library):
    // así no se lee la fila del enlace, cuyo trashed_at queda detrás del excerpt (páginas de desbordamiento).
    return db.all<TagSummary>(
      `SELECT t.id, t.name, t.name_key AS key,
              (SELECT COUNT(*) FROM bookmark_tags bt
                WHERE bt.tag_id = t.id
                  AND bt.bookmark_id NOT IN (SELECT id FROM bookmarks WHERE user_id = ? AND trashed_at IS NOT NULL)) AS count
         FROM tags t
        WHERE t.user_id = ?
        ORDER BY t.name COLLATE NOCASE, t.id`,
      userId, userId,
    );
  }

  function rename(userId: number, id: number, rawName: string): TagRef | null {
    if (!Number.isSafeInteger(id)) return null;
    let parsed;
    try {
      parsed = parseTags(rawName); // una cadena: una coma separaría etiquetas
    } catch (err) {
      if (err instanceof ValidationError) throw new ValidationError('name', err.message);
      throw err;
    }
    const tag = parsed[0];
    if (!tag) throw new ValidationError('name', 'Escribe un nombre para la etiqueta.');
    if (parsed.length > 1) throw new ValidationError('name', 'El nombre de una etiqueta no puede llevar comas.');
    return db.transaction(() => {
      if (!db.get('SELECT 1 FROM tags WHERE user_id = ? AND id = ?', userId, id)) return null;
      if (db.get('SELECT 1 FROM tags WHERE user_id = ? AND name_key = ? AND id <> ?', userId, tag.key, id)) {
        throw new ValidationError('name', 'Ya tienes una etiqueta con ese nombre.');
      }
      db.run('UPDATE tags SET name = ?, name_key = ? WHERE user_id = ? AND id = ?', tag.name, tag.key, userId, id);
      return { id, name: tag.name };
    });
  }

  function remove(userId: number, id: number): boolean {
    if (!Number.isSafeInteger(id)) return false;
    // bookmark_tags cae en CASCADE por la FK compuesta (tag_id, user_id).
    return db.run('DELETE FROM tags WHERE user_id = ? AND id = ?', userId, id).changes > 0;
  }

  return { list, rename, remove };
}
