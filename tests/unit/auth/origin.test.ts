import { describe, expect, it } from 'vitest';
import { originAllowed } from '../../../src/server/security/origin.ts';

const base = { appOrigin: 'https://pin.example.com' };

describe('originAllowed', () => {
  it('deja pasar métodos seguros', () => {
    expect(originAllowed({ ...base, method: 'GET', origin: 'https://evil.com', secFetchSite: 'cross-site' })).toBe(true);
  });
  it('acepta Origin igual a APP_ORIGIN', () => {
    expect(originAllowed({ ...base, method: 'POST', origin: 'https://pin.example.com', secFetchSite: 'same-origin' })).toBe(true);
  });
  it('rechaza otro origen, null y sitios cruzados', () => {
    expect(originAllowed({ ...base, method: 'POST', origin: 'https://evil.com', secFetchSite: null })).toBe(false);
    expect(originAllowed({ ...base, method: 'POST', origin: 'null', secFetchSite: 'cross-site' })).toBe(false);
    expect(originAllowed({ ...base, method: 'POST', origin: null, secFetchSite: 'cross-site' })).toBe(false);
    expect(originAllowed({ ...base, method: 'DELETE', origin: null, secFetchSite: 'same-site' })).toBe(false);
    expect(originAllowed({ ...base, method: 'POST', origin: 'http://pin.example.com', secFetchSite: null })).toBe(false);
  });
  it('Origin: null (Referrer-Policy no-referrer) decide por Sec-Fetch-Site', () => {
    expect(originAllowed({ ...base, method: 'POST', origin: 'null', secFetchSite: 'same-origin' })).toBe(true);
    expect(originAllowed({ ...base, method: 'POST', origin: 'null', secFetchSite: 'same-site' })).toBe(false);
  });
  it('sin Origin: same-origin/none o cliente sin cabeceras pasan (queda el CSRF)', () => {
    expect(originAllowed({ ...base, method: 'POST', origin: null, secFetchSite: 'same-origin' })).toBe(true);
    expect(originAllowed({ ...base, method: 'POST', origin: null, secFetchSite: 'none' })).toBe(true);
    expect(originAllowed({ ...base, method: 'POST', origin: null, secFetchSite: null })).toBe(true);
  });
  it('en desarrollo acepta same-origin con otro host (127.0.0.1 vs localhost)', () => {
    expect(originAllowed({ ...base, method: 'POST', origin: 'http://127.0.0.1:4321', secFetchSite: 'same-origin', dev: true })).toBe(true);
    expect(originAllowed({ ...base, method: 'POST', origin: 'http://127.0.0.1:4321', secFetchSite: 'same-origin' })).toBe(false);
  });
});
