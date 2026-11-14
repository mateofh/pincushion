// N6: bob adivina URLs de alice (GET y POST con su propio CSRF válido) → 404 y nada cambia en la DB.
import type { Page } from '@playwright/test';
import { test, expect, createOwner, e2eApp, e2eDb, seedBookmarks, type Owner } from '../fixtures/test.ts';
import { collectionService } from '../../../src/server/services/collections.ts';

const FRASE = 'zarzaparrilla secreta de alice';

async function datosDeAlice() {
  const alice = await createOwner('alice');
  const col = collectionService(e2eApp()).create(alice.id, 'Privada de alice');
  const [a, b] = seedBookmarks(alice, [
    { url: 'https://privado-de-alice.example.com/nota', title: 'Nota privada de alice', excerpt: `Contiene ${FRASE} y nada más`, tags: ['secreto-alice'], collectionId: col.id },
    { url: 'https://otro-de-alice.example.com/x', title: 'Otro de alice', tags: ['secreto-alice'] },
  ]);
  const tag = e2eDb().get<{ id: number }>('SELECT id FROM tags WHERE user_id = ? AND name_key = ?', alice.id, 'secreto-alice')!;
  return { alice, col, a, b, tag };
}

/** Todo lo que pertenece a alice, para comparar antes/después. */
function foto(alice: Owner): string {
  const db = e2eDb();
  const q = (sql: string) => db.all(sql, alice.id);
  return JSON.stringify({
    bookmarks: q('SELECT * FROM bookmarks WHERE user_id = ? ORDER BY id'),
    tags: q('SELECT * FROM tags WHERE user_id = ? ORDER BY id'),
    bookmark_tags: q('SELECT * FROM bookmark_tags WHERE user_id = ? ORDER BY bookmark_id, tag_id'),
    collections: q('SELECT * FROM collections WHERE user_id = ? ORDER BY id'),
    favicons: q('SELECT user_id, domain, status FROM favicons WHERE user_id = ? ORDER BY domain'),
  });
}

async function csrfDe(page: Page): Promise<string> {
  await page.goto('/ajustes');
  const token = await page.locator('meta[name="csrf-token"]').getAttribute('content');
  expect(token).toBeTruthy();
  return token!;
}

async function post(page: Page, csrf: string, path: string, fields: Array<[string, string]> = []) {
  const body = new URLSearchParams([['_csrf', csrf], ...fields]).toString();
  return page.request.post(path, { data: body, headers: { 'content-type': 'application/x-www-form-urlencoded' }, maxRedirects: 0 });
}

test('N6: GET de recursos de alice → 404 con salida a la Biblioteca [requiere: biblioteca|guardar]', async ({ signedIn: page }) => {
  const { alice, col, a, tag } = await datosDeAlice();
  const antes = foto(alice);
  const rutas = [
    `/enlaces/${a.id}`,
    `/enlaces/${a.id}/eliminar`,
    `/bookmarklet/guardado/${a.id}`,
    `/favicons/${a.domain}`,
    `/colecciones/${col.id}`,
    `/etiquetas/${tag.id}`,
  ];
  for (const ruta of rutas) {
    const res = await page.request.get(ruta, { maxRedirects: 0 });
    expect(res.status(), `GET ${ruta}`).toBe(404);
    const html = await res.text();
    expect(html, `GET ${ruta} no filtra datos`).not.toContain('Nota privada de alice');
    expect(html).not.toContain('privado-de-alice');
  }
  expect(foto(alice)).toBe(antes);

  // La página 404 que ve un navegador ofrece el camino de vuelta.
  const res = await page.goto(`/enlaces/${a.id}`);
  expect(res!.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('Código de referencia')).toBeVisible();
  await page.getByRole('link', { name: 'Volver a la Biblioteca' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Biblioteca' })).toBeVisible();
});

test('N6: POST sobre recursos de alice con CSRF propio válido → 404 y nada cambia [requiere: biblioteca|guardar]', async ({ signedIn: page, owner }) => {
  const { alice, col, a, b, tag } = await datosDeAlice();
  const csrf = await csrfDe(page);
  const antes = foto(alice);
  const bobAntes = e2eDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ?', owner.id)!.n;

  const intentos: Array<[string, Array<[string, string]>]> = [
    [`/enlaces/${a.id}`, [['title', 'Secuestrado por bob'], ['url', 'https://evil.example.com']]],
    [`/enlaces/${a.id}/favorito`, [['value', '1']]],
    [`/enlaces/${a.id}/papelera`, []],
    [`/enlaces/${a.id}/restaurar`, []],
    [`/enlaces/${a.id}/eliminar`, []],
    [`/enlaces/${a.id}/reintentar`, []],
    [`/bookmarklet/guardado/${a.id}`, [['title', 'Secuestrado por bob']]],
    [`/colecciones/${col.id}`, [['accion', 'renombrar'], ['nombre', 'Mía ahora']]],
    [`/colecciones/${col.id}`, [['accion', 'borrar']]],
    [`/etiquetas/${tag.id}`, [['accion', 'renombrar'], ['nombre', 'robada']]],
    [`/etiquetas/${tag.id}`, [['accion', 'borrar']]],
  ];
  for (const [ruta, campos] of intentos) {
    const res = await post(page, csrf, ruta, campos);
    expect(res.status(), `POST ${ruta} ${JSON.stringify(campos)}`).toBe(404);
  }

  // Lote con ids de alice: 404, o rechazo sin efectos (redirección con aviso / validación). Nunca un cambio.
  for (const accion of ['papelera', 'favorito', 'etiquetar', 'mover']) {
    const campos: Array<[string, string]> = [['ids', String(a.id)], ['ids', String(b.id)], ['accion', accion], ['etiqueta', 'infiltrada'], ['coleccion', 'nueva:Robada'], ['volver', '/']];
    const res = await post(page, csrf, '/enlaces/lote', campos);
    expect([404, 303, 422], `lote ${accion}`).toContain(res.status());
  }
  await post(page, csrf, '/enlaces/lote', [['ids', String(a.id)], ['accion', 'mover'], ['coleccion', String(col.id)]]);

  expect(foto(alice)).toBe(antes);
  const bobDespues = e2eDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ?', owner.id)!.n;
  expect(bobDespues, 'el lote de bob no creó ni movió nada propio').toBe(bobAntes);
  expect(e2eDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM tags WHERE user_id = ? AND name_key = ?', owner.id, 'infiltrada')!.n).toBe(0);
  expect(e2eDb().get<{ n: number }>('SELECT COUNT(*) AS n FROM collections WHERE user_id = ?', owner.id)!.n).toBe(0);
});

test('N6: /buscar de bob no devuelve nada de alice [requiere: buscar]', async ({ signedIn: page }) => {
  await datosDeAlice();
  for (const q of [FRASE, `"${FRASE}"`, 'zarzaparrilla', 'privado-de-alice', 'Nota privada']) {
    await page.goto(`/buscar?q=${encodeURIComponent(q)}`);
    await expect(page.locator('main article')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Nota privada de alice');
    await expect(page.locator('mark')).toHaveCount(0);
  }
  // Filtros por etiqueta/colección de alice tampoco abren nada
  await page.goto('/buscar?q=nota&etiqueta=secreto-alice');
  await expect(page.locator('main article')).toHaveCount(0);
});

test('N6: la Biblioteca de bob ignora la colección y la etiqueta de alice [requiere: biblioteca]', async ({ signedIn: page }) => {
  const { col } = await datosDeAlice();
  const res = await page.goto(`/?coleccion=${col.id}`);
  expect([200, 404]).toContain(res!.status());
  await expect(page.locator('body')).not.toContainText('Nota privada de alice');
  await page.goto('/?etiqueta=secreto-alice');
  await expect(page.locator('body')).not.toContainText('Nota privada de alice');
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(0);
});

test('N6: sin sesión, las URLs de alice llevan a entrar y no revelan nada', async ({ page }) => {
  const { a } = await datosDeAlice();
  for (const ruta of [`/enlaces/${a.id}`, `/favicons/${a.domain}`, `/buscar?q=${encodeURIComponent(FRASE)}`]) {
    const res = await page.request.get(ruta, { maxRedirects: 0 });
    // /favicons/ cae bajo el prefijo público '/favicon' del middleware: allí la respuesta depende del propio handler.
    // Lo único inadmisible es servir datos (200).
    expect([303, 401, 404], ruta).toContain(res.status());
    if (res.status() === 303) expect(res.headers().location).toMatch(/^\/entrar\?next=/);
  }
});
