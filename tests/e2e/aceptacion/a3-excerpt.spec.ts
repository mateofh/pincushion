// A3: una frase que solo está en el texto guardado (excerpt) se resalta completa en un único <mark>.
import { test, expect, seedBookmarks } from '../fixtures/test.ts';

test('A3: la frase completa del excerpt sale dentro de un solo <mark> y el título no se resalta @movil', async ({ signedIn: page, owner }) => {
  const frase = 'fermentación lenta del centeno';
  seedBookmarks(owner, [
    { url: 'https://example.com/panaderia', title: 'Apuntes de panadería', excerpt: `Notas largas. Lo que de verdad cambia el sabor es la ${frase} en frío, mucho más que la receta.` },
  ]);
  await page.goto(`/buscar?q=${encodeURIComponent(frase)}`);
  const item = page.getByRole('region', { name: 'Resultados' }).locator('article[data-bookmark-id]');
  await expect(item).toHaveCount(1);
  // Título sin resaltado.
  await expect(item.locator('h2 mark')).toHaveCount(0);
  // Fragmento: un único <mark> con toda la frase.
  const marks = item.locator('p mark');
  await expect(marks).toHaveCount(1);
  await expect(marks).toHaveText(frase);
});
