// Guardar, fusionar duplicados, editar, favorito, reintentar y papelera.
import { describe, expect, it } from 'vitest';
import { setup, tagNames } from './setup.ts';
import { ValidationError } from '../../../src/domain/errors.ts';
import { InvalidUrlError } from '../../../src/domain/url.ts';

describe('save: crear', () => {
  it('crea en pending con next_attempt_at = now y título de respaldo = dominio', async () => {
    const { app, alice, bookmarks } = await setup();
    const r = bookmarks.save(alice, { url: 'www.Example.com/pan/' }, 'web');
    expect(r.created).toBe(true);
    expect(r.restored).toBe(false);
    expect(r.bookmark).toMatchObject({
      url: 'https://www.example.com/pan/',
      domain: 'example.com',
      title: 'example.com',
      titleSource: 'fallback',
      fetchStatus: 'pending',
      fetchErrorCode: null,
      isFavorite: false,
      collection: null,
      tags: [],
      hasFavicon: false,
      trashedAt: null,
      createdAt: app.clock.now(),
    });
    const row = app.db.get<{ next_attempt_at: number; fetch_attempts: number }>('SELECT next_attempt_at, fetch_attempts FROM bookmarks WHERE id = ?', r.bookmark.id)!;
    expect(row).toEqual({ next_attempt_at: app.clock.now(), fetch_attempts: 0 });
  });

  it('guarda título, descripción, excerpt multilínea recortado, etiquetas, colección nueva y favorito', async () => {
    const { alice, bookmarks } = await setup();
    const excerpt = 'Línea uno\u0007\n\n\n\nLínea   dos ' + 'x'.repeat(9000);
    const r = bookmarks.save(
      alice,
      { url: 'https://example.com/a', title: '  Pan  de masa  ', description: 'Una receta', excerpt, tags: ['Cocina', 'masa madre', 'cocina'], newCollectionName: ' Recetas ', isFavorite: true },
      'web',
    );
    const b = r.bookmark;
    expect(b.title).toBe('Pan de masa');
    expect(b.titleSource).toBe('user');
    expect(b.description).toBe('Una receta');
    expect(b.excerpt).toMatch(/^Línea uno ?\n\nLínea dos x/);
    expect(b.excerpt.length).toBe(8000);
    expect(tagNames(b)).toEqual(['Cocina', 'masa madre']);
    expect(b.collection?.name).toBe('Recetas');
    expect(b.isFavorite).toBe(true);
  });

  it('bookmarklet: título de la página con title_source=page y recorta en vez de fallar', async () => {
    const { alice, bookmarks } = await setup();
    const b = bookmarks.save(alice, { url: 'https://example.com/a', title: 'T'.repeat(500), description: 'd'.repeat(2000) }, 'bookmarklet').bookmark;
    expect(b.titleSource).toBe('page');
    expect(b.title.length).toBe(300);
    expect(b.description.length).toBe(1000);
  });

  it('valida: URL inválida, título > 300 desde la web, demasiadas etiquetas, colección ajena', async () => {
    const { alice, bob, bookmarks, collections } = await setup();
    expect(() => bookmarks.save(alice, { url: 'javascript:alert(1)' }, 'web')).toThrow(InvalidUrlError);
    expect(() => bookmarks.save(alice, { url: '' }, 'web')).toThrow(InvalidUrlError);
    expect(() => bookmarks.save(alice, { url: 'https://example.com/' + 'a'.repeat(2100) }, 'web')).toThrow(InvalidUrlError);
    expect(() => bookmarks.save(alice, { url: 'https://example.com/a', title: 'x'.repeat(301) }, 'web')).toThrow(ValidationError);
    expect(() => bookmarks.save(alice, { url: 'https://example.com/a', tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, 'web')).toThrow(ValidationError);
    const ajena = collections.create(bob, 'Ajena');
    try {
      bookmarks.save(alice, { url: 'https://example.com/a', collectionId: ajena.id }, 'web');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).field).toBe('collection');
    }
    // Nada quedó a medias: ni enlace ni etiquetas.
    expect(bookmarks.list(alice, {}).total).toBe(0);
  });

  it('la transacción revierte etiquetas y colección nuevas si algo falla', async () => {
    const { app, alice, bob, bookmarks, collections } = await setup();
    const ajena = collections.create(bob, 'Ajena');
    expect(() => bookmarks.save(alice, { url: 'https://example.com/a', tags: ['nueva'], collectionId: ajena.id }, 'web')).toThrow(ValidationError);
    expect(app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tags WHERE user_id = ?', alice)!.n).toBe(0);
  });
});

describe('save: duplicados', () => {
  it('aceptación 2: misma URL con variantes (http/www/utm/barra final) → 1 enlace con etiquetas unidas', async () => {
    const { alice, bookmarks, tags } = await setup();
    const a = bookmarks.save(alice, { url: 'https://www.example.com/articulo/?utm_source=x&id=7', tags: ['cocina', 'pan'] }, 'web');
    const b = bookmarks.save(alice, { url: 'http://example.com/articulo?id=7&fbclid=abc', tags: ['Pan', 'masa madre'] }, 'web');
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.bookmark.id).toBe(a.bookmark.id);
    expect(tagNames(b.bookmark)).toEqual(['cocina', 'masa madre', 'pan']);
    expect(bookmarks.list(alice, {}).total).toBe(1);
    expect(tags.list(alice).map((t) => t.name)).toEqual(['cocina', 'masa madre', 'pan']);
    expect(b.bookmark.url).toBe('https://www.example.com/articulo/?utm_source=x&id=7');
  });

  it('doble save idéntico es idempotente', async () => {
    const { app, alice, bookmarks } = await setup();
    const input = { url: 'https://example.com/a', title: 'A', tags: ['x'], newCollectionName: 'Lectura', isFavorite: true };
    const a = bookmarks.save(alice, input, 'web');
    const b = bookmarks.save(alice, input, 'web');
    expect(b.created).toBe(false);
    expect({ ...b.bookmark, updatedAt: 0 }).toEqual({ ...a.bookmark, updatedAt: 0 });
    expect(app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM collections')!.n).toBe(1);
    expect(app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM bookmark_tags')!.n).toBe(1);
  });

  it('web reemplaza título/descripción/colección/favorito; vacío no borra el título', async () => {
    const { alice, bookmarks, collections } = await setup();
    const lectura = collections.create(alice, 'Lectura');
    bookmarks.save(alice, { url: 'https://example.com/a', title: 'Viejo', description: 'desc', collectionId: lectura.id, isFavorite: true }, 'web');
    const b = bookmarks.save(alice, { url: 'https://example.com/a', title: 'Nuevo', description: '', collectionId: null, isFavorite: false }, 'web').bookmark;
    expect(b).toMatchObject({ title: 'Nuevo', titleSource: 'user', description: '', collection: null, isFavorite: false });
    const c = bookmarks.save(alice, { url: 'https://example.com/a', title: '' }, 'web').bookmark;
    expect(c.title).toBe('Nuevo');
    expect(c.collection).toBeNull();
  });

  it('bookmarklet no pisa ediciones del usuario y solo rellena huecos', async () => {
    const { alice, bookmarks } = await setup();
    bookmarks.save(alice, { url: 'https://example.com/a', title: 'Mi título', isFavorite: true }, 'web');
    const b = bookmarks.save(alice, { url: 'https://example.com/a', title: 'Título de la página', description: 'meta', excerpt: 'texto', isFavorite: false, tags: ['nueva'] }, 'bookmarklet').bookmark;
    expect(b).toMatchObject({ title: 'Mi título', titleSource: 'user', description: 'meta', excerpt: 'texto', isFavorite: true });
    expect(tagNames(b)).toEqual(['nueva']);
    const c = bookmarks.save(alice, { url: 'https://example.com/a', description: 'otra', excerpt: 'otro' }, 'bookmarklet').bookmark;
    expect(c).toMatchObject({ description: 'meta', excerpt: 'texto' });
  });

  it('web restaura de la papelera (restored: true); bookmarklet no restaura', async () => {
    const { alice, bookmarks } = await setup();
    const { bookmark } = bookmarks.save(alice, { url: 'https://example.com/a' }, 'web');
    bookmarks.trash(alice, [bookmark.id]);
    const viaBm = bookmarks.save(alice, { url: 'https://example.com/a', tags: ['x'] }, 'bookmarklet');
    expect(viaBm).toMatchObject({ created: false, restored: false });
    expect(viaBm.bookmark.trashedAt).not.toBeNull();
    expect(bookmarks.list(alice, {}).total).toBe(0);
    const viaWeb = bookmarks.save(alice, { url: 'https://example.com/a' }, 'web');
    expect(viaWeb).toMatchObject({ created: false, restored: true });
    expect(viaWeb.bookmark.trashedAt).toBeNull();
    expect(bookmarks.list(alice, {}).total).toBe(1);
  });

  it('findDuplicate incluye la papelera, etiquetas y colección; null para URL inválida o ajena', async () => {
    const { alice, bob, bookmarks } = await setup();
    const { bookmark } = bookmarks.save(alice, { url: 'https://example.com/a', title: 'A', tags: ['x'], newCollectionName: 'Lectura' }, 'web');
    expect(bookmarks.findDuplicate(alice, 'http://www.example.com/a/')).toEqual({
      id: bookmark.id,
      title: 'A',
      createdAt: bookmark.createdAt,
      trashed: false,
      tags: bookmark.tags,
      collection: bookmark.collection,
    });
    bookmarks.trash(alice, [bookmark.id]);
    expect(bookmarks.findDuplicate(alice, 'example.com/a')?.trashed).toBe(true);
    expect(bookmarks.findDuplicate(alice, 'nota una url')).toBeNull();
    expect(bookmarks.findDuplicate(bob, 'example.com/a')).toBeNull();
  });
});

describe('update, favorito y reintentar', () => {
  it('update valida, marca title_source=user, reemplaza etiquetas y vacía el título al dominio', async () => {
    const { app, alice, bookmarks } = await setup();
    const { bookmark } = bookmarks.save(alice, { url: 'https://example.com/a', title: 'Página', tags: ['a', 'b'] }, 'bookmarklet');
    app.clock.advance(1000);
    const u = bookmarks.update(alice, bookmark.id, { title: 'Editado', tags: ['b', 'c'], description: 'línea 1\nlínea 2' })!;
    expect(u).toMatchObject({ title: 'Editado', titleSource: 'user', description: 'línea 1\nlínea 2', updatedAt: app.clock.now() });
    expect(tagNames(u)).toEqual(['b', 'c']);
    const same = bookmarks.update(alice, bookmark.id, { title: 'Editado' })!;
    expect(same.updatedAt).toBe(u.updatedAt);
    const empty = bookmarks.update(alice, bookmark.id, { title: '   ' })!;
    expect(empty).toMatchObject({ title: 'example.com', titleSource: 'fallback' });
    expect(() => bookmarks.update(alice, bookmark.id, { description: 'x'.repeat(1001) })).toThrow(ValidationError);
    expect(bookmarks.update(alice, 999_999, { title: 'x' })).toBeNull();
  });

  it('update mueve de colección (existente, nueva o ninguna)', async () => {
    const { alice, bookmarks, collections } = await setup();
    const { bookmark } = bookmarks.save(alice, { url: 'https://example.com/a' }, 'web');
    const lectura = collections.create(alice, 'Lectura');
    expect(bookmarks.update(alice, bookmark.id, { collectionId: lectura.id })!.collection).toEqual(lectura);
    expect(bookmarks.update(alice, bookmark.id, { newCollectionName: 'Viajes' })!.collection?.name).toBe('Viajes');
    expect(bookmarks.update(alice, bookmark.id, {})!.collection?.name).toBe('Viajes');
    expect(bookmarks.update(alice, bookmark.id, { collectionId: null })!.collection).toBeNull();
  });

  it('setFavorite con valor explícito es idempotente', async () => {
    const { alice, bookmarks } = await setup();
    const { bookmark } = bookmarks.save(alice, { url: 'https://example.com/a' }, 'web');
    expect(bookmarks.setFavorite(alice, bookmark.id, true)!.isFavorite).toBe(true);
    expect(bookmarks.setFavorite(alice, bookmark.id, true)!.isFavorite).toBe(true);
    expect(bookmarks.setFavorite(alice, bookmark.id, false)!.isFavorite).toBe(false);
    expect(bookmarks.setFavorite(alice, 424242, true)).toBeNull();
  });

  it('requestRefetch vuelve a pending con intentos a 0 y sin error', async () => {
    const { app, alice, bookmarks } = await setup();
    const { bookmark } = bookmarks.save(alice, { url: 'https://example.com/a' }, 'web');
    app.db.run("UPDATE bookmarks SET fetch_status = 'failed', fetch_attempts = 3, fetch_error_code = 'http_403', next_attempt_at = NULL, lease_until = 5 WHERE id = ?", bookmark.id);
    app.clock.advance(60_000);
    const b = bookmarks.requestRefetch(alice, bookmark.id)!;
    expect(b).toMatchObject({ fetchStatus: 'pending', fetchErrorCode: null });
    expect(app.db.get('SELECT fetch_attempts, next_attempt_at, lease_until FROM bookmarks WHERE id = ?', bookmark.id)).toEqual({
      fetch_attempts: 0,
      next_attempt_at: app.clock.now(),
      lease_until: null,
    });
  });

  it('hasFavicon solo con favicon succeeded del mismo usuario y dominio', async () => {
    const { app, alice, bob, bookmarks } = await setup();
    const { bookmark } = bookmarks.save(alice, { url: 'https://www.example.com/a' }, 'web');
    app.db.run("INSERT INTO favicons (user_id, domain, status, fetched_at) VALUES (?, 'example.com', 'succeeded', 1)", bob);
    expect(bookmarks.get(alice, bookmark.id)!.hasFavicon).toBe(false);
    app.db.run("INSERT INTO favicons (user_id, domain, status, fetched_at) VALUES (?, 'example.com', 'failed', 1)", alice);
    expect(bookmarks.get(alice, bookmark.id)!.hasFavicon).toBe(false);
    app.db.run("UPDATE favicons SET status = 'succeeded' WHERE user_id = ?", alice);
    expect(bookmarks.get(alice, bookmark.id)!.hasFavicon).toBe(true);
  });
});

describe('papelera', () => {
  it('trash/restore/purge/emptyTrash son idempotentes y devuelven cuántos cambiaron', async () => {
    const { alice, bookmarks, collections } = await setup();
    const ids = ['a', 'b', 'c'].map((p) => bookmarks.save(alice, { url: `https://example.com/${p}` }, 'web').bookmark.id);
    expect(bookmarks.purge(alice, ids)).toBe(0); // purge solo actúa sobre la papelera
    expect(bookmarks.trash(alice, [ids[0]!, ids[1]!])).toBe(2);
    expect(bookmarks.trash(alice, [ids[0]!, ids[1]!])).toBe(0);
    expect(bookmarks.list(alice, {}).total).toBe(1);
    expect(bookmarks.listTrash(alice).items.map((b) => b.id).sort()).toEqual([ids[0], ids[1]].sort());
    expect(collections.counts(alice)).toEqual({ all: 1, favorites: 0, unsorted: 1, trash: 2 });
    expect(bookmarks.restore(alice, [ids[0]!, ids[2]!])).toBe(1);
    expect(bookmarks.restore(alice, [ids[0]!])).toBe(0);
    expect(bookmarks.purge(alice, ids)).toBe(1);
    expect(bookmarks.get(alice, ids[1]!)).toBeNull();
    bookmarks.trash(alice, ids);
    expect(bookmarks.emptyTrash(alice)).toBe(2);
    expect(bookmarks.emptyTrash(alice)).toBe(0);
    expect(collections.counts(alice)).toEqual({ all: 0, favorites: 0, unsorted: 0, trash: 0 });
  });

  it('listTrash pagina por (trashed_at, id) más reciente primero', async () => {
    const { app, alice, bookmarks } = await setup();
    const ids: number[] = [];
    for (let i = 0; i < 120; i++) ids.push(bookmarks.save(alice, { url: `https://example.com/${i}` }, 'web').bookmark.id);
    for (let i = 0; i < 120; i += 3) {
      app.clock.advance(1000);
      bookmarks.trash(alice, ids.slice(i, i + 3)); // empates de trashed_at de 3 en 3
    }
    const seen: number[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const p = bookmarks.listTrash(alice, cursor);
      expect(p.total).toBe(120);
      seen.push(...p.items.map((b) => b.id));
      cursor = p.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual([...ids].reverse());
  });
});

describe('lote', () => {
  it('add-tag, remove-tag, move, move-new, favorite, trash; repetidos devuelven 0', async () => {
    const { alice, bookmarks, tags, collections } = await setup();
    const ids = ['a', 'b', 'c'].map((p) => bookmarks.save(alice, { url: `https://example.com/${p}` }, 'web').bookmark.id);
    const [a, b] = ids as [number, number, number];
    bookmarks.update(alice, a, { tags: ['leer'] });

    expect(bookmarks.bulk(alice, ids, { kind: 'add-tag', tag: 'Leer' })).toBe(2);
    expect(bookmarks.bulk(alice, ids, { kind: 'add-tag', tag: 'leer' })).toBe(0);
    const leer = tags.list(alice).find((t) => t.key === 'leer')!;
    expect(leer).toMatchObject({ name: 'leer', count: 3 });

    expect(bookmarks.bulk(alice, [a, b], { kind: 'remove-tag', tagId: leer.id })).toBe(2);
    expect(bookmarks.bulk(alice, [a, b], { kind: 'remove-tag', tagId: leer.id })).toBe(0);

    expect(bookmarks.bulk(alice, ids, { kind: 'move-new', collectionName: 'Lectura' })).toBe(3);
    expect(bookmarks.bulk(alice, ids, { kind: 'move-new', collectionName: 'lectura' })).toBe(0);
    expect(collections.list(alice)).toEqual([expect.objectContaining({ name: 'Lectura', count: 3 })]);
    expect(bookmarks.bulk(alice, [a], { kind: 'move', collectionId: null })).toBe(1);
    expect(bookmarks.bulk(alice, [a], { kind: 'move', collectionId: null })).toBe(0);

    expect(bookmarks.bulk(alice, ids, { kind: 'favorite', value: true })).toBe(3);
    expect(bookmarks.bulk(alice, ids, { kind: 'favorite', value: true })).toBe(0);

    expect(bookmarks.bulk(alice, [a, b], { kind: 'trash' })).toBe(2);
    expect(bookmarks.bulk(alice, [a, b], { kind: 'trash' })).toBe(0);
    expect(bookmarks.bulk(alice, [], { kind: 'trash' })).toBe(0);
    expect(collections.counts(alice)).toEqual({ all: 1, favorites: 1, unsorted: 0, trash: 2 });
  });

  it('add-tag vacío o demasiado largo → ValidationError con field tag', async () => {
    const { alice, bookmarks } = await setup();
    const id = bookmarks.save(alice, { url: 'https://example.com/a' }, 'web').bookmark.id;
    for (const tag of ['  ', 'x'.repeat(41), 'a, b']) {
      try {
        bookmarks.bulk(alice, [id], { kind: 'add-tag', tag });
        expect.unreachable();
      } catch (err) {
        expect((err as ValidationError).field).toBe('tag');
      }
    }
  });
});
