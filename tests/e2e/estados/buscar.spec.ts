// Estados de /buscar (con JavaScript): vacío, sin resultados, validación, filtros combinados y búsqueda en vivo.
import AxeBuilder from '@axe-core/playwright';
import { test, expect, seedBookmarks } from '../fixtures/test.ts';

test('sin consulta: consejos y atajo, sin resultados @movil', async ({ signedIn: page }) => {
  await page.goto('/buscar');
  await expect(page).toHaveTitle('Buscar · Pincushion');
  await expect(page.getByRole('heading', { level: 1, name: 'Buscar' })).toBeVisible();
  const consejos = page.locator('[data-empty-state]');
  await expect(consejos).toContainText('comillas');
  await expect(consejos).toContainText('título, la descripción y el texto guardado');
  await expect(consejos).toContainText('etiquetas');
  await expect(consejos).toContainText('/');
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(0);
});

test('sin resultados: sugerencias y "Quitar filtros" solo si hay filtros', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, [{ url: 'https://example.com/a', title: 'Receta de pan', tags: ['cocina'] }]);
  await page.goto('/buscar?q=xyzinexistente');
  await expect(page.getByRole('heading', { name: 'Sin resultados para «xyzinexistente»' })).toBeVisible();
  await expect(page.getByText('Revisa la ortografía')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Quitar filtros' })).toHaveCount(0);

  await page.goto('/buscar?q=receta&etiqueta=no-existe');
  await expect(page.getByRole('heading', { name: /Sin resultados/ })).toBeVisible();
  await page.getByRole('link', { name: 'Quitar filtros' }).click();
  await expect(page).toHaveURL(/\/buscar\?q=receta$/);
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(1);
});

test('consulta de más de 200 caracteres: mensaje junto al campo y el texto se conserva @movil', async ({ signedIn: page }) => {
  const larga = 'a'.repeat(205);
  await page.goto(`/buscar?q=${larga}`);
  const campo = page.getByLabel('Buscar', { exact: true });
  await expect(campo).toHaveValue(larga);
  await expect(campo).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#q-error')).toContainText('200 caracteres');
  await expect(campo).toHaveAttribute('aria-describedby', 'q-error');
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(0);
});

test('filtros combinados: colección, etiqueta y favoritos', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, [
    { url: 'https://example.com/1', title: 'Receta uno', tags: ['cocina'], newCollectionName: 'Lectura', isFavorite: true },
    { url: 'https://example.com/2', title: 'Receta dos', tags: ['cocina'], newCollectionName: 'Lectura' },
    { url: 'https://example.com/3', title: 'Receta tres', tags: ['dev'] },
  ]);
  await page.goto('/buscar?q=receta');
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Resultados' }).locator('.summary')).toContainText('3 resultados para «receta»');

  await page.getByText('Filtros', { exact: true }).click();
  await page.getByLabel('Colección', { exact: true }).selectOption({ label: 'Lectura' });
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(2);
  await page.getByLabel(/^cocina/).check();
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(2);
  await page.getByLabel('Solo favoritos').check();
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(1);
  await expect(page.locator('article')).toContainText('Receta uno');
  await expect(page).toHaveURL(/coleccion=\d+/);
  await expect(page).toHaveURL(/etiqueta=cocina/);
  await expect(page).toHaveURL(/favoritos=1/);

  await page.getByLabel('Colección', { exact: true }).selectOption('sin-coleccion');
  await expect(page.getByRole('heading', { name: /Sin resultados/ })).toBeVisible();
});

test('búsqueda en vivo: actualiza la URL, anuncia el resultado y no deja aria-busy', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, [
    { url: 'https://example.com/1', title: 'Guía de senderismo', excerpt: 'rutas de montaña' },
    { url: 'https://example.com/2', title: 'Senderismo nocturno', excerpt: 'linternas' },
    { url: 'https://example.com/3', title: 'Café', excerpt: 'granos' },
  ]);
  await page.goto('/buscar');
  await page.getByLabel('Buscar', { exact: true }).fill('senderismo');
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(2);
  await expect(page).toHaveURL(/\/buscar\?q=senderismo/);
  await expect(page.locator('#announcer')).toHaveText('2 resultados para «senderismo»');
  await expect(page.locator('#search-results')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page).toHaveTitle('Buscar: senderismo · Pincushion');

  await page.getByLabel('Buscar', { exact: true }).fill('senderismo nocturno');
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(1);
  await expect(page.locator('#announcer')).toHaveText('1 resultado para «senderismo nocturno»');

  // Atrás en el historial restaura la búsqueda anterior.
  await page.goBack();
  await expect(page.getByLabel('Buscar', { exact: true })).toHaveValue('senderismo');
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(2);
});

test('axe: /buscar vacío y con resultados no tiene violaciones serias @movil', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, [{ url: 'https://example.com/1', title: 'Guía de senderismo', excerpt: 'rutas de montaña', tags: ['viajes'], isFavorite: true }]);
  for (const url of ['/buscar', '/buscar?q=senderismo', '/buscar?q=nada-de-nada', '/buscar?q=senderismo&etiqueta=viajes']) {
    await page.goto(url);
    const r = await new AxeBuilder({ page: page as never }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(graves.map((v) => `${url}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  }
});

test('capturas de /buscar para revisión visual @movil', async ({ signedIn: page, owner }, testInfo) => {
  seedBookmarks(owner, [
    { url: 'https://example.com/pan', title: 'Pan de centeno en casa', excerpt: 'Una guía sobre la fermentación lenta del centeno en frío durante la noche, con tiempos y temperaturas.', tags: ['cocina', 'pan'], newCollectionName: 'Lectura', isFavorite: true },
    { url: 'https://example.org/recetas', title: 'Recetas de fermentación lenta', description: 'Colección de recetas', excerpt: 'Otro texto.', tags: ['cocina'] },
  ]);
  const w = testInfo.project.name === 'movil' ? 390 : 1280;
  for (const [nombre, url] of [['vacio', '/buscar'], ['resultados', '/buscar?q=fermentación+lenta'], ['sin-resultados', '/buscar?q=zzz&etiqueta=cocina']] as const) {
    await page.goto(url);
    await page.screenshot({ path: `test-results/buscar/${nombre}-${w}.png`, fullPage: true });
  }
});
