// Matriz de estados de Editar enlace.
import { test, expect } from '../fixtures/test.ts';
import { seedMany, createCollection } from '../biblioteca/helpers.ts';

test('éxito: guarda cambios, vuelve al contexto con flash @sin-js', async ({ signedIn: page, owner }) => {
  const [b] = seedMany(owner, 1, 'Original', { tags: ['uno'] });
  createCollection(owner, 'Lectura');
  await page.goto('/?vista=lista');
  await page.getByRole('link', { name: /^Editar/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Editar enlace' })).toBeVisible();
  await page.getByLabel('Título', { exact: true }).fill('Cambiado');
  await page.getByLabel('Etiquetas', { exact: true }).fill('uno, dos');
  await page.getByLabel('Colección', { exact: true }).selectOption({ label: 'Lectura' });
  await page.getByLabel('Favorito').check();
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page).toHaveURL(/\/\?vista=lista/);
  await expect(page.locator('#flash')).toContainText('Cambios guardados');
  const card = page.locator(`article[data-bookmark-id="${b!.id}"]`);
  await expect(card).toContainText('Cambiado');
  await expect(card).toContainText('dos');
  await expect(card).toContainText('Lectura');
  await expect(card.getByRole('button', { name: 'Quitar de favoritos' })).toHaveAttribute('aria-pressed', 'true');
});

test('validación: error junto al campo conservando lo escrito @sin-js', async ({ signedIn: page, owner }) => {
  const [b] = seedMany(owner, 1);
  await page.goto(`/enlaces/${b!.id}`);
  const largo = 'x'.repeat(301);
  await page.getByLabel('Título', { exact: true }).fill(largo);
  await page.getByLabel('Descripción').fill('Mi descripción nueva');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('#title-error')).toContainText('Máximo 300 caracteres');
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue(largo);
  await expect(page.getByLabel('Descripción')).toHaveValue('Mi descripción nueva');
  await expect(page.getByLabel('Título', { exact: true })).toHaveAttribute('aria-invalid', 'true');
});

test('validación: etiqueta demasiado larga y colección nueva @sin-js', async ({ signedIn: page, owner }) => {
  const [b] = seedMany(owner, 1);
  await page.goto(`/enlaces/${b!.id}`);
  await page.getByLabel('Etiquetas', { exact: true }).fill('y'.repeat(41));
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('#tags-error')).toContainText('40 caracteres');
  await expect(page.locator('input[name="tags"]')).toHaveValue('y'.repeat(41));
});

test('fallo del fetch: muestra el estado y Reintentar @sin-js', async ({ signedIn: page, owner }) => {
  const [b] = seedMany(owner, 1, 'Roto', { fetchStatus: 'failed' });
  await page.goto(`/enlaces/${b!.id}`);
  await expect(page.locator('[data-fetch-status="failed"]')).toContainText('No se pudo leer la página');
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page).toHaveURL(new RegExp(`/enlaces/${b!.id}`));
  await expect(page.locator('#flash')).toContainText('Volveremos a leer la página');
});

test('papelera desde la edición y Deshacer @sin-js', async ({ signedIn: page, owner }) => {
  const [b] = seedMany(owner, 1, 'Borrable');
  await page.goto(`/enlaces/${b!.id}`);
  await page.getByRole('button', { name: 'Mover a la papelera' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.locator('#flash')).toContainText('se movió a la papelera');
  await page.locator('#flash').getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.locator('article', { hasText: 'Borrable' })).toBeVisible();
});

test('enlace inexistente: 404', async ({ signedIn: page }) => {
  const res = await page.goto('/enlaces/99999999');
  expect(res?.status()).toBe(404);
});
