// POST /enlaces/lote — acciones sobre varios enlaces seleccionados en la Biblioteca (PRG a `volver` con flash).
// Campos: ids (repetible), accion = etiquetar | quitar-etiqueta | mover | favorito | quitar-favorito | papelera,
// etiqueta, coleccion ('' = Sin colección, 'nueva:<nombre>' = crear), coleccion_nueva (texto libre, gana sobre coleccion), volver.
import type { APIRoute } from 'astro';
import { bookmarkService } from '../../server/services/bookmarks.ts';
import { collectionService } from '../../server/services/collections.ts';
import { tagService } from '../../server/services/tags.ts';
import { formString, safeReturnPath, seeOther, setFlash, type Flash } from '../../server/http.ts';
import { parseId } from '../../domain/authz.ts';
import { parseIds } from '../../components/library/ids.ts';
import { isValidationError } from '../../domain/errors.ts';
import { collectionKey } from '../../domain/bookmark-rules.ts';
import { validateTagName } from '../../domain/tags.ts';
import type { Bookmark, BulkAction } from '../../server/contracts.ts';
import { plural } from '../../components/library/library-url.ts';

const ACCIONES = new Set(['etiquetar', 'quitar-etiqueta', 'mover', 'favorito', 'quitar-favorito', 'papelera']);

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const { app, user } = locals;
  const userId = user!.id;
  const form = await request.clone().formData();
  const volver = safeReturnPath(formString(form, 'volver', 1000), '/');
  const accion = formString(form, 'accion', 30);
  const ids = parseIds(form.getAll('ids'));

  const finish = (flash: Flash) => {
    setFlash(cookies, app.config, flash);
    return seeOther(volver);
  };
  const fail = (message: string) => finish({ kind: 'error', message });

  if (ids.length === 0) return fail('Selecciona al menos un enlace');
  if (!ACCIONES.has(accion)) return fail('Elige una acción para los enlaces seleccionados.');

  const bookmarks = bookmarkService(app);
  const owned = (): Bookmark[] => ids.map((id) => bookmarks.get(userId, id)).filter((b): b is Bookmark => b !== null);
  const enlaces = (n: number) => plural(n, 'enlace', 'enlaces');

  try {
    switch (accion) {
      case 'etiquetar': {
        const tag = validateTagName(formString(form, 'etiqueta', 200), 'tag');
        const changed = bookmarks.bulk(userId, ids, { kind: 'add-tag', tag: tag.name });
        const n = changed || owned().filter((b) => !b.trashedAt && b.tags.some((t) => t.name.toLocaleLowerCase('es') === tag.key)).length;
        if (n === 0) return fail('No se pudo añadir la etiqueta: los enlaces ya no están disponibles.');
        return finish({ kind: 'success', message: `Etiqueta «${tag.name}» añadida a ${enlaces(n)}.` });
      }
      case 'quitar-etiqueta': {
        const tag = validateTagName(formString(form, 'etiqueta', 200), 'tag');
        const found = tagService(app).list(userId).find((t) => t.key === tag.key);
        if (!found) return fail(`No tienes ninguna etiqueta «${tag.name}».`);
        const n = bookmarks.bulk(userId, ids, { kind: 'remove-tag', tagId: found.id });
        if (n === 0) return finish({ kind: 'info', message: `Los enlaces seleccionados no tenían la etiqueta «${found.name}».` });
        return finish({ kind: 'success', message: `Etiqueta «${found.name}» quitada de ${enlaces(n)}.` });
      }
      case 'mover': {
        const typed = formString(form, 'coleccion_nueva', 200).trim();
        const raw = formString(form, 'coleccion', 200);
        let action: BulkAction;
        let name = 'Sin colección';
        let targetId: number | null = null;
        if (typed || raw.startsWith('nueva:')) {
          const newName = typed || raw.slice('nueva:'.length);
          action = { kind: 'move-new', collectionName: newName };
        } else if (raw === '__elegir') {
          return fail('Elige una colección de destino.');
        } else if (raw === '') {
          action = { kind: 'move', collectionId: null };
        } else {
          targetId = parseId(raw);
          const col = targetId === null ? undefined : collectionService(app).list(userId).find((c) => c.id === targetId);
          if (!col) return fail('Esa colección no existe.');
          name = col.name;
          action = { kind: 'move', collectionId: col.id };
        }
        const changed = bookmarks.bulk(userId, ids, action);
        let n = changed;
        if (action.kind === 'move-new') {
          const col = collectionService(app).list(userId).find((c) => collectionKey(c.name) === collectionKey(action.collectionName));
          name = col?.name ?? action.collectionName;
          targetId = col?.id ?? null;
        }
        if (n === 0) n = owned().filter((b) => !b.trashedAt && (b.collection?.id ?? null) === targetId).length;
        if (n === 0) return fail('No se pudo mover: los enlaces ya no están disponibles.');
        return finish({ kind: 'success', message: `${enlaces(n)} ${n === 1 ? 'movido' : 'movidos'} a ${name}.` });
      }
      case 'favorito':
      case 'quitar-favorito': {
        const value = accion === 'favorito';
        const n = bookmarks.bulk(userId, ids, { kind: 'favorite', value }) || owned().filter((b) => !b.trashedAt && b.isFavorite === value).length;
        if (n === 0) return fail('No se pudo actualizar: los enlaces ya no están disponibles.');
        return finish({
          kind: 'success',
          message: value ? `${enlaces(n)} ${n === 1 ? 'marcado' : 'marcados'} como ${n === 1 ? 'favorito' : 'favoritos'}.` : `${enlaces(n)} ${n === 1 ? 'quitado' : 'quitados'} de favoritos.`,
        });
      }
      case 'papelera': {
        const active = owned().filter((b) => !b.trashedAt).map((b) => b.id);
        const changed = bookmarks.bulk(userId, ids, { kind: 'trash' });
        // Un doble envío no cambia nada la segunda vez: el aviso sigue describiendo lo que quedó en la papelera.
        const undo = changed > 0 ? active : owned().filter((b) => b.trashedAt).map((b) => b.id);
        const n = changed || undo.length;
        if (n === 0) return fail('No se pudo mover a la papelera: los enlaces ya no están disponibles.');
        return finish({
          kind: 'success',
          message: `${enlaces(n)} ${n === 1 ? 'movido' : 'movidos'} a la papelera.`,
          action: { label: 'Deshacer', post: '/enlaces/restaurar-lote', fields: { ids: undo.join(','), volver } },
        });
      }
    }
  } catch (err) {
    if (isValidationError(err)) return fail(err.message);
    throw err;
  }
  return fail('Elige una acción para los enlaces seleccionados.');
};
