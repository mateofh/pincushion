import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ValidationError } from '../../../src/domain/errors.ts';
import { HIGHLIGHT_CLOSE, HIGHLIGHT_OPEN, highlightToHtml } from '../../../src/domain/highlight.ts';
import { MAX_QUERY_LENGTH, MAX_QUERY_TERMS, buildMatchQuery, queryTerms } from '../../../src/domain/search-query.ts';

describe('buildMatchQuery: forma', () => {
  it('frase completa OR (términos con AND y prefijo en el último)', () => {
    expect(buildMatchQuery('fermentacion lenta')).toBe('"fermentacion lenta" OR ("fermentacion" AND "lenta"*)');
    expect(buildMatchQuery('a b c')).toBe('"a b c" OR ("a" AND "b" AND "c"*)');
  });
  it('un término → prefijo', () => {
    expect(buildMatchQuery('pan')).toBe('"pan"*');
    expect(buildMatchQuery('  pan  ')).toBe('"pan"*');
  });
  it('comillas del usuario = frase exacta, sin prefijo', () => {
    expect(buildMatchQuery('"masa madre"')).toBe('"masa madre"');
    expect(buildMatchQuery('“masa madre”')).toBe('"masa madre"');
    expect(buildMatchQuery('«masa madre»')).toBe('"masa madre"');
  });
  it('frase entre comillas + términos sueltos con AND', () => {
    expect(buildMatchQuery('"masa madre" receta')).toBe('"masa madre" AND "receta"*');
    expect(buildMatchQuery('receta "masa madre" "sin gluten"')).toBe('"masa madre" AND "sin gluten" AND "receta"*');
  });
  it('comillas sin cerrar se ignoran', () => {
    expect(buildMatchQuery('"masa madre')).toBe('"masa madre" OR ("masa" AND "madre"*)');
  });
  it('nada que buscar → null', () => {
    for (const s of ['', '   ', '""', '"', '***', '()', '🍞🥐', '- + : ^', '"🍞"']) expect(buildMatchQuery(s)).toBeNull();
  });
  it('NFKC: ancho completo y ligaduras', () => {
    expect(buildMatchQuery('ＡＢＣ')).toBe('"ABC"*');
    expect(buildMatchQuery('ﬁn')).toBe('"fin"*');
  });
  it(`limita a ${MAX_QUERY_TERMS} términos`, () => {
    const words = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ');
    expect(queryTerms(words)).toHaveLength(MAX_QUERY_TERMS);
    const q = buildMatchQuery(words)!;
    expect(q).toContain('"w11"*');
    expect(q).not.toContain('w12');
  });
  it(`lanza ValidationError si supera ${MAX_QUERY_LENGTH} caracteres`, () => {
    expect(buildMatchQuery('a'.repeat(MAX_QUERY_LENGTH))).toBe(`"${'a'.repeat(MAX_QUERY_LENGTH)}"*`);
    expect(() => buildMatchQuery('a'.repeat(MAX_QUERY_LENGTH + 1))).toThrow(ValidationError);
    try {
      buildMatchQuery('a'.repeat(201));
    } catch (e) {
      expect((e as ValidationError).field).toBe('q');
    }
  });
  it('los operadores del usuario quedan como texto entre comillas', () => {
    expect(buildMatchQuery('pan AND NOT queso')).toBe('"pan AND NOT queso" OR ("pan" AND "AND" AND "NOT" AND "queso"*)');
    expect(buildMatchQuery('title:pan')).toBe('"title pan" OR ("title" AND "pan"*)');
    expect(buildMatchQuery('-pan')).toBe('"pan"*');
  });
  it('queryTerms', () => {
    expect(queryTerms('"masa madre" pan')).toEqual(['masa', 'madre', 'pan']);
    expect(queryTerms('a'.repeat(300))).toEqual([]);
  });
});

describe('buildMatchQuery contra FTS5 real', () => {
  let db: DatabaseSync;
  const docs = [
    { title: 'Fermentación lenta del pan', description: 'Cómo hacer masa madre', excerpt: 'La fermentacion lenta mejora el sabor.' },
    { title: 'Receta de masa madre', description: 'Sin gluten', excerpt: 'Harina, agua y paciencia.' },
    { title: 'Guía de Tokio 東京', description: '日本語 ガイド', excerpt: 'Viaje a Japón.' },
    { title: 'עברית בסיסית', description: 'Hebreo', excerpt: 'Lengua RTL.' },
    { title: 'NEAR AND OR NOT', description: 'palabras reservadas', excerpt: 'operadores' },
    { title: 'Emoji 🍞 pan', description: 'pan con emoji', excerpt: '' },
  ];

  beforeAll(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`CREATE VIRTUAL TABLE t USING fts5(title, description, excerpt, tokenize = 'unicode61 remove_diacritics 2')`);
    const ins = db.prepare('INSERT INTO t (rowid, title, description, excerpt) VALUES (?, ?, ?, ?)');
    docs.forEach((d, i) => ins.run(i + 1, d.title, d.description, d.excerpt));
  });
  afterAll(() => db.close());

  const search = (input: string): number[] => {
    const q = buildMatchQuery(input);
    if (q === null) return [];
    return (db.prepare('SELECT rowid FROM t WHERE t MATCH ? ORDER BY rowid').all(q) as Array<{ rowid: number }>).map((r) => r.rowid);
  };

  const hostile = [
    '"',
    '""',
    '"""',
    '"a" "',
    'a"b',
    '*',
    'pan*',
    '*pan',
    'NEAR',
    'NEAR(pan masa, 2)',
    'pan NEAR masa',
    'AND',
    'OR',
    'NOT',
    'pan AND',
    'OR pan',
    'NOT pan',
    'pan OR OR masa',
    '-pan',
    'pan -masa',
    '+pan',
    ':',
    'title:pan',
    '{title description}:pan',
    'title : pan',
    '^pan',
    '^',
    '(',
    ')',
    '(pan',
    'pan)',
    '((pan OR masa)',
    "pan' OR 1=1 --",
    "'; DROP TABLE t; --",
    '\\"',
    '🍞',
    '🍞 pan',
    '👩\u200d💻',
    '東京',
    '日本語 ガイド',
    'עברית',
    'मराठी भाषा',
    'ไทย',
    'café',
    'café',
    'ＡＮＤ',
    '\u0000pan',
    'pan\tmasa\nmadre',
    '"masa madre" "sin',
    '%_pan',
    '[pan]',
    '<script>alert(1)</script>',
    'a'.repeat(200),
    Array.from({ length: 50 }, () => 'x').join(' '),
  ];

  it.each(hostile)('no lanza error de sintaxis con %j', (input) => {
    expect(() => search(input)).not.toThrow();
  });

  it('encuentra con y sin acentos (remove_diacritics)', () => {
    expect(search('fermentacion')).toEqual([1]);
    expect(search('fermentación')).toEqual([1]);
    expect(search('FERMENTACIÓN')).toEqual([1]);
  });

  it('prefijo en el último término', () => {
    expect(search('ferment')).toEqual([1]);
    expect(search('masa mad')).toEqual([1, 2]);
  });

  it('todos los términos deben aparecer', () => {
    expect(search('masa gluten')).toEqual([2]);
    expect(search('masa tokio')).toEqual([]);
  });

  it('frase exacta del usuario', () => {
    expect(search('"masa madre"')).toEqual([1, 2]);
    expect(search('"madre masa"')).toEqual([]);
    expect(search('"fermentacion lenta" sabor')).toEqual([1]);
    expect(search('"mas"')).toEqual([]); // sin prefijo
  });

  it('las palabras reservadas se buscan como texto', () => {
    expect(search('NEAR')).toEqual([5]);
    expect(search('AND OR')).toEqual([5]);
    expect(search('NOT')).toEqual([5]);
  });

  it('CJK, RTL y emoji', () => {
    expect(search('東京')).toEqual([3]);
    expect(search('עברית')).toEqual([4]);
    expect(search('🍞 pan')).toEqual([1, 6]);
  });

  it('la frase completa sale en un solo <mark> con highlight()', () => {
    const q = buildMatchQuery('fermentacion lenta')!;
    const row = db.prepare('SELECT highlight(t, 2, ?, ?) AS h FROM t WHERE t MATCH ? AND rowid = 1').get(HIGHLIGHT_OPEN, HIGHLIGHT_CLOSE, q) as { h: string };
    expect(highlightToHtml(row.h)).toBe('La <mark>fermentacion lenta</mark> mejora el sabor.');
  });
});
