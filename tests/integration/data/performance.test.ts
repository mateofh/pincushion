// Rendimiento con 10 000 enlaces con excerpts variados: búsqueda p95 < 100 ms y página de Biblioteca < 50 ms.
// Imprime los números medidos (console.log) para el informe.
import { beforeAll, describe, expect, it } from 'vitest';
import { setup, type Ctx } from './setup.ts';
import type { LibraryQuery, SortKey } from '../../../src/server/contracts.ts';

const N = 10_000;
const VOCAB = (
  'pan masa madre fermentación lenta harina agua sal horno receta cocina verdura tomate aceite oliva ajo cebolla ' +
  'viaje tren avión hotel playa montaña ruta mapa museo ciudad pueblo río lago bosque sendero mochila ' +
  'programación javascript tipos servidor base datos consulta índice rendimiento prueba error despliegue nube ' +
  'música guitarra piano canción disco concierto libro novela poesía autor capítulo lectura biblioteca ' +
  'salud ejercicio correr sueño dieta proteína café té chocolate azúcar leche queso vino cerveza ' +
  'diseño color tipografía interfaz usuario accesibilidad teclado pantalla móvil escritorio tableta ' +
  'historia arte pintura escultura fotografía cine película serie documental teatro danza ' +
  'jardín planta semilla riego flor árbol fruta manzana naranja limón fresa uva ' +
  'dinero ahorro inversión impuesto factura banco tarjeta presupuesto gasto ingreso ' +
  'el la los las de del que en y a un una por con para como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también'
).split(' ');

/** PRNG determinista (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function p(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!;
}

function time(fn: () => unknown): number {
  const t = performance.now();
  fn();
  return performance.now() - t;
}

describe('rendimiento con 10 000 enlaces', () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await setup();
    const { app, alice, bob, bookmarks, collections } = ctx;
    const r = rng(42);
    // Zipf aproximado: las palabras del principio salen mucho más.
    const word = () => VOCAB[Math.floor(VOCAB.length * Math.pow(r(), 1.6))]!;
    const words = (n: number) => Array.from({ length: n }, word).join(' ');
    const colls = ['Lectura', 'Recetas', 'Herramientas', 'Viajes', 'Música', 'Trabajo', 'Salud', 'Algún día'].map((n) => collections.create(alice, n).id);
    const tagPool = Array.from({ length: 40 }, (_, i) => `etiqueta-${i}`);
    const t0 = performance.now();
    app.db.transaction(() => {
      for (let i = 0; i < N; i++) {
        if (i % 7 === 0) app.clock.advance(60_000); // empates de created_at
        const nTags = Math.floor(r() * 4);
        bookmarks.save(
          alice,
          {
            url: `https://sitio${i % 500}.example.com/articulo/${i}`,
            title: `${words(3 + Math.floor(r() * 6))} ${i}`,
            description: words(10 + Math.floor(r() * 25)),
            excerpt: words(150 + Math.floor(r() * 700)),
            tags: Array.from({ length: nTags }, () => tagPool[Math.floor(r() * tagPool.length)]!),
            collectionId: r() < 0.8 ? colls[Math.floor(r() * colls.length)]! : null,
            isFavorite: r() < 0.1,
          },
          'web',
        );
      }
      for (let i = 0; i < 1000; i++) bookmarks.save(bob, { url: `https://bob.example.com/${i}`, title: words(5), excerpt: words(200) }, 'web');
    });
    const ids = app.db.all<{ id: number }>('SELECT id FROM bookmarks WHERE user_id = ? ORDER BY random() LIMIT 300', alice).map((x) => x.id);
    bookmarks.trash(alice, ids);
    app.db.exec("INSERT INTO bookmarks_fts(bookmarks_fts) VALUES ('optimize'); ANALYZE;");
    const avg = app.db.get<{ n: number }>('SELECT AVG(length(excerpt)) AS n FROM bookmarks')!.n;
    console.log(`[rendimiento] sembrados ${N} + 1000 enlaces en ${(performance.now() - t0).toFixed(0)} ms (excerpt medio ${avg.toFixed(0)} caracteres)`);
  }, 120_000);

  it('búsqueda: p95 < 100 ms (página de 50 con total, resaltado y snippets)', () => {
    const { alice, search } = ctx;
    const queries = [
      'pan', 'fermentación lenta', 'masa madre', '"masa madre"', 'javascript', 'servidor base datos', 'tren', 'museo ciudad',
      'chocolate', 'guitarra piano', 'accesibilidad teclado', 'presupuesto', 'uva', 'limón fresa', 'ferm', 'prog', 'documental',
      'la', 'el de', 'sobre también', 'pintura escultura fotografía', 'impuesto factura banco', 'xyznoexiste', 'sendero mochila',
      '"harina agua sal"', 'receta 1234', 'café', 'novela poesía', 'río lago', 'interfaz usuario',
    ];
    const filters: object[] = [{}, { favorites: true }, { tags: ['etiqueta-3'] }, { collection: 'sin-coleccion' }];
    for (const q of queries.slice(0, 5)) search.search(alice, { q }); // calentamiento
    const times: number[] = [];
    for (let round = 0; round < 3; round++) {
      for (const q of queries) {
        for (const f of filters) times.push(time(() => search.search(alice, { q, ...f })));
      }
    }
    const res = search.search(alice, { q: 'fermentación lenta' });
    expect(res.items.length).toBeGreaterThan(0);
    const p50 = p(times, 0.5);
    const p95 = p(times, 0.95);
    const max = Math.max(...times);
    console.log(`[rendimiento] búsqueda: ${times.length} consultas, p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, máx ${max.toFixed(1)} ms`);
    expect(p95).toBeLessThan(100);
  }, 120_000);

  it('biblioteca: cada página < 50 ms (4 órdenes, filtros y páginas profundas)', () => {
    const { alice, bookmarks } = ctx;
    const queries: LibraryQuery[] = [];
    for (const sort of ['recientes', 'antiguos', 'titulo', 'dominio'] as SortKey[]) {
      queries.push({ sort }, { sort, favorites: true }, { sort, tags: ['etiqueta-7'] }, { sort, collection: 'sin-coleccion' }, { sort, tags: ['etiqueta-1', 'etiqueta-2'] });
      // Página profunda (≈ página 100 de 50).
      let cursor: string | undefined;
      for (let i = 0; i < 100; i++) cursor = bookmarks.list(alice, { sort, cursor }).nextCursor ?? undefined;
      queries.push({ sort, cursor });
    }
    const first = ctx.collections.list(alice)[0]!;
    queries.push({ collection: first.id }, { collection: first.id, sort: 'titulo' });
    for (const q of queries) bookmarks.list(alice, q); // calentamiento
    const times: number[] = [];
    const perQuery: string[] = [];
    for (const q of queries) {
      const ts = [0, 1, 2].map(() => time(() => bookmarks.list(alice, q)));
      times.push(...ts);
      perQuery.push(`${q.sort ?? 'recientes'}${q.cursor ? '+profunda' : ''}${q.tags ? '+etiq' : ''}${q.favorites ? '+fav' : ''}${q.collection ? '+col' : ''}=${Math.max(...ts).toFixed(1)}`);
    }
    const page = bookmarks.list(alice, {});
    expect(page.items).toHaveLength(50);
    expect(page.total).toBe(N - 300);
    const p95 = p(times, 0.95);
    const max = Math.max(...times);
    console.log(`[rendimiento] biblioteca: ${times.length} páginas, p50 ${p(times, 0.5).toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, máx ${max.toFixed(1)} ms`);
    console.log(`[rendimiento] biblioteca por consulta (máx ms): ${perQuery.join(' ')}`);
    expect(max).toBeLessThan(50);
  }, 120_000);

  it('colecciones, etiquetas y conteos de la barra lateral < 50 ms', () => {
    const { alice, collections, tags } = ctx;
    const ts = [0, 1, 2].map(() => time(() => {
      collections.list(alice);
      collections.counts(alice);
      tags.list(alice);
    }));
    console.log(`[rendimiento] barra lateral (colecciones + conteos + etiquetas): máx ${Math.max(...ts).toFixed(1)} ms`);
    expect(Math.max(...ts)).toBeLessThan(50);
  });
});
