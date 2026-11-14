// Colecciones y etiquetas: conteos, creación idempotente, renombrar con conflicto y borrado.
import { describe, expect, it } from 'vitest';
import { setup, tagNames } from './setup.ts';
import { ValidationError } from '../../../src/domain/errors.ts';

function fieldOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ValidationError) return err.field;
    throw err;
  }
  throw new Error('no lanzó');
}

describe('colecciones', () => {
  it('create es idempotente por nombre normalizado y valida', async () => {
    const { alice, collections } = await setup();
    const a = collections.create(alice, 'Lectura');
    expect(collections.create(alice, '  lectura ')).toEqual(a);
    expect(collections.create(alice, 'LECTURA')).toEqual({ id: a.id, name: 'Lectura' });
    expect(fieldOf(() => collections.create(alice, '   '))).toBe('name');
    expect(fieldOf(() => collections.create(alice, 'x'.repeat(81)))).toBe('name');
  });

  it('list con conteos (sin papelera) ordenada por nombre; counts globales', async () => {
    const { alice, bookmarks, collections } = await setup();
    const viajes = collections.create(alice, 'viajes');
    const lectura = collections.create(alice, 'Lectura');
    collections.create(alice, 'Algún día');
    const ids = [1, 2, 3].map((i) => bookmarks.save(alice, { url: `https://example.com/${i}`, collectionId: lectura.id, isFavorite: i === 1 }, 'web').bookmark.id);
    bookmarks.save(alice, { url: 'https://example.com/v', collectionId: viajes.id }, 'web');
    bookmarks.save(alice, { url: 'https://example.com/n' }, 'web');
    bookmarks.trash(alice, [ids[2]!]);
    expect(collections.list(alice).map((c) => [c.name, c.count])).toEqual([
      ['Algún día', 0],
      ['Lectura', 2],
      ['viajes', 1],
    ]);
    expect(collections.counts(alice)).toEqual({ all: 4, favorites: 1, unsorted: 1, trash: 1 });
  });

  it('rename: cambia mayúsculas, conflicto → ValidationError, ajena → null', async () => {
    const { alice, bob, collections } = await setup();
    const a = collections.create(alice, 'Lectura');
    collections.create(alice, 'Viajes');
    expect(collections.rename(alice, a.id, 'LECTURA')).toEqual({ id: a.id, name: 'LECTURA' });
    expect(collections.rename(alice, a.id, 'Pendientes')).toEqual({ id: a.id, name: 'Pendientes' });
    expect(fieldOf(() => collections.rename(alice, a.id, 'viajes'))).toBe('name');
    expect(collections.rename(bob, a.id, 'Robada')).toBeNull();
    expect(collections.rename(alice, 999_999, 'X')).toBeNull();
    expect(collections.list(alice).map((c) => c.name)).toEqual(['Pendientes', 'Viajes']);
  });

  it('remove mueve los enlaces (también los de la papelera) a Sin colección y la borra', async () => {
    const { alice, bookmarks, collections } = await setup();
    const c = collections.create(alice, 'Lectura');
    const ids = [1, 2, 3].map((i) => bookmarks.save(alice, { url: `https://example.com/${i}`, collectionId: c.id }, 'web').bookmark.id);
    bookmarks.trash(alice, [ids[0]!]);
    expect(collections.remove(alice, c.id)).toBe(3);
    expect(collections.remove(alice, c.id)).toBeNull();
    expect(collections.list(alice)).toEqual([]);
    for (const id of ids) expect(bookmarks.get(alice, id)!.collection).toBeNull();
    expect(collections.counts(alice).unsorted).toBe(2);
  });
});

describe('etiquetas', () => {
  it('list con conteos (sin papelera) y key', async () => {
    const { alice, bookmarks, tags } = await setup();
    const a = bookmarks.save(alice, { url: 'https://example.com/a', tags: ['Masa Madre', 'pan'] }, 'web').bookmark.id;
    bookmarks.save(alice, { url: 'https://example.com/b', tags: ['pan'] }, 'web');
    bookmarks.trash(alice, [a]);
    expect(tags.list(alice)).toEqual([
      { id: expect.any(Number), name: 'Masa Madre', key: 'masa madre', count: 0 },
      { id: expect.any(Number), name: 'pan', key: 'pan', count: 1 },
    ]);
  });

  it('rename con conflicto → ValidationError; vacío → ValidationError; ajena → null', async () => {
    const { alice, bob, bookmarks, tags } = await setup();
    const id = bookmarks.save(alice, { url: 'https://example.com/a', tags: ['pan', 'cocina'] }, 'web').bookmark.id;
    const pan = tags.list(alice).find((t) => t.key === 'pan')!;
    expect(tags.rename(alice, pan.id, 'Pan de masa')).toEqual({ id: pan.id, name: 'Pan de masa' });
    expect(tagNames(bookmarks.get(alice, id)!)).toEqual(['cocina', 'Pan de masa']);
    expect(fieldOf(() => tags.rename(alice, pan.id, 'COCINA'))).toBe('name');
    expect(fieldOf(() => tags.rename(alice, pan.id, '   '))).toBe('name');
    expect(fieldOf(() => tags.rename(alice, pan.id, 'a, b'))).toBe('name');
    expect(tags.rename(alice, pan.id, 'PAN DE MASA')).toEqual({ id: pan.id, name: 'PAN DE MASA' });
    expect(tags.rename(bob, pan.id, 'robada')).toBeNull();
    // La etiqueta renombrada sigue filtrando por su nueva key.
    expect(bookmarks.list(alice, { tags: ['pan de masa'] }).total).toBe(1);
  });

  it('remove borra la etiqueta y sus vínculos; idempotente', async () => {
    const { alice, bookmarks, tags } = await setup();
    const id = bookmarks.save(alice, { url: 'https://example.com/a', tags: ['pan', 'cocina'] }, 'web').bookmark.id;
    const pan = tags.list(alice).find((t) => t.key === 'pan')!;
    expect(tags.remove(alice, pan.id)).toBe(true);
    expect(tags.remove(alice, pan.id)).toBe(false);
    expect(tagNames(bookmarks.get(alice, id)!)).toEqual(['cocina']);
  });
});
