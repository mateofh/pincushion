// Presupuesto de rendimiento percibido con 1000 enlaces: Pixel 7, CPU ×4, red Fast 3G (CDP).
// Contenido visible (primer article) < 1,5 s y JS enviado < 30 KB gzip. Nocturno / pre-release.
import { gzipSync } from 'node:zlib';
import { test, expect } from '../fixtures/test.ts';
import { sembrarDeterministas } from '../helpers/datos.ts';

/** Fast 3G de DevTools: 1,6 Mbit/s de bajada, 750 kbit/s de subida, 562,5 ms de latencia. */
const FAST_3G = { offline: false, latency: 562.5, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };

test('Biblioteca con 1000 enlaces: contenido visible < 1,5 s y JS < 30 KB gzip @movil @nocturno', async ({ signedIn: page, owner, isMobile }) => {
  test.skip(!isMobile, 'El presupuesto se mide solo en el perfil Pixel 7');
  test.setTimeout(240_000);
  sembrarDeterministas(owner, 1000);

  // Throttling después de entrar: solo se mide la Biblioteca, no el login.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', FAST_3G);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  const js = new Map<string, number>();
  page.on('response', async (res) => {
    const url = new URL(res.url());
    if (!/\.m?js$/.test(url.pathname)) return;
    const encoded = Number(res.headers()['content-length']);
    const gz = res.headers()['content-encoding'] === 'gzip' || res.headers()['content-encoding'] === 'br';
    try {
      const body = await res.body();
      // Si el servidor no comprime, se estima el tamaño que tendría con gzip.
      js.set(url.pathname, gz && Number.isFinite(encoded) ? encoded : gzipSync(body).length);
    } catch {
      /* respuesta cancelada */
    }
  });

  const t0 = Date.now();
  await page.goto('/', { waitUntil: 'commit' });
  await page.locator('article[data-bookmark-id]').first().waitFor({ state: 'visible', timeout: 20_000 });
  const visibleMs = Date.now() - t0;
  await page.waitForLoadState('load');
  await expect.poll(() => js.size, { message: 'se registró al menos un script' }).toBeGreaterThan(0);

  const totalJs = [...js.values()].reduce((a, b) => a + b, 0);
  const paint = await page.evaluate(() => performance.getEntriesByType('paint').map((e) => `${e.name}=${Math.round(e.startTime)}ms`).join(' '));
  test.info().annotations.push({ type: 'rendimiento', description: `contenido visible ${visibleMs} ms; JS ${(totalJs / 1024).toFixed(1)} KB gzip (${js.size} archivos); ${paint}` });

  expect(visibleMs, `contenido visible en ${visibleMs} ms (${paint})`).toBeLessThan(1500);
  expect(totalJs, `JS enviado: ${[...js].map(([k, v]) => `${k}=${v}`).join(', ')}`).toBeLessThan(30 * 1024);

  // La página no pide los 1000 enlaces de golpe: paginación por cursor de 50
  expect(await page.locator('article[data-bookmark-id]').count()).toBeLessThanOrEqual(50);
});
