// Capturas de revisión visual (390 y 1280 px) en test-results/biblioteca/. No comprueban nada: son artefactos.
import { test, expect, createOwner, login, seedBookmarks } from '../fixtures/test.ts';
import { createCollection, seedMany } from './helpers.ts';
import { mkdirSync } from 'node:fs';

const DIR = 'test-results/biblioteca';

test('capturas de las pantallas @movil', async ({ page }, info) => {
  mkdirSync(DIR, { recursive: true });
  const tag = info.project.name;
  const shot = (name: string, full = true) => page.screenshot({ path: `${DIR}/${name}-${tag}.png`, fullPage: full });

  const vacia = await createOwner('vacia');
  await login(page, vacia);
  await shot('01-vacia');

  const owner = await createOwner('capt');
  const lectura = createCollection(owner, 'Lectura');
  createCollection(owner, 'Algún día');
  seedMany(owner, 5, 'Receta de pan', { tags: ['cocina', 'pan'], collectionId: lectura.id, description: 'Una receta larga de pan de masa madre con muchos detalles para el fin de semana.' });
  seedBookmarks(owner, [
    { url: 'https://falla.example.com/x', title: 'Página que falló', fetchStatus: 'failed', isFavorite: true, tags: ['diseño'] },
    { url: 'https://cargando.example.com/x', title: 'Página pendiente', fetchStatus: 'pending' },
    { url: 'https://borrado.example.com/x', title: 'Enlace en la papelera', trashed: true },
  ]);
  await page.context().clearCookies();
  await login(page, owner);
  await shot('02-tarjetas');
  await page.goto('/?vista=lista');
  await shot('03-lista');
  await page.getByLabel('Seleccionar «Receta de pan 1»').check();
  await page.getByLabel('Seleccionar «Receta de pan 2»').check();
  await shot('04-seleccion', false);
  await page.goto(`/?coleccion=${lectura.id}`);
  await shot('05-coleccion');
  await page.goto('/?etiqueta=cocina&favoritos=1');
  await shot('06-sin-resultados');
  await page.goto('/?coleccion=' + createCollection(owner, 'Vacía').id);
  await shot('07-coleccion-vacia');
  await page.goto('/papelera');
  await shot('08-papelera');
  await page.goto('/papelera?vaciar=1');
  await shot('09-vaciar');
  await page.goto('/colecciones');
  await shot('10-colecciones');
  await page.goto('/etiquetas');
  await shot('11-etiquetas');
  const id = seedMany(owner, 1, 'Para editar', { tags: ['uno', 'dos'], fetchStatus: 'failed' })[0]!.id;
  await page.goto(`/enlaces/${id}`);
  await shot('12-editar');
  await page.getByLabel('Título', { exact: true }).fill('x'.repeat(301));
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await shot('13-editar-error');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
