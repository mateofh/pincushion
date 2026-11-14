// N9: tras una acción se vuelve al contexto (filtros incluidos) con flash y Deshacer, también sin JS.
import { test, expect } from '../fixtures/test.ts';
import { seedMany, createCollection, select } from '../biblioteca/helpers.ts';

test('papelera en lote vuelve a la misma URL con flash y Deshacer @sin-js', async ({ signedIn: page, owner }) => {
  const c = createCollection(owner, 'Lectura');
  seedMany(owner, 3, 'Item', { collectionId: c.id });
  const url = `/?coleccion=${c.id}&vista=lista&orden=titulo`;
  await page.goto(url);
  await select(page, 'Item 2');
  await page.getByRole('button', { name: 'Mover a la papelera' }).click();
  await expect(page).toHaveURL(url);
  const flash = page.locator('#flash');
  await expect(flash).toContainText('1 enlace movido a la papelera');
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(2);
  await flash.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page).toHaveURL(url);
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(3);
});

test('favorito desde la lista vuelve al contexto @sin-js', async ({ signedIn: page, owner }) => {
  seedMany(owner, 1, 'Fav');
  await page.goto('/?vista=lista');
  await page.getByRole('button', { name: 'Marcar como favorito' }).click();
  await expect(page).toHaveURL('/?vista=lista');
  await expect(page.getByRole('button', { name: 'Quitar de favoritos' })).toHaveAttribute('aria-pressed', 'true');
});

test('volver= externo se ignora', async ({ signedIn: page, owner }) => {
  const [b] = seedMany(owner, 1);
  await page.goto(`/enlaces/${b!.id}?volver=${encodeURIComponent('https://evil.example.com/')}`);
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page).toHaveURL('/');
});
