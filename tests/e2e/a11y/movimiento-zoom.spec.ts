// prefers-reduced-motion sin transiciones y zoom/texto al 200 % sin scroll horizontal.
import { test, expect, seedBookmarks } from '../fixtures/test.ts';
import { noHorizontalScroll } from '../helpers/ui.ts';

const RUTAS = ['/', '/guardar', '/buscar?q=zoom', '/ajustes', '/bookmarklet', '/papelera', '/colecciones'];
const DATOS = [
  { url: 'https://example.com/zoom-1', title: 'Un título razonablemente largo para forzar el ajuste de línea en pantallas estrechas', tags: ['una', 'dos', 'tres'] },
  { url: 'https://example.com/zoom-2', title: 'Segundo enlace', excerpt: 'texto zoom en el excerpt' },
];

test('prefers-reduced-motion: sin transiciones ni animaciones en las pantallas principales @movil', async ({ signedIn: page, owner }) => {
  seedBookmarks(owner, DATOS);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const ruta of RUTAS) {
    await page.goto(ruta);
    const largas = await page.evaluate(() => {
      const secs = (v: string) => v.split(',').map((x) => (x.trim().endsWith('ms') ? parseFloat(x) / 1000 : parseFloat(x)));
      return [...document.querySelectorAll<HTMLElement>('*')]
        .flatMap((el) => {
          const cs = getComputedStyle(el);
          const t = Math.max(...secs(cs.transitionDuration));
          const a = cs.animationName !== 'none' ? Math.max(...secs(cs.animationDuration)) : 0;
          const s = cs.scrollBehavior === 'smooth';
          return t > 0.01 || a > 0.01 || s ? [`${el.tagName.toLowerCase()}.${el.className} t=${t}s a=${a}s smooth=${s}`] : [];
        })
        .slice(0, 5);
    });
    expect(largas, `movimiento con reduced-motion en ${ruta}`).toEqual([]);
  }
});

test('sin preferencia de movimiento reducido el sitio no declara scroll suave global @movil', async ({ signedIn: page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const smooth = await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
  expect(['auto', 'smooth']).toContain(smooth);
});

test.describe('zoom 200 % (viewport de 640 px con escala 2)', () => {
  test.use({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 2 });

  for (const ruta of RUTAS) {
    const req = ['/', '/buscar?q=zoom', '/bookmarklet', '/papelera', '/colecciones'].includes(ruta) ? ' [requiere: biblioteca|guardar|buscar]' : '';
    test(`sin scroll horizontal en ${ruta}${req} @movil`, async ({ signedIn: page, owner }) => {
      seedBookmarks(owner, DATOS);
      const res = await page.goto(ruta);
      expect(res!.status()).toBe(200);
      await noHorizontalScroll(page, ruta);
      await expect(page.getByRole('link', { name: 'Guardar enlace' })).toBeVisible();
    });
  }
});

test.describe('texto al 200 % (fuente base duplicada, viewport móvil)', () => {
  test.use({ viewport: { width: 390, height: 780 } });

  for (const ruta of RUTAS) {
    test(`sin scroll horizontal ni controles cortados en ${ruta} @movil`, async ({ signedIn: page, owner }) => {
      seedBookmarks(owner, DATOS);
      await page.goto(ruta);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      await noHorizontalScroll(page, ruta);
      const cortados = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('button, a[href], input, select')]
          .filter((el) => el.offsetParent !== null && !el.closest('.visually-hidden, .skip-link'))
          .filter((el) => el.getBoundingClientRect().left < -1 || el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
          .map((el) => (el.textContent ?? el.getAttribute('name') ?? '').trim().slice(0, 30)),
      );
      expect(cortados, `controles fuera de pantalla en ${ruta}`).toEqual([]);
    });
  }
});
