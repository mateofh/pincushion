// Comportamiento de los componentes interactivos del design system (con y sin JavaScript).
import { test, expect } from '../fixtures/test.ts';

const GALERIA = '/dev/componentes';

test('TagInput con JS: chips eliminables con teclado y campo real sincronizado', async ({ signedIn: page }) => {
  await page.goto(GALERIA);
  const box = page.locator('[data-tag-input]').first();
  const campo = page.getByLabel('Etiquetas', { exact: true });
  await expect(box.locator('.tag-chip')).toHaveCount(2);
  await campo.fill('lectura, ');
  await expect(box.locator('.tag-chip')).toHaveCount(3);
  await campo.fill('nueva');
  await campo.press('Enter');
  await expect(box.locator('.tag-chip')).toHaveCount(4);
  await expect(box.locator('input[type="hidden"]')).toHaveValue('cocina, pan, lectura, nueva');
  await campo.press('Backspace');
  await expect(box.locator('.tag-chip')).toHaveCount(3);
  await box.getByRole('button', { name: 'Quitar etiqueta «pan»' }).click();
  await expect(box.locator('input[type="hidden"]')).toHaveValue('cocina, lectura');
  // El texto pendiente se incluye al enviar.
  await campo.fill('pendiente');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page).toHaveURL(/etiquetas=cocina%2C\+lectura%2C\+pendiente|etiquetas=cocina%2C%20lectura%2C%20pendiente/);
});

test('TagInput sin JS es un campo de texto separado por comas @solo-sin-js @sin-js', async ({ signedIn: page }) => {
  await page.goto(GALERIA);
  const campo = page.getByLabel('Etiquetas', { exact: true });
  await expect(campo).toHaveValue('cocina, pan');
  await expect(campo).toHaveAttribute('list', 'd-tags-sugerencias');
  await expect(page.locator('#d-tags-sugerencias option')).toHaveCount(3);
});

test('campos con error exponen aria-invalid y aria-describedby y conservan el valor @sin-js', async ({ signedIn: page }) => {
  await page.goto(GALERIA);
  const titulo = page.getByLabel('Título', { exact: true });
  await expect(titulo).toHaveAttribute('aria-invalid', 'true');
  await expect(titulo).toHaveAttribute('aria-describedby', 'd-titulo-error');
  await expect(page.locator('#d-titulo-error')).toContainText('300 caracteres');
  await expect(titulo).toHaveValue(/^x{320}$/);
});

test('BulkBar cuenta la selección y SortSelect se envía al cambiar', async ({ signedIn: page }) => {
  await page.goto(GALERIA);
  const bar = page.getByRole('form', { name: 'Acciones sobre los enlaces seleccionados' });
  await expect(bar).toContainText('Ningún enlace seleccionado');
  await page.getByRole('region', { name: 'Enlaces guardados' }).getByLabel('Seleccionar «Pan de masa madre: la guía definitiva»').check();
  await page.getByRole('region', { name: 'Enlaces guardados' }).getByLabel('Seleccionar «Sin favicon y sin descripción»').check();
  await expect(bar).toContainText('2 seleccionados');
  for (const n of ['Añadir etiqueta', 'Mover a…', 'Favorito', 'Mover a la papelera']) {
    await expect(bar.getByRole('button', { name: n })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Aplicar' })).toBeHidden();
  await Promise.all([page.waitForURL(/orden=titulo/), page.getByLabel('Ordenar').selectOption('titulo')]);
});

test('SortSelect muestra "Aplicar" sin JS y BulkBar es un formulario normal @solo-sin-js @sin-js', async ({ signedIn: page }) => {
  await page.goto(GALERIA);
  await expect(page.getByRole('button', { name: 'Aplicar' })).toBeVisible();
  const bar = page.locator('form#bulk');
  await expect(bar).toHaveAttribute('method', 'post');
  await expect(bar.locator('input[name="_csrf"]')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Enlaces guardados' }).locator('article[data-bookmark-id="1"] input[type="checkbox"]')).toHaveAttribute('form', 'bulk');
});

test('tarjeta: enlace externo seguro, favorito con value explícito y chips enlazados @sin-js', async ({ signedIn: page }) => {
  await page.goto(GALERIA);
  const region = page.getByRole('region', { name: 'Enlaces guardados' });
  const card = region.locator('article[data-bookmark-id="3"]');
  const titulo = card.locator('h2 a');
  await expect(titulo).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(titulo).toHaveAttribute('target', '_blank');
  const fav = region.locator('article[data-bookmark-id="1"] form[action="/enlaces/1/favorito"]');
  await expect(fav.locator('input[name="value"]')).toHaveValue('0');
  await expect(fav.locator('input[name="volver"]')).toHaveValue('/dev/componentes');
  await expect(region.locator('article[data-bookmark-id="1"] a[href="/?etiqueta=cocina"]')).toBeVisible();
  await expect(region.locator('article[data-bookmark-id="3"] form[action="/enlaces/3/favorito"] input[name="value"]')).toHaveValue('1');
  await expect(region.locator('article[data-bookmark-id="4"]').getByRole('button', { name: 'Reintentar' })).toBeVisible();
});

test('títulos y URLs larguísimos no provocan scroll horizontal @movil', async ({ signedIn: page }) => {
  await page.goto(GALERIA);
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(m.sw).toBeLessThanOrEqual(m.cw);
});
