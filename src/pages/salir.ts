// Salir: revoca la sesión actual, la audita y borra la cookie. Solo POST (con origen y CSRF validados por el middleware).
import type { APIRoute } from 'astro';
import { clearSessionCookie } from '../server/auth/sessions.ts';
import { logout } from '../server/auth/account.ts';
import { seeOther } from '../server/http.ts';
import { clearDraftCookies } from '../server/security/draft.ts';

export const POST: APIRoute = ({ locals, cookies }) => {
  const { app, session, user, requestId } = locals;
  if (session && user) logout(app, user.id, session.id, requestId);
  clearSessionCookie(cookies, app.config);
  clearDraftCookies(cookies, app.config);
  return seeOther('/entrar');
};
