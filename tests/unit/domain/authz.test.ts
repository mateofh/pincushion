import { describe, expect, it } from 'vitest';
import { assertOwner, ownedOrNull, ownsResource, parseId } from '../../../src/domain/authz.ts';
import { NotFoundError, ValidationError, isValidationError, toFieldErrors } from '../../../src/domain/errors.ts';

describe('ownsResource', () => {
  it('true solo con el mismo id válido', () => {
    expect(ownsResource(1, 1)).toBe(true);
    expect(ownsResource(1, 2)).toBe(false);
  });
  it.each([
    [0, 0],
    [-1, -1],
    [1.5, 1.5],
    [Number.NaN, Number.NaN],
    [null, null],
    [undefined, undefined],
    [1, null],
    [null, 1],
    [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1],
    ['1' as unknown as number, 1],
  ])('false con ids inválidos (%j, %j)', (a, b) => {
    expect(ownsResource(a, b)).toBe(false);
  });
});

describe('assertOwner', () => {
  it('no lanza con el dueño', () => {
    expect(() => assertOwner(7, 7)).not.toThrow();
  });
  it('lanza NotFoundError (→ 404, no 403) con recurso ajeno o inexistente', () => {
    expect(() => assertOwner(7, 8)).toThrow(NotFoundError);
    expect(() => assertOwner(7, null)).toThrow(NotFoundError);
    expect(() => assertOwner(undefined, 7)).toThrow(NotFoundError);
  });
});

describe('ownedOrNull', () => {
  it('devuelve el recurso propio y null para ajeno o inexistente', () => {
    const r = { id: 1, userId: 3, title: 'x' };
    expect(ownedOrNull(3, r)).toBe(r);
    expect(ownedOrNull(4, r)).toBeNull();
    expect(ownedOrNull(3, null)).toBeNull();
    expect(ownedOrNull(3, undefined)).toBeNull();
  });
});

describe('parseId', () => {
  it.each([
    ['1', 1],
    ['42', 42],
    [42, 42],
    ['9007199254740991', 9007199254740991],
  ])('%j → %j', (raw, id) => {
    expect(parseId(raw)).toBe(id);
  });
  it.each(['', '0', '-1', '01', '1.0', '1e3', ' 1', '1 ', '0x10', 'abc', '99999999999999999', 0, -1, 1.5, null, undefined])('%j → null', (raw) => {
    expect(parseId(raw as string)).toBeNull();
  });
});

describe('errors', () => {
  it('ValidationError lleva campo y nombre', () => {
    const e = new ValidationError('title', 'Máximo 300 caracteres.');
    expect(e.field).toBe('title');
    expect(e.name).toBe('ValidationError');
    expect(e).toBeInstanceOf(Error);
    expect(isValidationError(e)).toBe(true);
    expect(isValidationError(new Error('x'))).toBe(false);
  });
  it('toFieldErrors', () => {
    expect(toFieldErrors(new ValidationError('url', 'La URL no es válida'))).toEqual({ url: 'La URL no es válida' });
    expect(toFieldErrors(new Error('x'))).toBeNull();
  });
  it('NotFoundError tiene mensaje por defecto en español', () => {
    expect(new NotFoundError().message).toBe('No encontrado');
    expect(new NotFoundError().name).toBe('NotFoundError');
  });
});
