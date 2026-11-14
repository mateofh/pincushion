// Matriz de estados de la Biblioteca (CONTRATOS §4).
import { test, expect } from '../fixtures/test.ts';
import { seedMany, select, createCollection, region } from '../biblioteca/helpers.ts';

test('vacío: colección vacía explica cómo mover enlaces', async ({ signedIn: page, owner }) => {
  seedMany(owner, 1);
  const c = createCollection(owner, 'Algún día');
  await page.goto(`/?coleccion=${c.id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Algún día' })).toBeVisible();
  await expect(page.getByText('Para mover enlaces aquí')).toBeVisible();
});

test('vacío: filtros sin resultados ofrecen Quitar filtros', async ({ signedIn: page, owner }) => {
  seedMany(owner, 2, 'Uno', { tags: ['a'] });
  await page.goto('/?etiqueta=a&favoritos=1');
  await expect(page.getByText('Ningún enlace coincide con estos filtros')).toBeVisible();
  await page.getByRole('link', { name: 'Quitar filtros' }).first().click();
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(2);
});

test('validación: lote sin selección @sin-js', async ({ signedIn: page, owner }) => {
  seedMany(owner, 2);
  await page.goto('/?vista=lista&orden=titulo');
  await page.getByRole('button', { name: 'Mover a la papelera' }).click();
  await expect(page.locator('#flash')).toContainText('Selecciona al menos un enlace');
  await expect(page).toHaveURL(/vista=lista&orden=titulo/);
});

test('éxito: papelera en lote con Deshacer @sin-js', async ({ signedIn: page, owner }) => {
  seedMany(owner, 3);
  await page.goto('/');
  await select(page, 'Enlace 1');
  await select(page, 'Enlace 2');
  await page.getByRole('button', { name: 'Mover a la papelera' }).click();
  await expect(page.locator('#flash')).toContainText('2 enlaces movidos a la papelera');
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(1);
  await page.locator('#flash').getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.locator('#flash')).toContainText('2 enlaces restaurados');
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(3);
});

test('estado visible: conteos, h1 por filtro y badge de fetch', async ({ signedIn: page, owner }) => {
  const c = createCollection(owner, 'Lectura');
  seedMany(owner, 2, 'Lee', { collectionId: c.id, tags: ['x'] });
  seedMany(owner, 1, 'Roto', { fetchStatus: 'failed', isFavorite: true });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Filtros de la Biblioteca' });
  await expect(nav.getByRole('link', { name: /Lectura\s*2/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: /Favoritos\s*1/ })).toBeVisible();
  await expect(region(page).locator('[data-fetch-status="failed"]')).toContainText('No se pudo leer la página');
  await page.goto('/?favoritos=1');
  await expect(page.getByRole('heading', { level: 1, name: 'Favoritos' })).toBeVisible();
  await page.goto('/?etiqueta=x');
  await expect(page.getByRole('heading', { level: 1, name: 'Etiqueta: x' })).toBeVisible();
  await page.goto('/?coleccion=sin-coleccion');
  await expect(page.getByRole('heading', { level: 1, name: 'Sin colección' })).toBeVisible();
});

test('fallo recuperable: Reintentar desde la tarjeta @sin-js', async ({ signedIn: page, owner }) => {
  seedMany(owner, 1, 'Roto', { fetchStatus: 'failed' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.locator('#flash')).toContainText('Volveremos a leer la página');
});
