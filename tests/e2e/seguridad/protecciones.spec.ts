// 403 por CSRF/origen, 429 de login, páginas de error y cabeceras de caché.
import { test, expect, e2eDb } from '../fixtures/test.ts';

test('403 con CSRF inválido: mensaje humano y no se guarda nada', async ({ signedIn: page, owner }) => {
  await page.goto('/guardar');
  await page.locator('form:has(#url) input[name="_csrf"]').evaluate((el) => ((el as HTMLInputElement).value = 'manipulado'));
  await page.getByLabel('URL').fill('https://example.com/csrf');
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/guardar')),
    page.getByRole('button', { name: 'Guardar', exact: true }).click(),
  ]);
  expect(res.status()).toBe(403);
  await expect(page.getByRole('heading', { name: 'Este formulario caducó' })).toBeVisible();
  await expect(page.getByText('Código de referencia')).toBeVisible();
  expect(e2eDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ?', owner.id)!.n).toBe(0);
});

test('403 si el Origin no es APP_ORIGIN aunque el token CSRF sea válido', async ({ signedIn: page, owner }) => {
  const csrf = await page.locator('meta[name="csrf-token"]').getAttribute('content');
  expect(csrf).toBeTruthy();
  // JSON: el checkOrigin de Astro no lo mira; el del middleware sí.
  const res = await page.request.post('/guardar', {
    data: JSON.stringify({ url: 'https://example.com/origen' }),
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf!, Origin: 'https://evil.example' },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(403);
  expect(await res.text()).toContain('Este formulario caducó');
  // Formulario desde otro sitio, sin sesión: también 403.
  const anon = await page.request.post('/entrar', {
    form: { email: owner.email, password: owner.password },
    headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
    maxRedirects: 0,
  });
  expect(anon.status()).toBe(403);
});

test('429 de login tras 20 intentos por (email, IP): mensaje y Retry-After', async ({ page, owner }) => {
  for (let i = 0; i < 20; i++) {
    const r = await page.request.post('/entrar', { form: { email: owner.email, password: 'mala-' + i, next: '/' }, maxRedirects: 0 });
    expect(r.status()).toBe(422);
  }
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Contraseña').fill(owner.password);
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/entrar')),
    page.getByRole('button', { name: 'Entrar' }).click(),
  ]);
  expect(res.status()).toBe(429);
  expect(Number(res.headers()['retry-after'])).toBeGreaterThan(0);
  await expect(page.getByRole('alert')).toHaveText(/^Demasiados intentos, espera \d+ s$/);
  await expect(page).toHaveURL(/\/entrar/);
});

test('N8: página 429 y 403 con mensaje, referencia y salida @movil', async ({ page }) => {
  const res = await page.goto('/429?espera=30');
  expect(res!.status()).toBe(429);
  expect(res!.headers()['retry-after']).toBe('30');
  await expect(page.getByRole('heading', { name: 'Demasiados intentos' })).toBeVisible();
  await expect(page.getByText('Demasiados intentos, espera 30 s')).toBeVisible();
  await expect(page.getByText('Código de referencia')).toBeVisible();
  const r403 = await page.goto('/403');
  expect(r403!.status()).toBe(403);
  await expect(page.getByRole('link', { name: 'Ir a Entrar' })).toBeVisible();
});

test('/ajustes, /entrar y /bookmarklet van con Cache-Control: no-store', async ({ signedIn: page }) => {
  const a = await page.goto('/ajustes');
  expect(a!.headers()['cache-control']).toBe('no-store');
  const e = await page.request.get('/entrar', { maxRedirects: 0 });
  expect(e.headers()['cache-control']).toBe('no-store');
  const b = await page.request.get('/bookmarklet', { maxRedirects: 0 });
  expect(b.headers()['cache-control']).toBe('no-store');
});
