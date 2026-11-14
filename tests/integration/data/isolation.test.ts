// Aislamiento entre usuarios: bob nunca ve ni cambia nada de alice, en ninguna función.
import { beforeEach, describe, expect, it } from 'vitest';
import { setup, type Ctx } from './setup.ts';
import type { Bookmark } from '../../../src/server/contracts.ts';

describe('aislamiento alice/bob', () => {
  let ctx: Ctx;
  let a1: Bookmark;
  let a2: Bookmark;
  let snapshot: () => unknown;

  beforeEach(async () => {
    ctx = await setup();
    const { alice, bookmarks, app } = ctx;
    a1 = bookmarks.save(alice, { url: 'https://example.com/secreto', title: 'Plan secreto de alice', excerpt: 'contraseña del wifi', tags: ['privado'], newCollectionName: 'Personal' }, 'web').bookmark;
    a2 = bookmarks.save(alice, { url: 'https://example.com/papelera', title: 'En la papelera' }, 'web').bookmark;
    bookmarks.trash(alice, [a2.id]);
    app.db.run("INSERT INTO favicons (user_id, domain, status, fetched_at) VALUES (?, 'example.com', 'succeeded', 1)", alice);
    snapshot = () => ({
      bookmarks: app.db.all('SELECT * FROM bookmarks ORDER BY id'),
      tags: app.db.all('SELECT * FROM tags ORDER BY id'),
      links: app.db.all('SELECT * FROM bookmark_tags ORDER BY bookmark_id, tag_id'),
      collections: app.db.all('SELECT * FROM collections ORDER BY id'),
    });
  });

  it('get/update/setFavorite/requestRefetch con ids ajenos → null y sin cambios', () => {
    const { bob, bookmarks } = ctx;
    const before = snapshot();
    ctx.app.clock.advance(5000);
    expect(bookmarks.get(bob, a1.id)).toBeNull();
    expect(bookmarks.get(bob, a2.id)).toBeNull();
    expect(bookmarks.update(bob, a1.id, { title: 'hackeado', tags: ['x'], collectionId: null, isFavorite: true })).toBeNull();
    expect(bookmarks.setFavorite(bob, a1.id, true)).toBeNull();
    expect(bookmarks.requestRefetch(bob, a1.id)).toBeNull();
    // update de bob tampoco crea etiquetas ni colecciones: se validan solo si el enlace es suyo.
    expect(snapshot()).toEqual(before);
  });

  it('papelera y lote con ids ajenos → 0 y sin cambios', () => {
    const { bob, bookmarks, tags } = ctx;
    const before = snapshot();
    ctx.app.clock.advance(5000);
    const ids = [a1.id, a2.id];
    expect(bookmarks.trash(bob, ids)).toBe(0);
    expect(bookmarks.restore(bob, ids)).toBe(0);
    expect(bookmarks.purge(bob, ids)).toBe(0);
    expect(bookmarks.emptyTrash(bob)).toBe(0);
    const aliceTag = tags.list(ctx.alice)[0]!;
    const aliceColl = a1.collection!;
    expect(bookmarks.bulk(bob, ids, { kind: 'remove-tag', tagId: aliceTag.id })).toBe(0);
    expect(bookmarks.bulk(bob, ids, { kind: 'move', collectionId: null })).toBe(0);
    expect(bookmarks.bulk(bob, ids, { kind: 'favorite', value: true })).toBe(0);
    expect(bookmarks.bulk(bob, ids, { kind: 'trash' })).toBe(0);
    const bobsTagsBefore = tags.list(bob).length;
    expect(bookmarks.bulk(bob, ids, { kind: 'add-tag', tag: 'intruso' })).toBe(0);
    expect(bookmarks.bulk(bob, ids, { kind: 'move-new', collectionName: 'Intrusa' })).toBe(0);
    // Mover los enlaces propios de bob a la colección de alice → ignorado.
    const bobB = bookmarks.save(bob, { url: 'https://example.com/bob' }, 'web').bookmark;
    expect(bookmarks.bulk(bob, [bobB.id], { kind: 'move', collectionId: aliceColl.id })).toBe(0);
    expect(bookmarks.bulk(bob, [bobB.id], { kind: 'remove-tag', tagId: aliceTag.id })).toBe(0);
    const after = snapshot() as { bookmarks: { user_id: number }[] };
    const onlyAlice = (s: unknown) => {
      const x = s as { bookmarks: { user_id: number }[]; tags: { user_id: number }[]; links: { user_id: number }[]; collections: { user_id: number }[] };
      return {
        bookmarks: x.bookmarks.filter((r) => r.user_id === ctx.alice),
        tags: x.tags.filter((r) => r.user_id === ctx.alice),
        links: x.links.filter((r) => r.user_id === ctx.alice),
        collections: x.collections.filter((r) => r.user_id === ctx.alice),
      };
    };
    expect(onlyAlice(after)).toEqual(onlyAlice(before));
    expect(tags.list(bob).length).toBeGreaterThanOrEqual(bobsTagsBefore); // bob puede crear sus propias etiquetas
  });

  it('save con la misma URL crea un enlace propio de bob; no fusiona ni revela el de alice', () => {
    const { bob, bookmarks } = ctx;
    expect(bookmarks.findDuplicate(bob, 'https://example.com/secreto')).toBeNull();
    const r = bookmarks.save(bob, { url: 'https://example.com/secreto', tags: ['privado'] }, 'web');
    expect(r.created).toBe(true);
    expect(r.bookmark.id).not.toBe(a1.id);
    expect(r.bookmark.title).toBe('example.com');
    expect(r.bookmark.hasFavicon).toBe(false); // el favicon de alice no cuenta para bob
    expect(r.bookmark.tags[0]!.id).not.toBe(a1.tags[0]!.id);
    expect(bookmarks.get(ctx.alice, a1.id)!.tags).toEqual(a1.tags);
  });

  it('save de bob con colección de alice → ValidationError', () => {
    expect(() => ctx.bookmarks.save(ctx.bob, { url: 'https://example.com/z', collectionId: a1.collection!.id }, 'web')).toThrow(/colección/);
  });

  it('list/listTrash/search/collections/tags de bob no ven nada de alice', () => {
    const { bob, bookmarks, search, collections, tags } = ctx;
    expect(bookmarks.list(bob, {})).toEqual({ items: [], nextCursor: null, total: 0 });
    expect(bookmarks.list(bob, { collection: a1.collection!.id })).toEqual({ items: [], nextCursor: null, total: 0 });
    expect(bookmarks.list(bob, { tags: ['privado'] }).total).toBe(0);
    expect(bookmarks.listTrash(bob).total).toBe(0);
    expect(search.search(bob, { q: 'secreto' }).total).toBe(0);
    expect(search.search(bob, { q: 'contraseña wifi' }).total).toBe(0);
    expect(search.search(bob, { q: 'papelera' }).total).toBe(0);
    expect(collections.list(bob)).toEqual([]);
    expect(collections.counts(bob)).toEqual({ all: 0, favorites: 0, unsorted: 0, trash: 0 });
    expect(tags.list(bob)).toEqual([]);
    // Y alice sí los ve.
    expect(search.search(ctx.alice, { q: 'contraseña wifi' }).total).toBe(1);
  });

  it('colecciones y etiquetas ajenas: rename/remove → null/false sin cambios', () => {
    const { bob, collections, tags } = ctx;
    const before = snapshot();
    const tagId = a1.tags[0]!.id;
    const collId = a1.collection!.id;
    expect(collections.rename(bob, collId, 'Mía')).toBeNull();
    expect(collections.remove(bob, collId)).toBeNull();
    expect(tags.rename(bob, tagId, 'mía')).toBeNull();
    expect(tags.remove(bob, tagId)).toBe(false);
    expect(collections.create(bob, 'Personal').id).not.toBe(collId);
    const after = snapshot() as { collections: { user_id: number }[] };
    expect(after.collections.filter((c) => c.user_id === ctx.alice)).toEqual((before as typeof after).collections);
    expect((after as unknown as { tags: unknown }).tags).toEqual((before as { tags: unknown }).tags);
  });
});
