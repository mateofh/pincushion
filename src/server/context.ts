// Contexto de la aplicación: un único punto donde se crean config, DB, logger, reloj y adaptadores.
// Las páginas lo obtienen con getApp(); los tests crean el suyo con createApp().
import { loadConfig, type Config } from './config.ts';
import { openDb, migrate, pendingMigrations, type Db } from './db/sqlite.ts';
import { createLogger, type Logger } from './log.ts';
import type { PageFetcher } from './adapters/types.ts';
import { createHttpPageFetcher } from './adapters/page-fetcher.ts';

export interface Clock {
  now(): number;
}

export interface App {
  config: Config;
  db: Db;
  log: Logger;
  clock: Clock;
  fetcher: PageFetcher;
}

export interface CreateAppOptions {
  env?: Record<string, string | undefined>;
  db?: Db;
  clock?: Clock;
  fetcher?: PageFetcher;
  log?: Logger;
  /** Aplica migraciones pendientes al abrir (tests y dev). En producción se usa `npm run db:migrate`. */
  autoMigrate?: boolean;
}

export function createApp(opts: CreateAppOptions = {}): App {
  const config = loadConfig(opts.env ?? process.env);
  const log = opts.log ?? createLogger(config.LOG_LEVEL);
  const db = opts.db ?? openDb(config.DATABASE_PATH);
  if (opts.autoMigrate) migrate(db);
  else {
    const pending = pendingMigrations(db);
    if (pending.length) throw new Error(`Hay migraciones pendientes (${pending.join(', ')}). Ejecuta: npm run db:migrate`);
  }
  const clock = opts.clock ?? { now: () => Date.now() };
  const fetcher = opts.fetcher ?? createHttpPageFetcher(config, log);
  return { config, db, log, clock, fetcher };
}

const KEY = Symbol.for('pincushion.app');
type GlobalWithApp = typeof globalThis & { [KEY]?: App };

/** App compartida del proceso (servidor). Se crea la primera vez que se pide. */
export function getApp(): App {
  const g = globalThis as GlobalWithApp;
  if (!g[KEY]) {
    g[KEY] = createApp({ autoMigrate: process.env.NODE_ENV !== 'production' });
    void import('./jobs/worker.ts').then((m) => m.startWorkerOnce(g[KEY]!));
  }
  return g[KEY]!;
}

/** Solo para tests y scripts: reemplaza la app compartida. */
export function setApp(app: App | undefined): void {
  (globalThis as GlobalWithApp)[KEY] = app;
}
