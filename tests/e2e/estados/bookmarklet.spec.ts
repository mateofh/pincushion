// Matriz de estados del Bookmarklet (setup y prueba): primer uso, último uso, rotación, prueba OK y sin señal.
import { test, expect, e2eApp } from '../fixtures/test.ts';
import { bookmarkletService } from '../../../src/server/auth/bookmarklet.ts';
import { tokenOf } from '../guardar/helpers.ts';

test('estado visible: último uso y última prueba tras usarlo @sin-js', async ({ signedIn: page, owner }) => {
  const svc = bookmarkletService(e2eApp());
  const { tokenId } = svc.verify(tokenOf(owner))!;
  await page.goto('/bookmarklet');
  await expect(page.locator('#estado-uso')).toContainText('Aún no lo has usado para guardar.');
  svc.markUsed(tokenId, false);
  svc.markUsed(tokenId, true);
  await page.reload();
  await expect(page.locator('#estado-uso')).toContainText('Última prueba:');
  await expect(page.locator('#estado-uso')).toContainText('Último uso:');
});

test('rotar sin confirmar no cambia nada: el panel pide confirmación explícita @sin-js', async ({ signedIn: page, owner }) => {
  const token = tokenOf(owner);
  await page.goto('/bookmarklet?confirmar=rotar');
  await expect(page.getByRole('heading', { name: '¿Rotar el token del bookmarklet?' })).toBeVisible();
  await page.goto('/bookmarklet');
  expect(tokenOf(owner)).toBe(token);
});
