// Utilidades compartidas por las pruebas de Guardar y del bookmarklet (no es una prueba).
import type { BrowserContext, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { e2eApp, e2eDb, expect, type Owner } from '../fixtures/test.ts';
import { bookmarkletService } from '../../../src/server/auth/bookmarklet.ts';

export interface BookmarkRow {
  id: number;
  url: string;
  title: string;
  title_source: string;
  description: string;
  excerpt: string;
  fetch_status: string;
  is_favorite: number;
  collection_id: number | null;
}

export function rowsOf(owner: Owner): BookmarkRow[] {
  return e2eDb().all<BookmarkRow>(
    'SELECT id, url, title, title_source, description, excerpt, fetch_status, is_favorite, collection_id FROM bookmarks WHERE user_id = ? ORDER BY id',
    owner.id,
  );
}

export function tagNames(owner: Owner, bookmarkId: number): string[] {
  return e2eDb()
    .all<{ name: string }>(
      'SELECT t.name FROM tags t JOIN bookmark_tags bt ON bt.tag_id = t.id WHERE bt.user_id = ? AND bt.bookmark_id = ? ORDER BY t.name',
      owner.id,
      bookmarkId,
    )
    .map((r) => r.name);
}

/** Token activo del dueño (crea el bookmarklet si hace falta). */
export function tokenOf(owner: Owner): string {
  return bookmarkletService(e2eApp()).ensureToken(owner.id).token;
}

/** Código del bookmarklet tal como lo ejecutaría el navegador: `href` de /bookmarklet sin `javascript:` y decodificado. */
export async function bookmarkletCode(page: Page): Promise<string> {
  await page.goto('/bookmarklet');
  const href = await page.getByRole('link', { name: '+ Pincushion' }).getAttribute('href');
  expect(href).toMatch(/^javascript:/);
  return decodeURIComponent(href!.replace(/^javascript:/, ''));
}

/** Ejecuta el código del bookmarklet en la página actual y devuelve el popup que abre. */
export async function runBookmarklet(page: Page, context: BrowserContext, code: string): Promise<Page> {
  const [popup] = await Promise.all([context.waitForEvent('page'), page.evaluate(code)]);
  return popup;
}

export async function expectNoSeriousA11y(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page: page as never }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const graves = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 4).join(' | ')}`)).toEqual([]);
}

/** PNG 1×1 válido, para sembrar favicons. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** Valor real del campo Etiquetas (con JS lo lleva un campo oculto; sin JS, el propio input). */
export async function tagsValue(page: Page): Promise<string> {
  return page.locator('input[name="tags"]').evaluateAll((els) =>
    (els as HTMLInputElement[]).map((e) => e.value).sort((a, b) => b.length - a.length)[0] ?? '',
  );
}
