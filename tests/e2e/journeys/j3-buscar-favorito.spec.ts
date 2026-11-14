// J3: recordar una frase del texto guardado, encontrar el enlace, abrirlo y marcarlo como favorito.
import { test, expect, seedBookmarks } from '../fixtures/test.ts';

test('J3: encuentro un enlace por una frase del texto guardado, lo abro y lo marco favorito @movil @sin-js', async ({ signedIn: page, owner, context }, testInfo) => {
  seedBookmarks(owner, [
    { url: 'https://example.com/pan-centeno', title: 'Pan de centeno en casa', excerpt: 'Una guía práctica sobre la fermentación lenta del centeno en frío durante la noche.' },
    { url: 'https://example.com/cafe', title: 'Café de especialidad', excerpt: 'Molienda, agua y tiempo.' },
    { url: 'https://example.org/bicis', title: 'Mantenimiento de bicicletas', excerpt: 'Cadenas, frenos y cubiertas.' },
  ]);
  await page.goto('/');

  // La frase se escribe a medias en el buscador global.
  const global = page.locator('#q-global');
  await global.fill('fermentación len');
  await global.press('Enter');
  await expect(page).toHaveURL(/\/buscar\?q=/);
  await expect(page).toHaveTitle(/^Buscar: fermentación len · Pincushion$/);

  const resultados = page.getByRole('region', { name: 'Resultados' });
  const items = resultados.locator('article[data-bookmark-id]');
  await expect(items).toHaveCount(1);
  const item = items.first();
  await expect(item).toContainText('Pan de centeno en casa');
  await expect(item.locator('mark').first()).toBeVisible();

  // Abrir: enlace externo en pestaña nueva y sin opener.
  const abrir = item.getByRole('link', { name: /Pan de centeno en casa/ }).first();
  await expect(abrir).toHaveAttribute('href', 'https://example.com/pan-centeno');
  await expect(abrir).toHaveAttribute('target', '_blank');
  await expect(abrir).toHaveAttribute('rel', /noopener/);
  if (testInfo.project.name === 'escritorio') {
    await context.route('https://example.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Pan</title><h1>Pan</h1>' }));
    const [nueva] = await Promise.all([context.waitForEvent('page'), abrir.click()]);
    await nueva.waitForLoadState();
    expect(nueva.url()).toBe('https://example.com/pan-centeno');
    await nueva.close();
  }

  // Favorito: el botón cambia y sobrevive a recargar.
  await item.getByRole('button', { name: 'Marcar como favorito' }).click();
  await expect(page).toHaveURL(/\/buscar\?q=/);
  const marcado = page.locator('article[data-bookmark-id]').first();
  await expect(marcado.getByRole('button', { name: 'Quitar de favoritos' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('article[data-bookmark-id]').first().getByRole('button', { name: 'Quitar de favoritos' })).toHaveAttribute('aria-pressed', 'true');

  // Y aparece en la Biblioteca filtrada por favoritos (la exclusión de no favoritos la cubre el stream Biblioteca).
  await page.goto('/?favoritos=1');
  await expect(page.getByText('Pan de centeno en casa').first()).toBeVisible();
});
