// P1: primer uso con cuenta vacía, sin tour: la Biblioteca explica qué hacer y lleva a guardar y a instalar el bookmarklet.
import { test, expect, createOwner, login } from '../fixtures/test.ts';

test('la Biblioteca vacía guía a guardar el primer enlace @movil', async ({ page }) => {
  await login(page, await createOwner('dana'));
  await expect(page.getByRole('heading', { level: 1, name: 'Biblioteca' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Guarda tu primer enlace' })).toBeVisible();
  await page.getByRole('link', { name: 'Pega una URL' }).click();
  await expect(page).toHaveURL('/guardar');
  await page.goBack();
  await page.getByRole('link', { name: 'Instala el bookmarklet' }).click();
  await expect(page).toHaveURL('/bookmarklet');
});
