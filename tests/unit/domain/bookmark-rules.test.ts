import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  cleanText,
  collectionKey,
  decodeCursor,
  encodeCursor,
  mergeOnDuplicate,
  truncateText,
  validateCollectionName,
  type ExistingFields,
} from '../../../src/domain/bookmark-rules.ts';
import { ValidationError } from '../../../src/domain/errors.ts';

describe('cleanText', () => {
  it('colapsa espacios y quita controles en una línea', () => {
    expect(cleanText('  Hola\t\tmundo\n\ncruel \u0000 ', 300, 'title')).toBe('Hola mundo cruel');
  });
  it('undefined → cadena vacía', () => {
    expect(cleanText(undefined, 10, 'x')).toBe('');
  });
  it('normaliza a NFC', () => {
    expect(cleanText('café', 10, 'x')).toBe('café');
  });
  it('quita controles bidi e invisibles pero conserva texto RTL y emojis con ZWJ', () => {
    expect(cleanText('abc\u202edef\u200b', 50, 'x')).toBe('abcdef');
    expect(cleanText('שלום עולם', 50, 'x')).toBe('שלום עולם');
    expect(cleanText('👩\u200d💻 dev', 50, 'x')).toBe('👩\u200d💻 dev');
  });
  it('sustituye surrogates sueltos', () => {
    expect(cleanText('a\ud800b', 10, 'x')).toBe('a�b');
  });
  it('multilínea: CRLF → LF, recorta cada línea, máximo una línea en blanco', () => {
    expect(cleanText('  uno  \r\n\r\n\r\n\r\n  dos\t\tdos \u2028tres\u0007', 100, 'd', true)).toBe('uno\n\ndos dos\ntres');
  });
  it('lanza ValidationError con el campo al superar el máximo (en caracteres)', () => {
    expect(cleanText('x'.repeat(LIMITS.title), LIMITS.title, 'title')).toHaveLength(300);
    expect(() => cleanText('x'.repeat(301), LIMITS.title, 'title')).toThrow(ValidationError);
    expect(cleanText('🍞'.repeat(300), LIMITS.title, 'title')).toHaveLength(600); // 300 caracteres
    try {
      cleanText('x'.repeat(11), 10, 'description');
    } catch (e) {
      expect((e as ValidationError).field).toBe('description');
      expect((e as ValidationError).message).toBe('Máximo 10 caracteres.');
    }
  });
  it('mide después de limpiar', () => {
    expect(cleanText(`  ${'x'.repeat(10)}   `, 10, 'x')).toBe('x'.repeat(10));
  });
});

describe('truncateText', () => {
  it('recorta por caracteres sin partir emojis', () => {
    expect(truncateText('abc', 5)).toBe('abc');
    expect(truncateText('🍞🍞🍞', 2)).toBe('🍞🍞');
    expect(truncateText('hola mundo', 5)).toBe('hola');
  });
});

describe('colecciones', () => {
  it('collectionKey', () => {
    expect(collectionKey('  Lectura   Pendiente ')).toBe('lectura pendiente');
    expect(collectionKey('ÁRBOL')).toBe('árbol');
  });
  it('validateCollectionName limpia y valida', () => {
    expect(validateCollectionName('  Mis   Recetas ')).toBe('Mis Recetas');
    expect(() => validateCollectionName('   ')).toThrow('Escribe un nombre para la colección.');
    expect(() => validateCollectionName('x'.repeat(81))).toThrow(ValidationError);
    expect(validateCollectionName('x'.repeat(80))).toHaveLength(80);
  });
  it.each(['Sin colección', 'sin coleccion', 'SIN-COLECCION'])('rechaza el nombre reservado %s', (n) => {
    expect(() => validateCollectionName(n)).toThrow(/reservado/);
  });
  it('el campo del error es collection', () => {
    try {
      validateCollectionName('');
    } catch (e) {
      expect((e as ValidationError).field).toBe('collection');
    }
  });
});

describe('mergeOnDuplicate', () => {
  const fromPage: ExistingFields = { title: 'Título de la página', titleSource: 'page', description: 'Desc página' };
  const edited: ExistingFields = { title: 'Mi título', titleSource: 'user', description: 'Mi descripción' };
  const fallback: ExistingFields = { title: 'example.com', titleSource: 'fallback', description: '' };

  describe('desde la web ("Actualizar enlace")', () => {
    it('lo escrito reemplaza título (pasa a user) y descripción', () => {
      expect(mergeOnDuplicate(fromPage, { title: 'Nuevo', description: 'Otra' }, 'web')).toEqual({ title: 'Nuevo', titleSource: 'user', description: 'Otra' });
      expect(mergeOnDuplicate(edited, { title: 'Nuevo' }, 'web')).toEqual({ title: 'Nuevo', titleSource: 'user' });
    });
    it('título vacío no borra; descripción vacía explícita sí; undefined no toca', () => {
      expect(mergeOnDuplicate(fromPage, { title: '   ', description: '' }, 'web')).toEqual({ description: '' });
      expect(mergeOnDuplicate(fromPage, {}, 'web')).toEqual({});
    });
    it('sin cambios reales → objeto vacío (no marca user por reenviar el mismo título)', () => {
      expect(mergeOnDuplicate(fromPage, { title: ' Título de la página ', description: 'Desc página' }, 'web')).toEqual({});
    });
  });

  describe('desde el bookmarklet', () => {
    it('nunca pisa un título editado por el usuario', () => {
      expect(mergeOnDuplicate(edited, { title: 'Título nuevo de la página' }, 'bookmarklet')).toEqual({});
    });
    it('actualiza títulos de página o de respaldo', () => {
      expect(mergeOnDuplicate(fromPage, { title: 'Título actualizado' }, 'bookmarklet')).toEqual({ title: 'Título actualizado', titleSource: 'page' });
      expect(mergeOnDuplicate(fallback, { title: 'Por fin un título' }, 'bookmarklet')).toEqual({ title: 'Por fin un título', titleSource: 'page' });
    });
    it('solo rellena la descripción si está vacía y nunca vacía', () => {
      expect(mergeOnDuplicate(fallback, { description: 'Nueva' }, 'bookmarklet')).toEqual({ description: 'Nueva' });
      expect(mergeOnDuplicate(fromPage, { description: 'Otra' }, 'bookmarklet')).toEqual({});
      expect(mergeOnDuplicate(fromPage, { title: '', description: '' }, 'bookmarklet')).toEqual({});
    });
    it('no toca nada si la descripción del usuario existe aunque el título sea de página', () => {
      expect(mergeOnDuplicate(edited, { title: 'x', description: 'y' }, 'bookmarklet')).toEqual({});
    });
  });
});

describe('cursores', () => {
  it('ida y vuelta', () => {
    for (const [v, id] of [
      [1763121600000, 42],
      ['Título con "comillas" y ñ', 7],
      ['', 1],
      [0, Number.MAX_SAFE_INTEGER],
      [-5.5, 3],
    ] as const) {
      expect(decodeCursor(encodeCursor(v, id))).toEqual({ sortValue: v, id });
    }
  });

  it('el cursor es base64url (seguro en query strings)', () => {
    expect(encodeCursor('a/b+c?=&', 1)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  const b64 = (s: string) => Buffer.from(s).toString('base64url');
  it.each([
    ['undefined', undefined],
    ['vacío', ''],
    ['basura', 'no-es-un-cursor'],
    ['caracteres fuera de base64url', `${encodeCursor(1, 2)}!`],
    ['base64 estándar con relleno', Buffer.from('[1,2]').toString('base64')],
    ['demasiado largo', 'A'.repeat(501)],
    ['JSON no array', b64('{"a":1}')],
    ['array de 3', b64('[1,2,3]')],
    ['id decimal', b64('[1,2.5]')],
    ['id cero', b64('[1,0]')],
    ['id negativo', b64('[1,-3]')],
    ['id como texto', b64('[1,"2"]')],
    ['id enorme', b64('[1,9007199254740993]')],
    ['valor infinito', b64('[1e400,2]')],
    ['valor objeto', b64('[{"x":1},2]')],
    ['valor null', b64('[null,2]')],
    ['valor booleano', b64('[true,2]')],
    ['cadena larga', b64(JSON.stringify(['x'.repeat(301), 2]))],
    ['no canónico (espacios)', b64('[1, 2]')],
    ['no canónico (1.0)', b64('[1.0,2]')],
    ['inyección SQL en el valor (forma válida pero no canónica)', b64('["x\' OR 1=1 --" ,2]')],
  ])('cursor manipulado (%s) → null', (_name, cursor) => {
    expect(decodeCursor(cursor as string | undefined)).toBeNull();
  });

  it('un valor con comillas SQL se devuelve como dato si es canónico (lo protege el SQL parametrizado)', () => {
    const c = encodeCursor("x' OR 1=1 --", 2);
    expect(decodeCursor(c)).toEqual({ sortValue: "x' OR 1=1 --", id: 2 });
  });
});
