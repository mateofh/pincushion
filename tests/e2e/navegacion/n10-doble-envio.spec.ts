// N10: doble clic y recarga tras un POST no duplican ni repiten el efecto.
import { test, expect } from '../fixtures/test.ts';
import { seedMany, select } from '../biblioteca/helpers.ts';
import { e2eDb } from '../fixtures/test.ts';

test('doble clic en Añadir etiqueta no duplica y recargar no reenvía', async ({ signedIn: page, owner }) => {
  seedMany(owner, 2, 'Doble');
  await page.goto('/');
  await select(page, 'Doble 1');
  await page.getByLabel('Etiqueta', { exact: true }).fill('una');
  await page.getByRole('button', { name: 'Añadir etiqueta' }).dblclick();
  await expect(page.locator('#flash')).toContainText('«una»');
  await page.reload();
  await expect(page).toHaveURL('/');
  const n = e2eDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM tags WHERE user_id = ?', owner.id)!.n;
  expect(n).toBe(1);
  const links = e2eDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM bookmark_tags WHERE user_id = ?', owner.id)!.n;
  expect(links).toBe(1);
});

test('crear colección dos veces no la duplica', async ({ signedIn: page, owner }) => {
  await page.goto('/colecciones');
  await page.getByLabel('Nombre de la colección').fill('Única');
  await page.getByRole('button', { name: 'Crear colección' }).dblclick();
  await page.goto('/colecciones');
  const n = e2eDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM collections WHERE user_id = ?', owner.id)!.n;
  expect(n).toBe(1);
});

test('doble clic en papelera deja el enlace una sola vez en la papelera', async ({ signedIn: page, owner }) => {
  seedMany(owner, 1, 'Solo');
  await page.goto('/');
  await select(page, 'Solo 1');
  await page.getByRole('button', { name: 'Mover a la papelera' }).dblclick();
  await expect(page.locator('#flash')).toContainText('movido a la papelera');
  await page.goto('/papelera');
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(1);
});
