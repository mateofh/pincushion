// verify del token del bookmarklet: manipulado, otro secreto, revocado, inexistente, formato raro.
import { describe, expect, it } from 'vitest';
import { createTestApp, createUser } from '../../helpers/app.ts';
import { bookmarkletService } from '../../../src/server/auth/bookmarklet.ts';

describe('bookmarkletService.verify', () => {
  it('acepta el token emitido y devuelve usuario e id', async () => {
    const app = createTestApp();
    const uid = await createUser(app, 'a@example.com');
    const svc = bookmarkletService(app);
    const { token, info } = svc.ensureToken(uid);
    expect(token).toMatch(/^pc_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(svc.verify(token)).toEqual({ userId: uid, tokenId: info.id });
    // ensureToken es idempotente
    expect(svc.ensureToken(uid).token).toBe(token);
  });

  it('rechaza tokens manipulados', async () => {
    const app = createTestApp();
    const uid = await createUser(app, 'a@example.com');
    const svc = bookmarkletService(app);
    const { token } = svc.ensureToken(uid);
    const last = token.at(-1) === 'A' ? 'B' : 'A';
    expect(svc.verify(token.slice(0, -1) + last)).toBeNull();
    // id cambiado con la misma firma
    const [, rest] = token.split('_');
    const [id, mac] = rest!.split('.');
    const otherId = (id![0] === 'A' ? 'B' : 'A') + id!.slice(1);
    expect(svc.verify(`pc_${otherId}.${mac}`)).toBeNull();
    for (const bad of ['', 'pc_', token + 'x', token.slice(1), ` ${token}`, token.replace('.', '-'), 'x'.repeat(5000)]) {
      expect(svc.verify(bad)).toBeNull();
    }
    expect(svc.verify(undefined as unknown as string)).toBeNull();
  });

  it('no sirve con otro APP_SECRET ni para otro usuario', async () => {
    const app = createTestApp();
    const uid = await createUser(app, 'a@example.com');
    const { token } = bookmarkletService(app).ensureToken(uid);
    const other = createTestApp({ APP_SECRET: 'otro-secreto-0123456789abcdef0123456789abcdef' });
    // misma fila en la otra DB, otra clave
    const id = token.slice(3, 25);
    await createUser(other, 'a@example.com');
    other.db.run('INSERT INTO bookmarklet_tokens (id, user_id, created_at) VALUES (?, 1, 0)', id);
    expect(bookmarkletService(other).verify(token)).toBeNull();
    // fila reasignada a otro usuario en la misma DB: la firma ata user|id
    const bob = await createUser(app, 'b@example.com');
    app.db.run('UPDATE bookmarklet_tokens SET user_id = ? WHERE id = ?', bob, id);
    expect(bookmarkletService(app).verify(token)).toBeNull();
  });

  it('rechaza revocados e inexistentes', async () => {
    const app = createTestApp();
    const uid = await createUser(app, 'a@example.com');
    const svc = bookmarkletService(app);
    const first = svc.ensureToken(uid).token;
    const second = svc.rotate(uid).token;
    expect(first).not.toBe(second);
    expect(svc.verify(first)).toBeNull();
    expect(svc.verify(second)?.userId).toBe(uid);
    app.db.run('DELETE FROM bookmarklet_tokens');
    expect(svc.verify(second)).toBeNull();
  });

  it('markUsed actualiza último uso y última prueba', async () => {
    const app = createTestApp();
    const uid = await createUser(app, 'a@example.com');
    const svc = bookmarkletService(app);
    const { info } = svc.ensureToken(uid);
    app.clock.advance(1000);
    svc.markUsed(info.id, false);
    let now = svc.ensureToken(uid).info;
    expect(now.lastUsedAt).toBe(app.clock.now());
    expect(now.lastTestAt).toBeNull();
    app.clock.advance(1000);
    svc.markUsed(info.id, true);
    now = svc.ensureToken(uid).info;
    expect(now.lastTestAt).toBe(app.clock.now());
    expect(now.lastUsedAt).toBe(app.clock.now());
  });
});
