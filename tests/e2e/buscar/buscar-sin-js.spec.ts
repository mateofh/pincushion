// /buscar funciona sin JavaScript: formulario GET con botón "Buscar" y filtros en la URL.
import { test, expect, seedBookmarks } from '../fixtures/test.ts';

test('buscar con filtros sin JS conserva todo en la URL @sin-js @movil', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, [
    { url: 'https://example.com/a', title: 'Receta de lentejas', tags: ['cocina'], newCollectionName: 'Lectura', isFavorite: true },
    { url: 'https://example.com/b', title: 'Receta de arroz', tags: ['cocina'] },
    { url: 'https://example.com/c', title: 'Receta de código', tags: ['dev'] },
  ]);
  await page.goto('/buscar');
  await expect(page.getByRole('button', { name: 'Buscar', exact: true })).toBeVisible();
  await page.getByLabel('Buscar', { exact: true }).fill('receta');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(3);

  // Abre los filtros (details nativo, sin JS) y combina.
  await page.getByText('Filtros', { exact: true }).click();
  await page.getByLabel(/^cocina/).check();
  await page.getByLabel('Solo favoritos').check();
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page).toHaveURL(/q=receta/);
  await expect(page).toHaveURL(/etiqueta=cocina/);
  await expect(page).toHaveURL(/favoritos=1/);
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(1);
  await expect(page.locator('article')).toContainText('Receta de lentejas');
  // El estado sobrevive a recargar y los filtros siguen marcados.
  await page.reload();
  await expect(page.getByLabel('Solo favoritos')).toBeChecked();
  await expect(page.getByLabel(/^cocina/)).toBeChecked();
});
