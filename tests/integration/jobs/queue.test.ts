// Cola de metadatos con fetcher fake: claim atómico, leases, reintentos, protección de ediciones y runInline.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, createTestClock, createUser } from '../../helpers/app.ts';
import { createApp } from '../../../src/server/context.ts';
import { openDb } from '../../../src/server/db/sqlite.ts';
import { createLogger } from '../../../src/server/log.ts';
import { createFakeFetcher } from '../../../src/server/adapters/fake-fetcher.ts';
import { PageFetchError, type PageMetadata } from '../../../src/server/adapters/types.ts';
import { BACKOFF_MS, LEASE_MS, MAX_ATTEMPTS } from '../../../src/domain/fetch-state.ts';
import { claimDue, enqueueFetch, executeJob, processDue, runFetch, runInline } from '../../../src/server/jobs/worker.ts';
import { getBookmark, insertBookmark } from './_data.ts';

const PNG = { contentType: 'image/png' as const, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]) };
const meta = (url: string, over: Partial<PageMetadata> = {}): PageMetadata => ({
  finalUrl: url,
  title: 'Título de la página',
  description: 'Descripción de la página',
  excerpt: 'Texto del artículo',
  faviconUrl: new URL('/favicon.ico', url).href,
  ...over,
});
const noJitter = () => 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('claimDue', () => {
  it('dos conexiones a la misma DB reclamando a la vez no duplican trabajos', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pincushion-cola-'));
    tmpDirs.push(dir);
    const path = join(dir, 'cola.db');
    const clock = createTestClock();
    const env = { APP_SECRET: 'x'.repeat(32), DATABASE_PATH: path, JOBS_INLINE_WORKER: 'false' };
    const mk = () => createApp({ env, db: openDb(path), clock, fetcher: createFakeFetcher(), log: createLogger('silent'), autoMigrate: true });
    const a = mk();
    const b = mk();
    const user = await createUser(a, 'alice@example.com');
    for (let i = 0; i < 25; i++) insertBookmark(a, user);

    const results = await Promise.all([
      Promise.resolve().then(() => claimDue(a, 10)),
      Promise.resolve().then(() => claimDue(b, 10)),
      Promise.resolve().then(() => claimDue(a, 10)),
      Promise.resolve().then(() => claimDue(b, 10)),
    ]);
    const ids = results.flat().map((j) => j.bookmarkId);
    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
    expect(claimDue(a, 10)).toEqual([]);
    a.db.close();
    b.db.close();
  });

  it('processDue concurrente sobre la misma app pide cada página una sola vez', async () => {
    const app = createTestApp();
    const user = await createUser(app, 'alice@example.com');
    const urls = Array.from({ length: 8 }, (_, i) => `https://sitio${i}.example/a`);
    for (const url of urls) {
      app.fetcher.set(url, async (u) => {
        await sleep(10);
        return meta(u);
      });
      insertBookmark(app, user, { url });
    }
    const counts = await Promise.all([processDue(app, { limit: 10 }), processDue(app, { limit: 10 })]);
    expect(counts[0] + counts[1]).toBe(8);
    expect([...app.fetcher.calls].sort()).toEqual([...urls].sort());
    const rows = app.db.all<{ fetch_status: string }>('SELECT fetch_status FROM bookmarks');
    expect(rows.every((r) => r.fetch_status === 'succeeded')).toBe(true);
  });

  it('solo reclama lo vencido, no lo que está en la papelera ni lo terminado', async () => {
    const app = createTestApp();
    const user = await createUser(app, 'alice@example.com');
    const now = app.clock.now();
    const due = insertBookmark(app, user);
    insertBookmark(app, user, { status: 'retrying', attempts: 1, nextAttemptAt: now + 1000 });
    insertBookmark(app, user, { trashedAt: now });
    insertBookmark(app, user, { status: 'succeeded', nextAttemptAt: null });
    insertBookmark(app, user, { status: 'failed', nextAttemptAt: null });
    expect(claimDue(app, 10).map((j) => j.bookmarkId)).toEqual([due]);
  });

  it('un lease vencido se reclama y cuenta como intento fallido; el worker viejo ya no puede escribir', async () => {
    const app = createTestApp();
    const user = await createUser(app, 'alice@example.com');
    const id = insertBookmark(app, user, { url: 'https://lento.example/' });
    const [stale] = claimDue(app, 5);
    expect(stale).toMatchObject({ bookmarkId: id, attempts: 0 });
    expect(getBookmark(app, id).lease_until).toBe(app.clock.now() + LEASE_MS);
    expect(claimDue(app, 5)).toEqual([]); // lease vigente

    app.clock.advance(LEASE_MS + 1);
    const [again] = claimDue(app, 5);
    expect(again).toMatchObject({ bookmarkId: id, attempts: 1 });
    expect(getBookmark(app, id)).toMatchObject({ fetch_status: 'retrying', fetch_attempts: 1, fetch_error_code: 'timeout' });

    // El worker original termina tarde: su escritura se descarta.
    app.fetcher.set('https://lento.example/', meta('https://lento.example/', { title: 'Tarde' }));
    const late = await executeJob(app, stale!, { jitter: noJitter });
    expect(late.finished).toBe(false);
    expect(getBookmark(app, id).title).not.toBe('Tarde');
    expect(app.logs.some((l) => l.includes('job.lease_lost'))).toBe(true);

    // El nuevo sí.
    const ok = await executeJob(app, again!, { jitter: noJitter });
    expect(ok).toMatchObject({ status: 'succeeded', finished: true });
    expect(getBookmark(app, id)).toMatchObject({ title: 'Tarde', fetch_attempts: 2, lease_until: null });
  });

  it('leases vencidos repetidos agotan los intentos → failed', async () => {
    const app = createTestApp();
    const user = await createUser(app, 'alice@example.com');
    const id = insertBookmark(app, user);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(claimDue(app, 1)).toHaveLength(1);
      app.clock.advance(LEASE_MS + 1);
    }
    expect(claimDue(app, 1)).toEqual([]);
    expect(getBookmark(app, id)).toMatchObject({ fetch_status: 'failed', fetch_attempts: MAX_ATTEMPTS, next_attempt_at: null, lease_until: null });
  });
});

describe('runFetch y processDue', () => {
  it('éxito: rellena título (fallback → page), descripción y excerpt, y guarda el favicon', async () => {
    const app = createTestApp();
    const user = await createUser(app, 'alice@example.com');
    const url = 'https://www.blog.example/post';
    app.fetcher.set(url, meta(url));
    app.fetcher.setFavicon('https://www.blog.example/favicon.ico', PNG);
    const id = insertBookmark(app, user, { url });
    const r = await runFetch(app, id, { jitter: noJitter });
    expect(r).toMatchObject({ bookmarkId: id, status: 'succeeded', finished: true, errorCode: null });
    expect(getBookmark(app, id)).toMatchObject({
      title: 'Título de la página',
      title_source: 'page',
      description: 'Descripción de la página',
      excerpt: 'Texto del artículo',
      fetch_status: 'succeeded',
      fetch_attempts: 1,
      next_attempt_at: null,
      fetch_error_code: null,
      lease_until: null,
      fetched_at: app.clock.now(),
    });
    const fav = app.db.get<{ status: string; content_type: string; bytes: Uint8Array }>(
      'SELECT status, content_type, bytes FROM favicons WHERE user_id = ? AND domain = ?', user, 'blog.example',
    );
    expect(fav).toMatchObject({ status: 'succeeded', content_type: 'image/png' });
    expect([...fav!.bytes]).toEqual([...PNG.bytes]);
    // El excerpt queda buscable por FTS.
    expect(app.db.all("SELECT rowid FROM bookmarks_fts WHERE bookmarks_fts MATCH 'articulo'")).toHaveLength(1);
  });

  it('el título editado por el usuario y una descripción existente sobreviven al fetch', async () => {
    const app = createTestApp();
    const user = await createUser(app, 'alice@example.com');
    const url = 'https://editado.example/';
    app.fetcher.set(url, meta(url));
    const id = insertBookmark(app, user, { url, title: 'Mi título', titleSource: 'user', description: 'Mi nota', excerpt: 'Lo que pegué' });
    await runFetch(app, id, { jitter: noJitter });
    expect(getBookmark(app, id)).toMatchObject({ title: 'Mi título', title_source: 'user', description: 'Mi nota', excerpt: 'Lo que pegué', fetch_status: 'succeeded' });

    // Título de usuario + descripción vacía: la descripción sí se rellena.
    const id2 = insertBookmark(app, user, { url: 'https://editado.example/2', title: 'Otro mío', titleSource: 'user' });
    app.fetcher.set('https://editado.example/2', meta('https://editado.example/2'));
    await runFetch(app, id2, { jitter: noJitter });
    expect(getBookmark(app, id2)).toMatchObject({ title: 'Otro mío', title_source: 'user', description: 'Descripción de la página' });
  });

  it('una página sin título no pisa el título de respaldo', async () => {
    const app = createTestApp();
    const user = await createUser(app, 'alice@example.com');
    const url = 'https://sin-titulo.example/';
    app.fetcher.set(url, meta(url, { title: null, description: null }));
    const id = insertBookmark(app, user, { url, title: 'sin-titulo.example' });
    await runFetch(app, id, { jitter: noJitter });
    expect(getBookmark(app, id)).toMatchObject({ title: 'sin-titulo.example', title_source: 'fallback', description: '', fetch_status: 'succeeded' });
  });

  it('500 → retrying con backoff creciente y failed tras MAX_ATTEMPTS intentos', async () => {
    const app = createTestApp();
    const user = await createUser(app, 'alice@example.com');
    const url = 'https://caido.example/';
    app.fetcher.set(url, new PageFetchError('http_error', 'HTTP 500', { status: 500, retryable: true }));
    const id = insertBookmark(app, user, { url });

    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      expect(await processDue(app, { jitter: noJitter })).toBe(1);
      const wait = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]!;
      expect(getBookmark(app, id)).toMatchObject({
        fetch_status: 'retrying',
        fetch_attempts: attempt,
        next_attempt_at: app.clock.now() + wait,
        fetch_error_code: 'http_error',
      });
      app.clock.advance(wait - 1);
      expect(await processDue(app, { jitter: noJitter })).toBe(0); // aún no toca
      app.clock.advance(1);
    }
    expect(await processDue(app, { jitter: noJitter })).toBe(1);
    expect(getBookmark(app, id)).toMatchObject({ fetch_status: 'failed', fetch_attempts: MAX_ATTEMPTS, next_attempt_at: null, fetch_error_code: 'http_error' });
    app.clock.advance(BACKOFF_MS[BACKOFF_MS.length - 1]! * 10);
    expect(await processDue(app)).toBe(0);
    expect(app.fetcher.calls).toHaveLength(MAX_ATTEMPTS);
  });

  it('el jitter inyectado desplaza el backoff ±20 %', async () => {
    const app = createTestApp();
    const user = await createUser(app, 'alice@example.com');
    const url = 'https://jitter.example/';
    app.fetcher.set(url, new PageFetchError('timeout', 't', { retryable: true }));
    const id = insertBookmark(app, user, { url });
    await runFetch(app, id, { jitter: () => 1 });
    expect(getBookmark(app, id).next_attempt_at).toBe(app.clock.now() + BACKOFF_MS[0] * 1.2);
  });

  it('403 → failed sin reintento; not_html → skipped (con favicon del origen)', async () => {
    const app = createTestApp();
    const user = await createUser(app, 'alice@example.com');
    app.fetcher.set('https://prohibido.example/', new PageFetchError('http_error', 'HTTP 403', { status: 403 }));
    app.fetcher.set('https://docs.example/a.pdf', new PageFetchError('not_html', 'pdf'));
    app.fetcher.setFavicon('https://docs.example/favicon.ico', PNG);
    const a = insertBookmark(app, user, { url: 'https://prohibido.example/' });
    const b = insertBookmark(app, user, { url: 'https://docs.example/a.pdf' });
    expect(await processDue(app)).toBe(2);
    expect(getBookmark(app, a)).toMatchObject({ fetch_status: 'failed', fetch_attempts: 1, next_attempt_at: null, fetch_error_code: 'http_error' });
    expect(getBookmark(app, b)).toMatchObject({ fetch_status: 'skipped', fetch_error_code: 'not_html' });
    expect(app.db.get('SELECT status FROM favicons WHERE domain = ?', 'docs.example')).toEqual({ status: 'succeeded' });
    expect(app.db.get('SELECT 1 FROM favicons WHERE domain = ?', 'prohibido.example')).toBeUndefined();
  });

  it('no vuelve a pedir un favicon reciente del mismo (usuario, dominio); otro usuario sí lo pide', async () => {
    const app = createTestApp();
    const alice = await createUser(app, 'alice@example.com');
    const bob = await createUser(app, 'bob@example.com');
    let favCalls = 0;
    const orig = app.fetcher.fetchFavicon.bind(app.fetcher);
    app.fetcher.fetchFavicon = async (u, o) => {
      favCalls++;
      return orig(u, o);
    };
    app.fetcher.setFavicon('https://mismo.example/favicon.ico', PNG);
    for (const p of ['a', 'b', 'c']) app.fetcher.set(`https://mismo.example/${p}`, meta(`https://mismo.example/${p}`));
    await runFetch(app, insertBookmark(app, alice, { url: 'https://mismo.example/a' }));
    await runFetch(app, insertBookmark(app, alice, { url: 'https://mismo.example/b' }));
    expect(favCalls).toBe(1);
    await runFetch(app, insertBookmark(app, bob, { url: 'https://mismo.example/c' }));
    expect(favCalls).toBe(2);
    // Pasados 30 días se refresca.
    app.clock.advance(31 * 24 * 3600 * 1000);
    const d = insertBookmark(app, alice, { url: 'https://mismo.example/a?otra=1' });
    app.fetcher.set('https://mismo.example/a?otra=1', meta('https://mismo.example/a'));
    await runFetch(app, d);
    expect(favCalls).toBe(3);
  });

  it('enqueueFetch ("Reintentar") devuelve un enlace fallido a la cola', async () => {
    const app = createTestApp();
    const user = await createUser(app, 'alice@example.com');
    const url = 'https://vuelve.example/';
    const id = insertBookmark(app, user, { url, status: 'failed', attempts: MAX_ATTEMPTS, nextAttemptAt: null });
    expect(await runFetch(app, id)).toBeNull(); // failed no se reclama
    expect(enqueueFetch(app, id)).toBe(true);
    expect(getBookmark(app, id)).toMatchObject({ fetch_status: 'pending', fetch_attempts: 0, next_attempt_at: app.clock.now(), fetch_error_code: null });
    app.fetcher.set(url, meta(url));
    expect(await processDue(app)).toBe(1);
    expect(getBookmark(app, id).fetch_status).toBe('succeeded');
    expect(enqueueFetch(app, 999_999)).toBe(false);
  });

  it('los logs llevan job_id y bookmark_id, y nunca la URL completa', async () => {
    const app = createTestApp();
    const user = await createUser(app, 'alice@example.com');
    const url = 'https://privado.example/ruta-secreta?token=abc';
    app.fetcher.set(url, new PageFetchError('http_error', 'x', { status: 500, retryable: true }));
    const id = insertBookmark(app, user, { url });
    await processDue(app);
    const done = app.logs.map((l) => JSON.parse(l)).find((l) => l.msg === 'job.done');
    expect(done).toMatchObject({ bookmark_id: id, domain: 'privado.example', status: 'retrying' });
    expect(typeof done.job_id).toBe('string');
    expect(app.logs.join('\n')).not.toContain('ruta-secreta');
    expect(app.logs.join('\n')).not.toContain('token=abc');
  });
});

describe('runInline', () => {
  it('si termina dentro del presupuesto, deja datos y favicon listos', async () => {
    const app = createTestApp();
    const user = await createUser(app, 'alice@example.com');
    const url = 'https://rapido.example/';
    app.fetcher.set(url, meta(url));
    app.fetcher.setFavicon('https://rapido.example/favicon.ico', PNG);
    const id = insertBookmark(app, user, { url });
    const r = await runInline(app, id, { budgetMs: 1000 });
    expect(r).toMatchObject({ status: 'succeeded', finished: true });
    expect(app.db.get('SELECT status FROM favicons WHERE domain = ?', 'rapido.example')).toEqual({ status: 'succeeded' });
  });

  it('respeta el presupuesto: si no alcanza, vuelve a tiempo y deja el enlace pendiente para el worker', async () => {
    const app = createTestApp();
    const user = await createUser(app, 'alice@example.com');
    const url = 'https://tardon.example/';
    app.fetcher.set(url, async (u) => {
      await sleep(800);
      return meta(u, { title: 'Llegó tarde' });
    });
    const id = insertBookmark(app, user, { url });
    const t0 = Date.now();
    const r = await runInline(app, id, { budgetMs: 100 });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(400);
    expect(r).toMatchObject({ bookmarkId: id, status: 'pending', finished: false });
    expect(getBookmark(app, id)).toMatchObject({ fetch_status: 'pending', fetch_attempts: 0, lease_until: null, next_attempt_at: app.clock.now() });

    // La respuesta tardía no escribe nada.
    await sleep(850);
    expect(getBookmark(app, id).title).not.toBe('Llegó tarde');

    // El worker lo retoma.
    app.fetcher.set(url, meta(url));
    expect(await processDue(app)).toBe(1);
    expect(getBookmark(app, id)).toMatchObject({ fetch_status: 'succeeded', fetch_attempts: 1 });
  });

  it('no compite con un worker que ya tiene el lease', async () => {
    const app = createTestApp();
    const user = await createUser(app, 'alice@example.com');
    const id = insertBookmark(app, user);
    claimDue(app, 1);
    expect(await runInline(app, id, { budgetMs: 100 })).toBeNull();
    expect(app.fetcher.calls).toHaveLength(0);
  });
});
