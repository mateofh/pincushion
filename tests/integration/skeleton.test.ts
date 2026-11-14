// Prueba del esqueleto (Ola 0): guardar, fusionar duplicados, buscar en el excerpt y aislamiento entre usuarios.
import { describe, expect, it } from 'vitest';
import { createTestApp, createUser } from '../helpers/app.ts';
import { saveBookmark, listBookmarks, searchBookmarks } from '../../src/server/services/bookmarks.ts';
import { highlightToHtml } from '../../src/domain/highlight.ts';

describe('esqueleto', () => {
  it('guarda, fusiona por URL normalizada y aísla usuarios', async () => {
    const app = createTestApp();
    const alice = await createUser(app, 'alice@example.com');
    const bob = await createUser(app, 'bob@example.com');

    const a = saveBookmark(app, alice, { url: 'https://www.example.com/pan/?utm_source=x', title: 'Pan', tags: ['cocina'] });
    const b = saveBookmark(app, alice, { url: 'http://example.com/pan', tags: ['masa madre'] });
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    const tags = app.db.all<{ name: string }>(
      'SELECT t.name FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.bookmark_id = ? ORDER BY t.name', a.id,
    );
    expect(tags.map((t) => t.name)).toEqual(['cocina', 'masa madre']);

    expect(listBookmarks(app, alice)).toHaveLength(1);
    expect(listBookmarks(app, bob)).toHaveLength(0);
  });

  it('encuentra una frase que solo está en el excerpt y la resalta en un solo <mark>', async () => {
    const app = createTestApp();
    const alice = await createUser(app, 'alice@example.com');
    const bob = await createUser(app, 'bob@example.com');
    const { id } = saveBookmark(app, alice, { url: 'https://example.com/a', title: 'Notas de cocina' });
    app.db.run("UPDATE bookmarks SET excerpt = 'El secreto es la fermentación lenta en frío durante la noche.' WHERE id = ?", id);

    const results = searchBookmarks(app, alice, 'fermentacion lenta');
    expect(results).toHaveLength(1);
    expect(highlightToHtml(results[0]!.excerpt_hl)).toContain('<mark>fermentación lenta</mark>');
    expect(searchBookmarks(app, bob, 'fermentacion lenta')).toHaveLength(0);
  });

  it('escapa HTML en el resaltado', () => {
    expect(highlightToHtml('<img src=x onerror=alert(1)> \u0002hola\u0003')).toBe('&lt;img src=x onerror=alert(1)&gt; <mark>hola</mark>');
  });
});
