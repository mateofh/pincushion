// Mantenimiento: borra exactamente lo vencido, para todos los usuarios, y nada más.
import { describe, expect, it } from 'vitest';
import { createTestApp, createUser } from '../../helpers/app.ts';
import { LEASE_MS } from '../../../src/domain/fetch-state.ts';
import { runMaintenance } from '../../../src/server/jobs/worker.ts';
import { getBookmark, insertBookmark } from './_data.ts';

const DAY = 24 * 60 * 60 * 1000;

describe('runMaintenance', () => {
  it('purga papelera > 30 d, sesiones > 7 d, rate limits viejos, audit > 365 d, favicons huérfanos y reclama leases', async () => {
    const app = createTestApp();
    const now = app.clock.now();
    const alice = await createUser(app, 'alice@example.com');
    const bob = await createUser(app, 'bob@example.com');

    // Enlaces
    const aOld = insertBookmark(app, alice, { url: 'https://viejo.example/a', trashedAt: now - 31 * DAY, excerpt: 'zanahoria' });
    const aRecent = insertBookmark(app, alice, { url: 'https://reciente.example/a', trashedAt: now - 29 * DAY });
    const aActive = insertBookmark(app, alice, { url: 'https://activo.example/a', status: 'succeeded', nextAttemptAt: null });
    const bOld = insertBookmark(app, bob, { url: 'https://viejo.example/b', trashedAt: now - 40 * DAY });
    const bActive = insertBookmark(app, bob, { url: 'https://bob.example/b', status: 'succeeded', nextAttemptAt: null });
    const leased = insertBookmark(app, bob, { url: 'https://colgado.example/', leaseUntil: now - 1 });
    app.db.run('INSERT INTO tags (user_id, name, name_key, created_at) VALUES (?, ?, ?, ?)', alice, 'cocina', 'cocina', now);
    const tagId = app.db.get<{ id: number }>('SELECT id FROM tags')!.id;
    app.db.run('INSERT INTO bookmark_tags (bookmark_id, tag_id, user_id) VALUES (?, ?, ?)', aOld, tagId, alice);
    app.db.run('INSERT INTO bookmark_tags (bookmark_id, tag_id, user_id) VALUES (?, ?, ?)', aActive, tagId, alice);

    // Sesiones
    const session = (id: string, user: number, expiresAt: number, revokedAt: number | null = null) =>
      app.db.run(
        'INSERT INTO sessions (id, user_id, csrf_secret, created_at, last_seen_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, user, 'csrf', now - 60 * DAY, now - 60 * DAY, expiresAt, revokedAt,
      );
    session('expirada-hace-8d', alice, now - 8 * DAY);
    session('expirada-hace-6d', alice, now - 6 * DAY);
    session('revocada-hace-8d', bob, now + 10 * DAY, now - 8 * DAY);
    session('revocada-hace-1d', bob, now + 10 * DAY, now - 1 * DAY);
    session('activa', bob, now + 10 * DAY);

    // Rate limits
    app.db.run('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)', 'login:viejo', now - 2 * DAY, 3);
    app.db.run('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)', 'login:actual', now - 30_000, 1);

    // Audit
    const audit = (user: number, at: number) =>
      app.db.run("INSERT INTO audit_events (user_id, type, created_at) VALUES (?, 'login.succeeded', ?)", user, at);
    audit(alice, now - 366 * DAY);
    audit(bob, now - 400 * DAY);
    audit(alice, now - 364 * DAY);
    audit(bob, now - 1 * DAY);

    // Favicons
    const fav = (user: number, domain: string) =>
      app.db.run("INSERT INTO favicons (user_id, domain, status, fetched_at) VALUES (?, ?, 'failed', ?)", user, domain, now);
    fav(alice, 'activo.example'); // tiene enlace → se queda
    fav(alice, 'reciente.example'); // enlace en papelera reciente → se queda
    fav(alice, 'viejo.example'); // su único enlace se purga → fuera
    fav(alice, 'sin-enlaces.example'); // huérfano → fuera
    fav(bob, 'activo.example'); // ese dominio es de alice, no de bob → fuera
    fav(bob, 'bob.example'); // se queda

    const r = await runMaintenance(app);
    expect(r).toEqual({ trashedPurged: 2, sessionsPurged: 2, rateLimitsPurged: 1, auditPurged: 2, faviconsPurged: 3, leasesReclaimed: 1 });

    const ids = app.db.all<{ id: number }>('SELECT id FROM bookmarks ORDER BY id').map((x) => x.id);
    expect(ids).toEqual([aRecent, aActive, bActive, leased].sort((a, b) => a - b));
    expect(ids).not.toContain(aOld);
    expect(ids).not.toContain(bOld);
    expect(app.db.all('SELECT bookmark_id FROM bookmark_tags')).toEqual([{ bookmark_id: aActive }]);
    expect(app.db.all("SELECT rowid FROM bookmarks_fts WHERE bookmarks_fts MATCH 'zanahoria'")).toEqual([]);
    expect(app.db.all<{ id: string }>('SELECT id FROM sessions ORDER BY id').map((s) => s.id)).toEqual(['activa', 'expirada-hace-6d', 'revocada-hace-1d']);
    expect(app.db.all<{ key: string }>('SELECT key FROM rate_limits').map((x) => x.key)).toEqual(['login:actual']);
    expect(app.db.all<{ created_at: number }>('SELECT created_at FROM audit_events ORDER BY created_at').map((x) => x.created_at)).toEqual([now - 364 * DAY, now - 1 * DAY]);
    expect(app.db.all<{ user_id: number; domain: string }>('SELECT user_id, domain FROM favicons ORDER BY user_id, domain')).toEqual([
      { user_id: alice, domain: 'activo.example' },
      { user_id: alice, domain: 'reciente.example' },
      { user_id: bob, domain: 'bob.example' },
    ]);
    expect(getBookmark(app, leased)).toMatchObject({ fetch_status: 'retrying', fetch_attempts: 1, lease_until: null, fetch_error_code: 'timeout' });
    expect(app.logs.some((l) => l.includes('maintenance.done'))).toBe(true);

    // Idempotente: una segunda pasada no borra nada más.
    expect(await runMaintenance(app)).toEqual({ trashedPurged: 0, sessionsPurged: 0, rateLimitsPurged: 0, auditPurged: 0, faviconsPurged: 0, leasesReclaimed: 0 });
  });

  it('no toca leases vigentes', async () => {
    const app = createTestApp();
    const user = await createUser(app, 'alice@example.com');
    const id = insertBookmark(app, user, { leaseUntil: app.clock.now() + LEASE_MS });
    expect((await runMaintenance(app)).leasesReclaimed).toBe(0);
    expect(getBookmark(app, id)).toMatchObject({ fetch_status: 'pending', fetch_attempts: 0 });
  });
});
