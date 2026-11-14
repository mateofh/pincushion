// Utilidades compartidas de QA transversal: layout, targets táctiles, axe y foco.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** La página no desborda en horizontal (tolerancia de 1 px por redondeos). */
export async function noHorizontalScroll(page: Page, label = page.url()): Promise<void> {
  const m = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.documentElement.clientWidth,
    wide: [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && getComputedStyle(el).position !== 'fixed')
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
  }));
  expect(m.doc, `scroll horizontal en ${label}; desbordan: ${m.wide.join(', ')}`).toBeLessThanOrEqual(1);
  expect(m.body, `scroll horizontal del body en ${label}`).toBeLessThanOrEqual(1);
}

const TARGETS = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox]';

/**
 * Todo control visible mide al menos `min`×`min` px. Casillas/radios cuentan con el tamaño de su <label>.
 * Quedan fuera: lo visualmente oculto, el enlace "Saltar al contenido" y los enlaces dentro de un párrafo
 * (WCAG 2.5.8 los exceptúa). Se puede añadir `ignore` (selector CSS).
 */
export async function tapTargetsAtLeast(page: Page, min = 44, opts: { scope?: string; ignore?: string } = {}): Promise<void> {
  const small = await page.evaluate(
    ({ min, scope, ignore, sel }) => {
      const root = scope ? document.querySelector(scope) : document.body;
      if (!root) return ['(ámbito no encontrado)'];
      const out: string[] = [];
      for (const el of root.querySelectorAll<HTMLElement>(sel)) {
        if (el.closest('.visually-hidden, .skip-link, [hidden], [inert]')) continue;
        if (ignore && el.matches(ignore)) continue;
        if (el.matches('p a:not(.btn), li > p a:not(.btn), dd a:not(.btn)')) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        let r = el.getBoundingClientRect();
        if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) {
          const label = el.labels?.[0] ?? el.closest('label');
          if (label) r = label.getBoundingClientRect();
        }
        if (r.width === 0 || r.height === 0) continue;
        if (r.width + 0.5 < min || r.height + 0.5 < min) {
          const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30);
          out.push(`${el.tagName.toLowerCase()} «${name}» ${Math.round(r.width)}×${Math.round(r.height)}`);
        }
      }
      return out;
    },
    { min, scope: opts.scope, ignore: opts.ignore, sel: TARGETS },
  );
  expect(small, `controles menores de ${min}×${min} px en ${page.url()}`).toEqual([]);
}

/** axe-core (WCAG 2.x A/AA): cero violaciones serias o críticas. `incluir`/`excluir` acotan el análisis. */
export async function expectNoSeriousAxe(page: Page, opts: { label?: string; include?: string; exclude?: string[] } = {}): Promise<void> {
  let axe = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (opts.include) axe = axe.include(opts.include);
  for (const ex of opts.exclude ?? []) axe = axe.exclude(ex);
  const { violations } = await axe.analyze();
  const serious = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(serious, `axe en ${opts.label ?? page.url()}`).toEqual([]);
}

export interface FocusInfo {
  tag: string;
  name: string;
  visible: boolean;
}

/** Describe el elemento enfocado y si tiene un indicador de foco (outline o box-shadow no nulos, propio o de su label/contenedor). */
export async function focusIndicator(page: Page): Promise<FocusInfo> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { tag: 'body', name: '', visible: false };
    const shows = (e: Element): boolean => {
      const cs = getComputedStyle(e);
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && cs.outlineColor !== 'rgba(0, 0, 0, 0)';
      return outline || (cs.boxShadow !== 'none' && cs.boxShadow !== '');
    };
    let ok = shows(el);
    if (!ok && el instanceof HTMLInputElement) {
      const label = el.labels?.[0] ?? el.closest('label');
      ok = Boolean(label && shows(label)) || Boolean(el.nextElementSibling && shows(el.nextElementSibling));
    }
    if (!ok && el.matches('summary, [role=button]')) ok = shows(el);
    return { tag: el.tagName.toLowerCase(), name: (el.getAttribute('aria-label') ?? el.textContent ?? el.getAttribute('name') ?? '').trim().slice(0, 40), visible: ok };
  });
}

/** Recorre con Tab todos los controles de la página (máx. `max`) y devuelve los que no muestran foco. */
export async function tabStopsWithoutFocusRing(page: Page, max = 150): Promise<string[]> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const bad: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const key = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return 'BODY';
      const path: string[] = [];
      for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) path.push(`${e.tagName}${e.parentElement ? [...e.parentElement.children].indexOf(e) : ''}`);
      return path.join('>');
    });
    if (key === 'BODY' || seen.has(key)) break;
    seen.add(key);
    const f = await focusIndicator(page);
    if (!f.visible) bad.push(`${f.tag} «${f.name}»`);
  }
  expect(seen.size, 'no se encontró ningún control tabulable').toBeGreaterThan(0);
  return bad;
}

/** Pantallas principales (CONTRATOS §2) con el `active` del layout y un fragmento del <title>. */
export const PANTALLAS = [
  { ruta: '/', nombre: 'Biblioteca', activo: 'Biblioteca', requiere: 'biblioteca' },
  { ruta: '/guardar', nombre: 'Guardar', activo: null, requiere: 'guardar' },
  { ruta: '/buscar', nombre: 'Buscar', activo: null, requiere: 'buscar' },
  { ruta: '/bookmarklet', nombre: 'Bookmarklet', activo: 'Bookmarklet', requiere: 'guardar' },
  { ruta: '/ajustes', nombre: 'Ajustes', activo: 'Ajustes', requiere: null },
  { ruta: '/papelera', nombre: 'Papelera', activo: null, requiere: 'biblioteca' },
  { ruta: '/colecciones', nombre: 'Colecciones', activo: null, requiere: 'biblioteca' },
] as const;
