// axe-core (WCAG 2 A/AA): cero violaciones serias o críticas en cada pantalla y en los estados clave, en móvil y escritorio.
import { test, expect, login, seedBookmarks } from '../fixtures/test.ts';
import { expectNoSeriousAxe, PANTALLAS } from '../helpers/ui.ts';

const DATOS = [
  { url: 'https://example.com/pan', title: 'Pan de masa madre', description: 'Receta paso a paso', excerpt: 'harina agua sal y paciencia', tags: ['cocina', 'pan'] },
  { url: 'https://example.com/viaje', title: 'Guía de Lisboa', tags: ['viajes'], isFavorite: true },
  { url: 'https://example.com/roto', title: 'Página que no se pudo leer', fetchStatus: 'failed' as const },
  { url: 'https://example.com/espera', title: 'Esperando datos', fetchStatus: 'pending' as const },
];

for (const p of PANTALLAS) {
  const req = p.requiere ? ` [requiere: ${p.requiere}]` : '';
  test(`axe: ${p.ruta} con datos${req} @movil`, async ({ signedIn: page, owner }) => {
    seedBookmarks(owner, DATOS);
    const res = await page.goto(p.ruta);
    expect(res!.status(), `${p.ruta} existe`).toBe(200);
    await expectNoSeriousAxe(page, { label: p.ruta });
  });
}

test('axe: Biblioteca vacía (primer uso) [requiere: biblioteca] @movil', async ({ signedIn: page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Biblioteca' })).toBeVisible();
  await expectNoSeriousAxe(page, { label: 'Biblioteca vacía' });
});

test('axe: Biblioteca en vista lista, con selección y filtros sin resultados [requiere: biblioteca] @movil', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, DATOS);
  await page.goto('/?vista=lista');
  await expectNoSeriousAxe(page, { label: 'Biblioteca lista' });
  await page.getByRole('checkbox', { name: 'Seleccionar «Pan de masa madre»' }).check();
  await expectNoSeriousAxe(page, { label: 'Biblioteca con selección' });
  await page.goto('/?etiqueta=no-existe');
  await expect(page.getByRole('link', { name: 'Quitar filtros' })).toBeVisible();
  await expectNoSeriousAxe(page, { label: 'Biblioteca sin resultados' });
});

test('axe: Biblioteca, lote sin selección muestra el error y sigue accesible [requiere: biblioteca] @movil', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, DATOS);
  await page.goto('/');
  await page.getByRole('button', { name: 'Mover a la papelera' }).click();
  await expect(page.getByText('Selecciona al menos un enlace')).toBeVisible();
  await expectNoSeriousAxe(page, { label: 'lote sin selección' });
});

test('axe: Guardar con error de validación conservando lo escrito [requiere: guardar] @movil', async ({ signedIn: page }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill('esto no es una url');
  await page.getByLabel('Título').fill('Lo que escribí');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByLabel('Título')).toHaveValue('Lo que escribí');
  await expect(page.getByLabel('URL')).toHaveAttribute('aria-invalid', 'true');
  await expectNoSeriousAxe(page, { label: 'Guardar inválido' });
});

test('axe: Guardar con duplicado y con papelera [requiere: guardar] @movil', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, [{ url: 'https://example.com/ya-guardado', title: 'Ya guardado' }]);
  await page.goto('/guardar?url=' + encodeURIComponent('https://example.com/ya-guardado'));
  await expect(page.getByText(/Ya lo guardaste/)).toBeVisible();
  await expectNoSeriousAxe(page, { label: 'Guardar duplicado' });
});

test('axe: Buscar sin consulta, con resultados y sin resultados [requiere: buscar] @movil', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, DATOS);
  await page.goto('/buscar');
  await expectNoSeriousAxe(page, { label: 'Buscar vacío' });
  await page.goto('/buscar?q=masa');
  await expect(page.locator('mark').first()).toBeVisible();
  await expectNoSeriousAxe(page, { label: 'Buscar con resultados' });
  await page.goto('/buscar?q=zzzinexistente');
  await expectNoSeriousAxe(page, { label: 'Buscar sin resultados' });
});

test('axe: Bookmarklet primer uso y con prueba esperando [requiere: guardar] @movil', async ({ signedIn: page }) => {
  await page.goto('/bookmarklet');
  await expectNoSeriousAxe(page, { label: 'Bookmarklet' });
  const res = await page.goto('/bookmarklet/prueba');
  expect(res!.status()).toBe(200);
  await expectNoSeriousAxe(page, { label: 'Bookmarklet prueba' });
});

test('axe: popup del bookmarklet sin sesión con token inválido [requiere: guardar] @movil', async ({ page }) => {
  const res = await page.goto('/bookmarklet/guardar#t=token-que-no-vale&u=' + encodeURIComponent('https://example.com/pagina') + '&ti=Ejemplo');
  expect(res!.status(), 'el shell del popup es público').toBe(200);
  await expect(page.getByRole('main')).toContainText(/no es válido|ya no es válido|Guardando|Guardado/);
  await expectNoSeriousAxe(page, { label: 'popup sin sesión' });
});

test('axe: Entrar, con error de credenciales y con sesión expirada @movil', async ({ page, owner }) => {
  await page.goto('/entrar');
  await expectNoSeriousAxe(page, { label: 'Entrar' });
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Contraseña').fill('incorrecta');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expectNoSeriousAxe(page, { label: 'Entrar con error' });
  await page.goto('/entrar?expirada=1');
  await expect(page.getByRole('status').filter({ hasText: 'Tu sesión expiró' })).toBeVisible();
  await expectNoSeriousAxe(page, { label: 'Entrar sesión expirada' });
});

test('axe: Ajustes con error de validación @movil', async ({ signedIn: page }) => {
  await page.goto('/ajustes');
  await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await expect(page.getByRole('alert').or(page.locator('.error')).first()).toBeVisible();
  await expectNoSeriousAxe(page, { label: 'Ajustes con error' });
});

test('axe: páginas de error 403, 404, 429 y 500 @movil', async ({ signedIn: page }) => {
  for (const ruta of ['/esta-ruta-no-existe', '/429?espera=30', '/500']) {
    await page.goto(ruta);
    await expectNoSeriousAxe(page, { label: ruta });
  }
  await page.goto('/ajustes');
  await page.locator('form:has(select[name="timezone"]) input[name="_csrf"]').evaluate((el) => ((el as HTMLInputElement).value = 'x'));
  await page.getByRole('button', { name: 'Guardar zona horaria' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Este formulario caducó' })).toBeVisible();
  await expectNoSeriousAxe(page, { label: '403' });
});

test('axe: flash de éxito tras PRG @movil', async ({ page, owner }) => {
  await login(page, owner, '/ajustes');
  await page.getByLabel('Zona horaria').selectOption('America/Bogota');
  await page.getByRole('button', { name: 'Guardar zona horaria' }).click();
  await expect(page.locator('#flash').filter({ hasText: 'Zona horaria guardada.' })).toBeVisible();
  await expectNoSeriousAxe(page, { label: 'flash de éxito' });
});
