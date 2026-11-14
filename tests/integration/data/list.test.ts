// Biblioteca: filtros, órdenes y paginación por cursor sin duplicados ni huecos (con empates).
import { describe, expect, it } from 'vitest';
import { setup, type Ctx } from './setup.ts';
import type { Bookmark, SortKey } from '../../../src/server/contracts.ts';
import { encodeCursor } from '../../../src/domain/bookmark-rules.ts';

const TITLES = ['banana', 'Banana', 'apple', 'Cherry', 'apple', 'zeta', 'Árbol', 'mango', 'APPLE', 'kiwi'];
const DOMAINS = ['b.example.com', 'a.example.com', 'c.example.com'];

function seed(ctx: Ctx, n: number): void {
  const { app, alice, bookmarks } = ctx;
  for (let i = 0; i < n; i++) {
    if (i % 5 === 0) app.clock.advance(1000); // grupos de 5 con el mismo created_at
    bookmarks.save(alice, { url: `https://${DOMAINS[i % 3]}/p/${i}`, title: TITLES[i % TITLES.length]! }, 'web');
  }
}

function collect(ctx: Ctx, sort: SortKey, limit: number, extra: object = {}): { ids: number[]; pages: number; items: Bookmark[] } {
  const items: Bookmark[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const p = ctx.bookmarks.list(ctx.alice, { sort, limit, cursor, ...extra });
    expect(p.items.length).toBeLessThanOrEqual(limit);
    items.push(...p.items);
    cursor = p.nextCursor ?? undefined;
    pages++;
    if (pages > 1000) throw new Error('bucle de paginación');
  } while (cursor);
  return { ids: items.map((b) => b.id), pages, items };
}

const nocase = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

describe('list: paginación por cursor', () => {
  const expected: Record<SortKey, (a: Bookmark, b: Bookmark) => number> = {
    recientes: (a, b) => cmp(b.createdAt, a.createdAt) || cmp(b.id, a.id),
    antiguos: (a, b) => cmp(a.createdAt, b.createdAt) || cmp(a.id, b.id),
    titulo: (a, b) => cmp(nocase(a.title), nocase(b.title)) || cmp(a.id, b.id),
    dominio: (a, b) => cmp(a.domain, b.domain) || cmp(a.id, b.id),
  };

  for (const sort of Object.keys(expected) as SortKey[]) {
    it(`orden ${sort}: recorre todo sin duplicados ni huecos, con empates`, async () => {
      const ctx = await setup();
      seed(ctx, 137);
      const all = ctx.app.db.all<{ id: number }>('SELECT id FROM bookmarks WHERE user_id = ?', ctx.alice).map((r) => r.id);
      const { ids, pages, items } = collect(ctx, sort, 10);
      expect(pages).toBe(14);
      expect(new Set(ids).size).toBe(137);
      expect([...ids].sort((a, b) => a - b)).toEqual(all.sort((a, b) => a - b));
      expect(ids).toEqual([...items].sort(expected[sort]).map((b) => b.id));
      expect(ctx.bookmarks.list(ctx.alice, { sort }).total).toBe(137);
    });
  }

  it('límite por defecto 50, máximo 100, mínimo 1', async () => {
    const ctx = await setup();
    seed(ctx, 120);
    expect(ctx.bookmarks.list(ctx.alice, {}).items).toHaveLength(50);
    expect(ctx.bookmarks.list(ctx.alice, { limit: 500 }).items).toHaveLength(100);
    expect(ctx.bookmarks.list(ctx.alice, { limit: 0 }).items).toHaveLength(1);
    const last = ctx.bookmarks.list(ctx.alice, { limit: 120 });
    expect(last.items).toHaveLength(100);
    expect(last.nextCursor).not.toBeNull();
    expect(ctx.bookmarks.list(ctx.alice, { limit: 100, cursor: last.nextCursor! }).nextCursor).toBeNull();
  });

  it('cursor inválido o de otro orden → primera página', async () => {
    const ctx = await setup();
    seed(ctx, 12);
    const first = ctx.bookmarks.list(ctx.alice, { limit: 5 }).items.map((b) => b.id);
    expect(ctx.bookmarks.list(ctx.alice, { limit: 5, cursor: 'basura' }).items.map((b) => b.id)).toEqual(first);
    expect(ctx.bookmarks.list(ctx.alice, { limit: 5, cursor: encodeCursor('texto', 3) }).items.map((b) => b.id)).toEqual(first);
  });

  it('los enlaces de la papelera no aparecen ni cuentan', async () => {
    const ctx = await setup();
    seed(ctx, 10);
    const some = ctx.bookmarks.list(ctx.alice, { limit: 3 }).items.map((b) => b.id);
    ctx.bookmarks.trash(ctx.alice, some);
    const { ids } = collect(ctx, 'recientes', 4);
    expect(ids).toHaveLength(7);
    expect(ids.some((id) => some.includes(id))).toBe(false);
  });
});

describe('list: filtros', () => {
  it('colección, sin colección, favoritos y etiquetas (AND por key)', async () => {
    const { alice, bookmarks, collections } = await setup();
    const lectura = collections.create(alice, 'Lectura');
    const s = (p: string, extra: object) => bookmarks.save(alice, { url: `https://example.com/${p}`, ...extra }, 'web').bookmark.id;
    const a = s('a', { collectionId: lectura.id, tags: ['Pan', 'Cocina'], isFavorite: true });
    const b = s('b', { collectionId: lectura.id, tags: ['pan'] });
    const c = s('c', { tags: ['cocina'], isFavorite: true });
    const d = s('d', {});
    const ids = (q: object) => bookmarks.list(alice, q).items.map((x) => x.id).sort((x, y) => x - y);
    const total = (q: object) => bookmarks.list(alice, q).total;

    expect(ids({ collection: lectura.id })).toEqual([a, b]);
    expect(ids({ collection: 'sin-coleccion' })).toEqual([c, d]);
    expect(ids({ favorites: true })).toEqual([a, c]);
    expect(ids({ tags: ['pan'] })).toEqual([a, b]);
    expect(ids({ tags: ['pan', 'cocina'] })).toEqual([a]);
    expect(ids({ tags: ['cocina'], favorites: true, collection: 'sin-coleccion' })).toEqual([c]);
    expect(total({ tags: ['pan'] })).toBe(2);
    expect(ids({ tags: ['no-existe'] })).toEqual([]);
    expect(total({ tags: ['pan', 'no-existe'] })).toBe(0);
    expect(ids({ collection: 999_999 })).toEqual([]);
  });

  it('cada enlace trae etiquetas ordenadas y su colección', async () => {
    const { alice, bookmarks } = await setup();
    bookmarks.save(alice, { url: 'https://example.com/a', tags: ['zeta', 'Alfa', 'medio'], newCollectionName: 'Viajes' }, 'web');
    const [b] = bookmarks.list(alice, {}).items;
    expect(b!.tags.map((t) => t.name)).toEqual(['Alfa', 'medio', 'zeta']);
    expect(b!.collection?.name).toBe('Viajes');
  });
});
