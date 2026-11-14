// J1: instalar el bookmarklet, ejecutarlo en una página de otro sitio con CSP estricta y comprobar el popup.
import { test, expect, SITE_URL } from '../fixtures/test.ts';
import { bookmarkletCode, rowsOf, runBookmarklet } from '../guardar/helpers.ts';

test('J1: el bookmarklet guarda desde una página con CSP estricta y el popup lo muestra @movil', async ({ signedIn: page, context, owner }, info) => {
  const code = await bookmarkletCode(page);
  await page.goto(`${SITE_URL}/csp-estricta`);
  const popup = await runBookmarklet(page, context, code);

  await expect(popup.getByText('Guardado ✓')).toBeVisible({ timeout: 15_000 });
  await expect(popup.getByRole('heading', { name: 'Página con CSP estricta' })).toBeVisible();
  await expect(popup.getByText('Una página que restringe scripts y formularios.')).toBeVisible();
  await expect(popup.getByText('localhost', { exact: true })).toBeVisible();
  await expect(popup.locator('[data-favicon="fetched"]')).toBeVisible({ timeout: 15_000 });
  await expect(popup.locator('[data-fetch-status="succeeded"]')).toBeVisible();
  // El token no queda en la URL del popup.
  expect(popup.url()).not.toContain('pc_');
  expect(popup.url()).toMatch(/\/bookmarklet\/guardado\/\d+$/);
  await popup.screenshot({ path: `test-results/guardar/popup-${info.project.name}.png`, fullPage: true });

  // El texto para la búsqueda llega por el job y es buscable.
  await expect
    .poll(async () => {
      await page.goto('/buscar?q=fermentaci%C3%B3n');
      return page.getByRole('link', { name: /CSP estricta/ }).count();
    }, { timeout: 15_000 })
    .toBeGreaterThan(0);
  expect(rowsOf(owner)).toHaveLength(1);
  expect(rowsOf(owner)[0]!.excerpt).toContain('fermentación lenta');
});

test('J1: con window.open bloqueado, el fallback navega la pestaña al popup @movil', async ({ signedIn: page, owner }) => {
  const code = await bookmarkletCode(page);
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await page.goto(`${SITE_URL}/articulo`);
  await Promise.all([page.waitForURL(/\/bookmarklet\/guardado\/\d+$/), page.evaluate(code).catch(() => undefined)]);
  await expect(page.getByText('Guardado ✓')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pan de masa madre en casa' })).toBeVisible({ timeout: 10_000 });
  expect(rowsOf(owner)).toHaveLength(1);
});
