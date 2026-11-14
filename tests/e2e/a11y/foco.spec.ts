// Foco: visible en cada control, Escape cierra y devuelve el foco, tras PRG el foco va a la confirmación.
import { test, expect, login, seedBookmarks } from '../fixtures/test.ts';
import { focusIndicator, tabStopsWithoutFocusRing } from '../helpers/ui.ts';

const DATOS = [
  { url: 'https://example.com/f1', title: 'Foco uno', tags: ['a'], isFavorite: true },
  { url: 'https://example.com/f2', title: 'Foco dos', fetchStatus: 'failed' as const },
  { url: 'https://example.com/f3', title: 'Foco tres', description: 'con descripción' },
];

test('foco visible en cada control tabulable de la Biblioteca [requiere: biblioteca] @movil', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, DATOS);
  await page.goto('/');
  expect(await tabStopsWithoutFocusRing(page, 200)).toEqual([]);
});

test('foco visible en Biblioteca en vista lista [requiere: biblioteca] @movil', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, DATOS);
  await page.goto('/?vista=lista');
  expect(await tabStopsWithoutFocusRing(page, 200)).toEqual([]);
});

for (const ruta of ['/guardar', '/ajustes', '/entrar']) {
  test(`foco visible en cada control de ${ruta} @movil`, async ({ page, owner }) => {
    if (ruta !== '/entrar') await login(page, owner, ruta);
    else await page.goto(ruta);
    expect(await tabStopsWithoutFocusRing(page, 80)).toEqual([]);
  });
}

test('foco visible en Buscar con resultados [requiere: buscar] @movil', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, DATOS);
  await page.goto('/buscar?q=foco');
  expect(await tabStopsWithoutFocusRing(page, 120)).toEqual([]);
});

test('el indicador de foco es un anillo de 2 px o más, no solo un cambio de color @movil', async ({ signedIn: page }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').focus();
  const ring = await page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement!);
    return { outline: cs.outlineStyle !== 'none' ? parseFloat(cs.outlineWidth) : 0, shadow: cs.boxShadow };
  });
  expect(ring.outline >= 2 || /\b([2-9]|\d\d)px\b/.test(ring.shadow), `foco: ${JSON.stringify(ring)}`).toBe(true);
  expect((await focusIndicator(page)).visible).toBe(true);
});

test('Escape cierra el desplegable de filtros y devuelve el foco a su botón [requiere: biblioteca] @movil', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, DATOS);
  await page.goto('/');
  const filtros = page.locator('details').filter({ has: page.locator('summary', { hasText: /Filtros/ }) }).first();
  const resumen = filtros.locator('summary');
  await resumen.focus();
  await page.keyboard.press('Enter');
  await expect(filtros).toHaveAttribute('open', '');
  // Mover el foco dentro del desplegable y cerrar con Escape
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(filtros).not.toHaveAttribute('open', '');
  await expect(resumen).toBeFocused();
});

test('tras un PRG el foco va a la confirmación (flash) @movil', async ({ signedIn: page }) => {
  await page.goto('/ajustes');
  await page.getByLabel('Zona horaria').selectOption('America/Bogota');
  await page.getByRole('button', { name: 'Guardar zona horaria' }).click();
  const flash = page.locator('#flash [data-flash]');
  await expect(flash).toContainText('Zona horaria guardada.');
  await expect(flash).toBeFocused();
  // La confirmación está dentro de una región role=status
  await expect(page.locator('#flash')).toHaveAttribute('role', 'status');
  // Y desde ahí Tab continúa en el documento (no se pierde el foco)
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
});

test('tras guardar un enlace el foco va al flash y el contenido nuevo es alcanzable [requiere: guardar] @movil', async ({ signedIn: page }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill('https://example.com/foco-prg');
  await page.getByLabel('Título').fill('Guardado para el foco');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.locator('#flash [data-flash]')).toContainText('Enlace guardado');
  await expect(page.locator('#flash [data-flash]')).toBeFocused();
});

test('un error de validación lleva el foco o el aviso al campo con error [requiere: guardar] @movil', async ({ signedIn: page }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill('no es una url');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  const campo = page.getByLabel('URL');
  await expect(campo).toHaveAttribute('aria-invalid', 'true');
  const describedBy = await campo.getAttribute('aria-describedby');
  expect(describedBy, 'el error está asociado al campo').toBeTruthy();
  await expect(page.locator(`#${describedBy!.split(' ')[0]}`)).toBeVisible();
});
