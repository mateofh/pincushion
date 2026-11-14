// Rendimiento de /buscar con 1000 enlaces con excerpts (nocturno).
import { test, expect, createOwner, e2eDb, APP_URL, PASSWORD } from '../fixtures/test.ts';
import { e2eApp } from '../fixtures/test.ts';
import { bookmarkService } from '../../../src/server/services/bookmarks.ts';

test('p95 de /buscar < 150 ms con 1000 enlaces @nocturno', async ({ playwright }) => {
  test.setTimeout(120_000);
  const owner = await createOwner('perf');
  const app = e2eApp();
  const svc = bookmarkService(app);
  const palabras = ['masa', 'madre', 'fermentación', 'lenta', 'centeno', 'senderismo', 'bicicleta', 'café', 'molienda', 'montaña', 'tiempo', 'agua', 'receta', 'guía', 'cadena', 'frío'];
  const texto = (i: number) => Array.from({ length: 120 }, (_, k) => palabras[(i * 7 + k * 3) % palabras.length]).join(' ');
  e2eDb().transaction(() => {
    for (let i = 0; i < 1000; i++) {
      const { bookmark } = svc.save(owner.id, { url: `https://perf-${i % 40}.example.com/articulo-${i}`, title: `Artículo ${i} sobre ${palabras[i % palabras.length]}`, tags: [`t${i % 10}`] }, 'web');
      app.db.run('UPDATE bookmarks SET excerpt = ?, fetch_status = ?, next_attempt_at = NULL WHERE id = ?', texto(i), 'succeeded', bookmark.id);
    }
  });

  const ctx = await playwright.request.newContext({ baseURL: APP_URL });
  const entrada = await ctx.get(`/entrar`);
  expect(entrada.ok()).toBeTruthy();
  const csrf = /name="_csrf" value="([^"]+)"/.exec(await entrada.text())?.[1];
  const login = await ctx.post('/entrar', { form: { email: owner.email, password: PASSWORD, ...(csrf ? { _csrf: csrf } : {}) }, maxRedirects: 0 });
  expect([302, 303]).toContain(login.status());

  const consultas = ['fermentación lenta', 'masa madre', 'senderi', '"café molienda"', 'bicicleta cadena'];
  for (const q of consultas) await ctx.get(`/buscar?q=${encodeURIComponent(q)}`); // calentar
  const tiempos: number[] = [];
  for (let i = 0; i < 100; i++) {
    const q = consultas[i % consultas.length]!;
    const t0 = performance.now();
    const r = await ctx.get(`/buscar?q=${encodeURIComponent(q)}`);
    tiempos.push(performance.now() - t0);
    expect(r.status()).toBe(200);
  }
  tiempos.sort((a, b) => a - b);
  const p95 = tiempos[Math.floor(tiempos.length * 0.95) - 1]!;
  console.log(`busqueda p50=${tiempos[50]!.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${tiempos.at(-1)!.toFixed(1)}ms`);
  expect(p95).toBeLessThan(150);
  await ctx.dispose();
});
