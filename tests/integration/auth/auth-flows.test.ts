// Flujos de auth con DB: rotación del token, login con auditoría y rate limit, cambio de contraseña y sesiones.
import { describe, expect, it } from 'vitest';
import { createTestApp, createUser, TEST_PASSWORD } from '../../helpers/app.ts';
import { bookmarkletService } from '../../../src/server/auth/bookmarklet.ts';
import { attemptLogin } from '../../../src/server/auth/login.ts';
import { createSession, lookupSession, revokeAllForUser } from '../../../src/server/auth/sessions.ts';
import { changePassword, logout, logoutEverywhere, setTimezone } from '../../../src/server/auth/account.ts';
import { verifyPassword } from '../../../src/server/crypto.ts';

const audits = (app: ReturnType<typeof createTestApp>) =>
  app.db.all<{ type: string; user_id: number | null; meta_json: string; request_id: string | null }>(
    'SELECT type, user_id, meta_json, request_id FROM audit_events ORDER BY id',
  );

describe('token del bookmarklet', () => {
  it('rotar deja un solo token activo, revoca el anterior y audita', async () => {
    const app = createTestApp();
    const uid = await createUser(app, 'a@example.com');
    const svc = bookmarkletService(app, { requestId: 'req-rotate-1' });
    const a = svc.ensureToken(uid);
    const b = svc.rotate(uid);
    const c = svc.rotate(uid);
    const active = app.db.all('SELECT id FROM bookmarklet_tokens WHERE user_id = ? AND revoked_at IS NULL', uid);
    expect(active).toEqual([{ id: c.info.id }]);
    expect(app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM bookmarklet_tokens')!.n).toBe(3);
    expect(svc.verify(a.token)).toBeNull();
    expect(svc.verify(b.token)).toBeNull();
    expect(svc.verify(c.token)?.tokenId).toBe(c.info.id);
    const rot = audits(app).filter((e) => e.type === 'token.rotated');
    expect(rot).toHaveLength(2);
    expect(rot[1]!.request_id).toBe('req-rotate-1');
    expect(rot[1]!.meta_json).not.toContain(c.token.split('.')[1]!);
    // En la DB no hay nada que permita reconstruir el secreto salvo el id.
    const cols = app.db.all<{ name: string }>("SELECT name FROM pragma_table_info('bookmarklet_tokens')").map((r) => r.name);
    expect(cols.sort()).toEqual(['created_at', 'id', 'last_test_at', 'last_used_at', 'revoked_at', 'user_id']);
  });

  it('el índice único parcial impide dos tokens activos aunque se salte el servicio', async () => {
    const app = createTestApp();
    const uid = await createUser(app, 'a@example.com');
    bookmarkletService(app).ensureToken(uid);
    expect(() => app.db.run('INSERT INTO bookmarklet_tokens (id, user_id, created_at) VALUES (?, ?, 0)', 'x'.repeat(22), uid)).toThrow(/UNIQUE/);
  });

  it('tokens de usuarios distintos son independientes', async () => {
    const app = createTestApp();
    const alice = await createUser(app, 'alice@example.com');
    const bob = await createUser(app, 'bob@example.com');
    const svc = bookmarkletService(app);
    const ta = svc.ensureToken(alice).token;
    svc.rotate(bob);
    expect(svc.verify(ta)?.userId).toBe(alice);
  });
});

describe('login', () => {
  it('fallido audita sin email en claro y sin contraseña; correcto rota la sesión anterior', async () => {
    const app = createTestApp();
    const uid = await createUser(app, 'dueno@example.com');
    const bad = await attemptLogin(app, { email: 'Dueno@Example.com', password: 'mala-contraseña', ip: '10.0.0.1', requestId: 'req-1' });
    expect(bad.kind).toBe('invalid');
    const unknown = await attemptLogin(app, { email: 'nadie@example.com', password: 'x', ip: '10.0.0.1' });
    expect(unknown.kind).toBe('invalid');

    const old = createSession(app, uid);
    const ok = await attemptLogin(app, { email: 'dueno@example.com', password: TEST_PASSWORD, ip: '10.0.0.1', previousToken: old.token });
    expect(ok.kind).toBe('ok');
    if (ok.kind !== 'ok') return;
    expect(ok.token).not.toBe(old.token);
    expect(lookupSession(app, old.token).status).toBe('expired');
    expect(lookupSession(app, ok.token).status).toBe('active');

    const events = audits(app);
    expect(events.map((e) => e.type)).toEqual(['login.failed', 'login.failed', 'login.succeeded']);
    expect(events[0]!.user_id).toBe(uid);
    expect(events[0]!.request_id).toBe('req-1');
    expect(events[1]!.user_id).toBeNull();
    const all = JSON.stringify(events) + app.logs.join('\n');
    expect(all).not.toMatch(/dueno@example\.com|nadie@example\.com|mala-contraseña|10\.0\.0\.1/i);
    expect(all).not.toContain(TEST_PASSWORD);
    const meta = JSON.parse(events[0]!.meta_json) as Record<string, string>;
    expect(meta.email_hash).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(JSON.parse(events[1]!.meta_json).email_hash).not.toBe(meta.email_hash);
  });

  it('campos vacíos no cuentan ni auditan', async () => {
    const app = createTestApp();
    expect((await attemptLogin(app, { email: '', password: 'x', ip: '1.1.1.1' })).kind).toBe('missing');
    expect(audits(app)).toHaveLength(0);
    expect(app.db.all('SELECT * FROM rate_limits')).toHaveLength(0);
  });

  it('429 por IP con el límite configurado, incluso con la contraseña correcta', async () => {
    const app = createTestApp({ RATE_LIMIT_LOGIN_PER_MIN: '3' });
    await createUser(app, 'dueno@example.com');
    for (let i = 0; i < 3; i++) await attemptLogin(app, { email: `x${i}@example.com`, password: 'mala', ip: '7.7.7.7' });
    const r = await attemptLogin(app, { email: 'dueno@example.com', password: TEST_PASSWORD, ip: '7.7.7.7' });
    expect(r.kind).toBe('rate_limited');
    if (r.kind === 'rate_limited') expect(r.retryAfterS).toBeGreaterThan(0);
    // Desde otra IP el dueño sigue pudiendo entrar.
    expect((await attemptLogin(app, { email: 'dueno@example.com', password: TEST_PASSWORD, ip: '8.8.8.8' })).kind).toBe('ok');
    // Pasada la ventana, vuelve a dejar.
    app.clock.advance(60_000);
    expect((await attemptLogin(app, { email: 'dueno@example.com', password: TEST_PASSWORD, ip: '7.7.7.7' })).kind).toBe('ok');
  });

  it('429 por (email, IP) tras 20 intentos en una hora', async () => {
    const app = createTestApp({ RATE_LIMIT_LOGIN_PER_MIN: '10000' });
    await createUser(app, 'dueno@example.com');
    for (let i = 0; i < 20; i++) expect((await attemptLogin(app, { email: 'dueno@example.com', password: 'mala', ip: '7.7.7.7' })).kind).toBe('invalid');
    const r = await attemptLogin(app, { email: 'dueno@example.com', password: TEST_PASSWORD, ip: '7.7.7.7' });
    expect(r.kind).toBe('rate_limited');
    if (r.kind === 'rate_limited') expect(r.retryAfterS).toBeLessThanOrEqual(3600);
  });
});

describe('sesiones y contraseña', () => {
  it('cambiar la contraseña revoca las demás sesiones, conserva la actual y audita', async () => {
    const app = createTestApp();
    const uid = await createUser(app, 'dueno@example.com');
    const other = await createUser(app, 'otra@example.com');
    const current = createSession(app, uid);
    const phone = createSession(app, uid);
    const laptop = createSession(app, uid);
    const foreign = createSession(app, other);

    const r = await changePassword(app, { userId: uid, sessionId: current.session.id, current: TEST_PASSWORD, next: 'nueva-contraseña-larga', confirm: 'nueva-contraseña-larga', requestId: 'req-pw' });
    expect(r).toEqual({ ok: true, revoked: 2 });
    expect(lookupSession(app, current.token).status).toBe('active');
    expect(lookupSession(app, phone.token).status).toBe('expired');
    expect(lookupSession(app, laptop.token).status).toBe('expired');
    expect(lookupSession(app, foreign.token).status).toBe('active');
    const row = app.db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', uid)!;
    expect(await verifyPassword('nueva-contraseña-larga', row.password_hash)).toBe(true);
    const ev = audits(app).find((e) => e.type === 'password.changed')!;
    expect(ev.user_id).toBe(uid);
    expect(ev.meta_json).not.toContain('nueva-contraseña');
    expect(JSON.parse(ev.meta_json)).toEqual({ other_sessions_revoked: 2 });
  });

  it('valida la contraseña actual, la longitud y la confirmación sin cambiar nada', async () => {
    const app = createTestApp();
    const uid = await createUser(app, 'dueno@example.com');
    const s = createSession(app, uid);
    const phone = createSession(app, uid);
    const base = { userId: uid, sessionId: s.session.id };
    expect(await changePassword(app, { ...base, current: 'mala', next: 'nueva-contraseña-larga', confirm: 'nueva-contraseña-larga' })).toMatchObject({ ok: false, field: 'current' });
    expect(await changePassword(app, { ...base, current: TEST_PASSWORD, next: 'corta', confirm: 'corta' })).toMatchObject({ ok: false, field: 'next' });
    expect(await changePassword(app, { ...base, current: TEST_PASSWORD, next: 'nueva-contraseña-larga', confirm: 'otra-cosa-distinta' })).toMatchObject({ ok: false, field: 'confirm' });
    expect(await changePassword(app, { ...base, current: TEST_PASSWORD, next: TEST_PASSWORD, confirm: TEST_PASSWORD })).toMatchObject({ ok: false, field: 'next' });
    expect(lookupSession(app, phone.token).status).toBe('active');
    expect(audits(app)).toHaveLength(0);
  });

  it('limita los intentos de cambio de contraseña por usuario', async () => {
    const app = createTestApp();
    const uid = await createUser(app, 'dueno@example.com');
    const s = createSession(app, uid);
    for (let i = 0; i < 10; i++) await changePassword(app, { userId: uid, sessionId: s.session.id, current: 'mala', next: 'nueva-contraseña-larga', confirm: 'nueva-contraseña-larga' });
    const r = await changePassword(app, { userId: uid, sessionId: s.session.id, current: TEST_PASSWORD, next: 'nueva-contraseña-larga', confirm: 'nueva-contraseña-larga' });
    expect(r).toMatchObject({ ok: false, field: 'form' });
    if (!r.ok) expect(r.retryAfterS).toBeGreaterThan(0);
  });

  it('cerrar todas las sesiones y salir auditan; revokeAllForUser respeta except', async () => {
    const app = createTestApp();
    const uid = await createUser(app, 'dueno@example.com');
    const a = createSession(app, uid);
    const b = createSession(app, uid);
    expect(revokeAllForUser(app, uid, { except: a.session.id })).toBe(1);
    expect(lookupSession(app, a.token).status).toBe('active');
    expect(lookupSession(app, b.token)).toEqual({ status: 'expired', userId: uid });
    const c = createSession(app, uid);
    logout(app, uid, c.session.id, 'req-out');
    logout(app, uid, c.session.id, 'req-out'); // idempotente: no audita dos veces
    expect(logoutEverywhere(app, uid)).toBe(1);
    expect(lookupSession(app, a.token).status).toBe('expired');
    expect(audits(app).map((e) => e.type)).toEqual(['session.revoked', 'sessions.revoked_all']);
  });

  it('zona horaria: valida IANA y persiste', async () => {
    const app = createTestApp();
    const uid = await createUser(app, 'dueno@example.com', 'UTC');
    expect(setTimezone(app, uid, 'Mars/Olympus').ok).toBe(false);
    expect(setTimezone(app, uid, '../../etc').ok).toBe(false);
    expect(setTimezone(app, uid, 'America/Argentina/Buenos_Aires')).toEqual({ ok: true, timezone: 'America/Argentina/Buenos_Aires' });
    expect(app.db.get<{ timezone: string }>('SELECT timezone FROM users WHERE id = ?', uid)!.timezone).toBe('America/Argentina/Buenos_Aires');
  });
});
