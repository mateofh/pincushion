// POST /enlaces/restaurar-lote — "Deshacer" de un lote enviado a la papelera. ids = "1,2,3" (o repetido), volver.
import type { APIRoute } from 'astro';
import { bookmarkService } from '../../server/services/bookmarks.ts';
import { formString, safeReturnPath, seeOther, setFlash } from '../../server/http.ts';
import { plural } from '../../components/library/library-url.ts';
import { parseIds } from '../../components/library/ids.ts';

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const { app, user } = locals;
  const form = await request.clone().formData();
  const volver = safeReturnPath(formString(form, 'volver', 1000), '/');
  const ids = parseIds(form.getAll('ids'));
  if (ids.length === 0) {
    setFlash(cookies, app.config, { kind: 'error', message: 'No hay enlaces que restaurar.' });
    return seeOther(volver);
  }
  const n = bookmarkService(app).restore(user!.id, ids);
  setFlash(
    cookies,
    app.config,
    n > 0
      ? { kind: 'success', message: `${plural(n, 'enlace restaurado', 'enlaces restaurados')}.` }
      : { kind: 'info', message: 'Esos enlaces ya estaban restaurados.' },
  );
  return seeOther(volver);
};
