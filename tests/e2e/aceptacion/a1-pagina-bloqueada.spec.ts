// A1: una página que bloquea el fetch (403) se guarda igual con título propio, y ese título sobrevive al reintento.
import { test, expect, SITE_URL, e2eApp } from '../fixtures/test.ts';
import { bookmarkService } from '../../../src/server/services/bookmarks.ts';
import { rowsOf } from '../guardar/helpers.ts';

test('A1: página bloqueada → se guarda con título propio y el título editado sobrevive al reintento', async ({ signedIn: page, owner }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill(`${SITE_URL}/bloqueado`);
  await page.getByRole('button', { name: 'Obtener datos' }).click();
  await expect(page.getByText('No se pudo leer la página', { exact: true })).toBeVisible();
  await page.getByLabel('Título', { exact: true }).fill('Mi apunte sobre la página bloqueada');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.locator('#flash')).toContainText('Enlace guardado');
  await expect(page.getByRole('link', { name: 'Mi apunte sobre la página bloqueada' })).toBeVisible();

  const [row] = rowsOf(owner);
  expect(row).toMatchObject({ title: 'Mi apunte sobre la página bloqueada', title_source: 'user' });

  // El worker intenta leer la página, recibe 403 (fallo terminal) y deja el enlace en "failed".
  await expect.poll(() => rowsOf(owner)[0]!.fetch_status, { timeout: 15_000 }).toBe('failed');
  expect(rowsOf(owner)[0]!.title).toBe('Mi apunte sobre la página bloqueada');

  // Reintentar (lo que hará el botón de la Biblioteca): vuelve a cola y, al fallar de nuevo, el título sigue siendo el tuyo.
  const retried = bookmarkService(e2eApp()).requestRefetch(owner.id, row!.id);
  expect(retried).not.toBeNull();
  await expect.poll(() => rowsOf(owner)[0]!.fetch_status, { timeout: 15_000 }).toBe('failed');
  expect(rowsOf(owner)[0]).toMatchObject({ title: 'Mi apunte sobre la página bloqueada', title_source: 'user' });
});
