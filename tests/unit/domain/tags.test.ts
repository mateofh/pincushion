import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../src/domain/errors.ts';
import { MAX_TAGS_PER_BOOKMARK, MAX_TAG_LENGTH, mergeTags, parseTags, tagKey, validateTagName } from '../../../src/domain/tags.ts';

describe('tagKey', () => {
  it.each([
    ['Masa  Madre', 'masa madre'],
    ['  Recetas ', 'recetas'],
    ['#Viajes', 'viajes'],
    ['ÑANDÚ', 'ñandú'],
    ['café', 'café'], // NFD → NFC
    ['a\u200bb', 'ab'],
  ])('%j → %j', (input, expected) => {
    expect(tagKey(input)).toBe(expected);
  });

  it('es idempotente', () => {
    for (const s of ['Masa  Madre', '#X', 'Ünïcödé  Tag']) expect(tagKey(tagKey(s))).toBe(tagKey(s));
  });
});

describe('parseTags', () => {
  it('separa por comas, recorta, quita vacíos y # inicial', () => {
    expect(parseTags(' recetas, ,#pan ,  masa   madre,')).toEqual([
      { name: 'recetas', key: 'recetas' },
      { name: 'pan', key: 'pan' },
      { name: 'masa madre', key: 'masa madre' },
    ]);
  });

  it('acepta arrays y también separa comas dentro de cada elemento', () => {
    expect(parseTags(['a, b', 'c']).map((t) => t.name)).toEqual(['a', 'b', 'c']);
  });

  it('deduplica por clave y gana la primera escritura', () => {
    expect(parseTags('Recetas, recetas, RECETAS, Pan')).toEqual([
      { name: 'Recetas', key: 'recetas' },
      { name: 'Pan', key: 'pan' },
    ]);
  });

  it('undefined, cadena vacía o array vacío → []', () => {
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags('')).toEqual([]);
    expect(parseTags([])).toEqual([]);
    expect(parseTags(' , ,, # ')).toEqual([]);
  });

  it(`rechaza etiquetas de más de ${MAX_TAG_LENGTH} caracteres (contados como caracteres, no UTF-16)`, () => {
    expect(parseTags('x'.repeat(MAX_TAG_LENGTH))[0]!.name).toHaveLength(MAX_TAG_LENGTH);
    expect(() => parseTags('x'.repeat(MAX_TAG_LENGTH + 1))).toThrow(ValidationError);
    // 40 emojis = 40 caracteres aunque ocupen 80 unidades UTF-16.
    expect(parseTags('🍞'.repeat(MAX_TAG_LENGTH))).toHaveLength(1);
    try {
      parseTags('y'.repeat(99));
    } catch (e) {
      expect((e as ValidationError).field).toBe('tags');
      expect((e as ValidationError).message).toMatch(/hasta 40 caracteres/);
    }
  });

  it(`rechaza más de ${MAX_TAGS_PER_BOOKMARK} etiquetas distintas (los duplicados no cuentan)`, () => {
    const twenty = Array.from({ length: MAX_TAGS_PER_BOOKMARK }, (_, i) => `t${i}`);
    expect(parseTags([...twenty, 'T0', 't1'])).toHaveLength(MAX_TAGS_PER_BOOKMARK);
    expect(() => parseTags([...twenty, 'otra'])).toThrow(/hasta 20 etiquetas/);
  });

  it('quita controles e invisibles y colapsa saltos de línea', () => {
    expect(parseTags('a\u0000b, c\nd, \u202eevil')).toEqual([
      { name: 'a b', key: 'a b' },
      { name: 'c d', key: 'c d' },
      { name: 'evil', key: 'evil' },
    ]);
  });

  it('acepta emoji, CJK y RTL', () => {
    expect(parseTags('🍞 pan, 日本語, עברית').map((t) => t.name)).toEqual(['🍞 pan', '日本語', 'עברית']);
  });
});

describe('validateTagName', () => {
  it('devuelve nombre y clave', () => {
    expect(validateTagName('  #Lectura ')).toEqual({ name: 'Lectura', key: 'lectura' });
  });
  it('rechaza vacío, comas y largos', () => {
    expect(() => validateTagName('')).toThrow(/Escribe el nombre/);
    expect(() => validateTagName(undefined)).toThrow(ValidationError);
    expect(() => validateTagName('a,b')).toThrow(/comas/);
    expect(() => validateTagName('x'.repeat(41))).toThrow(/40/);
  });
  it('usa el campo indicado', () => {
    try {
      validateTagName('', 'etiqueta');
    } catch (e) {
      expect((e as ValidationError).field).toBe('etiqueta');
    }
  });
});

describe('mergeTags', () => {
  it('une sin duplicar y conserva el nombre existente', () => {
    const existing = parseTags('Recetas, Pan');
    const incoming = parseTags('pan, masa madre');
    expect(mergeTags(existing, incoming)).toEqual([
      { name: 'Recetas', key: 'recetas' },
      { name: 'Pan', key: 'pan' },
      { name: 'masa madre', key: 'masa madre' },
    ]);
  });
  it('no muta las entradas', () => {
    const a = parseTags('a');
    mergeTags(a, parseTags('b'));
    expect(a).toHaveLength(1);
  });
});
