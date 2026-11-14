// R1: HTMX falla (500 o red caída, vía page.route sobre las peticiones con HX-Request) → aviso recuperable
// y el formulario normal (sin HTMX) sigue funcionando.
import type { Page } from '@playwright/test';
import { test, expect, e2eDb, seedBookmarks } from '../fixtures/test.ts';

const AVISO = /No se pudo|Sin conexión|Inténtalo|Reintentar|no se pudo/i;

type Modo = '500' | 'abortar';

/** Solo las peticiones HTMX fallan; las navegaciones y envíos normales pasan. */
async function romperHtmx(page: Page, modo: Modo): Promise<{ hits: () => number; arreglar: () => Promise<void> }> {
  let n = 0;
  const handler = async (route: import('@playwright/test').Route) => {
    if (route.request().headers()['hx-request'] !== 'true') return route.fallback();
    n++;
    if (modo === 'abortar') return route.abort('connectionfailed');
    return route.fulfill({ status: 500, contentType: 'text/html', body: '<p>boom</p>' });
  };
  await page.route('**/*', handler);
  return { hits: () => n, arreglar: () => page.unroute('**/*', handler) };
}

const aviso = (page: Page) => page.locator('#announcer, [role=alert], [role=status] .notice, .notice, #flash [data-flash]');

for (const modo of ['500', 'abortar'] as const) {
  test(`R1: Guardar, "Obtener datos" con HTMX caído (${modo}) avisa y el formulario normal guarda [requiere: guardar]`, async ({ signedIn: page, owner }) => {
    await page.goto('/guardar');
    const url = `https://example.com/r1-${modo}`;
    await page.getByLabel('URL').fill(url);
    await page.getByLabel('Título').fill(`Título escrito antes del fallo ${modo}`);
    const roto = await romperHtmx(page, modo);

    await page.getByRole('button', { name: 'Obtener datos' }).click();
    await expect.poll(roto.hits, { message: 'con JS, "Obtener datos" usa HTMX (HX-Request)' }).toBeGreaterThan(0);
    // Aviso recuperable, anunciado
    await expect(aviso(page).filter({ hasText: AVISO }).first()).toBeVisible();
    // Lo escrito sigue ahí y la página no se rompió
    await expect(page.getByLabel('URL')).toHaveValue(url);
    await expect(page.getByLabel('Título')).toHaveValue(`Título escrito antes del fallo ${modo}`);
    await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);

    // El formulario normal sigue funcionando (el envío nativo no lleva HX-Request)
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page).toHaveURL(/\/($|\?|enlaces|guardar)/);
    await expect(page.locator('#flash').filter({ hasText: 'Enlace guardado' })).toBeVisible();
    const row = e2eDb().get<{ title: string }>('SELECT title FROM bookmarks WHERE user_id = ?', owner.id);
    expect(row?.title).toBe(`Título escrito antes del fallo ${modo}`);
  });
}

test('R1: favorito con HTMX caído avisa, y tras recuperar la red funciona y persiste [requiere: biblioteca]', async ({ signedIn: page, owner }) => {
  const [b] = seedBookmarks(owner, [{ url: 'https://example.com/r1-fav', title: 'Receta para el fallo' }]);
  await page.goto('/');
  const card = page.locator(`article[data-bookmark-id="${b.id}"]`);
  await expect(card).toBeVisible();
  const roto = await romperHtmx(page, '500');
  await card.getByRole('button', { name: 'Marcar como favorito' }).click();
  await expect.poll(roto.hits).toBeGreaterThan(0);
  await expect(aviso(page).filter({ hasText: AVISO }).first()).toBeVisible();
  // El estado visible no mintió: sigue sin ser favorito
  await expect(card.getByRole('button', { name: 'Marcar como favorito' })).toHaveAttribute('aria-pressed', 'false');
  expect(e2eDb().get<{ f: number }>('SELECT is_favorite AS f FROM bookmarks WHERE id = ?', b.id)!.f).toBe(0);

  await roto.arreglar();
  await card.getByRole('button', { name: /Marcar como favorito/ }).click();
  await expect(page.locator(`article[data-bookmark-id="${b.id}"]`).getByRole('button', { name: 'Quitar de favoritos' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator(`article[data-bookmark-id="${b.id}"]`).getByRole('button', { name: 'Quitar de favoritos' })).toBeVisible();
});

test('R1: lote con HTMX caído conserva la selección y el reintento funciona [requiere: biblioteca]', async ({ signedIn: page, owner }) => {
  const items = seedBookmarks(owner, [
    { url: 'https://example.com/r1-a', title: 'Lote A' },
    { url: 'https://example.com/r1-b', title: 'Lote B' },
  ]);
  await page.goto('/');
  await page.getByRole('checkbox', { name: 'Seleccionar «Lote A»' }).check();
  await page.getByRole('checkbox', { name: 'Seleccionar «Lote B»' }).check();
  const roto = await romperHtmx(page, '500');
  await page.getByRole('button', { name: 'Favorito', exact: true }).click();
  await expect.poll(roto.hits).toBeGreaterThan(0);
  await expect(aviso(page).filter({ hasText: AVISO }).first()).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Seleccionar «Lote A»' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Seleccionar «Lote B»' })).toBeChecked();
  await roto.arreglar();
  // Reintento con la selección intacta: no hay que volver a marcar nada
  await page.getByRole('button', { name: 'Favorito', exact: true }).click();
  await expect(page.locator('#flash').filter({ hasText: /favorit/i })).toBeVisible();
  for (const it of items) expect(e2eDb().get<{ f: number }>('SELECT is_favorite AS f FROM bookmarks WHERE id = ?', it.id)!.f).toBe(1);
});
