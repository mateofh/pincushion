// Salir: revoca la sesión actual y borra la cookie. Solo POST (con CSRF, lo valida el middleware).
import type { APIRoute } from 'astro';
import { revokeSession } from '../server/auth/sessions.ts';
import { cookieName, seeOther } from '../server/http.ts';

export const POST: APIRoute = ({ locals, cookies }) => {
  if (locals.session) revokeSession(locals.app, locals.session.id);
  cookies.delete(cookieName(locals.app.config, 'pc_session'), { path: '/' });
  return seeOther('/entrar');
};
