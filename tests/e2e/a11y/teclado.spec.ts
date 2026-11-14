// J2 y J3 solo con teclado: ninguna interacción usa click/check/fill sobre la UI.
import { test, expect, e2eApp, e2eDb, seedBookmarks } from '../fixtures/test.ts';
import { collectionService } from '../../../src/server/services/collections.ts';
import { focusByKeyboard, saltarAlContenido, tabsUntil } from '../helpers/teclado.ts';

test('J2 solo teclado: seleccionar con Espacio, etiquetar y mover en lote [requiere: biblioteca] @movil', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, [
    { url: 'https://example.com/k1', title: 'Teclado uno' },
    { url: 'https://example.com/k2', title: 'Teclado dos' },
    { url: 'https://example.com/k3', title: 'Teclado tres' },
    { url: 'https://example.com/k4', title: 'Teclado cuatro' },
  ]);
  collectionService(e2eApp()).create(owner.id, 'Lectura');
  await page.goto('/');
  await saltarAlContenido(page);

  // Seleccionar 3 con la barra espaciadora
  for (const t of ['Teclado uno', 'Teclado dos', 'Teclado tres']) {
    const box = page.getByRole('checkbox', { name: `Seleccionar «${t}»` });
    await focusByKeyboard(page, box);
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
  }
  await expect(page.getByRole('checkbox', { name: 'Seleccionar «Teclado cuatro»' })).not.toBeChecked();
  // La BulkBar anuncia cuántos hay seleccionados (no solo se ve)
  await expect(page.getByText(/3 seleccionados?/)).toBeVisible();

  // Añadir etiqueta: campo de etiqueta → escribir → Enter en el botón de la acción
  const campoEtiqueta = page.getByRole('textbox', { name: /etiqueta/i }).last();
  await focusByKeyboard(page, campoEtiqueta);
  await page.keyboard.type('teclado');
  await focusByKeyboard(page, page.getByRole('button', { name: 'Añadir etiqueta' }));
  await page.keyboard.press('Enter');
  await expect(page.locator('#flash').filter({ hasText: /etiqueta/i })).toBeVisible();
  const conEtiqueta = e2eDb().get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.user_id = ? AND t.name_key = 'teclado'",
    owner.id,
  )!.n;
  expect(conEtiqueta, 'la etiqueta se aplicó a los 3 seleccionados').toBe(3);

  // Tras el PRG la selección se pierde: volver a seleccionar y mover a una colección
  for (const t of ['Teclado uno', 'Teclado dos', 'Teclado tres']) {
    const box = page.getByRole('checkbox', { name: `Seleccionar «${t}»` });
    await focusByKeyboard(page, box);
    if (!(await box.isChecked())) await page.keyboard.press('Space');
  }
  const mover = page.getByRole('combobox', { name: /Mover a|Colecci/i }).first();
  await focusByKeyboard(page, mover);
  await page.keyboard.type('Lectura'); // un <select> nativo elige por tecleo
  await focusByKeyboard(page, page.getByRole('button', { name: /^Mover/ }).first());
  await page.keyboard.press('Enter');
  await expect(page.locator('#flash').filter({ hasText: /Lectura/ })).toBeVisible();
  const movidos = e2eDb().get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM bookmarks b JOIN collections c ON c.id = b.collection_id WHERE b.user_id = ? AND c.name = ?',
    owner.id,
    'Lectura',
  )!.n;
  expect(movidos).toBe(3);
});

test('J2 solo teclado: el orden de Tab es lógico y ningún control queda atrapado [requiere: biblioteca] @movil', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, [{ url: 'https://example.com/o1', title: 'Orden uno' }, { url: 'https://example.com/o2', title: 'Orden dos' }]);
  await page.goto('/');
  await saltarAlContenido(page);
  // Desde el contenido, el primer enlace/casilla de un enlace se alcanza en pocas pulsaciones
  const n = await tabsUntil(page, page.getByRole('checkbox', { name: 'Seleccionar «Orden uno»' }), 25);
  expect(n).toBeLessThanOrEqual(25);
  // Shift+Tab vuelve atrás sin saltos al final de la página
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('main')))).toBe(true);
});

test('J3 solo teclado: "/" enfoca el buscador, Enter busca y se abre el resultado [requiere: buscar] @movil', async ({ signedIn: page, owner, context }) => {
  seedBookmarks(owner, [
    { url: 'https://example.com/nube', title: 'Cuaderno de nubes', excerpt: 'Una frase memorable sobre nube de algodón en primavera' },
    { url: 'https://example.com/otro', title: 'Otro enlace sin relación' },
  ]);
  await page.goto('/ajustes');
  await page.locator('body').press('/');
  await expect(page.locator('#q-global')).toBeFocused();
  await page.keyboard.type('nube de algodón');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/buscar\?q=nube(\+|%20)de(\+|%20)algod/);

  const resultados = page.getByRole('region', { name: 'Resultados' });
  await expect(resultados).toBeVisible();
  const resultado = resultados.locator('article[data-bookmark-id]').first();
  await expect(resultado.locator('mark').first()).toBeVisible();
  // Resultados anunciados
  await expect(page.getByText(/1 resultado/)).toBeVisible();

  const enlace = resultado.getByRole('link').first();
  await focusByKeyboard(page, enlace);
  const [nueva] = await Promise.all([context.waitForEvent('page'), page.keyboard.press('Enter')]);
  await nueva.waitForLoadState('domcontentloaded').catch(() => {});
  expect(nueva.url()).toContain('example.com/nube');

  // Favorito con teclado desde el resultado
  const fav = resultado.getByRole('button', { name: 'Marcar como favorito' });
  await focusByKeyboard(page, fav);
  await page.keyboard.press('Space');
  await expect(resultado.getByRole('button', { name: 'Quitar de favoritos' })).toBeVisible();
});

test('el atajo "/" no roba la tecla mientras se escribe en un campo @sin-js', async ({ signedIn: page }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').focus();
  await page.keyboard.type('https://example.com/a/b');
  await expect(page.getByLabel('URL')).toHaveValue('https://example.com/a/b');
  await expect(page.locator('#q-global')).not.toBeFocused();
});

test('"/" lleva al buscador global desde cualquier pantalla con JavaScript', async ({ signedIn: page }) => {
  for (const ruta of ['/', '/guardar', '/ajustes']) {
    await page.goto(ruta);
    await page.locator('main').press('/');
    await expect(page.locator('#q-global'), ruta).toBeFocused();
  }
});
