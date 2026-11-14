// Búsqueda FTS5: aceptación 3, resaltado seguro, relevancia, filtros, papelera y paginación.
import { describe, expect, it } from 'vitest';
import { setup } from './setup.ts';
import { ValidationError } from '../../../src/domain/errors.ts';
import { searchBookmarks } from '../../../src/server/services/bookmarks.ts';

describe('search', () => {
  it('aceptación 3: frase solo en el excerpt → un único <mark> con la frase; título sin marcas', async () => {
    const { alice, bookmarks, search } = await setup();
    const { bookmark } = bookmarks.save(
      alice,
      { url: 'https://example.com/pan', title: 'Notas de cocina', excerpt: 'Para el pan de masa madre, el secreto es la fermentación lenta en frío durante toda la noche.' },
      'web',
    );
    bookmarks.save(alice, { url: 'https://example.com/otro', title: 'Otra cosa', excerpt: 'Nada que ver con esto.' }, 'web');
    const page = search.search(alice, { q: 'fermentacion lenta' });
    expect(page.total).toBe(1);
    const hit = page.items[0]!;
    expect(hit.bookmark.id).toBe(bookmark.id);
    expect(hit.excerptHtml.match(/<mark>/g)).toHaveLength(1);
    expect(hit.excerptHtml).toContain('<mark>fermentación lenta</mark>');
    expect(hit.titleHtml).toBe('Notas de cocina');
    expect(hit.descriptionHtml).toBe('');
  });

  it('prefijo en el último término, sin tildes y comillas = frase exacta', async () => {
    const { alice, bookmarks, search } = await setup();
    bookmarks.save(alice, { url: 'https://example.com/1', title: 'Fermentación de verduras' }, 'web');
    bookmarks.save(alice, { url: 'https://example.com/2', title: 'Lenta y fría fermentación' }, 'web');
    expect(search.search(alice, { q: 'ferment' }).total).toBe(2);
    expect(search.search(alice, { q: 'FERMENTACIÓN' }).total).toBe(2);
    expect(search.search(alice, { q: '"lenta y fria"' }).total).toBe(1);
    expect(search.search(alice, { q: '"fria lenta"' }).total).toBe(0);
  });

  it('relevancia bm25 10/4/1: título antes que descripción antes que excerpt', async () => {
    const { alice, bookmarks, search } = await setup();
    const ex = bookmarks.save(alice, { url: 'https://example.com/e', title: 'Uno', excerpt: 'habla del ornitorrinco' }, 'web').bookmark.id;
    const de = bookmarks.save(alice, { url: 'https://example.com/d', title: 'Dos', description: 'habla del ornitorrinco' }, 'web').bookmark.id;
    const ti = bookmarks.save(alice, { url: 'https://example.com/t', title: 'El ornitorrinco' }, 'web').bookmark.id;
    const page = search.search(alice, { q: 'ornitorrinco' });
    expect(page.items.map((h) => h.bookmark.id)).toEqual([ti, de, ex]);
    expect(page.items[0]!.titleHtml).toBe('El <mark>ornitorrinco</mark>');
    expect(page.items[1]!.descriptionHtml).toBe('habla del <mark>ornitorrinco</mark>');
  });

  it('escapa HTML del contenido (anti-XSS) y solo emite <mark>', async () => {
    const { alice, bookmarks, search } = await setup();
    bookmarks.save(alice, { url: 'https://example.com/x', title: '<img src=x onerror=alert(1)> trampa', excerpt: '<script>alert("trampa")</script>' }, 'web');
    const [hit] = search.search(alice, { q: 'trampa' }).items;
    expect(hit!.titleHtml).toBe('&lt;img src=x onerror=alert(1)&gt; <mark>trampa</mark>');
    expect(hit!.excerptHtml).toBe('&lt;script&gt;alert(&quot;<mark>trampa</mark>&quot;)&lt;/script&gt;');
  });

  it('filtros etiqueta/colección/favoritos y excluye la papelera', async () => {
    const { alice, bookmarks, search } = await setup();
    const s = (p: string, extra: object) => bookmarks.save(alice, { url: `https://example.com/${p}`, title: `receta ${p}`, ...extra }, 'web').bookmark;
    const a = s('a', { tags: ['pan'], newCollectionName: 'Recetas', isFavorite: true });
    const b = s('b', { tags: ['pan'] });
    const c = s('c', {});
    const ids = (q: object) => search.search(alice, { q: 'receta', ...q }).items.map((h) => h.bookmark.id).sort((x, y) => x - y);
    expect(ids({})).toEqual([a.id, b.id, c.id]);
    expect(ids({ tags: ['pan'] })).toEqual([a.id, b.id]);
    expect(ids({ collection: a.collection!.id })).toEqual([a.id]);
    expect(ids({ collection: 'sin-coleccion' })).toEqual([b.id, c.id]);
    expect(ids({ favorites: true })).toEqual([a.id]);
    expect(ids({ tags: ['no-existe'] })).toEqual([]);
    bookmarks.trash(alice, [b.id]);
    expect(ids({})).toEqual([a.id, c.id]);
    expect(search.search(alice, { q: 'receta' }).total).toBe(2);
  });

  it('vacío o solo signos → sin resultados; > 200 caracteres → ValidationError', async () => {
    const { alice, bookmarks, search } = await setup();
    bookmarks.save(alice, { url: 'https://example.com/a', title: 'algo' }, 'web');
    expect(search.search(alice, { q: '' })).toEqual({ items: [], nextCursor: null, total: 0 });
    expect(search.search(alice, { q: ' ¿?!… "" ' })).toEqual({ items: [], nextCursor: null, total: 0 });
    expect(() => search.search(alice, { q: 'a'.repeat(201) })).toThrow(ValidationError);
    expect(() => search.search(alice, { q: 'a'.repeat(200) })).not.toThrow();
    // Sintaxis FTS5 del usuario no rompe la consulta.
    expect(() => search.search(alice, { q: 'algo NEAR( OR "* -' })).not.toThrow();
  });

  it('pagina por offset sin duplicados ni huecos', async () => {
    const { alice, bookmarks, search } = await setup();
    for (let i = 0; i < 53; i++) bookmarks.save(alice, { url: `https://example.com/${i}`, title: `guía ${i}` }, 'web');
    const seen: number[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const p = search.search(alice, { q: 'guia', limit: 10, cursor });
      expect(p.total).toBe(53);
      seen.push(...p.items.map((h) => h.bookmark.id));
      cursor = p.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(6);
    expect(new Set(seen).size).toBe(53);
  });

  it('envoltorio searchBookmarks de Ola 0 mantiene su forma', async () => {
    const { app, alice, bookmarks } = await setup();
    bookmarks.save(alice, { url: 'https://example.com/a', title: 'Hola mundo' }, 'web');
    const [r] = searchBookmarks(app, alice, 'mundo');
    expect(r).toMatchObject({ title: 'Hola mundo', title_hl: 'Hola \u0002mundo\u0003', excerpt_hl: '' });
    expect(searchBookmarks(app, alice, 'x'.repeat(201))).toEqual([]);
  });
});
