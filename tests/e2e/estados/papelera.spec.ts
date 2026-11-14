// Matriz de estados de la Papelera.
import { test, expect } from '../fixtures/test.ts';
import { seedMany } from '../biblioteca/helpers.ts';

test('vacío: la papelera está vacía', async ({ signedIn: page }) => {
  await page.goto('/papelera');
  await expect(page.getByRole('heading', { name: 'La papelera está vacía' })).toBeVisible();
});

test('estado visible: texto de 30 días y fecha por enlace @sin-js', async ({ signedIn: page, owner }) => {
  seedMany(owner, 2, 'Viejo', { trashed: true });
  await page.goto('/papelera');
  await expect(page.getByText('Se eliminan solos 30 días después')).toBeVisible();
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(2);
  await expect(page.locator('article[data-bookmark-id]').first()).toContainText(/Se elimina en 30 días/);
});

test('restaurar @sin-js', async ({ signedIn: page, owner }) => {
  seedMany(owner, 1, 'Recuperable', { trashed: true });
  await page.goto('/papelera');
  await page.getByRole('button', { name: /^Restaurar/ }).click();
  await expect(page).toHaveURL('/papelera');
  await expect(page.locator('#flash')).toContainText('se restauró');
  await page.goto('/');
  await expect(page.locator('article', { hasText: 'Recuperable' })).toBeVisible();
});

test('eliminar definitivamente pide confirmación con alcance @sin-js', async ({ signedIn: page, owner }) => {
  seedMany(owner, 2, 'Adiós', { trashed: true });
  await page.goto('/papelera');
  await page.getByRole('link', { name: /Eliminar definitivamente «Adiós 1»/ }).click();
  await expect(page.getByText('Se eliminará «Adiós 1» para siempre')).toBeVisible();
  await page.getByRole('button', { name: 'Eliminar para siempre' }).click();
  await expect(page).toHaveURL('/papelera');
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(1);
});

test('vaciar papelera: confirmación con número y cancelar @sin-js', async ({ signedIn: page, owner }) => {
  seedMany(owner, 3, 'Basura', { trashed: true });
  await page.goto('/papelera');
  await page.getByRole('link', { name: 'Vaciar papelera' }).click();
  await expect(page.getByText('Se eliminarán 3 enlaces para siempre')).toBeVisible();
  await page.getByRole('link', { name: 'Cancelar' }).click();
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(3);
  await page.getByRole('link', { name: 'Vaciar papelera' }).click();
  await page.getByRole('button', { name: 'Eliminar 3 enlaces' }).click();
  await expect(page.locator('#flash')).toContainText('Papelera vaciada');
  await expect(page.getByRole('heading', { name: 'La papelera está vacía' })).toBeVisible();
});

test('eliminar un enlace activo no está permitido', async ({ signedIn: page, owner }) => {
  const [b] = seedMany(owner, 1);
  await page.goto(`/enlaces/${b!.id}/eliminar`);
  await expect(page).toHaveURL(`/enlaces/${b!.id}`);
  await expect(page.locator('#flash')).toContainText('Solo puedes eliminar para siempre desde la papelera');
});
