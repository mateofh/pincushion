// Única puerta a node:sqlite. El resto del código usa la interfaz Db.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readdirSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type Param = SQLInputValue;
export type Row = Record<string, unknown>;

export interface Db {
  get<T = Row>(sql: string, ...params: Param[]): T | undefined;
  all<T = Row>(sql: string, ...params: Param[]): T[];
  run(sql: string, ...params: Param[]): { changes: number; lastInsertRowid: number };
  exec(sql: string): void;
  /** Ejecuta fn dentro de una transacción (BEGIN IMMEDIATE). Anidar reutiliza la externa. */
  transaction<T>(fn: () => T): T;
  close(): void;
}

class SqliteDb implements Db {
  #db: DatabaseSync;
  #depth = 0;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.#db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    this.#db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  }
  get<T>(sql: string, ...params: Param[]): T | undefined {
    return this.#db.prepare(sql).get(...params) as T | undefined;
  }
  all<T>(sql: string, ...params: Param[]): T[] {
    return this.#db.prepare(sql).all(...params) as T[];
  }
  run(sql: string, ...params: Param[]) {
    const r = this.#db.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }
  exec(sql: string) {
    this.#db.exec(sql);
  }
  transaction<T>(fn: () => T): T {
    if (this.#depth > 0) {
      this.#depth++;
      try { return fn(); } finally { this.#depth--; }
    }
    this.#db.exec('BEGIN IMMEDIATE');
    this.#depth = 1;
    try {
      const out = fn();
      if (out instanceof Promise) throw new Error('db.transaction no admite funciones async');
      this.#db.exec('COMMIT');
      return out;
    } catch (err) {
      this.#db.exec('ROLLBACK');
      throw err;
    } finally {
      this.#depth = 0;
    }
  }
  close() {
    this.#db.close();
  }
}

export function openDb(path: string): Db {
  return new SqliteDb(path);
}

export const MIGRATIONS_DIR = resolve(process.env.PINCUSHION_MIGRATIONS_DIR ?? join(process.cwd(), 'migrations'));

export function listMigrations(dir = MIGRATIONS_DIR): { name: string; sql: string }[] {
  if (!existsSync(dir)) throw new Error(`No existe el directorio de migraciones: ${dir}`);
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

export function pendingMigrations(db: Db, dir = MIGRATIONS_DIR): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const applied = new Set(db.all<{ name: string }>('SELECT name FROM schema_migrations').map((r) => r.name));
  return listMigrations(dir).filter((m) => !applied.has(m.name)).map((m) => m.name);
}

/** Aplica migraciones pendientes, cada una en su transacción. Solo hacia adelante. */
export function migrate(db: Db, dir = MIGRATIONS_DIR, now = Date.now()): string[] {
  const pending = new Set(pendingMigrations(db, dir));
  const done: string[] = [];
  for (const m of listMigrations(dir)) {
    if (!pending.has(m.name)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', m.name, now);
    });
    done.push(m.name);
  }
  return done;
}
