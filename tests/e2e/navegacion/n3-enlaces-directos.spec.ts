// N3: enlaces directos cargan con el estado correcto.
import { test, expect } from '../fixtures/test.ts';
import { seedMany, createCollection, region } from '../biblioteca/helpers.ts';

test('URLs directas de la Biblioteca y de editar', async ({ signedIn: page, owner }) => {
  const c = createCollection(owner, 'Recetas');
  const [b] = seedMany(owner, 2, 'Pan', { collectionId: c.id, tags: ['masa'], isFavorite: true });
  await page.goto(`/?coleccion=${c.id}&vista=tarjetas`);
  await expect(page.getByRole('heading', { level: 1, name: 'Recetas' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tarjetas' })).toHaveAttribute('aria-current', 'true');
  await expect(region(page).locator('article')).toHaveCount(2);
  await page.goto('/?etiqueta=masa&etiqueta=inexistente');
  await expect(page.getByText('Ningún enlace coincide')).toBeVisible();
  await page.goto('/?favoritos=1&orden=antiguos');
  await expect(region(page).locator('article')).toHaveCount(2);
  await page.goto(`/enlaces/${b!.id}`);
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Pan 1');
  const res = await page.goto('/?coleccion=999999');
  expect(res?.status()).toBe(404);
});
