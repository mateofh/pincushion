// Guardar: flujos funcionales (con y sin JavaScript), obtener datos, duplicados, permisos y accesibilidad.
import { test, expect, SITE_URL, e2eDb, createOwner, login, seedBookmarks } from '../fixtures/test.ts';
import { expectNoSeriousA11y, rowsOf, tagNames, tagsValue } from './helpers.ts';

test('guardar con URL, título y etiquetas @movil @sin-js', async ({ signedIn: page, owner }) => {
  await page.goto('/guardar');
  // La URL va al final para que el cambio de campo no lance "Obtener datos" mientras se escribe.
  await page.getByLabel('Título', { exact: true }).fill('Mi pan casero');
  await page.getByLabel('Etiquetas', { exact: true }).fill('cocina, pan');
  await page.getByLabel('URL').fill(`${SITE_URL}/articulo`);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();

  await expect(page).toHaveURL('/');
  await expect(page.locator('#flash')).toContainText('Enlace guardado');
  const [row] = rowsOf(owner);
  expect(row).toMatchObject({ title: 'Mi pan casero', title_source: 'user' });
  expect(tagNames(owner, row!.id)).toEqual(['cocina', 'pan']);
});

test('Obtener datos rellena título, descripción y texto para la búsqueda @sin-js', async ({ signedIn: page, owner }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill(`${SITE_URL}/articulo`);
  await page.getByRole('button', { name: 'Obtener datos' }).click();

  await expect(page.getByText('Datos obtenidos de')).toContainText('localhost');
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Pan de masa madre en casa');
  await expect(page.getByLabel('Descripción')).toHaveValue('Guía práctica para hornear pan con masa madre.');
  await expect(page.getByLabel('Texto para la búsqueda')).toHaveValue(/fermentación lenta/);

  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page).toHaveURL('/');
  const [row] = rowsOf(owner);
  expect(row!.excerpt).toContain('fermentación lenta');
  expect(row!.title).toBe('Pan de masa madre en casa');
});

test('con JavaScript, cambiar la URL obtiene los datos sin recargar y los anuncia', async ({ signedIn: page }) => {
  await page.goto('/guardar');
  await page.getByLabel('Etiquetas', { exact: true }).fill('cocina');
  await page.getByLabel('URL').fill(`${SITE_URL}/articulo`);
  await page.getByLabel('Título', { exact: true }).focus(); // sale del campo URL: change
  await expect(page.getByText('Datos obtenidos de')).toBeVisible();
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Pan de masa madre en casa');
  // Lo escrito en otros campos se conserva.
  await expect.poll(() => tagsValue(page)).toBe('cocina');
  await expect(page.locator('#estado-datos')).toHaveAttribute('aria-live', 'polite');
});

test('no pisa un título escrito a mano al volver a obtener los datos', async ({ signedIn: page }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill(`${SITE_URL}/articulo`);
  await page.getByRole('button', { name: 'Obtener datos' }).click();
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Pan de masa madre en casa');
  await page.getByLabel('Título', { exact: true }).fill('Mi título');
  await page.getByRole('button', { name: 'Obtener datos' }).click();
  await expect(page.getByText('Datos obtenidos de')).toBeVisible();
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Mi título');
  await expect(page.getByLabel('Descripción')).toHaveValue(/masa madre/);
});

test('guardar un enlace con excerpt obtenido lo deja buscable', async ({ signedIn: page, owner }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill(`${SITE_URL}/articulo-2`);
  await page.getByRole('button', { name: 'Obtener datos' }).click();
  await expect(page.getByText('Datos obtenidos de')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page).toHaveURL('/');
  await page.goto('/buscar?q=fermentaci%C3%B3n');
  await expect(page.getByRole('link', { name: /Pan de masa madre/ })).toBeVisible();
  expect(rowsOf(owner)).toHaveLength(1);
});

test('colección nueva y favorito al guardar', async ({ signedIn: page, owner }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill('https://example.com/lectura-larga');
  await page.getByLabel('Título', { exact: true }).fill('Lectura larga');
  await page.getByText('Crear una colección nueva').click();
  await page.getByLabel('Nombre nuevo').fill('Para leer');
  await page.getByLabel('Favorito').check();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page).toHaveURL('/');
  const [row] = rowsOf(owner);
  expect(row!.is_favorite).toBe(1);
  const col = e2eDb().get<{ name: string }>('SELECT name FROM collections WHERE id = ?', row!.collection_id!);
  expect(col!.name).toBe('Para leer');
});

test('volver: tras guardar regresa al contexto indicado', async ({ signedIn: page }) => {
  await page.goto('/guardar?url=https%3A%2F%2Fexample.com%2Fa&volver=%2Fbuscar');
  await expect(page.getByLabel('URL')).toHaveValue('https://example.com/a');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page).toHaveURL('/buscar');
  await expect(page.locator('#flash')).toContainText('Enlace guardado');
});

test('Cancelar vuelve a la Biblioteca', async ({ signedIn: page }) => {
  await page.goto('/guardar');
  await page.getByRole('link', { name: 'Cancelar' }).click();
  await expect(page).toHaveURL('/');
});

test('permisos: alice y bob no comparten duplicados ni favicons', async ({ signedIn: page, owner, browser }) => {
  seedBookmarks(owner, [{ url: 'https://example.com/privado', title: 'Privado de alice' }]);
  const bob = await createOwner('bob');
  const ctx = await browser.newContext();
  const bobPage = await ctx.newPage();
  await login(bobPage, bob);
  await bobPage.goto('/guardar?url=https%3A%2F%2Fexample.com%2Fprivado');
  await expect(bobPage.getByText('Este enlace ya existe')).toHaveCount(0);
  await expect(bobPage.getByText('Privado de alice')).toHaveCount(0);
  await ctx.close();
  await page.goto('/guardar?url=https%3A%2F%2Fexample.com%2Fprivado');
  await expect(page.getByText('Este enlace ya existe')).toBeVisible();
});

test('axe: Guardar sin violaciones serias (escritorio)', async ({ signedIn: page }) => {
  await page.goto('/guardar?url=https%3A%2F%2Fexample.com%2Fa');
  await expect(page.getByRole('heading', { name: 'Guardar enlace', level: 1 })).toBeVisible();
  await expectNoSeriousA11y(page);
});

test('axe y capturas: Guardar en 390 y 1280 px @movil', async ({ signedIn: page }, info) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill(`${SITE_URL}/articulo`);
  await page.getByRole('button', { name: 'Obtener datos' }).click();
  await expect(page.getByText('Datos obtenidos de')).toBeVisible();
  await expectNoSeriousA11y(page);
  const size = info.project.name === 'movil' ? '390' : '1280';
  await page.screenshot({ path: `test-results/guardar/guardar-${size}.png`, fullPage: true });
  // Sin desborde horizontal.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
