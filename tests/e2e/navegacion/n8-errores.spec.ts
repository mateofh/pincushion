// N8: páginas 403/404/429/500 con mensaje humano, "Código de referencia" que coincide con X-Request-Id y botón para continuar.
import type { Page, Response } from '@playwright/test';
import { test, expect } from '../fixtures/test.ts';
import { noHorizontalScroll, tapTargetsAtLeast } from '../helpers/ui.ts';

/** El código mostrado es el X-Request-Id de la respuesta (así se cruza con los logs). */
async function expectReferencia(page: Page, res: Response): Promise<string> {
  const id = res.headers()['x-request-id'] ?? '';
  expect(id, 'la respuesta lleva X-Request-Id').toMatch(/^[A-Za-z0-9-]{8,64}$/);
  const ref = page.locator('.ref code');
  await expect(page.locator('.ref')).toContainText('Código de referencia');
  await expect(ref).toHaveText(id);
  return id;
}

async function expectLayoutSano(page: Page) {
  await noHorizontalScroll(page);
  await tapTargetsAtLeast(page, 44);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('main')).toBeVisible();
}

test('N8: 404 de una ruta inventada, con sesión @movil', async ({ signedIn: page }) => {
  const res = (await page.goto('/esta-ruta-no-existe'))!;
  expect(res.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'No encontramos esta página' })).toBeVisible();
  await expect(page.getByText(/enlace haya cambiado|dirección esté mal escrita/)).toBeVisible();
  await expectReferencia(page, res);
  await expectLayoutSano(page);
  await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
  await page.getByRole('link', { name: 'Volver a la Biblioteca' }).click();
  await expect(page).toHaveURL('/');
});

test('N8: 404 de un enlace que no existe y de un id absurdo @movil', async ({ signedIn: page }) => {
  for (const ruta of ['/enlaces/99999999', '/enlaces/abc', '/colecciones/99999999']) {
    const res = (await page.goto(ruta))!;
    expect(res.status(), ruta).toBe(404);
    await expect(page.getByRole('link', { name: 'Volver a la Biblioteca' })).toBeVisible();
    await expectReferencia(page, res);
  }
});

test('N8: 403 por formulario con CSRF inválido, sin cambios @movil', async ({ signedIn: page }) => {
  await page.goto('/ajustes');
  await page.locator('form:has(select[name="timezone"]) input[name="_csrf"]').evaluate((el) => ((el as HTMLInputElement).value = 'caducado'));
  await page.getByLabel('Zona horaria').selectOption('America/Bogota');
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/ajustes')),
    page.getByRole('button', { name: 'Guardar zona horaria' }).click(),
  ]);
  expect(res.status()).toBe(403);
  await expect(page.getByRole('heading', { level: 1, name: 'Este formulario caducó' })).toBeVisible();
  await expect(page.getByText(/Recarga la página/)).toBeVisible();
  await expectReferencia(page, res);
  await expectLayoutSano(page);
  await page.getByRole('link', { name: 'Ir a la Biblioteca' }).click();
  await expect(page).toHaveURL('/');
});

test('N8: 403 sin sesión ofrece Ir a Entrar @movil', async ({ page }) => {
  // JSON: el checkOrigin de Astro (solo formularios) no actúa; el del middleware sí y responde con nuestra página.
  const res = await page.request.post('/entrar', {
    data: JSON.stringify({ email: 'x@example.com', password: 'x' }),
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(403);
  const id = res.headers()['x-request-id'] ?? '';
  const html = await res.text();
  expect(html).toContain('Ir a Entrar');
  expect(html.match(/<code[^>]*>([^<]+)<\/code>/)?.[1], 'el código de referencia mostrado es el X-Request-Id').toBe(id);
});

test('N8: página 429 con espera, Retry-After y salida @movil', async ({ signedIn: page }) => {
  const res = (await page.goto('/429?espera=30'))!;
  expect(res.status()).toBe(429);
  expect(res.headers()['retry-after']).toBe('30');
  await expect(page.getByRole('heading', { level: 1, name: 'Demasiados intentos' })).toBeVisible();
  await expect(page.getByText('Demasiados intentos, espera 30 s')).toBeVisible();
  await expectReferencia(page, res);
  await expectLayoutSano(page);
  await page.getByRole('link', { name: 'Volver a la Biblioteca' }).click();
  await expect(page).toHaveURL('/');
});

test('N8: 429 real en Entrar tras 20 intentos fallidos del mismo email desde la misma IP @movil', async ({ page, owner }) => {
  // El límite por minuto del servidor e2e es alto (1000), pero el de 20/h por (email, IP) es el real.
  for (let i = 0; i < 20; i++) {
    const r = await page.request.post('/entrar', { form: { email: owner.email, password: `mala-${i}`, next: '/' }, maxRedirects: 0 });
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
  // No se pierde el email y el formulario sigue ahí para reintentar más tarde
  await expect(page.getByLabel('Email')).toHaveValue(owner.email);
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  expect(res.headers()['x-request-id']).toMatch(/^[A-Za-z0-9-]{8,64}$/);
});

test('N8: página 500 con mensaje, código de referencia y salida @movil', async ({ signedIn: page }) => {
  // /500 es pública y responde con el mismo estado que un fallo real.
  const res = (await page.goto('/500'))!;
  expect(res.status()).toBe(500);
  await expect(page.getByRole('heading', { level: 1, name: 'Algo falló de nuestro lado' })).toBeVisible();
  await expect(page.getByText(/No perdiste nada/)).toBeVisible();
  await expectReferencia(page, res);
  await expectLayoutSano(page);
  await page.getByRole('link', { name: 'Volver a la Biblioteca' }).click();
  await expect(page).toHaveURL('/');
});

test('N8: un fallo real del servidor (cuerpo multipart corrupto) muestra la página 500 con su código', async ({ page }) => {
  const res = await page.request.post('/entrar', {
    data: '--límite\r\ncontent-disposition: form-data; name="email"\r\n\r\ncorrupto sin cierre',
    headers: { 'content-type': 'multipart/form-data; boundary=otro-limite' },
    maxRedirects: 0,
  });
  // Provocarlo es seguro (no toca datos); lo importante es que, sea cual sea el código, el cuerpo sea la página humana y no un volcado.
  const html = await res.text();
  expect(html).not.toMatch(/at .*\.(ts|mjs|js):\d+|node_modules|Error:/);
  if (res.status() === 500) {
    expect(html).toContain('Algo falló de nuestro lado');
    expect(html).toContain(res.headers()['x-request-id']);
  } else {
    expect([400, 422, 429]).toContain(res.status());
  }
});

test('N8: sin sesión, 404 y 500 siguen siendo páginas humanas con salida', async ({ page }) => {
  const res = (await page.goto('/500'))!;
  expect(res.status()).toBe(500);
  await expect(page.getByRole('link', { name: 'Volver a la Biblioteca' })).toBeVisible();
  await expect(page.locator('.ref')).toContainText('Código de referencia');
});
