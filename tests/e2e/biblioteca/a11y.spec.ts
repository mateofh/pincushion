// axe: 0 violaciones serias o críticas en la Biblioteca (con datos y vacía) y en Editar.
import AxeBuilder from '@axe-core/playwright';
import { test, expect, createOwner, login } from '../fixtures/test.ts';
import { seedMany, createCollection } from './helpers.ts';

async function serias(page: import('@playwright/test').Page) {
  const r = await new AxeBuilder({ page: page as never }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

test('Biblioteca con datos', async ({ signedIn: page, owner }) => {
  const c = createCollection(owner, 'Lectura');
  seedMany(owner, 4, 'Dato', { collectionId: c.id, tags: ['a', 'b'], fetchStatus: 'failed' });
  await page.goto('/');
  expect(await serias(page)).toEqual([]);
  await page.goto('/?vista=lista');
  expect(await serias(page)).toEqual([]);
});

test('Biblioteca vacía', async ({ page }) => {
  await login(page, await createOwner('vacio'));
  expect(await serias(page)).toEqual([]);
});

test('Editar enlace, papelera, colecciones y etiquetas', async ({ signedIn: page, owner }) => {
  const [b] = seedMany(owner, 1, 'Ed', { tags: ['x'] });
  seedMany(owner, 1, 'Tr', { trashed: true });
  createCollection(owner, 'Col');
  for (const path of [`/enlaces/${b!.id}`, '/papelera', '/colecciones', '/etiquetas']) {
    await page.goto(path);
    expect(await serias(page), path).toEqual([]);
  }
});
