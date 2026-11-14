// Cola + PageFetcher HTTP real contra el servidor de fixtures (127.0.0.1, modo test).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createUser, type TestApp } from '../../helpers/app.ts';
import { createHttpPageFetcher } from '../../../src/server/adapters/page-fetcher.ts';
import type { PageFetcher } from '../../../src/server/adapters/types.ts';
import { processDue, runInline } from '../../../src/server/jobs/worker.ts';
import { startSite, testEnv, type Site } from '../adapters/_site.ts';
import { getBookmark, insertBookmark } from './_data.ts';

let site: Site;
beforeAll(async () => {
  site = await startSite();
});
afterAll(() => site.close());

function realApp(): TestApp {
  const app = createTestApp(testEnv(site));
  (app as { fetcher: PageFetcher }).fetcher = createHttpPageFetcher(app.config, app.log);
  return app;
}

describe('cola con fetcher real', () => {
  it('guarda metadatos y favicon PNG; 403 queda failed; PDF skipped; redirect a loopback failed (blocked_address)', async () => {
    const app = realApp();
    const user = await createUser(app, 'alice@example.com');
    const ok = insertBookmark(app, user, { url: site.url('/articulo') });
    const forbidden = insertBookmark(app, user, { url: site.url('/bloqueado') });
    const pdf = insertBookmark(app, user, { url: site.url('/documento.pdf') });
    const blocked = insertBookmark(app, user, { url: site.url('/redirige-a-loopback') });
    const svgOnly = insertBookmark(app, user, { url: site.url('/con-icono-svg') });
    expect(await processDue(app, { limit: 10, jitter: () => 0 })).toBe(5);

    expect(getBookmark(app, ok)).toMatchObject({ title: 'Pan de masa madre en casa', title_source: 'page', fetch_status: 'succeeded' });
    expect(getBookmark(app, ok).excerpt).toContain('fermentación lenta en frío');
    expect(getBookmark(app, forbidden)).toMatchObject({ fetch_status: 'failed', fetch_attempts: 1, fetch_error_code: 'http_error' });
    expect(getBookmark(app, pdf)).toMatchObject({ fetch_status: 'skipped', fetch_error_code: 'not_html' });
    expect(getBookmark(app, blocked)).toMatchObject({ fetch_status: 'failed', fetch_attempts: 1, fetch_error_code: 'blocked_address' });
    expect(getBookmark(app, svgOnly).fetch_status).toBe('succeeded');

    // Todos comparten dominio (127.0.0.1): el primero que termina guarda el favicon y los demás lo reutilizan.
    const fav = app.db.get<{ status: string; content_type: string }>('SELECT status, content_type FROM favicons WHERE user_id = ?', user);
    expect(fav?.status).toBe('succeeded');
    expect(['image/png', 'image/x-icon']).toContain(fav?.content_type);
  });

  it('500 → retrying; runInline con servidor lento respeta el presupuesto y deja el enlace al worker', async () => {
    const app = realApp();
    const user = await createUser(app, 'alice@example.com');
    const err = insertBookmark(app, user, { url: site.url('/error-500') });
    await processDue(app, { jitter: () => 0 });
    expect(getBookmark(app, err)).toMatchObject({ fetch_status: 'retrying', fetch_attempts: 1, fetch_error_code: 'http_error' });

    const slow = insertBookmark(app, user, { url: site.url('/lento') });
    const t0 = Date.now();
    const r = await runInline(app, slow, { budgetMs: 300 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r).toMatchObject({ status: 'pending', finished: false });
    expect(getBookmark(app, slow)).toMatchObject({ fetch_status: 'pending', fetch_attempts: 0, lease_until: null });
  });

  it('timeout del fetcher (METADATA_TIMEOUT_MS) cuenta como intento reintentable', async () => {
    const app = createTestApp(testEnv(site, { METADATA_TIMEOUT_MS: '500' }));
    (app as { fetcher: PageFetcher }).fetcher = createHttpPageFetcher(app.config, app.log);
    const user = await createUser(app, 'alice@example.com');
    const slow = insertBookmark(app, user, { url: site.url('/lento') });
    await processDue(app, { jitter: () => 0 });
    expect(getBookmark(app, slow)).toMatchObject({ fetch_status: 'retrying', fetch_attempts: 1, fetch_error_code: 'timeout' });
  });

  it('el título editado por el usuario sobrevive a un fetch real', async () => {
    const app = realApp();
    const user = await createUser(app, 'alice@example.com');
    const id = insertBookmark(app, user, { url: site.url('/articulo-2'), title: 'Mi pan', titleSource: 'user' });
    await processDue(app);
    expect(getBookmark(app, id)).toMatchObject({ title: 'Mi pan', title_source: 'user', description: 'Guía práctica para hornear pan con masa madre.', fetch_status: 'succeeded' });
  });
});
