import { describe, expect, it } from 'vitest';
import { draftFields, openDraft, sealDraft, DRAFT_MAX_BYTES, type Draft } from '../../../src/server/security/draft.ts';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const draft = (over: Partial<Draft> = {}): Draft => ({
  v: 1, uid: 7, path: '/guardar', next: '/guardar', fields: [['title', 'Hola ñ']], exp: 10_000, ...over,
});

describe('borrador de formulario (N5)', () => {
  it('excluye _csrf y contraseñas, conserva repetidos', () => {
    const f = new FormData();
    f.append('_csrf', 'x');
    f.append('title', 'T');
    f.append('tags', 'a');
    f.append('tags', 'b');
    f.append('current_password', 'secreta');
    f.append('contraseña', 'secreta');
    expect(draftFields(f)).toEqual([['title', 'T'], ['tags', 'a'], ['tags', 'b']]);
  });

  it('null si supera 16 KB o no hay nada', () => {
    const big = new FormData();
    big.append('excerpt', 'x'.repeat(DRAFT_MAX_BYTES));
    expect(draftFields(big)).toBeNull();
    const empty = new FormData();
    empty.append('_csrf', 'x');
    expect(draftFields(empty)).toBeNull();
  });

  it('sella y abre; rechaza manipulado, otro secreto, caducado y rutas externas', () => {
    const sealed = sealDraft(SECRET, draft());
    expect(sealed).not.toContain('Hola');
    expect(openDraft(SECRET, sealed, 5_000)?.fields).toEqual([['title', 'Hola ñ']]);
    expect(openDraft(SECRET, sealed, 10_000)).toBeNull();
    expect(openDraft('otro-secreto-0123456789abcdef0123456789abcdef', sealed, 5_000)).toBeNull();
    const flipped = sealed.slice(0, 40) + (sealed[40] === 'A' ? 'B' : 'A') + sealed.slice(41);
    expect(openDraft(SECRET, flipped, 5_000)).toBeNull();
    expect(openDraft(SECRET, sealDraft(SECRET, draft({ path: '//evil.com' })), 5_000)).toBeNull();
    expect(openDraft(SECRET, sealDraft(SECRET, draft({ next: 'https://evil.com' })), 5_000)?.next).toBe('/');
    expect(openDraft(SECRET, 'no válido', 5_000)).toBeNull();
  });
});
