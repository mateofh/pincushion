import { describe, expect, it } from 'vitest';
import { clientIp } from '../../../src/server/security/rate-limit.ts';

function ctx(headers: Record<string, string>, socket?: string, trust = false) {
  return { request: new Request('http://x.test/', { headers }), clientAddress: socket, locals: { app: { config: { TRUST_PROXY: trust } } } };
}

describe('clientIp', () => {
  it('sin TRUST_PROXY ignora X-Forwarded-For y usa el socket', () => {
    expect(clientIp(ctx({ 'x-forwarded-for': '1.2.3.4' }, '10.0.0.5'))).toBe('10.0.0.5');
  });

  it('con TRUST_PROXY usa la entrada más a la derecha (la que añadió el proxy)', () => {
    expect(clientIp(ctx({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }, '10.0.0.1', true))).toBe('203.0.113.9');
  });

  it('con TRUST_PROXY y cabecera ausente o basura vuelve al socket', () => {
    expect(clientIp(ctx({}, '10.0.0.1', true))).toBe('10.0.0.1');
    expect(clientIp(ctx({ 'x-forwarded-for': '<script>' }, '10.0.0.1', true))).toBe('10.0.0.1');
  });

  it('normaliza IPv4 mapeada en IPv6', () => {
    expect(clientIp(ctx({}, '::ffff:127.0.0.1'))).toBe('127.0.0.1');
  });

  it('el parámetro explícito manda sobre locals y tolera clientAddress que lanza', () => {
    const c = {
      request: new Request('http://x.test/', { headers: { 'x-forwarded-for': '9.9.9.9' } }),
      get clientAddress(): string {
        throw new Error('no disponible');
      },
    };
    expect(clientIp(c, true)).toBe('9.9.9.9');
    expect(clientIp(c, false)).toBe('desconocida');
  });
});
