// A2: la misma URL con variantes (http, www, utm, barra final) guardada dos veces: aviso antes y un solo enlace con la unión de etiquetas.
import { test, expect } from '../fixtures/test.ts';
import { rowsOf, tagNames } from '../guardar/helpers.ts';

const VARIANTES = [
  ['https://example.com/pan', 'http://www.example.com/pan/'],
  ['https://example.com/receta?utm_source=news&id=7', 'https://www.example.com/receta/?id=7'],
  ['http://example.com/guia/', 'https://example.com/guia?utm_campaign=x'],
] as const;

for (const [primera, segunda] of VARIANTES) {
  test(`A2: ${segunda} es el mismo enlace que ${primera}`, async ({ signedIn: page, owner }) => {
    await page.goto('/guardar');
    await page.getByLabel('URL').fill(primera);
    await page.getByLabel('Etiquetas', { exact: true }).fill('uno');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.locator('#flash')).toContainText('Enlace guardado');

    // Segundo guardado: el aviso aparece ANTES de pulsar nada.
    await page.goto('/guardar?url=' + encodeURIComponent(segunda));
    await expect(page.locator('#estado-datos')).toContainText('Ya lo guardaste el');
    await expect(page.getByRole('button', { name: 'Actualizar enlace' })).toBeVisible();
    await page.getByLabel('Etiquetas', { exact: true }).fill('dos');
    await page.getByRole('button', { name: 'Actualizar enlace' }).click();
    await expect(page.locator('#flash')).toContainText('Enlace actualizado: se sumó 1 etiqueta');

    const rows = rowsOf(owner);
    expect(rows).toHaveLength(1);
    expect(tagNames(owner, rows[0]!.id)).toEqual(['dos', 'uno']);
  });
}
