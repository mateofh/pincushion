// Ningún estado se comunica solo por color: favorito, seleccionado y fallo tienen texto accesible (y marca visible).
import { test, expect, seedBookmarks } from '../fixtures/test.ts';

test('favorito: nombre accesible + aria-pressed + marca no cromática [requiere: biblioteca] @movil', async ({ signedIn: page, owner }) => {
  const [normal, fav] = seedBookmarks(owner, [
    { url: 'https://example.com/c1', title: 'Normal' },
    { url: 'https://example.com/c2', title: 'Favorito marcado', isFavorite: true },
  ]);
  await page.goto('/');
  const botonNormal = page.locator(`article[data-bookmark-id="${normal.id}"]`).getByRole('button', { name: 'Marcar como favorito' });
  const botonFav = page.locator(`article[data-bookmark-id="${fav.id}"]`).getByRole('button', { name: 'Quitar de favoritos' });
  await expect(botonNormal).toHaveAttribute('aria-pressed', 'false');
  await expect(botonFav).toHaveAttribute('aria-pressed', 'true');
  // Además del nombre, el botón lleva un icono distinto por estado (la forma, no solo el color)
  const forma = async (b: typeof botonFav) => b.evaluate((el) => el.querySelector('svg, img')?.outerHTML ?? el.textContent ?? '');
  expect(await forma(botonNormal)).not.toBe(await forma(botonFav));
});

test('seleccionado: casilla nativa con estado + conteo textual [requiere: biblioteca] @movil', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, [{ url: 'https://example.com/s1', title: 'Seleccionable' }, { url: 'https://example.com/s2', title: 'Otro' }]);
  await page.goto('/');
  const box = page.getByRole('checkbox', { name: 'Seleccionar «Seleccionable»' });
  await expect(box).not.toBeChecked();
  await box.check();
  await expect(box).toBeChecked();
  // El estado "seleccionado" se anuncia también como texto, no solo se pinta
  await expect(page.getByText(/1 seleccionado/)).toBeVisible();
  // La tarjeta seleccionada se distingue sin color: tiene aria-selected/atributo o un indicador textual
  const tarjeta = page.locator('article', { has: box });
  const marca = await tarjeta.evaluate((el) => ({ attrs: el.getAttribute('aria-selected') ?? el.getAttribute('data-selected'), outline: getComputedStyle(el).outlineStyle !== 'none' || getComputedStyle(el).borderTopWidth !== getComputedStyle(el).borderBottomWidth || getComputedStyle(el).boxShadow !== 'none' }));
  expect(Boolean(marca.attrs) || marca.outline, 'la selección tiene una marca estructural o de forma').toBe(true);
});

test('fallo del fetch: texto "No se pudo leer la página" y acción Reintentar, no solo un color [requiere: biblioteca] @movil', async ({ signedIn: page, owner }) => {
  const [roto, espera, reintento, ok] = seedBookmarks(owner, [
    { url: 'https://example.com/e1', title: 'Roto', fetchStatus: 'failed' },
    { url: 'https://example.com/e2', title: 'En espera', fetchStatus: 'pending' },
    { url: 'https://example.com/e3', title: 'Reintentando', fetchStatus: 'retrying' },
    { url: 'https://example.com/e4', title: 'Listo', fetchStatus: 'succeeded' },
  ]);
  await page.goto('/');
  const esperado: Array<[number, string, string]> = [
    [roto.id, 'failed', 'No se pudo leer la página'],
    [espera.id, 'pending', 'Obteniendo datos…'],
    [reintento.id, 'retrying', 'Reintentando…'],
    [ok.id, 'succeeded', 'Datos obtenidos'],
  ];
  for (const [id, estado, texto] of esperado) {
    const badge = page.locator(`article[data-bookmark-id="${id}"] [data-fetch-status="${estado}"]`);
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(texto);
  }
  await expect(page.locator(`article[data-bookmark-id="${roto.id}"]`).getByRole('button', { name: 'Reintentar' })).toBeVisible();
});

test('errores de formulario: texto junto al campo y aria-invalid, no solo borde rojo [requiere: guardar] @movil', async ({ signedIn: page }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill('no es una url');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  const campo = page.getByLabel('URL');
  await expect(campo).toHaveAttribute('aria-invalid', 'true');
  const msg = await page.locator(`#${(await campo.getAttribute('aria-describedby'))!.split(' ')[0]}`).innerText();
  expect(msg.trim().length).toBeGreaterThan(5);
});

test('aviso de login con error: rol alert con texto @movil', async ({ page, owner }) => {
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Contraseña').fill('mal');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toHaveText('El email o la contraseña no coinciden.');
  await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
});

test('enlace activo del menú: aria-current + subrayado, no solo color @movil', async ({ signedIn: page }) => {
  await page.goto('/ajustes');
  const activo = page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Ajustes' });
  await expect(activo).toHaveAttribute('aria-current', 'page');
  expect(await activo.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain('underline');
});
