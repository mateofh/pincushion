// N1: la barra global es idéntica en cada pantalla principal (landmarks, <title>, aria-current, CTA, salto al contenido).
import { test, expect } from '../fixtures/test.ts';
import { PANTALLAS } from '../helpers/ui.ts';

const requiere = (p: (typeof PANTALLAS)[number]) => (p.requiere ? ` [requiere: ${p.requiere}]` : '');

for (const p of PANTALLAS) {
  test(`N1: ${p.ruta} tiene la barra global completa${requiere(p)} @movil`, async ({ signedIn: page }) => {
    const res = await page.goto(p.ruta);
    expect(res!.status(), `${p.ruta} debe existir (200)`).toBe(200);

    // Landmarks
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('search')).toBeVisible();
    await expect(page.getByRole('search').getByLabel('Buscar en tus enlaces')).toBeVisible();
    await expect(page.locator('#q-global')).toBeVisible();

    // <title> útil y con la marca al final
    const title = await page.title();
    expect(title).toMatch(/^.{3,}· Pincushion$/);
    expect(title.replace(/· Pincushion$/, '').trim().length).toBeGreaterThan(2);

    // h1 único
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

    // Navegación: enlaces con los nombres de CONTRATOS §3 y aria-current solo en el activo
    const nav = page.getByRole('navigation', { name: 'Principal' });
    for (const name of ['Biblioteca', 'Bookmarklet', 'Ajustes']) await expect(nav.getByRole('link', { name })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Salir' })).toBeVisible();
    const current = page.locator('header [aria-current="page"]');
    if (p.activo) {
      await expect(nav.getByRole('link', { name: p.activo })).toHaveAttribute('aria-current', 'page');
    } else {
      // Pantallas sin entrada propia en el menú: nunca debe haber un aria-current equivocado en el menú
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);
    }
    expect(await current.count()).toBeLessThanOrEqual(1);

    // Acción primaria siempre visible
    await expect(page.getByRole('link', { name: 'Guardar enlace' }).first()).toBeVisible();
  });
}

test('N1: títulos únicos y descriptivos en todas las pantallas [requiere: biblioteca|guardar|buscar] @movil', async ({ signedIn: page }) => {
  const titles = new Map<string, string>();
  for (const p of PANTALLAS) {
    await page.goto(p.ruta);
    titles.set(p.ruta, await page.title());
  }
  const values = [...titles.values()];
  expect(new Set(values).size, `títulos repetidos: ${JSON.stringify([...titles])}`).toBe(values.length);
  for (const [ruta, t] of titles) expect(t, ruta).not.toMatch(/No encontramos|Error|undefined/i);
});

test('N1: el botón "Guardar enlace" queda en la misma posición en cada pantalla [requiere: biblioteca|guardar|buscar] @movil', async ({ signedIn: page }) => {
  let base: { x: number; y: number; width: number; height: number } | null = null;
  for (const p of PANTALLAS) {
    await page.goto(p.ruta);
    const cta = page.getByRole('link', { name: 'Guardar enlace' }).first();
    await expect(cta).toBeVisible();
    const box = (await cta.boundingBox())!;
    base ??= box;
    for (const k of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(box[k] - base[k]), `${k} del CTA en ${p.ruta}`).toBeLessThanOrEqual(2);
    }
  }
});

test('N1: "Saltar al contenido" es el primer enfocable y lleva al main @movil @sin-js', async ({ signedIn: page }) => {
  for (const ruta of ['/', '/ajustes', '/guardar']) {
    await page.goto(ruta);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Saltar al contenido' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#contenido$/);
    await expect(page.getByRole('main')).toBeVisible();
    // Tras saltar, el siguiente Tab cae dentro del contenido y no en la barra
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('main')))).toBe(true);
  }
});

test('N1: la barra global también está en /ajustes con el mismo orden de landmarks @movil', async ({ signedIn: page }) => {
  await page.goto('/ajustes');
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('header, nav, [role=search], main')].map((el) => (el.matches('[role=search]') ? 'search' : el.tagName.toLowerCase())),
  );
  expect(order).toEqual(['header', 'search', 'nav', 'main']);
});
