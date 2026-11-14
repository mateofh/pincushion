// next/volver: solo rutas relativas internas (N7).
import { describe, expect, it } from 'vitest';
import { safeReturnPath } from '../../../src/server/http.ts';

describe('safeReturnPath', () => {
  it.each([
    '//evil.com',
    '//evil.com/x',
    '/\\evil.com',
    '/\\/evil.com',
    '\\\\evil.com',
    'https://evil.com',
    'http:/evil.com',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' /espacio',
    'evil.com',
    '/ok\u0000',
    '/ok\r\nSet-Cookie: x=1',
    '/\tevil',
    '',
    'a'.repeat(1001),
  ])('rechaza %j', (v) => {
    expect(safeReturnPath(v)).toBe('/');
  });

  it('decodificado %2F%2F no escapa del origen', () => {
    const out = safeReturnPath('/%2F%2Fevil.com');
    expect(out.startsWith('//')).toBe(false);
    expect(new URL(out, 'https://app.test').origin).toBe('https://app.test');
    expect(safeReturnPath('%2F%2Fevil.com')).toBe('/');
  });

  it('acepta rutas internas con query y fragmento', () => {
    expect(safeReturnPath('/buscar?q=pan%20casero&etiqueta=cocina')).toBe('/buscar?q=pan%20casero&etiqueta=cocina');
    expect(safeReturnPath('/enlaces/12#editar')).toBe('/enlaces/12#editar');
    expect(safeReturnPath('/')).toBe('/');
  });

  it('usa el fallback indicado y rechaza no-strings', () => {
    expect(safeReturnPath(undefined, '/x')).toBe('/x');
    expect(safeReturnPath(null)).toBe('/');
    expect(safeReturnPath(['/a'])).toBe('/');
  });
});
