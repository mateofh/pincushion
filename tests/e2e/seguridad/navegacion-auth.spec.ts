// N4, N5, N7 y salir: sesión, regreso al destino y recuperación de lo escrito con la sesión expirada.
import { test, expect, login, e2eDb, APP_URL } from '../fixtures/test.ts';

async function fillLogin(page: import('@playwright/test').Page, email: string, password: string) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test('N4: sin sesión una página protegida lleva a /entrar?next= y vuelve al destino @sin-js', async ({ page, owner }) => {
  await page.goto('/buscar?q=pan');
  await expect(page).toHaveURL(/\/entrar\?next=%2Fbuscar%3Fq%3Dpan$/);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await fillLogin(page, owner.email, owner.password);
  await expect(page).toHaveURL('/buscar?q=pan');
});

test('N4: credenciales incorrectas dan un mensaje genérico y conservan el email', async ({ page, owner }) => {
  await page.goto('/entrar');
  await fillLogin(page, owner.email, 'no-es-la-contraseña');
  await expect(page.getByRole('alert')).toHaveText('El email o la contraseña no coinciden.');
  await expect(page.getByLabel('Email')).toHaveValue(owner.email);
  await fillLogin(page, 'nadie-' + owner.email, 'no-es-la-contraseña');
  await expect(page.getByRole('alert')).toHaveText('El email o la contraseña no coinciden.');
});

test('N5: sesión expirada al guardar → entrar → reenviar sin perder lo escrito', async ({ signedIn: page, owner }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill('https://example.com/receta-de-sesion-expirada');
  await page.getByLabel('Título').fill('Receta escrita antes de expirar');
  await page.getByLabel('Etiquetas').fill('cocina, n5');

  e2eDb().run('UPDATE sessions SET expires_at = ? WHERE user_id = ?', Date.now() - 1000, owner.id);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();

  await expect(page).toHaveURL(/\/entrar\?.*expirada=1/);
  await expect(page.getByRole('status').filter({ hasText: 'Tu sesión expiró' })).toBeVisible();
  await fillLogin(page, owner.email, owner.password);

  await expect(page.getByRole('heading', { name: 'Recuperamos tus cambios' })).toBeVisible();
  const summary = page.getByRole('definition');
  await expect(summary.filter({ hasText: 'Receta escrita antes de expirar' })).toBeVisible();
  await expect(summary.filter({ hasText: 'cocina, n5' })).toBeVisible();
  await page.getByRole('button', { name: 'Reenviar cambios' }).click();

  await expect(page).toHaveURL('/');
  await expect(page.getByRole('status')).toContainText('Enlace guardado');
  await expect(page.getByRole('link', { name: 'Receta escrita antes de expirar' })).toBeVisible();
  const n = e2eDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ?', owner.id)!.n;
  expect(n).toBe(1);

  // El borrador ya no se ofrece después de usarlo.
  await page.goto('/entrar?recuperar=1');
  await expect(page).toHaveURL('/');
});

test('N5: el borrador se puede descartar y no se guarda nada', async ({ signedIn: page, owner }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill('https://example.com/descartado');
  await page.getByLabel('Título').fill('Esto se descarta');
  e2eDb().run('UPDATE sessions SET expires_at = ? WHERE user_id = ?', Date.now() - 1000, owner.id);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await fillLogin(page, owner.email, owner.password);
  await page.getByRole('button', { name: 'Descartar cambios' }).click();
  // Sin Referer (Referrer-Policy: no-referrer) el origen del formulario se desconoce: vuelve a la Biblioteca.
  await expect(page).toHaveURL('/');
  await page.goto('/entrar?recuperar=1');
  await expect(page).toHaveURL('/');
  expect(e2eDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ?', owner.id)!.n).toBe(0);
});

test('N5: con HTMX y la sesión expirada responde 401 + HX-Redirect', async ({ signedIn: page, owner }) => {
  e2eDb().run('UPDATE sessions SET expires_at = ? WHERE user_id = ?', Date.now() - 1000, owner.id);
  const res = await page.request.post('/guardar', { form: { url: 'https://example.com/x' }, headers: { 'HX-Request': 'true' }, maxRedirects: 0 });
  expect(res.status()).toBe(401);
  expect(res.headers()['hx-redirect']).toMatch(/^\/entrar\?next=.*expirada=1/);
});

for (const evil of ['//evil.com', 'https://evil.com/x', 'javascript:alert(1)', '/\\evil.com', '%2F%2Fevil.com']) {
  test(`N7: next malicioso ${evil} se ignora y lleva a /`, async ({ page, owner }) => {
    await page.goto(`/entrar?next=${encodeURIComponent(evil)}`);
    await fillLogin(page, owner.email, owner.password);
    await page.waitForURL((u) => !u.pathname.startsWith('/entrar'));
    expect(page.url()).toBe(`${APP_URL}/`);
    // Con sesión, GET /entrar?next=… también lo ignora.
    await page.goto(`/entrar?next=${encodeURIComponent(evil)}`);
    expect(page.url()).toBe(`${APP_URL}/`);
  });
}

test('Salir revoca la sesión: volver atrás no da acceso', async ({ signedIn: page }) => {
  await page.getByRole('button', { name: 'Salir' }).click();
  await expect(page).toHaveURL('/entrar');
  await page.goto('/');
  await expect(page).toHaveURL(/\/entrar\?next=%2F/);
});

test('el login emite una sesión nueva y revoca la anterior del navegador', async ({ page, owner, context }) => {
  await login(page, owner);
  const first = (await context.cookies()).find((c) => c.name === 'pc_session')!.value;
  e2eDb().run('UPDATE sessions SET expires_at = ? WHERE user_id = ?', Date.now() - 1000, owner.id);
  await page.goto('/');
  await expect(page).toHaveURL(/\/entrar\?next=%2F&expirada=1/);
  await fillLogin(page, owner.email, owner.password);
  await expect(page).toHaveURL('/');
  const second = (await context.cookies()).find((c) => c.name === 'pc_session')!.value;
  expect(second).not.toBe(first);
  const rows = e2eDb().all<{ revoked_at: number | null }>('SELECT revoked_at FROM sessions WHERE user_id = ? ORDER BY created_at', owner.id);
  expect(rows).toHaveLength(2);
  expect(rows[0]!.revoked_at).not.toBeNull();
  expect(rows[1]!.revoked_at).toBeNull();
});
