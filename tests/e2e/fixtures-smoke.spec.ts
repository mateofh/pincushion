import { test, expect, seedBookmarks } from './fixtures/test.ts';
test('fixture seedBookmarks crea datos visibles', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, [{ url: 'https://example.com/x', title: 'Semilla de prueba', excerpt: 'texto con frase rara zumbido' }]);
  await page.goto('/buscar?q=zumbido');
  await expect(page.locator('mark')).toHaveText('zumbido');
});
