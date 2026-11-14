// D1: el mismo usuario en un teléfono (Pixel 7) y en un escritorio: lo guardado en uno aparece en el otro tras recargar.
import { test, expect, login, APP_URL, SITE_URL } from '../fixtures/test.ts';
import { devices } from '@playwright/test';
import { rowsOf } from '../guardar/helpers.ts';

test('D1: guardar en el teléfono se ve en el escritorio y editar en uno se ve en el otro', async ({ browser, owner }) => {
  const phone = await browser.newContext({ ...devices['Pixel 7'], baseURL: APP_URL, locale: 'es-ES' });
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: APP_URL, locale: 'es-ES' });
  const tel = await phone.newPage();
  const esc = await desk.newPage();
  await login(tel, owner);
  await login(esc, owner);

  await tel.goto('/guardar');
  await tel.getByLabel('URL').fill(`${SITE_URL}/articulo`);
  await tel.getByLabel('Título', { exact: true }).fill('Receta desde el móvil');
  await tel.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(tel.locator('#flash')).toContainText('Enlace guardado');

  await esc.reload();
  await esc.goto('/');
  await expect(esc.getByRole('link', { name: 'Receta desde el móvil' })).toBeVisible();

  // Editar en el escritorio (re-guardar la misma URL con otro título) se ve en el teléfono.
  await esc.goto('/guardar?url=' + encodeURIComponent(`${SITE_URL}/articulo`));
  await expect(esc.getByText('Ya lo guardaste el')).toBeVisible();
  await esc.getByLabel('Título', { exact: true }).fill('Receta editada en el escritorio');
  await esc.getByRole('button', { name: 'Actualizar enlace' }).click();
  await expect(esc.locator('#flash')).toContainText('Enlace actualizado');

  await tel.goto('/');
  await expect(tel.getByRole('link', { name: 'Receta editada en el escritorio' })).toBeVisible();
  expect(rowsOf(owner)).toHaveLength(1);
  await phone.close();
  await desk.close();
});
