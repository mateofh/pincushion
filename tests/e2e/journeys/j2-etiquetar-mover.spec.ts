// J2: seleccionar 3, añadir etiqueta, mover a colección nueva, abrir la colección en vista Tarjetas.
import { test, expect } from '../fixtures/test.ts';
import { seedMany, select, region } from '../biblioteca/helpers.ts';

test('etiquetar y mover 3 enlaces sin salir de la Biblioteca @movil @sin-js', async ({ signedIn: page, owner }) => {
  seedMany(owner, 5, 'Receta');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Biblioteca' })).toBeVisible();
  for (const n of [1, 2, 3]) await select(page, `Receta ${n}`);

  await page.getByLabel('Etiqueta', { exact: true }).fill('cocina');
  await page.getByRole('button', { name: 'Añadir etiqueta' }).click();
  await expect(page.locator('#flash')).toContainText('Etiqueta «cocina» añadida a 3 enlaces');
  await expect(page.locator('article[data-bookmark-id]').filter({ hasText: 'cocina' })).toHaveCount(3);

  for (const n of [1, 2, 3]) await select(page, `Receta ${n}`);
  await page.getByLabel('Nombre de una colección nueva').fill('Lectura');
  await page.getByRole('button', { name: 'Mover a…' }).click();
  await expect(page.locator('#flash')).toContainText('3 enlaces movidos a Lectura');

  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Filtros de la Biblioteca' });
  if (await nav.isHidden()) await page.getByText('Filtros', { exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Filtros de la Biblioteca' }).locator(':visible').getByRole('link', { name: /Sin colección\s*2/ })).toBeVisible();
  await page.getByRole('navigation', { name: 'Filtros de la Biblioteca' }).locator(':visible').getByRole('link', { name: /^Lectura\s*3/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Lectura' })).toBeVisible();
  await page.getByRole('link', { name: 'Tarjetas' }).click();
  await expect(page.getByRole('link', { name: 'Tarjetas' })).toHaveAttribute('aria-current', 'true');
  await expect(region(page).locator('article[data-bookmark-id]')).toHaveCount(3);

  await page.reload();
  await expect(region(page).locator('article[data-bookmark-id]')).toHaveCount(3);
  await expect(page.getByRole('heading', { level: 1, name: 'Lectura' })).toBeVisible();
});
