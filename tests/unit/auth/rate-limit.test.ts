import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../helpers/app.ts';
import { hit, hitLogin, purgeRateLimits, rateLimitKey, tooManyMessage } from '../../../src/server/security/rate-limit.ts';

describe('rate limit de ventana fija', () => {
  it('permite hasta el límite y bloquea el siguiente con Retry-After hasta el fin de la ventana', () => {
    const app = createTestApp();
    app.clock.set(60_000 * 1000); // inicio exacto de una ventana de 60 s
    for (let i = 0; i < 3; i++) expect(hit(app, 's', 'k', 3, 60_000).allowed).toBe(true);
    app.clock.advance(15_000);
    const blocked = hit(app, 's', 'k', 3, 60_000);
    expect(blocked).toEqual({ allowed: false, retryAfterS: 45, remaining: 0 });
  });

  it('en el borde: último ms de la ventana sigue bloqueado, el primero de la siguiente se reinicia', () => {
    const app = createTestApp();
    const start = 60_000 * 2000;
    app.clock.set(start);
    hit(app, 's', 'k', 1, 60_000);
    app.clock.set(start + 59_999);
    const edge = hit(app, 's', 'k', 1, 60_000);
    expect(edge.allowed).toBe(false);
    expect(edge.retryAfterS).toBe(1);
    app.clock.set(start + 60_000);
    expect(hit(app, 's', 'k', 1, 60_000)).toEqual({ allowed: true, retryAfterS: 0, remaining: 0 });
    expect(hit(app, 's', 'k', 1, 60_000).allowed).toBe(false);
  });

  it('separa scopes y claves, y no guarda el valor en claro', () => {
    const app = createTestApp();
    expect(hit(app, 'a', '1.2.3.4', 1, 60_000).allowed).toBe(true);
    expect(hit(app, 'b', '1.2.3.4', 1, 60_000).allowed).toBe(true);
    expect(hit(app, 'a', '5.6.7.8', 1, 60_000).allowed).toBe(true);
    const keys = app.db.all<{ key: string }>('SELECT key FROM rate_limits').map((r) => r.key);
    expect(keys).toHaveLength(3);
    expect(keys).toContain(rateLimitKey('a', '1.2.3.4'));
    expect(keys.join()).not.toContain('1.2.3.4');
  });

  it('login: límite por IP (config) y 20/h por (email, IP) sin afectar a otra IP', () => {
    const app = createTestApp({ RATE_LIMIT_LOGIN_PER_MIN: '1000' });
    for (let i = 0; i < 20; i++) expect(hitLogin(app, '1.1.1.1', 'dueno@example.com').allowed).toBe(true);
    const r = hitLogin(app, '1.1.1.1', 'Dueno@Example.com ');
    expect(r.allowed).toBe(false);
    expect(r.retryAfterS).toBeGreaterThan(0);
    expect(hitLogin(app, '2.2.2.2', 'dueno@example.com').allowed).toBe(true);

    const strict = createTestApp({ RATE_LIMIT_LOGIN_PER_MIN: '2' });
    expect(hitLogin(strict, '1.1.1.1', 'a@x.com').allowed).toBe(true);
    expect(hitLogin(strict, '1.1.1.1', 'b@x.com').allowed).toBe(true);
    expect(hitLogin(strict, '1.1.1.1', 'c@x.com').allowed).toBe(false);
  });

  it('purga ventanas viejas y formatea el mensaje', () => {
    const app = createTestApp();
    hit(app, 's', 'k', 1, 60_000);
    app.clock.advance(2 * 60 * 60 * 1000);
    expect(purgeRateLimits(app)).toBe(1);
    expect(tooManyMessage(12)).toBe('Demasiados intentos, espera 12 s');
  });

  it('valida parámetros', () => {
    const app = createTestApp();
    expect(() => hit(app, 's', 'k', 0, 60_000)).toThrow();
    expect(() => hit(app, 's', 'k', 1, 10)).toThrow();
  });
});
