// Matriz de estados del popup del bookmarklet: pendiente, éxito, validación, token revocado, no guardable, 429, permisos.
import { test, expect, SITE_URL, APP_URL, e2eApp, e2eDb, createOwner, login, seedBookmarks } from '../fixtures/test.ts';
import { bookmarkletService } from '../../../src/server/auth/bookmarklet.ts';
import { hit } from '../../../src/server/security/rate-limit.ts';
import { PNG_1X1, expectNoSeriousA11y, rowsOf, tagNames, tokenOf } from '../guardar/helpers.ts';

function popupUrl(token: string, u: string, ti = 'Título del popup', de = ''): string {
  const e = encodeURIComponent;
  return `/bookmarklet/guardar#v=1&t=${token}&u=${e(u)}&ti=${e(ti)}&de=${e(de)}`;
}

test('pendiente: la shell muestra "Guardando…" y borra el fragmento de la URL', async ({ signedIn: page, owner }) => {
  await page.goto(popupUrl(tokenOf(owner), `${SITE_URL}/articulo`));
  await page.waitForURL(/\/bookmarklet\/guardado\/\d+$/);
  expect(page.url()).not.toContain('#');
  expect(page.url()).not.toContain('pc_');
});

test('shell sin JavaScript explica qué hacer @sin-js @solo-sin-js', async ({ page }) => {
  await page.goto('/bookmarklet/guardar');
  await expect(page.getByRole('heading', { name: 'Guardando…' })).toBeVisible();
  // Chromium sin JS no siempre renderiza <noscript>: se comprueba su contenido en el DOM.
  const html = await page.locator('noscript').evaluate((n) => n.textContent ?? '');
  expect(html).toContain('necesita JavaScript');
  expect(html).toContain('Guardar enlace');
});

test('shell sin fragmento: no hay nada que guardar', async ({ page }) => {
  await page.goto('/bookmarklet/guardar');
  await expect(page.getByRole('heading', { name: 'Nada que guardar' })).toBeVisible();
});

test('éxito con sesión: "Guardado ✓", resumen y edición con PRG', async ({ signedIn: page, owner }) => {
  await page.goto(popupUrl(tokenOf(owner), `${SITE_URL}/articulo`, 'Pan del popup', 'Descripción enviada'));
  await expect(page.locator('#flash')).toContainText('Guardado ✓');
  await expect(page.getByRole('heading', { name: /Pan/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir Pincushion' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar ventana' })).toBeVisible();

  await page.getByLabel('Título', { exact: true }).fill('Mi título editado');
  await page.getByLabel('Etiquetas', { exact: true }).fill('popup, pan');
  await page.getByLabel('Favorito').check();
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('#flash')).toContainText('Cambios guardados.');
  const [row] = rowsOf(owner);
  expect(row).toMatchObject({ title: 'Mi título editado', title_source: 'user', is_favorite: 1 });
  expect(tagNames(owner, row!.id)).toEqual(['pan', 'popup']);
  await expectNoSeriousA11y(page);
});

test('guardar dos veces: la segunda dice "Ya estaba guardado" y no duplica', async ({ signedIn: page, owner }) => {
  const url = popupUrl(tokenOf(owner), `${SITE_URL}/articulo-3`);
  await page.goto(url);
  await expect(page.locator('#flash')).toContainText('Guardado ✓');
  await page.goto(url);
  await expect(page.locator('#flash')).toContainText('Ya estaba guardado');
  expect(rowsOf(owner)).toHaveLength(1);
});

test('validación: error de título junto al campo conservando lo escrito', async ({ signedIn: page, owner }) => {
  await page.goto(popupUrl(tokenOf(owner), `${SITE_URL}/articulo`));
  await page.waitForURL(/guardado/);
  await page.getByLabel('Título', { exact: true }).evaluate((el: HTMLInputElement) => {
    el.removeAttribute('maxlength');
    el.value = 'a'.repeat(301);
  });
  await page.getByLabel('Etiquetas', { exact: true }).fill('conservada');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Máximo 300 caracteres.')).toBeVisible();
  await expect(page.locator('input[name="tags"]').last()).toHaveValue('conservada');
});

test('token revocado: mensaje con enlace al nuevo bookmarklet y nada guardado', async ({ signedIn: page, owner }) => {
  const old = tokenOf(owner);
  bookmarkletService(e2eApp()).rotate(owner.id);
  await page.goto(popupUrl(old, `${SITE_URL}/articulo`));
  await expect(page.getByRole('heading', { name: 'Este bookmarklet ya no es válido' })).toBeVisible();
  await expect(page.getByText('Instala el nuevo desde Pincushion')).toBeVisible();
  expect(rowsOf(owner)).toHaveLength(0);
});

test('token inventado: 401 sin pistas', async ({ page }) => {
  await page.goto(popupUrl('pc_aaaaaaaaaaaaaaaaaaaaaa.' + 'b'.repeat(43), `${SITE_URL}/articulo`));
  await expect(page.getByText('Este bookmarklet ya no es válido')).toBeVisible();
});

for (const [name, u, texto] of [
  ['about:blank', 'about:blank', /no se puede guardar|Esta página/],
  ['chrome://', 'chrome://settings', /Esta página no se puede guardar/],
  ['file://', 'file:///home/x.html', /Esta página no se puede guardar/],
] as const) {
  test(`página no guardable (${name}): mensaje y nada guardado`, async ({ signedIn: page, owner }) => {
    await page.goto(popupUrl(tokenOf(owner), u));
    await expect(page.getByRole('heading', { name: 'Esta página no se puede guardar' })).toBeVisible();
    await expect(page.getByText(texto).first()).toBeVisible();
    expect(rowsOf(owner)).toHaveLength(0);
  });
}

test('429: demasiados guardados con el mismo token avisa con los segundos', async ({ signedIn: page, owner }) => {
  const { tokenId } = bookmarkletService(e2eApp()).verify(tokenOf(owner))!;
  for (let i = 0; i < 61; i++) hit(e2eApp(), 'bookmarklet:save', tokenId, 60, 60_000);
  await page.goto(popupUrl(tokenOf(owner), `${SITE_URL}/articulo`));
  await expect(page.getByRole('heading', { name: 'Demasiados intentos' })).toBeVisible();
  await expect(page.getByText(/espera \d+ s/)).toBeVisible();
  expect(rowsOf(owner)).toHaveLength(0);
});

test('sin sesión: solo "Guardado ✓" y pedir inicio de sesión; no revela datos', async ({ browser, owner }) => {
  const ctx = await browser.newContext({ baseURL: APP_URL });
  const page = await ctx.newPage();
  await page.goto(popupUrl(tokenOf(owner), `${SITE_URL}/articulo`, 'Secreto del dueño'));
  await expect(page.getByRole('heading', { name: 'Guardado ✓' })).toBeVisible();
  await expect(page.getByText('Inicia sesión para añadir etiquetas')).toBeVisible();
  await expect(page.getByText('Secreto del dueño')).toHaveCount(0);
  await expect(page.getByText('localhost')).toHaveCount(0);
  expect(rowsOf(owner)).toHaveLength(1);
  // Y una segunda vez, "Ya estaba guardado" (se sale antes para que el hash cargue la shell de nuevo).
  await page.goto('about:blank');
  await page.goto(popupUrl(tokenOf(owner), `${SITE_URL}/articulo`));
  await expect(page.getByRole('heading', { name: 'Ya estaba guardado' })).toBeVisible();
  await expectNoSeriousA11y(page);
  await ctx.close();
});

test('el token no restaura de la papelera ni lo revela', async ({ browser, owner }) => {
  seedBookmarks(owner, [{ url: `${SITE_URL}/articulo`, title: 'En la papelera', trashed: true }]);
  const ctx = await browser.newContext({ baseURL: APP_URL });
  const page = await ctx.newPage();
  await page.goto(popupUrl(tokenOf(owner), `${SITE_URL}/articulo`));
  await expect(page.getByRole('heading', { name: 'Ya estaba guardado' })).toBeVisible();
  await expect(page.getByText('En la papelera')).toHaveCount(0);
  const n = e2eDb().get<{ n: number }>('SELECT count(*) AS n FROM bookmarks WHERE user_id = ? AND trashed_at IS NOT NULL', owner.id)!.n;
  expect(n).toBe(1);
  await ctx.close();
});

test('permisos: bob no ve el guardado ni el favicon de alice', async ({ signedIn: page, owner, browser }) => {
  await page.goto(popupUrl(tokenOf(owner), `${SITE_URL}/articulo`));
  await page.waitForURL(/\/bookmarklet\/guardado\/(\d+)$/);
  const id = page.url().split('/').pop()!;
  e2eDb().run(
    `INSERT INTO favicons (user_id, domain, status, content_type, bytes, fetched_at) VALUES (?, 'localhost', 'succeeded', 'image/png', ?, ?)
     ON CONFLICT (user_id, domain) DO UPDATE SET status = 'succeeded', content_type = 'image/png', bytes = excluded.bytes`,
    owner.id, PNG_1X1, Date.now(),
  );
  // El dueño recibe la imagen con sus cabeceras de seguridad.
  const own = await page.request.get('/favicons/localhost');
  expect(own.status()).toBe(200);
  expect(own.headers()['content-type']).toBe('image/png');
  expect(own.headers()['x-content-type-options']).toBe('nosniff');
  expect(own.headers()['content-security-policy']).toBe("default-src 'none'; sandbox");
  expect(own.headers()['cache-control']).toBe('private, max-age=86400');

  const bob = await createOwner('bob');
  const ctx = await browser.newContext({ baseURL: APP_URL });
  const bobPage = await ctx.newPage();
  await login(bobPage, bob);
  const res = await bobPage.goto(`/bookmarklet/guardado/${id}`);
  expect(res!.status()).toBe(404);
  const fav = await bobPage.request.get('/favicons/localhost');
  expect(fav.status()).toBe(404);
  // Sin sesión tampoco hay favicon.
  const anon = await ctx.browser()!.newContext({ baseURL: APP_URL });
  expect((await anon.request.get('/favicons/localhost')).status()).toBe(404);
  await anon.close();
  await ctx.close();
});
