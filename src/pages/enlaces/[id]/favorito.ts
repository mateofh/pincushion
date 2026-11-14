// POST /enlaces/:id/favorito — marca o quita de favoritos con valor explícito (idempotente).
// Sin JS: PRG a `volver` con confirmación. Con HTMX: el cliente sigue la redirección y selecciona el enlace actualizado.
import type { APIRoute } from 'astro';
import { bookmarkService } from '../../../server/services/bookmarks.ts';
import { formString, safeReturnPath, seeOther, setFlash } from '../../../server/http.ts';
import { parseId } from '../../../domain/authz.ts';

export const POST: APIRoute = async ({ params, request, locals, cookies, rewrite }) => {
  const { app, user } = locals;
  const id = parseId(params.id);
  const form = await request.formData();
  const volver = safeReturnPath(formString(form, 'volver', 1000), '/');
  const raw = formString(form, 'value', 1);
  if (id === null || (raw !== '0' && raw !== '1')) return rewrite('/404');
  const value = raw === '1';
  const updated = bookmarkService(app).setFavorite(user!.id, id, value);
  if (!updated) return rewrite('/404');
  setFlash(cookies, app.config, {
    kind: 'success',
    message: value ? `«${updated.title.slice(0, 80)}» está en Favoritos.` : `«${updated.title.slice(0, 80)}» ya no está en Favoritos.`,
  });
  return seeOther(volver);
};
