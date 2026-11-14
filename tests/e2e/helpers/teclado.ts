// Navegación solo con teclado: nada de click/fill/check sobre la UI en los tests que lo usan.
import { expect, type Locator, type Page } from '@playwright/test';

/** Lleva el foco a `target` pulsando Tab (o Shift+Tab si ya pasó), sin tocar el ratón. */
export async function focusByKeyboard(page: Page, target: Locator, max = 120): Promise<void> {
  await expect(target.first(), 'el destino existe y es visible').toBeVisible();
  for (let i = 0; i < max; i++) {
    if (await target.first().evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  for (let i = 0; i < max; i++) {
    if (await target.first().evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Shift+Tab');
  }
  throw new Error(`No se pudo llegar con Tab a ${target}`);
}

/** Tab hasta llegar a `target`; falla si hace falta más de `maxTabs` pulsaciones (coste de teclado razonable). */
export async function tabsUntil(page: Page, target: Locator, maxTabs: number): Promise<number> {
  for (let i = 1; i <= maxTabs; i++) {
    await page.keyboard.press('Tab');
    if (await target.first().evaluate((el) => el === document.activeElement)) return i;
  }
  throw new Error(`Hacen falta más de ${maxTabs} Tab para llegar a ${target}`);
}

/** Lo primero que hace quien navega con teclado: ir al contenido. */
export async function saltarAlContenido(page: Page): Promise<void> {
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeVisible();
}
