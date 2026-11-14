// Restricciones del esquema: UNIQUE, CHECK y FKs compuestas que impiden mezclar datos de usuarios.
import { describe, expect, it } from 'vitest';
import { setup } from './setup.ts';

describe('restricciones del esquema', () => {
  it('UNIQUE (user_id, normalized_url): misma URL normalizada solo una vez por usuario, pero sí en otro usuario', async () => {
    const { app, alice, bob } = await setup();
    const now = app.clock.now();
    const insert = (user: number) =>
      app.db.run(
        `INSERT INTO bookmarks (user_id, url, normalized_url, domain, title, created_at, updated_at)
         VALUES (?, 'https://example.com/a', 'example.com/a', 'example.com', 'A', ?, ?)`,
        user, now, now,
      );
    insert(alice);
    expect(() => insert(alice)).toThrow(/UNIQUE/);
    expect(() => insert(bob)).not.toThrow();
  });

  it('UNIQUE (user_id, name_key) en etiquetas y colecciones', async () => {
    const { app, alice, bob } = await setup();
    const now = app.clock.now();
    app.db.run("INSERT INTO tags (user_id, name, name_key, created_at) VALUES (?, 'Pan', 'pan', ?)", alice, now);
    expect(() => app.db.run("INSERT INTO tags (user_id, name, name_key, created_at) VALUES (?, 'PAN', 'pan', ?)", alice, now)).toThrow(/UNIQUE/);
    expect(() => app.db.run("INSERT INTO tags (user_id, name, name_key, created_at) VALUES (?, 'pan', 'pan', ?)", bob, now)).not.toThrow();
    app.db.run("INSERT INTO collections (user_id, name, name_key, created_at, updated_at) VALUES (?, 'Lectura', 'lectura', ?, ?)", alice, now, now);
    expect(() =>
      app.db.run("INSERT INTO collections (user_id, name, name_key, created_at, updated_at) VALUES (?, 'lectura', 'lectura', ?, ?)", alice, now, now),
    ).toThrow(/UNIQUE/);
  });

  it('CHECK: esquema http(s), título 1–300, favorito 0/1, fetch_status válido, excerpt ≤ 8000', async () => {
    const { app, alice } = await setup();
    const now = app.clock.now();
    const base = { url: 'https://example.com/x', title: 'X', fav: 0, status: 'pending', excerpt: '' };
    const insert = (o: Partial<typeof base>) => {
      const v = { ...base, ...o };
      return app.db.run(
        `INSERT INTO bookmarks (user_id, url, normalized_url, domain, title, is_favorite, fetch_status, excerpt, created_at, updated_at)
         VALUES (?, ?, ?, 'example.com', ?, ?, ?, ?, ?, ?)`,
        alice, v.url, `n-${Math.random()}`, v.title, v.fav, v.status, v.excerpt, now, now,
      );
    };
    expect(() => insert({ url: 'javascript:alert(1)//aaaa' })).toThrow(/CHECK/);
    expect(() => insert({ url: 'ftp://example.com/x' })).toThrow(/CHECK/);
    expect(() => insert({ title: '' })).toThrow(/CHECK/);
    expect(() => insert({ title: 'x'.repeat(301) })).toThrow(/CHECK/);
    expect(() => insert({ fav: 2 })).toThrow(/CHECK/);
    expect(() => insert({ status: 'done' })).toThrow(/CHECK/);
    expect(() => insert({ excerpt: 'x'.repeat(8001) })).toThrow(/CHECK/);
    expect(() => insert({})).not.toThrow();
  });

  it('FK compuesta: imposible etiquetar un enlace con una etiqueta de otro usuario', async () => {
    const { app, alice, bob, bookmarks } = await setup();
    const b = bookmarks.save(alice, { url: 'https://example.com/a' }, 'web').bookmark;
    const bobTag = app.db.run("INSERT INTO tags (user_id, name, name_key, created_at) VALUES (?, 'ajena', 'ajena', ?)", bob, app.clock.now()).lastInsertRowid;
    // Con user_id de alice: la etiqueta no es suya.
    expect(() => app.db.run('INSERT INTO bookmark_tags (bookmark_id, tag_id, user_id) VALUES (?, ?, ?)', b.id, bobTag, alice)).toThrow(/FOREIGN KEY/);
    // Con user_id de bob: el enlace no es suyo.
    expect(() => app.db.run('INSERT INTO bookmark_tags (bookmark_id, tag_id, user_id) VALUES (?, ?, ?)', b.id, bobTag, bob)).toThrow(/FOREIGN KEY/);
  });

  it('FK compuesta: imposible asignar una colección de otro usuario', async () => {
    const { app, alice, bob, bookmarks, collections } = await setup();
    const b = bookmarks.save(alice, { url: 'https://example.com/a' }, 'web').bookmark;
    const bobColl = collections.create(bob, 'De Bob');
    expect(() => app.db.run('UPDATE bookmarks SET collection_id = ? WHERE id = ?', bobColl.id, b.id)).toThrow(/FOREIGN KEY/);
  });

  it('borrar un enlace borra sus etiquetas enlazadas y su fila FTS (CASCADE + trigger)', async () => {
    const { app, alice, bookmarks, search } = await setup();
    const b = bookmarks.save(alice, { url: 'https://example.com/a', title: 'Ornitorrinco', tags: ['x'] }, 'web').bookmark;
    bookmarks.trash(alice, [b.id]);
    expect(bookmarks.purge(alice, [b.id])).toBe(1);
    expect(app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM bookmark_tags')!.n).toBe(0);
    expect(app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM bookmarks_fts WHERE bookmarks_fts MATCH 'ornitorrinco'")!.n).toBe(0);
    expect(search.search(alice, { q: 'ornitorrinco' }).total).toBe(0);
  });
});
