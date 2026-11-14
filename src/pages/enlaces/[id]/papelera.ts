// POST /enlaces/:id/papelera — mueve un enlace a la papelera (PRG con flash y "Deshacer").
import type { APIRoute } from 'astro';
import { bookmarkService } from '../../../server/services/bookmarks.ts';
import { formString, safeReturnPath, seeOther, setFlash } from '../../../server/http.ts';
import { parseId } from '../../../domain/authz.ts';

export const POST: APIRoute = async ({ params, request, locals, cookies, rewrite }) => {
  const { app, user } = locals;
  const id = parseId(params.id);
  const form = await request.clone().formData();
  const volver = safeReturnPath(formString(form, 'volver', 1000), '/');
  const svc = bookmarkService(app);
  const bookmark = id === null ? null : svc.get(user!.id, id);
  if (id === null || !bookmark) return rewrite('/404');
  svc.trash(user!.id, [id]);
  setFlash(cookies, app.config, {
    kind: 'success',
    message: `«${bookmark.title.slice(0, 80)}» se movió a la papelera.`,
    action: { label: 'Deshacer', post: `/enlaces/${id}/restaurar`, fields: { volver } },
  });
  return seeOther(volver);
};
