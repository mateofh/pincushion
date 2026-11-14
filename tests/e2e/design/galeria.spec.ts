// Design system: la galería (/dev/componentes, servida con PINCUSHION_TEST_MODE=1) renderiza,
// pasa axe, no desborda en móvil, tiene objetivos táctiles de 44 px y foco visible.
// Las capturas de referencia se guardan en test-results/design/ (artefactos, sin toHaveScreenshot).
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { test, expect } from '../fixtures/test.ts';

const GALERIA = '/dev/componentes';
const OUT = 'test-results/design';

test('la galería renderiza todos los componentes', async ({ signedIn: page }) => {
  await page.goto(GALERIA);
  await expect(page.getByRole('heading', { level: 1, name: 'Componentes' })).toBeVisible();
  await expect(page.locator('article[data-bookmark-id]').first()).toBeVisible();
  await expect(page.locator('[data-fetch-status]')).not.toHaveCount(0);
  for (const s of ['pending', 'retrying', 'succeeded', 'failed', 'skipped']) {
    await expect(page.locator(`[data-fetch-status="${s}"]`).first()).toBeVisible();
  }
  await expect(page.locator('[data-favicon="fallback"]').first()).toBeVisible();
  await expect(page.getByRole('group', { name: 'Vista' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Enlaces guardados' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Marcar como favorito' }).first()).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Quitar de favoritos' }).first()).toHaveAttribute('aria-pressed', 'true');
});

test('sin sesión la galería no se sirve (404 o redirección a entrar)', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: process.env.E2E_APP_URL });
  const res = await ctx.request.get(GALERIA, { maxRedirects: 0 });
  expect([302, 303, 401, 403, 404]).toContain(res.status());
  await ctx.close();
});

test('axe: sin violaciones serias ni críticas (escritorio)', async ({ signedIn: page }) => {
  await page.goto(GALERIA);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const graves = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 4).join(' | ')}`)).toEqual([]);
});

test('axe: sin violaciones serias ni críticas (móvil 360 px)', async ({ signedIn: page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(GALERIA);
  await page.locator('details.mf summary').click();
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const graves = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 4).join(' | ')}`)).toEqual([]);
});

test('sin desplazamiento horizontal a 360 px', async ({ signedIn: page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(GALERIA);
  await page.locator('details.mf summary').click();
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(m.sw).toBeLessThanOrEqual(m.cw);
});

test('objetivos interactivos ≥ 44×44 en móvil', async ({ signedIn: page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(GALERIA);
  await page.locator('details.mf summary').click();
  // Selecciona un enlace para que aparezca la barra de lote en móvil.
  await page.getByRole('region', { name: 'Enlaces guardados' }).locator('article[data-bookmark-id="1"] input[type="checkbox"]').check();
  const pequenos = await page.evaluate(() => {
    const out: string[] = [];
    const sel = 'a[href], button, input:not([type="hidden"]), select, textarea, summary';
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (el.closest('.skip-link') || el.classList.contains('skip-link')) continue;
      if (el.closest('.topbar')) continue; // layout (lo mantiene la sesión principal)
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.visibility === 'hidden' || cs.display === 'none' || r.width === 0 || r.height === 0) continue;
      if (r.width <= 1 && r.height <= 1) continue; // visually-hidden
      // Enlaces dentro de un párrafo de texto: excepción de WCAG 2.5.8 (enlace en línea).
      if (el.tagName === 'A' && el.closest('p, .text') && getComputedStyle(el).display === 'inline') continue;
      if (r.width < 43.5 || r.height < 43.5) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || '').trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return out;
  });
  expect(pequenos).toEqual([]);
});

test('foco visible al tabular', async ({ signedIn: page }) => {
  await page.goto(GALERIA);
  const vistos: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const box = el.closest('.tag-box') ? getComputedStyle(el.closest('.tag-box') as Element).boxShadow !== 'none' : false; // TagInput: el aro va en el contenedor
      const visible = box || cs.boxShadow !== 'none' || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0);
      return { visible, what: `${el.tagName.toLowerCase()} ${(el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || '').trim().slice(0, 30)}` };
    });
    if (info && !info.visible) vistos.push(info.what);
  }
  expect(vistos).toEqual([]);
});

test('capturas de referencia 390 y 1280 px', async ({ signedIn: page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(GALERIA);
  await page.screenshot({ path: `${OUT}/galeria-390.png`, fullPage: true });
  await page.locator('details.mf summary').click();
  await page.locator('details.mf').screenshot({ path: `${OUT}/filtros-movil-390.png` });
  await page.locator('details.mf summary').click();
  await page.getByRole('region', { name: 'Enlaces guardados' }).locator('article[data-bookmark-id="1"] input[type="checkbox"]').check();
  await page.screenshot({ path: `${OUT}/seleccion-movil-390.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(GALERIA);
  await page.screenshot({ path: `${OUT}/galeria-1280.png`, fullPage: true });
});
