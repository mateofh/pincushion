// GET /favicons/:dominio — sirve el favicon guardado del usuario actual. Es ruta "pública" para el middleware
// (prefijo /favicon), así que exige sesión aquí: sin sesión, ajeno o inexistente → 404 sin pistas.
// Nota: no existe aún un servicio de favicons; la consulta es de solo lectura y filtra por user_id.
import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ params, locals }) => {
  const { app, user } = locals;
  const domain = (params.domain ?? '').toLowerCase();
  if (!user || !domain || domain.length > 253 || !/^[a-z0-9.:_\-\[\]]+$/.test(domain)) return notFound();
  const row = app.db.get<{ content_type: string | null; bytes: Uint8Array | null }>(
    `SELECT content_type, bytes FROM favicons WHERE user_id = ? AND domain = ? AND status = 'succeeded'`,
    user.id, domain,
  );
  if (!row?.bytes || !row.content_type) return notFound();
  return new Response(row.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': row.content_type,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=86400',
    },
  });
};

function notFound(): Response {
  return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}
