// Permisos: bob no puede ver ni cambiar enlaces de alice (404 o sin cambios).
import { test, expect, createOwner, login, e2eDb } from '../fixtures/test.ts';
import { seedMany } from './helpers.ts';

test('bob sobre los enlaces de alice', async ({ page, request }) => {
  const alice = await createOwner('alice');
  const bob = await createOwner('bob');
  const [b] = seedMany(alice, 1, 'Privado');
  await login(page, bob);
  const id = b!.id;
  for (const path of [`/enlaces/${id}`, `/enlaces/${id}/eliminar`]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
  }
  await page.goto('/');
  const csrf = (await page.locator('meta[name="csrf-token"]').getAttribute('content'))!;
  const post = (path: string, data: Record<string, string>) =>
    page.request.post(path, { form: { _csrf: csrf, ...data }, maxRedirects: 0 });
  for (const path of [`/enlaces/${id}/papelera`, `/enlaces/${id}/restaurar`, `/enlaces/${id}/reintentar`]) {
    const res = await post(path, { value: '1' });
    expect(res.status(), path).toBe(404);
  }
  expect((await post(`/enlaces/${id}`, { title: 'Hackeado' })).status()).toBe(404);
  const lote = await post('/enlaces/lote', { ids: String(id), accion: 'papelera', volver: '/' });
  expect(lote.status()).toBe(303);
  const row = e2eDb().get<{ title: string; trashed_at: number | null; is_favorite: number }>('SELECT title, trashed_at, is_favorite FROM bookmarks WHERE id = ?', id)!;
  expect(row).toEqual({ title: 'Privado 1', trashed_at: null, is_favorite: 0 });
  void request;
});
