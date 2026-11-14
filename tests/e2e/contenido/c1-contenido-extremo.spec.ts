// C1: contenido extremo sin scroll horizontal.
import { test, expect } from '../fixtures/test.ts';
import { seedBookmarks } from '../fixtures/test.ts';
import { expectNoHorizontalScroll, seedMany, region } from '../biblioteca/helpers.ts';

test('título de 300, sin descripción, emoji/RTL, 20 etiquetas y URL de 2000 @movil', async ({ signedIn: page, owner }) => {
  const tags = Array.from({ length: 20 }, (_, i) => `etiqueta-numero-${i + 1}`);
  const [largo] = seedBookmarks(owner, [
    { url: 'https://largo.example.com/a', title: 'T'.repeat(300), tags },
    { url: 'https://sinespacios.example.com/a', title: 'U'.repeat(250).replace(/(.{50})/g, '$1') },
    { url: 'https://emoji.example.com/a', title: '🎉🚀 Fiesta 🎉 مرحبا بالعالم שלום', description: 'مرحبا بك في المكتبة 🌍' },
    { url: `https://larga.example.com/${'p'.repeat(1960)}`, title: 'Con URL larguísima' },
    { url: 'https://sin-desc.example.com/a', title: 'Sin descripción' },
  ]);
  for (const vista of ['tarjetas', 'lista']) {
    await page.goto(`/?vista=${vista}`);
    await expect(region(page).locator('article')).toHaveCount(5);
    await expectNoHorizontalScroll(page);
  }
  await page.goto(`/enlaces/${largo!.id}`);
  await expectNoHorizontalScroll(page);
  const larga = (await page.goto('/')) && (await page.locator('article', { hasText: 'Con URL larguísima' }).getByRole('link', { name: 'Editar' }).click());
  void larga;
  await expect(page.getByRole('heading', { level: 1, name: 'Editar enlace' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.goto('/etiquetas');
  await expectNoHorizontalScroll(page);
});

test('60 enlaces: paginación por cursor @movil', async ({ signedIn: page, owner }) => {
  seedMany(owner, 60, 'Masa');
  await page.goto('/');
  await expect(region(page).locator('article')).toHaveCount(50);
  await expectNoHorizontalScroll(page);
  await page.getByRole('link', { name: 'Más antiguos' }).click();
  await expect(region(page).locator('article')).toHaveCount(10);
  await expect(page).toHaveURL(/cursor=/);
  await expectNoHorizontalScroll(page);
  await page.getByRole('link', { name: 'Más recientes' }).click();
  await expect(region(page).locator('article')).toHaveCount(50);
});
