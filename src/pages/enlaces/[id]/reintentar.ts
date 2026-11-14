// POST /enlaces/:id/reintentar — vuelve a pedir los metadatos de la página (el título editado por la persona no se pisa).
import type { APIRoute } from 'astro';
import { bookmarkService } from '../../../server/services/bookmarks.ts';
import { formString, safeReturnPath, seeOther, setFlash } from '../../../server/http.ts';
import { parseId } from '../../../domain/authz.ts';

export const POST: APIRoute = async ({ params, request, locals, cookies, rewrite }) => {
  const { app, user } = locals;
  const id = parseId(params.id);
  const form = await request.clone().formData();
  const volver = safeReturnPath(formString(form, 'volver', 1000), '/');
  const updated = id === null ? null : bookmarkService(app).requestRefetch(user!.id, id);
  if (id === null || !updated) return rewrite('/404');
  setFlash(cookies, app.config, { kind: 'success', message: 'Volveremos a leer la página en unos segundos.' });
  return seeOther(volver);
};
