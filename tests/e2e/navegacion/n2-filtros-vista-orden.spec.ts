// N2: filtros + vista + orden viven en la URL: recargar y atrás/adelante conservan el estado.
import { test, expect } from '../fixtures/test.ts';
import { seedMany, createCollection, region } from '../biblioteca/helpers.ts';

test('filtros, vista y orden sobreviven a recargar y al historial', async ({ signedIn: page, owner }) => {
  const c = createCollection(owner, 'Lectura');
  seedMany(owner, 3, 'Beta', { collectionId: c.id, tags: ['t'] });
  seedMany(owner, 1, 'Alfa', { collectionId: c.id, tags: ['t'] });
  await page.goto(`/?coleccion=${c.id}`);
  await page.getByRole('link', { name: 'Lista' }).click();
  await expect(page).toHaveURL(/vista=lista/);
  await page.getByLabel('Ordenar').selectOption('titulo');
  await expect(page).toHaveURL(/orden=titulo/);
  await expect(page).toHaveURL(/coleccion=/);
  await expect(page).toHaveURL(/vista=lista/);
  await expect(region(page).locator('article').first()).toContainText('Alfa 1');

  await page.reload();
  await expect(page.getByRole('link', { name: 'Lista' })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByLabel('Ordenar')).toHaveValue('titulo');
  await expect(region(page).locator('article').first()).toContainText('Alfa 1');

  await page.goBack();
  await expect(page).not.toHaveURL(/orden=/);
  await expect(page).toHaveURL(/vista=lista/);
  await page.goForward();
  await expect(page).toHaveURL(/orden=titulo/);
  await expect(page.getByLabel('Ordenar')).toHaveValue('titulo');
});

test('la vista elegida se recuerda en la cookie y la URL manda', async ({ signedIn: page, owner }) => {
  seedMany(owner, 2);
  await page.goto('/?vista=lista');
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Lista' })).toHaveAttribute('aria-current', 'true');
  await page.goto('/?vista=tarjetas');
  await expect(page.getByRole('link', { name: 'Tarjetas' })).toHaveAttribute('aria-current', 'true');
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Tarjetas' })).toHaveAttribute('aria-current', 'true');
});
