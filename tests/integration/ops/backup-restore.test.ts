// db:backup y db:restore como procesos hijos sobre una DB temporal sembrada.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTempDb, snapshot, type TempDb } from './run.ts';

let t: TempDb | undefined;
afterEach(() => {
  t?.cleanup();
  t = undefined;
});

function seededDb(): TempDb {
  t = createTempDb();
  const r = t.run('seed.ts');
  expect(r.status).toBe(0);
  return t;
}

const backupsIn = (dir: string, prefix: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.db')).sort() : []);

function integrity(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
  } finally {
    db.close();
  }
}

describe('db:backup', () => {
  it('crea una copia íntegra con el mismo contenido junto a la DB', () => {
    const tmp = seededDb();
    const r = tmp.run('backup.ts');
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const files = backupsIn(join(tmp.dir, 'backups'), 'pincushion-');
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^pincushion-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/);
    const copy = join(tmp.dir, 'backups', files[0]!);
    expect(r.stdout).toContain(copy);
    expect(r.stdout).toContain('integrity_check=ok');
    expect(integrity(copy)).toBe('ok');

    const live = tmp.open();
    const expected = snapshot(live);
    live.close();
    const c = new DatabaseSync(copy, { readOnly: true });
    const n = (sql: string) => Number((c.prepare(sql).get() as { n: number }).n);
    expect(n('SELECT COUNT(*) AS n FROM bookmarks')).toBe(expected.bookmarks);
    expect(n('SELECT COUNT(*) AS n FROM bookmark_tags')).toBe(expected.bookmark_tags);
    expect(n("SELECT COUNT(*) AS n FROM bookmarks_fts WHERE bookmarks_fts MATCH '\"fermentación lenta\"'")).toBe(1);
    c.close();
  });

  it('funciona en caliente con una conexión abierta y escrituras en el WAL', () => {
    const tmp = seededDb();
    const live = tmp.open();
    try {
      const now = Date.now();
      live.run("INSERT INTO users (email, password_hash, created_at, updated_at) VALUES ('wal@example.org', 'x', ?, ?)", now, now);
      expect(existsSync(`${tmp.path}-wal`)).toBe(true);
      const out = join(tmp.dir, 'manual', 'copia.db');
      const r = tmp.run('backup.ts', ['--out', out]);
      expect(r.status).toBe(0);
      const c = new DatabaseSync(out, { readOnly: true });
      expect((c.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'wal@example.org'").get() as { n: number }).n).toBe(1);
      c.close();
      // --out a un archivo existente se rechaza.
      expect(tmp.run('backup.ts', ['--out', out]).status).toBe(1);
    } finally {
      live.close();
    }
  });

  it('respeta --keep y no borra otras copias (pre-migrate, pre-restore)', () => {
    const tmp = seededDb();
    const dir = join(tmp.dir, 'backups');
    expect(tmp.run('backup.ts').status).toBe(0);
    writeFileSync(join(dir, 'pre-migrate-2020-01-01T00-00-00-000Z.db'), '');
    for (let i = 0; i < 3; i++) expect(tmp.run('backup.ts', ['--keep', '2']).status).toBe(0);
    const kept = backupsIn(dir, 'pincushion-');
    expect(kept).toHaveLength(2);
    expect(backupsIn(dir, 'pre-migrate-')).toHaveLength(1);
    // Se conservan las más recientes.
    const r = tmp.run('backup.ts', ['--keep', '2']);
    const newest = r.stdout.match(/Copia creada: (.+\.db)/)![1]!;
    expect(backupsIn(dir, 'pincushion-')).toContain(newest.split(/[\\/]/).pop());
    expect(backupsIn(dir, 'pincushion-')).not.toContain(kept[0]);
  });

  it('falla si la DB no existe o --keep no es válido', () => {
    t = createTempDb({ migrated: false });
    expect(t.run('backup.ts').status).toBe(1);
    expect(t.run('backup.ts', ['--keep', '-1']).status).toBe(1);
  });
});

describe('db:restore', () => {
  it('reemplaza el contenido, guarda una copia previa y borra -wal/-shm viejos', () => {
    const tmp = seededDb();
    const b = tmp.run('backup.ts', ['--out', join(tmp.dir, 'buena.db')]);
    expect(b.status).toBe(0);
    let db = tmp.open();
    const original = snapshot(db);
    // Cambios posteriores al backup que la restauración debe deshacer.
    db.run("DELETE FROM bookmarks WHERE user_id = (SELECT id FROM users WHERE email = 'bob@example.com')");
    db.run("INSERT INTO users (email, password_hash, created_at, updated_at) VALUES ('nuevo@example.org', 'x', 1, 1)");
    const modified = snapshot(db);
    db.close();
    expect(modified).not.toEqual(original);

    const r = tmp.run('restore.ts', ['--from', join(tmp.dir, 'buena.db')]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(existsSync(`${tmp.path}-wal`)).toBe(false);
    expect(existsSync(`${tmp.path}-shm`)).toBe(false);
    expect(readdirSync(tmp.dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);

    db = tmp.open();
    expect(snapshot(db)).toEqual(original);
    db.exec("INSERT INTO bookmarks_fts(bookmarks_fts) VALUES ('integrity-check')");
    db.close();

    const pre = backupsIn(join(tmp.dir, 'backups'), 'pre-restore-');
    expect(pre).toHaveLength(1);
    const prePath = join(tmp.dir, 'backups', pre[0]!);
    expect(r.stdout).toContain(prePath);
    expect(integrity(prePath)).toBe('ok');
    const c = new DatabaseSync(prePath, { readOnly: true });
    expect((c.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'nuevo@example.org'").get() as { n: number }).n).toBe(1);
    c.close();
  });

  it('se niega si el servidor parece activo (WAL reciente) salvo con --force', () => {
    const tmp = seededDb();
    expect(tmp.run('backup.ts', ['--out', join(tmp.dir, 'buena.db')]).status).toBe(0);
    const live = tmp.open();
    try {
      live.run("INSERT INTO users (email, password_hash, created_at, updated_at) VALUES ('activo@example.org', 'x', 1, 1)");
      expect(existsSync(`${tmp.path}-wal`)).toBe(true);
      const r = tmp.run('restore.ts', ['--from', join(tmp.dir, 'buena.db')]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('parece activo');
      const still = live.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE email = 'activo@example.org'")!.n;
      expect(still).toBe(1);
    } finally {
      live.close();
    }
    // Con el servidor detenido (sin -wal) restaura sin --force; con --force también se permite.
    expect(tmp.run('restore.ts', ['--from', join(tmp.dir, 'buena.db')]).status).toBe(0);
    const live2 = tmp.open();
    live2.run("INSERT INTO users (email, password_hash, created_at, updated_at) VALUES ('otro@example.org', 'x', 1, 1)");
    const forced = tmp.run('restore.ts', ['--from', join(tmp.dir, 'buena.db'), '--force']);
    live2.close();
    expect(forced.status).toBe(0);
    const db = tmp.open();
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE email IN ('activo@example.org', 'otro@example.org')")!.n).toBe(0);
    db.close();
  });

  it('rechaza un origen corrupto o que no es de Pincushion sin tocar la DB', () => {
    const tmp = seededDb();
    const before = (() => {
      const db = tmp.open();
      const s = snapshot(db);
      db.close();
      return s;
    })();
    const junk = join(tmp.dir, 'basura.db');
    writeFileSync(junk, 'esto no es sqlite'.repeat(100));
    const r1 = tmp.run('restore.ts', ['--from', junk]);
    expect(r1.status).toBe(1);

    const other = join(tmp.dir, 'otra.db');
    const o = new DatabaseSync(other);
    o.exec('CREATE TABLE cosas (x)');
    o.close();
    const r2 = tmp.run('restore.ts', ['--from', other]);
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain('no parece una base de Pincushion');

    expect(tmp.run('restore.ts', []).status).toBe(1);
    expect(tmp.run('restore.ts', ['--from', join(tmp.dir, 'no-existe.db')]).status).toBe(1);

    const db = tmp.open();
    expect(snapshot(db)).toEqual(before);
    db.close();
    expect(backupsIn(join(tmp.dir, 'backups'), 'pre-restore-')).toEqual([]);
  });
});
