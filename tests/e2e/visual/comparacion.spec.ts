// Comparación visual (toHaveScreenshot) de Biblioteca (tarjetas y lista), Guardar, Buscar con resultados y Bookmarklet
// a 390 y 1280 px. Datos y fechas deterministas; lo que depende del reloj del servidor o es aleatorio se enmascara.
// Las líneas base NO están generadas: se crean al integrar con `npx playwright test tests/e2e/visual --update-snapshots`.
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test.ts';
import { FECHA_BASE, sembrarDeterministas } from '../helpers/datos.ts';

const ANCHOS = [
  { nombre: '390', width: 390, height: 844 },
  { nombre: '1280', width: 1280, height: 800 },
] as const;

const PANTALLAS = [
  { id: 'biblioteca-tarjetas', ruta: '/?vista=tarjetas', requiere: 'biblioteca' },
  { id: 'biblioteca-lista', ruta: '/?vista=lista', requiere: 'biblioteca' },
  { id: 'guardar', ruta: '/guardar', requiere: 'guardar' },
  { id: 'buscar-resultados', ruta: '/buscar?q=nube', requiere: 'buscar' },
  { id: 'bookmarklet', ruta: '/bookmarklet', requiere: 'guardar' },
] as const;

/** Fechas relativas, tokens y código del bookmarklet: no deben decidir el resultado. */
function mascaras(page: Page) {
  return [
    page.locator('time'),
    page.locator('[data-fecha]'),
    page.locator('[data-token], [data-bookmarklet-code], textarea[readonly], input[readonly]'),
    page.locator('a[href^="javascript:"]'),
  ];
}

for (const a of ANCHOS) {
  test.describe(`visual a ${a.nombre} px`, () => {
    test.use({ viewport: { width: a.width, height: a.height }, colorScheme: 'light', reducedMotion: 'reduce' });

    for (const p of PANTALLAS) {
      test(`${p.id} a ${a.nombre} px [requiere: ${p.requiere}]`, async ({ signedIn: page, owner }) => {
        sembrarDeterministas(owner, 8, (i) => ({ isFavorite: i === 1 || i === 4 }));
        await page.clock.setFixedTime(new Date(FECHA_BASE + 2 * 24 * 3_600_000));
        const res = await page.goto(p.ruta);
        expect(res!.status()).toBe(200);
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`${p.id}-${a.nombre}.png`, {
          fullPage: true,
          animations: 'disabled',
          caret: 'hide',
          maxDiffPixelRatio: 0.01,
          mask: mascaras(page),
        });
      });
    }
  });
}
