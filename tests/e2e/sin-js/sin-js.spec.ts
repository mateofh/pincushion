// Todo funciona con JavaScript desactivado: entrar, Guardar en dos pasos, Biblioteca con selección masiva, Buscar,
// editar y papelera. `javaScriptEnabled: false` también en el proyecto de escritorio, para que el test sea el mismo en ambos.
import { test, expect, e2eApp, e2eDb, seedBookmarks, SITE_URL } from '../fixtures/test.ts';
import { collectionService } from '../../../src/server/services/collections.ts';

test.use({ javaScriptEnabled: false });

test('sin JS: entrar con credenciales y volver al destino @sin-js', async ({ page, owner }) => {
  await page.goto('/buscar?q=pan');
  await expect(page).toHaveURL(/\/entrar\?next=/);
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Contraseña').fill('mal');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toHaveText('El email o la contraseña no coinciden.');
  await expect(page.getByLabel('Email')).toHaveValue(owner.email);
  await page.getByLabel('Contraseña').fill(owner.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL('/buscar?q=pan');
  await page.getByRole('button', { name: 'Salir' }).click();
  await expect(page).toHaveURL(/\/entrar/);
});

test('sin JS: Guardar en dos pasos (Obtener datos → Guardar) [requiere: guardar] @sin-js', async ({ signedIn: page, owner }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill(`${SITE_URL}/articulo`);
  await page.getByRole('button', { name: 'Obtener datos' }).click();
  // Paso 1: la página vuelve con los datos obtenidos y lo escrito conservado
  await expect(page.getByLabel('Título')).toHaveValue('Pan de masa madre en casa');
  await expect(page.getByLabel('URL')).toHaveValue(`${SITE_URL}/articulo`);
  await expect(page.getByText(/Datos obtenidos de localhost/)).toBeVisible();
  // Paso 2: guardar con etiquetas
  await page.getByLabel('Etiquetas').fill('cocina, pan');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.locator('#flash').filter({ hasText: 'Enlace guardado' })).toBeVisible();
  const row = e2eDb().get<{ title: string; id: number }>('SELECT id, title FROM bookmarks WHERE user_id = ?', owner.id)!;
  expect(row.title).toBe('Pan de masa madre en casa');
  // Doble envío / recarga: un solo enlace
  await page.reload();
  expect(e2eDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ?', owner.id)!.n).toBe(1);
});

test('sin JS: Guardar con URL inválida conserva lo escrito [requiere: guardar] @sin-js', async ({ signedIn: page }) => {
  await page.goto('/guardar');
  await page.getByLabel('URL').fill('esto no es una url');
  await page.getByLabel('Título').fill('Mi título');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByLabel('Título')).toHaveValue('Mi título');
  await expect(page.getByLabel('URL')).toHaveValue('esto no es una url');
  await expect(page.getByLabel('URL')).toHaveAttribute('aria-invalid', 'true');
});

test('sin JS: Biblioteca con selección masiva, etiquetar y mover (J2) [requiere: biblioteca] @sin-js', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, [
    { url: 'https://example.com/m1', title: 'Masivo uno' },
    { url: 'https://example.com/m2', title: 'Masivo dos' },
    { url: 'https://example.com/m3', title: 'Masivo tres' },
    { url: 'https://example.com/m4', title: 'Masivo cuatro' },
  ]);
  collectionService(e2eApp()).create(owner.id, 'Lectura');
  await page.goto('/');

  // Lote sin selección: validación visible
  await page.getByRole('button', { name: 'Favorito', exact: true }).click();
  await expect(page.getByText('Selecciona al menos un enlace')).toBeVisible();

  for (const t of ['Masivo uno', 'Masivo dos', 'Masivo tres']) await page.getByRole('checkbox', { name: `Seleccionar «${t}»` }).check();
  await page.getByRole('textbox', { name: /etiqueta/i }).last().fill('lote-sin-js');
  await page.getByRole('button', { name: 'Añadir etiqueta' }).click();
  await expect(page.locator('#flash').filter({ hasText: /etiqueta/i })).toBeVisible();
  expect(
    e2eDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.user_id = ? AND t.name_key = 'lote-sin-js'", owner.id)!.n,
  ).toBe(3);

  for (const t of ['Masivo uno', 'Masivo dos', 'Masivo tres']) await page.getByRole('checkbox', { name: `Seleccionar «${t}»` }).check();
  await page.getByRole('combobox', { name: /Mover a|Colecci/i }).first().selectOption({ label: 'Lectura' });
  await page.getByRole('button', { name: /^Mover/ }).first().click();
  await expect(page.locator('#flash').filter({ hasText: /Lectura/ })).toBeVisible();
  await page.getByRole('link', { name: /Lectura/ }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Lectura' })).toBeVisible();
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(3);
});

test('sin JS: favorito desde la Biblioteca y filtros por URL [requiere: biblioteca] @sin-js', async ({ signedIn: page, owner }) => {
  const [a] = seedBookmarks(owner, [{ url: 'https://example.com/fj', title: 'Favorito sin JS' }, { url: 'https://example.com/fk', title: 'Otro enlace' }]);
  await page.goto('/');
  await page.locator(`article[data-bookmark-id="${a.id}"]`).getByRole('button', { name: 'Marcar como favorito' }).click();
  await expect(page.locator('#flash')).toContainText(/Favoritos/);
  await page.goto('/?favoritos=1');
  await expect(page.getByRole('heading', { level: 1, name: 'Favoritos' })).toBeVisible();
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(1);
  await page.goto('/?vista=lista&orden=titulo');
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(2);
});

test('sin JS: Buscar por la barra global y abrir el resultado (J3) [requiere: buscar] @sin-js', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, [
    { url: 'https://example.com/b1', title: 'Cuaderno de nubes', excerpt: 'Una frase memorable sobre nube de algodón' },
    { url: 'https://example.com/b2', title: 'Otro sin relación' },
  ]);
  await page.goto('/');
  await page.getByRole('search').getByLabel('Buscar en tus enlaces').fill('nube de algodón');
  await page.keyboard.press('Enter'); // el formulario GET se envía sin JS
  await expect(page).toHaveURL(/\/buscar\?q=nube/);
  await expect(page.getByRole('region', { name: 'Resultados' }).locator('article[data-bookmark-id]')).toHaveCount(1);
  await expect(page.locator('mark').first()).toBeVisible();
  await expect(page.getByText(/1 resultado/)).toBeVisible();
  await page.getByRole('region', { name: 'Resultados' }).getByRole('button', { name: 'Marcar como favorito' }).click();
  await expect(page.getByRole('region', { name: 'Resultados' }).getByRole('button', { name: 'Quitar de favoritos' })).toBeVisible();
});

test('sin JS: editar un enlace y volver con confirmación [requiere: biblioteca] @sin-js', async ({ signedIn: page, owner }) => {
  const [a] = seedBookmarks(owner, [{ url: 'https://example.com/ed', title: 'Título original', tags: ['uno'] }]);
  await page.goto(`/enlaces/${a.id}`);
  await page.getByLabel('Título').fill('Título editado sin JS');
  await page.getByLabel('Etiquetas').fill('uno, dos');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('#flash')).toBeVisible();
  const row = e2eDb().get<{ title: string }>('SELECT title FROM bookmarks WHERE id = ?', a.id)!;
  expect(row.title).toBe('Título editado sin JS');
  // Validación: título demasiado largo se rechaza junto al campo y conserva lo escrito
  await page.goto(`/enlaces/${a.id}`);
  await page.getByLabel('Título').fill('x'.repeat(301));
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByLabel('Título')).toHaveAttribute('aria-invalid', 'true');
});

test('sin JS: papelera, Deshacer, restaurar y eliminar con confirmación [requiere: biblioteca] @sin-js', async ({ signedIn: page, owner }) => {
  const [a, b] = seedBookmarks(owner, [
    { url: 'https://example.com/p1', title: 'Para la papelera' },
    { url: 'https://example.com/p2', title: 'Para eliminar' },
  ]);
  await page.goto('/');
  await page.locator(`article[data-bookmark-id="${a.id}"]`).getByRole('button', { name: /papelera/i }).click();
  await expect(page.locator('#flash')).toContainText(/papelera/i);
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.locator(`article[data-bookmark-id="${a.id}"]`)).toBeVisible();

  await page.locator(`article[data-bookmark-id="${b.id}"]`).getByRole('button', { name: /papelera/i }).click();
  await page.goto('/papelera');
  await expect(page.getByText(/30 días/)).toBeVisible();
  await page.locator(`article[data-bookmark-id="${b.id}"]`).getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.locator('#flash')).toBeVisible();

  await page.locator(`article[data-bookmark-id="${b.id}"]`).getByRole('button', { name: /papelera/i }).click();
  await page.goto('/papelera');
  await page.locator(`article[data-bookmark-id="${b.id}"]`).getByRole('link', { name: /Eliminar/ }).click();
  await expect(page.getByText(/para siempre/)).toBeVisible();
  await page.getByRole('button', { name: /Eliminar definitivamente/ }).click();
  expect(e2eDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM bookmarks WHERE id = ?', b.id)!.n).toBe(0);
});

test('sin JS: Ajustes (zona horaria) y la barra global siguen utilizables @sin-js', async ({ signedIn: page }) => {
  await page.getByRole('link', { name: 'Ajustes' }).click();
  await page.getByLabel('Zona horaria').selectOption('America/Bogota');
  await page.getByRole('button', { name: 'Guardar zona horaria' }).click();
  await expect(page.locator('#flash')).toContainText('Zona horaria guardada.');
  await page.getByRole('link', { name: 'Guardar enlace' }).click();
  await expect(page).toHaveURL('/guardar');
});
