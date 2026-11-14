// db:seed como proceso hijo sobre una DB temporal migrada.
import { afterEach, describe, expect, it } from 'vitest';
import { createTempDb, snapshot, type TempDb } from './run.ts';
import { verifyPassword } from '../../../src/server/crypto.ts';

const DAY = 86_400_000;
let t: TempDb | undefined;
afterEach(() => {
  t?.cleanup();
  t = undefined;
});

function seeded(args: string[] = []): TempDb {
  t = createTempDb();
  const r = t.run('seed.ts', args);
  expect(r.stderr).toBe('');
  expect(r.status).toBe(0);
  return t;
}

describe('db:seed', () => {
  it('crea alice, bob y dana con los datos esperados', async () => {
    const tmp = seeded();
    const db = tmp.open();
    try {
      const users = db.all<{ id: number; email: string; timezone: string; password_hash: string }>('SELECT * FROM users ORDER BY email');
      expect(users.map((u) => u.email)).toEqual(['alice@example.com', 'bob@example.com', 'dana@example.com']);
      expect(users.every((u) => u.timezone === 'Europe/Madrid')).toBe(true);
      expect(await verifyPassword('pincushion-demo', users[0]!.password_hash)).toBe(true);
      const [alice, bob, dana] = users.map((u) => u.id) as [number, number, number];

      const count = (sql: string, ...p: (number | string)[]) => db.get<{ n: number }>(sql, ...p)!.n;
      expect(count('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ?', alice)).toBeGreaterThanOrEqual(24);
      expect(count('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ?', bob)).toBe(6);
      expect(count('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ?', dana)).toBe(0);
      expect(count('SELECT COUNT(*) AS n FROM collections WHERE user_id = ?', dana)).toBe(0);

      expect(db.all<{ name: string }>('SELECT name FROM collections WHERE user_id = ? ORDER BY name', alice).map((c) => c.name)).toEqual([
        'Algún día', 'Herramientas', 'Lectura', 'Recetas', 'Viajes',
      ]);
      expect(count("SELECT COUNT(*) AS n FROM bookmarks b JOIN collections c ON c.id = b.collection_id WHERE c.user_id = ? AND c.name = 'Algún día'", alice)).toBe(0);
      expect(db.all<{ name: string }>('SELECT name FROM collections WHERE user_id = ?', bob).map((c) => c.name)).toEqual(['Trabajo']);
      const aliceTags = count('SELECT COUNT(*) AS n FROM tags WHERE user_id = ?', alice);
      expect(aliceTags).toBeGreaterThanOrEqual(10);
      expect(aliceTags).toBeLessThanOrEqual(14);
      expect(count('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ? AND is_favorite = 1', alice)).toBe(5);

      // Estados del fetch.
      const failed = db.all<Record<string, unknown>>("SELECT * FROM bookmarks WHERE user_id = ? AND fetch_status = 'failed'", alice);
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({ fetch_error_code: 'http_error', title_source: 'fallback' });
      expect(failed[0]!.title).toBe(failed[0]!.domain);
      const retrying = db.all<{ fetch_attempts: number; next_attempt_at: number }>("SELECT * FROM bookmarks WHERE user_id = ? AND fetch_status = 'retrying'", alice);
      expect(retrying).toHaveLength(1);
      expect(retrying[0]!.fetch_attempts).toBe(1);
      expect(retrying[0]!.next_attempt_at).toBeGreaterThan(Date.now());
      const skipped = db.all<{ url: string }>("SELECT url FROM bookmarks WHERE user_id = ? AND fetch_status = 'skipped'", alice);
      expect(skipped).toHaveLength(1);
      expect(skipped[0]!.url).toMatch(/\.pdf$/);
      const total = count('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ?', alice);
      expect(count("SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ? AND fetch_status = 'succeeded'", alice)).toBe(total - 3);
      expect(count("SELECT COUNT(*) AS n FROM bookmarks WHERE fetch_status = 'pending'")).toBe(0);

      // Papelera: uno restaurable (3 días) y uno vencido (31 días).
      const trashed = db.all<{ trashed_at: number; created_at: number }>('SELECT trashed_at, created_at FROM bookmarks WHERE user_id = ? AND trashed_at IS NOT NULL ORDER BY trashed_at DESC', alice);
      expect(trashed).toHaveLength(2);
      const ages = trashed.map((r) => Math.round((Date.now() - r.trashed_at) / DAY));
      expect(ages).toEqual([3, 31]);
      expect(trashed.every((r) => r.created_at < r.trashed_at)).toBe(true);

      // Fechas repartidas en los últimos 6 meses.
      const span = db.get<{ min: number; max: number }>('SELECT MIN(created_at) AS min, MAX(created_at) AS max FROM bookmarks WHERE user_id = ?', alice)!;
      expect(Date.now() - span.min).toBeLessThanOrEqual(183 * DAY);
      expect(Date.now() - span.min).toBeGreaterThan(120 * DAY);
      expect(span.max).toBeLessThanOrEqual(Date.now());

      // Excerpts creíbles en los que se obtuvieron.
      expect(count("SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ? AND fetch_status = 'succeeded' AND length(excerpt) < 250", alice)).toBe(0);

      // Token: uno revocado hace 10 días, ninguno activo.
      const tokens = db.all<{ revoked_at: number | null }>('SELECT revoked_at FROM bookmarklet_tokens WHERE user_id = ?', alice);
      expect(tokens).toHaveLength(1);
      expect(Math.round((Date.now() - tokens[0]!.revoked_at!) / DAY)).toBe(10);
      expect(count('SELECT COUNT(*) AS n FROM bookmarklet_tokens WHERE revoked_at IS NULL')).toBe(0);
    } finally {
      db.close();
    }
  });

  it('ninguna etiqueta cruza usuarios', () => {
    const db = seeded().open();
    try {
      const crossed = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM bookmark_tags bt
           JOIN bookmarks b ON b.id = bt.bookmark_id
           JOIN tags t ON t.id = bt.tag_id
          WHERE bt.user_id <> b.user_id OR bt.user_id <> t.user_id`,
      )!.n;
      expect(crossed).toBe(0);
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM bookmark_tags')!.n).toBeGreaterThan(30);
      // Mismo nombre de etiqueta en dos usuarios = dos filas distintas.
      expect(db.get<{ n: number }>("SELECT COUNT(DISTINCT user_id) AS n FROM tags WHERE name_key = 'sqlite'")!.n).toBe(2);
    } finally {
      db.close();
    }
  });

  it('la frase "fermentación lenta" encuentra 1 resultado de alice solo por el excerpt', () => {
    const db = seeded().open();
    try {
      const rows = db.all<{ email: string; title: string; description: string; excerpt: string }>(
        `SELECT u.email, b.title, b.description, b.excerpt
           FROM bookmarks_fts f JOIN bookmarks b ON b.id = f.rowid JOIN users u ON u.id = b.user_id
          WHERE bookmarks_fts MATCH ?`,
        '"fermentación lenta"',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.email).toBe('alice@example.com');
      expect(rows[0]!.excerpt).toContain('fermentación lenta en frío');
      expect(`${rows[0]!.title} ${rows[0]!.description}`.toLowerCase()).not.toContain('fermentación');
      // Sin tildes también (remove_diacritics 2).
      expect(db.all('SELECT rowid FROM bookmarks_fts WHERE bookmarks_fts MATCH ?', '"fermentacion lenta"')).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('es idempotente: dos ejecuciones dejan los mismos conteos', () => {
    const tmp = seeded();
    let db = tmp.open();
    const first = snapshot(db);
    db.close();
    const r = tmp.run('seed.ts');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('ya existía');
    db = tmp.open();
    expect(snapshot(db)).toEqual(first);
    db.close();
  });

  it('--reset borra los datos de los usuarios demo y los recrea', () => {
    const tmp = seeded();
    let db = tmp.open();
    const baseline = snapshot(db);
    const alice = db.get<{ id: number }>("SELECT id FROM users WHERE email = 'alice@example.com'")!.id;
    const now = Date.now();
    db.run(
      "INSERT INTO bookmarks (user_id, url, normalized_url, domain, title, created_at, updated_at) VALUES (?, 'https://extra.example.org/a', 'extra.example.org/a', 'extra.example.org', 'Extra', ?, ?)",
      alice, now, now,
    );
    db.run("INSERT INTO sessions (id, user_id, csrf_secret, created_at, last_seen_at, expires_at) VALUES ('s1', ?, 'x', ?, ?, ?)", alice, now, now, now + DAY);
    db.run("UPDATE bookmarks SET trashed_at = NULL WHERE user_id = ?", alice);
    db.close();

    // Sin --reset no se tocan ni el extra ni lo editado.
    expect(tmp.run('seed.ts').status).toBe(0);
    db = tmp.open();
    expect(snapshot(db)['bookmarks:alice@example.com']).toBe(baseline['bookmarks:alice@example.com']! + 1);
    db.close();

    const r = tmp.run('seed.ts', ['--reset']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('borrados 3 usuarios demo');
    db = tmp.open();
    try {
      expect(snapshot(db)).toEqual(baseline);
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')!.n).toBe(0);
      expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM bookmarks WHERE domain = 'extra.example.org'")!.n).toBe(0);
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM bookmarks WHERE trashed_at IS NOT NULL')!.n).toBe(2);
      // El índice FTS sigue coherente tras borrar y reinsertar.
      expect(db.all('SELECT rowid FROM bookmarks_fts WHERE bookmarks_fts MATCH ?', '"fermentación lenta"')).toHaveLength(1);
      db.exec("INSERT INTO bookmarks_fts(bookmarks_fts) VALUES ('integrity-check')");
    } finally {
      db.close();
    }
  });

  it('no toca usuarios que no son demo', () => {
    const tmp = createTempDb();
    t = tmp;
    let db = tmp.open();
    const now = Date.now();
    db.run("INSERT INTO users (email, password_hash, created_at, updated_at) VALUES ('owner@example.org', 'x', ?, ?)", now, now);
    db.close();
    expect(tmp.run('seed.ts', ['--reset']).status).toBe(0);
    db = tmp.open();
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE email = 'owner@example.org'")!.n).toBe(1);
    db.close();
  });

  it('se niega en producción, con APP_ORIGIN https sin --force y con migraciones pendientes', () => {
    t = createTempDb();
    const prod = t.run('seed.ts', [], { NODE_ENV: 'production' });
    expect(prod.status).toBe(1);
    expect(prod.stderr).toContain('NODE_ENV=production');
    const prodForced = t.run('seed.ts', ['--force'], { NODE_ENV: 'production' });
    expect(prodForced.status).toBe(1);

    const https = t.run('seed.ts', [], { APP_ORIGIN: 'https://pincushion.example.org' });
    expect(https.status).toBe(1);
    expect(https.stderr).toContain('--force');
    let db = t.open();
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n).toBe(0);
    db.close();
    expect(t.run('seed.ts', ['--force'], { APP_ORIGIN: 'https://pincushion.example.org' }).status).toBe(0);

    const fresh = createTempDb({ migrated: false });
    try {
      const missing = fresh.run('seed.ts');
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain('db:migrate');
      db = fresh.open(); // crea la DB vacía, sin migrar
      db.close();
      const pending = fresh.run('seed.ts');
      expect(pending.status).toBe(1);
      expect(pending.stderr).toContain('migraciones pendientes');
    } finally {
      fresh.cleanup();
    }
  });
});
