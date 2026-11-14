// Utilidades de las pruebas de la Biblioteca: datos propios por test (nunca el seed demo).
import { expect, type Page } from '@playwright/test';
import { seedBookmarks, type Owner, type SeedBookmark } from '../fixtures/test.ts';
import { e2eApp } from '../fixtures/test.ts';
import { collectionService } from '../../../src/server/services/collections.ts';
import type { Bookmark } from '../../../src/server/contracts.ts';

/** n enlaces con títulos "<prefijo> 1…n", URLs distintas y el campo común `extra`. */
export function seedMany(owner: Owner, n: number, prefix = 'Enlace', extra: Partial<SeedBookmark> = {}): Bookmark[] {
  return seedBookmarks(
    owner,
    Array.from({ length: n }, (_, i) => ({
      url: `https://${prefix.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${i + 1}.example.com/articulo`,
      title: `${prefix} ${i + 1}`,
      ...extra,
    })),
  );
}

export function createCollection(owner: Owner, name: string): { id: number; name: string } {
  return collectionService(e2eApp()).create(owner.id, name);
}

/** Marca la casilla "Seleccionar «título»" (funciona con y sin JS). */
export async function select(page: Page, title: string): Promise<void> {
  await page.getByLabel(`Seleccionar «${title}»`).check();
}

export function bookmarkCard(page: Page, id: number) {
  return page.locator(`article[data-bookmark-id="${id}"]`);
}

/** La región de enlaces de la Biblioteca. */
export function region(page: Page) {
  return page.getByRole('region', { name: 'Enlaces guardados' });
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw, `scrollWidth ${sw} > clientWidth ${cw}`).toBeLessThanOrEqual(cw);
}
