// Matriz de estados de Guardar y Duplicado: validación, vacío, pendiente, éxito, fallo recuperable, 429.
import { test, expect, SITE_URL, seedBookmarks } from '../fixtures/test.ts';
import { hit } from '../../../src/server/security/rate-limit.ts';
import { e2eApp } from '../fixtures/test.ts';
import { rowsOf, tagsValue } from '../guardar/helpers.ts';

test('vacío: formulario con ayuda y acción primaria @sin-js', async ({ signedIn: page }) => {
  await page.goto('/guardar');
  await expect(page.getByRole('heading', { name: 'Guardar enlace', level: 1 })).toBeVisible();
  await expect(page.locator('#url-hint')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Obtener datos' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cancelar' })).toBeVisible();
  await expect(page).toHaveTitle('Guardar enlace · Pincushion');
});

test('validación: URL inválida muestra el error junto al campo y conserva lo escrito @sin-js', async ({ signedIn: page, owner }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill('ftp://servidor/archivo');
  await page.getByLabel('Título', { exact: true }).fill('Lo que escribí');
  await page.getByLabel('Etiquetas', { exact: true }).fill('uno, dos');
  await page.getByLabel('Descripción').fill('Texto largo');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();

  await expect(page.locator('#url-error')).toBeVisible();
  await expect(page.getByLabel('URL')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('URL')).toHaveValue('ftp://servidor/archivo');
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Lo que escribí');
  await expect.poll(() => tagsValue(page)).toBe('uno, dos');
  await expect(page.getByLabel('Descripción')).toHaveValue('Texto largo');
  expect(rowsOf(owner)).toHaveLength(0);
});

test('validación: URL vacía y título de más de 300 caracteres @sin-js', async ({ signedIn: page }) => {
  await page.goto('/guardar');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.locator('#url-error')).toBeVisible();

  await page.getByLabel('URL').fill('https://example.com/x');
  await page.getByLabel('Título', { exact: true }).evaluate((el: HTMLInputElement) => {
    el.removeAttribute('maxlength');
    el.value = 'a'.repeat(301);
  });
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Máximo 300 caracteres.')).toBeVisible();
  await expect(page.getByLabel('URL')).toHaveValue('https://example.com/x');
});

test('validación: etiqueta de más de 40 caracteres @sin-js', async ({ signedIn: page }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill('https://example.com/x');
  await page.getByLabel('Etiquetas', { exact: true }).fill('x'.repeat(41));
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Cada etiqueta puede tener hasta 40 caracteres.')).toBeVisible();
  await expect.poll(() => tagsValue(page)).toBe('x'.repeat(41));
});

test('duplicado: aviso con fecha y colección, botón "Actualizar enlace" y flash con etiquetas sumadas @sin-js', async ({ signedIn: page, owner }) => {
  const [b] = seedBookmarks(owner, [{ url: 'https://example.com/pan', title: 'Pan', tags: ['cocina'], newCollectionName: 'Lectura' }]);
  await page.goto('/guardar?url=' + encodeURIComponent('http://www.example.com/pan/?utm_source=x'));
  const aviso = page.locator('#estado-datos');
  await expect(aviso).toContainText('Ya lo guardaste el');
  await expect(aviso).toContainText('en Lectura');
  await expect(aviso).toContainText('Guardar actualizará ese enlace y sumará las etiquetas');
  await expect(aviso.getByRole('link', { name: 'Ver el existente' })).toHaveAttribute('href', `/enlaces/${b!.id}`);
  await expect(page.getByLabel('Colección', { exact: true })).toHaveValue(String(b!.collection!.id));
  await expect(page.getByRole('button', { name: 'Actualizar enlace' })).toBeVisible();
  await page.getByLabel('Etiquetas', { exact: true }).fill('pan, receta');
  await page.getByRole('button', { name: 'Actualizar enlace' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.locator('#flash')).toContainText('Enlace actualizado: se sumaron 2 etiquetas');
  expect(rowsOf(owner)).toHaveLength(1);
});

test('duplicado en la papelera: avisa y guardar lo restaura @sin-js', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, [{ url: 'https://example.com/viejo', title: 'Viejo', trashed: true }]);
  await page.goto('/guardar?url=' + encodeURIComponent('https://example.com/viejo'));
  await expect(page.locator('#estado-datos')).toContainText('papelera');
  await expect(page.locator('#estado-datos')).toContainText('lo restaurará');
  await page.getByRole('button', { name: 'Actualizar enlace' }).click();
  await expect(page.locator('#flash')).toContainText('restaurado de la papelera');
  const [row] = rowsOf(owner);
  expect(row).toBeDefined();
});

test('fallo recuperable: página bloqueada permite guardar igual con título propio @sin-js', async ({ signedIn: page, owner }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill(`${SITE_URL}/bloqueado`);
  await page.getByRole('button', { name: 'Obtener datos' }).click();
  await expect(page.getByText('No se pudo leer la página', { exact: true })).toBeVisible();
  await expect(page.getByText('puedes guardar igual con un título propio', { exact: false })).toBeVisible();
  await page.getByLabel('Título', { exact: true }).fill('Mi título propio');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page).toHaveURL('/');
  expect(rowsOf(owner)[0]).toMatchObject({ title: 'Mi título propio', title_source: 'user' });
});

test('URL inválida al obtener datos: error junto al campo, sin llamar a la red @sin-js', async ({ signedIn: page }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill('esto no es una url');
  await page.getByRole('button', { name: 'Obtener datos' }).click();
  await expect(page.locator('#url-error')).toBeVisible();
  await expect(page.getByLabel('URL')).toHaveValue('esto no es una url');
});

test('pendiente: "Obteniendo datos…" visible mientras HTMX espera y el botón sigue disponible', async ({ signedIn: page }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill(`${SITE_URL}/lento`);
  await page.getByRole('button', { name: 'Obtener datos' }).click();
  await expect(page.getByText('Obteniendo datos…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled();
  // Termina con un fallo recuperable (timeout corto), nunca bloquea el guardado.
  await expect(page.getByText('No se pudo leer la página', { exact: true })).toBeVisible({ timeout: 15_000 });
});

test('429: demasiados "Obtener datos" avisa y deja guardar @sin-js', async ({ signedIn: page, owner }) => {
  for (let i = 0; i < 31; i++) hit(e2eApp(), 'fetch-preview', String(owner.id), 30, 60_000);
  await page.goto('/guardar');
  await page.getByLabel('URL').fill(`${SITE_URL}/articulo`);
  await page.getByRole('button', { name: 'Obtener datos' }).click();
  await expect(page.getByText('Demasiados intentos, espera')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page).toHaveURL('/');
});

test('éxito: flash "Enlace guardado" visible tras el PRG @sin-js', async ({ signedIn: page }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill('https://example.com/ok');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.locator('#flash')).toContainText('Enlace guardado');
  await page.reload();
  await expect(page.locator('#flash')).not.toContainText('Enlace guardado');
});
