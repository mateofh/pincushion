// Helpers para tests de integración: app con DB en memoria migrada, reloj controlable y fetcher fake.
import { createApp, type App } from '../../src/server/context.ts';
import { openDb } from '../../src/server/db/sqlite.ts';
import { createFakeFetcher, type FakeFetcher } from '../../src/server/adapters/fake-fetcher.ts';
import { createLogger } from '../../src/server/log.ts';
import { hashPassword } from '../../src/server/crypto.ts';

export interface TestClock {
  now(): number;
  set(ms: number): void;
  advance(ms: number): void;
}

export function createTestClock(start = Date.UTC(2026, 10, 14, 12, 0, 0)): TestClock {
  let t = start;
  return { now: () => t, set: (ms) => void (t = ms), advance: (ms) => void (t += ms) };
}

export interface TestApp extends App {
  clock: TestClock;
  fetcher: FakeFetcher;
  logs: string[];
}

export function createTestApp(env: Record<string, string> = {}): TestApp {
  const logs: string[] = [];
  const clock = createTestClock();
  const fetcher = createFakeFetcher();
  const app = createApp({
    env: {
      APP_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
      APP_ORIGIN: 'http://localhost:4321',
      DATABASE_PATH: ':memory:',
      LOG_LEVEL: 'debug',
      JOBS_INLINE_WORKER: 'false',
      ...env,
    },
    db: openDb(':memory:'),
    clock,
    fetcher,
    log: createLogger('debug', {}, (l) => logs.push(l)),
    autoMigrate: true,
  });
  return Object.assign(app, { clock, fetcher, logs });
}

// Hash precalculado para no pagar scrypt en cada test.
let cachedHash: Promise<string> | undefined;
export const TEST_PASSWORD = 'contraseña-de-prueba';

export async function createUser(app: App, email: string, timezone = 'Europe/Madrid'): Promise<number> {
  cachedHash ??= hashPassword(TEST_PASSWORD);
  const now = app.clock.now();
  return app.db.run(
    'INSERT INTO users (email, password_hash, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    email.toLowerCase(), await cachedHash, timezone, now, now,
  ).lastInsertRowid;
}
