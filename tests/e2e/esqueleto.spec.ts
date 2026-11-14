// Esqueleto que camina (Ola 0): entrar → guardar → ver en Biblioteca → buscar.
import { test, expect } from './fixtures/test.ts';

test('entrar, guardar, listar y buscar @movil @sin-js', async ({ signedIn: page }) => {
  await page.getByRole('link', { name: 'Guardar enlace' }).click();
  await page.getByLabel('URL').fill('https://example.com/pan-de-masa-madre');
  await page.getByLabel('Título').fill('Pan de masa madre');
  await page.getByLabel('Etiquetas').fill('cocina, pan');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();

  await expect(page).toHaveURL('/');
  await expect(page.locator('#flash')).toContainText('Enlace guardado');
  await expect(page.getByRole('link', { name: 'Pan de masa madre' }).first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole('link', { name: 'Pan de masa madre' }).first()).toBeVisible();

  await page.goto('/buscar?q=masa');
  await expect(page.locator('mark').first()).toHaveText(/masa/i);
});
