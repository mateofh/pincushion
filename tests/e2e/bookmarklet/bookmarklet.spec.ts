// Pantalla de instalación del bookmarklet y prueba de guardado.
import { test, expect, SITE_URL, e2eApp } from '../fixtures/test.ts';
import { bookmarkletService } from '../../../src/server/auth/bookmarklet.ts';
import { bookmarkletCode, expectNoSeriousA11y, rowsOf, runBookmarklet, tokenOf } from '../guardar/helpers.ts';

test('primer uso: enlace arrastrable, código para copiar e instrucciones de móvil @movil @sin-js', async ({ signedIn: page }, info) => {
  await page.goto('/bookmarklet');
  await expect(page.getByRole('heading', { name: 'Bookmarklet', level: 1 })).toBeVisible();
  await expect(page.getByText('Arrástralo a tu barra de marcadores')).toBeVisible();
  const link = page.getByRole('link', { name: '+ Pincushion' });
  await expect(link).toHaveAttribute('href', /^javascript:/);
  await expect(page.getByLabel('Código del bookmarklet')).toHaveValue(/^javascript:/);
  await expect(page.getByText('iPhone o iPad (Safari)')).toBeVisible();
  await expect(page.getByText('Android (Chrome)')).toBeVisible();
  await expect(page.getByText('Todavía no has hecho la prueba.')).toBeVisible();
  await page.screenshot({ path: `test-results/guardar/bookmarklet-${info.project.name === 'movil' ? '390' : '1280'}.png`, fullPage: true });
});

test('Copiar código pone el código en el portapapeles (con JS)', async ({ signedIn: page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/bookmarklet');
  await page.getByRole('button', { name: 'Copiar código' }).click();
  await expect(page.getByText('Código copiado.')).toBeAttached();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  const code = await page.getByLabel('Código del bookmarklet').inputValue();
  expect(clip).toBe(code);
});

test('sin JS el botón Copiar no se muestra y el código sigue seleccionable @sin-js @solo-sin-js', async ({ signedIn: page }) => {
  await page.goto('/bookmarklet');
  await expect(page.getByRole('button', { name: 'Copiar código' })).toBeHidden();
  await expect(page.getByLabel('Código del bookmarklet')).toBeVisible();
});

test('rotar token: exige confirmación, invalida el anterior y avisa @sin-js', async ({ signedIn: page, owner }) => {
  const old = tokenOf(owner);
  await page.goto('/bookmarklet');
  await page.getByRole('link', { name: 'Rotar token' }).click();
  await expect(page.getByText('El bookmarklet anterior dejará de funcionar en todos tus navegadores')).toBeVisible();
  // Cancelar no cambia nada.
  await page.getByRole('link', { name: 'Cancelar' }).click();
  expect(bookmarkletService(e2eApp()).verify(old)).not.toBeNull();
  await page.getByRole('link', { name: 'Rotar token' }).click();
  await page.getByRole('button', { name: 'Rotar token' }).click();
  await expect(page).toHaveURL('/bookmarklet');
  await expect(page.locator('#flash')).toContainText('Token rotado');
  expect(bookmarkletService(e2eApp()).verify(old)).toBeNull();
  expect(bookmarkletService(e2eApp()).verify(tokenOf(owner))).not.toBeNull();
});

test('prueba: esperando, señal recibida y "Comprobar" sin JS @sin-js', async ({ signedIn: page, owner, request }) => {
  void request;
  await page.goto('/bookmarklet/prueba');
  await expect(page.getByText('Haz clic en el bookmarklet en la página de prueba')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Probar sin la barra' })).toBeVisible();
  const desde = await page.locator('input[name="desde"]').inputValue();
  // La señal llega (como si el popup hubiera recibido la página de prueba).
  const svc = bookmarkletService(e2eApp());
  svc.markUsed(svc.verify(tokenOf(owner))!.tokenId, true);
  await page.getByRole('button', { name: 'Comprobar' }).click();
  await expect(page).toHaveURL(new RegExp(`desde=${desde}`));
  await expect(page.getByText('✓ Funciona: guardado de prueba recibido a las')).toBeVisible();
  expect(rowsOf(owner)).toHaveLength(0);
});

test('prueba de extremo a extremo: la página de prueba no crea enlaces y la prueba se completa sola', async ({ signedIn: page, context, owner }) => {
  const code = await bookmarkletCode(page);
  await page.goto('/bookmarklet/prueba');
  await expect(page.getByText('esperando señal')).toBeVisible();
  const testPage = await context.newPage();
  await testPage.goto('/bookmarklet/pagina-de-prueba');
  await expect(testPage).toHaveTitle('Página de prueba de Pincushion');
  const popup = await runBookmarklet(testPage, context, code);
  await expect(popup.getByText('✓ Prueba recibida')).toBeVisible();
  // El polling de HTMX (cada 2 s) muestra el éxito sin recargar.
  await expect(page.getByText('✓ Funciona: guardado de prueba recibido a las')).toBeVisible({ timeout: 10_000 });
  expect(rowsOf(owner)).toHaveLength(0);
});

test('sin señal en 60 s: causas probables y "Probar sin la barra" funciona', async ({ signedIn: page, context, owner }) => {
  await page.goto(`/bookmarklet/prueba?desde=${Date.now() - 70_000}`);
  await expect(page.getByText('Todavía no hemos recibido nada')).toBeVisible();
  await expect(page.getByText('Causas probables:')).toBeVisible();
  const [popup] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: 'Probar sin la barra' }).click()]);
  await expect(popup.getByText('✓ Prueba recibida')).toBeVisible();
  await page.goto('/bookmarklet');
  await expect(page.getByText('Última prueba:')).toBeVisible();
  expect(rowsOf(owner)).toHaveLength(0);
});

test('un token antiguo (rotado) no guarda y avisa de que ya no es válido', async ({ signedIn: page, owner }) => {
  const old = tokenOf(owner);
  bookmarkletService(e2eApp()).rotate(owner.id);
  await page.goto(`/bookmarklet/guardar#v=1&t=${old}&u=${encodeURIComponent(SITE_URL + '/articulo')}&ti=X&de=`);
  await expect(page.getByText('Este bookmarklet ya no es válido')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Instalar el nuevo' })).toHaveAttribute('href', '/bookmarklet');
  expect(rowsOf(owner)).toHaveLength(0);
});

test('axe: /bookmarklet y /bookmarklet/prueba sin violaciones serias', async ({ signedIn: page }) => {
  await page.goto('/bookmarklet');
  await expectNoSeriousA11y(page);
  await page.goto('/bookmarklet/prueba');
  await expectNoSeriousA11y(page);
});
