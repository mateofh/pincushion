// R2: una página lenta nunca bloquea el guardado; el estado se ve como "Obteniendo datos…" y luego "Reintentando…".
import { test, expect, SITE_URL } from '../fixtures/test.ts';
import { bookmarkletCode, rowsOf, runBookmarklet } from '../guardar/helpers.ts';

test('R2: bookmarklet sobre una página lenta guarda al instante y el popup muestra el estado pendiente y luego el reintento', async ({ signedIn: page, context, owner }) => {
  test.setTimeout(60_000);
  const code = await bookmarkletCode(page);
  await page.goto(`${SITE_URL}/lento`, { waitUntil: 'commit' });
  const started = Date.now();
  const popup = await runBookmarklet(page, context, code);
  await expect(popup.getByText('Guardado ✓')).toBeVisible({ timeout: 15_000 });
  // El guardado no espera a la página lenta: el presupuesto en línea es de 3 s.
  expect(Date.now() - started).toBeLessThan(9_000);
  await expect(popup.locator('[data-fetch-status="pending"]')).toBeVisible();
  await expect(popup.getByText('Obteniendo datos…')).toBeVisible();
  expect(rowsOf(owner)).toHaveLength(1);

  // La cola reintenta (timeout de 3 s en el entorno de pruebas) y el popup se actualiza solo.
  await expect(popup.locator('[data-fetch-status="retrying"]')).toBeVisible({ timeout: 25_000 });
  await expect(popup.getByText('Reintentando…')).toBeVisible();
});

test('R2: en Guardar, una página lenta termina en fallo recuperable y se puede guardar igual', async ({ signedIn: page, owner }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill(`${SITE_URL}/lento`);
  await page.getByRole('button', { name: 'Obtener datos' }).click();
  await expect(page.getByText('Obteniendo datos…')).toBeVisible();
  // Guardar no depende de que termine: el botón está activo mientras se espera.
  await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled();
  await expect(page.getByText('No se pudo leer la página', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Título', { exact: true }).fill('Página lenta pero guardada');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page).toHaveURL('/');
  expect(rowsOf(owner)[0]).toMatchObject({ title: 'Página lenta pero guardada' });
});
