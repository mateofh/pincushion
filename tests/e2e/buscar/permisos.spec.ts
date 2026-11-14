// Permisos: la búsqueda nunca cruza usuarios.
import { test, expect, seedBookmarks, createOwner, login } from '../fixtures/test.ts';

test('bob no encuentra lo que solo tiene alice @sin-js', async ({ page }) => {
  const alice = await createOwner('alice');
  const bob = await createOwner('bob');
  seedBookmarks(alice, [{ url: 'https://example.com/secreto', title: 'Plan secreto de alice', excerpt: 'la frase unica zafiro-turquesa de alice' }]);
  seedBookmarks(bob, [{ url: 'https://example.com/otro', title: 'Algo de bob', excerpt: 'nada que ver' }]);

  await login(page, bob);
  await page.goto('/buscar?q=zafiro-turquesa');
  await expect(page.getByRole('region', { name: 'Resultados' })).toHaveCount(0);
  await expect(page.locator('article[data-bookmark-id]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Sin resultados/ })).toBeVisible();
  await expect(page.getByText('Plan secreto de alice')).toHaveCount(0);
});
