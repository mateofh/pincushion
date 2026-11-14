// Helpers de las pruebas de operación: DB temporal y scripts ejecutados como procesos hijos.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate, type Db } from '../../../src/server/db/sqlite.ts';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export interface ScriptResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface TempDb {
  dir: string;
  path: string;
  env: Record<string, string>;
  run(script: string, args?: string[], extraEnv?: Record<string, string | undefined>): ScriptResult;
  open(): Db;
  cleanup(): void;
}

export function createTempDb(opts: { migrated?: boolean } = {}): TempDb {
  const dir = mkdtempSync(join(tmpdir(), 'pincushion-ops-'));
  const path = join(dir, 'pincushion.db');
  const env: Record<string, string> = {
    APP_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
    APP_ORIGIN: 'http://localhost:4321',
    DATABASE_PATH: path,
    LOG_LEVEL: 'silent',
  };
  if (opts.migrated !== false) {
    const db = openDb(path);
    migrate(db);
    db.close();
  }
  return {
    dir,
    path,
    env,
    run(script, args = [], extraEnv = {}) {
      const childEnv: Record<string, string | undefined> = { ...process.env, ...env, ...extraEnv };
      for (const [k, v] of Object.entries(childEnv)) if (v === undefined) delete childEnv[k];
      const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join('scripts', script), ...args], {
        cwd: ROOT,
        env: childEnv as NodeJS.ProcessEnv,
        encoding: 'utf8',
        timeout: 30_000,
      });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    },
    open: () => openDb(path),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Conteos globales y por usuario para comparar ejecuciones. */
export function snapshot(db: Db): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of ['users', 'bookmarks', 'collections', 'tags', 'bookmark_tags', 'bookmarklet_tokens']) {
    out[t] = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n;
  }
  for (const u of db.all<{ email: string; n: number }>(
    'SELECT u.email, COUNT(b.id) AS n FROM users u LEFT JOIN bookmarks b ON b.user_id = u.id GROUP BY u.id ORDER BY u.email',
  )) {
    out[`bookmarks:${u.email}`] = u.n;
  }
  return out;
}
