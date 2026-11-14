import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { checkUrl, ipv6ToBytes, isBlockedAddress, pinnedLookup, resolveTarget } from '../../../src/server/adapters/ssrf.ts';
import { PageFetchError } from '../../../src/server/adapters/types.ts';

const prod = { PINCUSHION_TEST_MODE: false, testHosts: new Set<string>() };
const test = { PINCUSHION_TEST_MODE: true, testHosts: new Set(['127.0.0.1:4421', 'localhost:4420']) };

describe('BlockList', () => {
  it.each([
    '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.254', '127.0.0.1', '127.8.8.8',
    '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.8', '192.0.2.1', '192.168.1.1', '198.18.0.1',
    '198.19.255.255', '198.51.100.7', '203.0.113.9', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255',
  ])('bloquea IPv4 %s', (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '100.63.255.255', '100.128.0.0', '172.15.255.255', '172.32.0.0', '198.17.255.255', '198.20.0.0', '223.255.255.255', '192.0.1.1'])(
    'permite IPv4 pública %s',
    (ip) => expect(isBlockedAddress(ip)).toBe(false),
  );

  it.each(['::', '::1', '::127.0.0.1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'febf::1', 'ff02::1', '64:ff9b::808:808', '64:ff9b::8.8.8.8', '2001:db8::1', '100::1'])(
    'bloquea IPv6 %s',
    (ip) => expect(isBlockedAddress(ip)).toBe(true),
  );

  it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450::1'])('permite IPv6 pública %s', (ip) => expect(isBlockedAddress(ip)).toBe(false));

  it('valida la IPv4 embebida en las mapeadas (::ffff:0:0/96) en ambas notaciones', () => {
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:7f00:1')).toBe(true);
    expect(isBlockedAddress('::ffff:10.1.2.3')).toBe(true);
    expect(isBlockedAddress('::ffff:a9fe:a9fe')).toBe(true); // 169.254.169.254
    expect(isBlockedAddress('0:0:0:0:0:ffff:c0a8:0101')).toBe(true); // 192.168.1.1
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false);
    expect(isBlockedAddress('::ffff:808:808')).toBe(false);
  });

  it('valida la IPv4 embebida en 6to4 (2002::/16)', () => {
    expect(isBlockedAddress('2002:7f00:1::1')).toBe(true);
    expect(isBlockedAddress('2002:0808:0808::1')).toBe(false);
  });

  it('lo que no es una IP se considera bloqueado', () => {
    expect(isBlockedAddress('example.com')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
  });

  it('expande IPv6 a bytes', () => {
    expect([...ipv6ToBytes('::1')!]).toEqual([...Array(15).fill(0), 1]);
    expect([...ipv6ToBytes('::ffff:1.2.3.4')!].slice(10)).toEqual([0xff, 0xff, 1, 2, 3, 4]);
    expect(ipv6ToBytes('1.2.3.4')).toBeNull();
  });
});

describe('checkUrl', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as PageFetchError).code;
    }
    return 'ok';
  };
  it('solo http/https sin credenciales y puertos 80/443', () => {
    expect(code(() => checkUrl('https://example.com/a', prod))).toBe('ok');
    expect(code(() => checkUrl('http://example.com:80/a', prod))).toBe('ok');
    expect(code(() => checkUrl('https://example.com:443/a', prod))).toBe('ok');
    expect(code(() => checkUrl('https://example.com:8443/a', prod))).toBe('blocked_address');
    expect(code(() => checkUrl('http://example.com:22/', prod))).toBe('blocked_address');
    expect(code(() => checkUrl('ftp://example.com/', prod))).toBe('invalid_url');
    expect(code(() => checkUrl('file:///etc/passwd', prod))).toBe('invalid_url');
    expect(code(() => checkUrl('javascript:alert(1)', prod))).toBe('invalid_url');
    expect(code(() => checkUrl('https://user:pw@example.com/', prod))).toBe('invalid_url');
    expect(code(() => checkUrl('::nope', prod))).toBe('invalid_url');
  });

  it('la excepción de test solo aplica en modo test y al host:puerto exacto', () => {
    expect(checkUrl('http://127.0.0.1:4421/x', test).testHost).toBe(true);
    expect(checkUrl('http://localhost:4420/x', test).testHost).toBe(true);
    expect(code(() => checkUrl('http://127.0.0.1:4420/x', test))).toBe('blocked_address');
    expect(code(() => checkUrl('http://localhost:4421/x', test))).toBe('blocked_address');
    expect(checkUrl('http://127.0.0.1/x', test).testHost).toBe(false);
    expect(code(() => checkUrl('http://127.0.0.1:4421/x', { ...test, PINCUSHION_TEST_MODE: false }))).toBe('blocked_address');
  });
});

describe('resolveTarget', () => {
  const resolver = (map: Record<string, string[]>) => async (h: string) => (map[h] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

  it('rechaza si cualquier dirección resuelta está bloqueada', async () => {
    const r = resolver({ 'ok.example': ['93.184.216.34', '2606:4700::1'], 'mix.example': ['93.184.216.34', '::ffff:127.0.0.1'], 'rebind.example': ['169.254.169.254'] });
    const t = await resolveTarget('https://ok.example/a', prod, r);
    expect(t.addresses.map((a) => a.address)).toEqual(['93.184.216.34', '2606:4700::1']);
    await expect(resolveTarget('https://mix.example/', prod, r)).rejects.toMatchObject({ code: 'blocked_address' });
    await expect(resolveTarget('https://rebind.example/', prod, r)).rejects.toMatchObject({ code: 'blocked_address' });
  });

  it('valida literales IP sin DNS (también IPv6 entre corchetes)', async () => {
    await expect(resolveTarget('http://127.0.0.1/', prod)).rejects.toMatchObject({ code: 'blocked_address' });
    await expect(resolveTarget('http://[::1]/', prod)).rejects.toMatchObject({ code: 'blocked_address' });
    await expect(resolveTarget('http://[::ffff:192.168.0.1]/', prod)).rejects.toMatchObject({ code: 'blocked_address' });
    await expect(resolveTarget('http://0x7f000001/', prod)).rejects.toMatchObject({ code: 'blocked_address' }); // WHATWG → 127.0.0.1
    const t = await resolveTarget('http://8.8.8.8/', prod);
    expect(t.addresses).toEqual([{ address: '8.8.8.8', family: 4 }]);
  });

  it('host inexistente → network', async () => {
    await expect(resolveTarget('https://nada.example/', prod, async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); })).rejects.toMatchObject({ code: 'network', retryable: false });
  });
});

describe('pinnedLookup', () => {
  it('devuelve solo las direcciones validadas, con y sin all', async () => {
    const lookup = pinnedLookup([{ address: '93.184.216.34', family: 4 }, { address: '2606:4700::1', family: 6 }]);
    const one = await new Promise<unknown[]>((res) => lookup('otro.example', {}, (...args: unknown[]) => res(args)));
    expect(one).toEqual([null, '93.184.216.34', 4]);
    const all = await new Promise<unknown[]>((res) => lookup('otro.example', { all: true }, (...args: unknown[]) => res(args)));
    expect(all).toEqual([null, [{ address: '93.184.216.34', family: 4 }, { address: '2606:4700::1', family: 6 }]]);
    const v6 = await new Promise<unknown[]>((res) => lookup('x', { family: 6 }, (...args: unknown[]) => res(args)));
    expect(v6).toEqual([null, '2606:4700::1', 6]);
  });

  it('fija la conexión: un nombre cualquiera conecta a la IP validada sin consultar el DNS', async () => {
    const server = http.createServer((req, res) => res.end(String(req.headers.host)));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const req = http.request(
          { hostname: 'no-existe.invalid', port, path: '/', agent: false, lookup: pinnedLookup([{ address: '127.0.0.1', family: 4 }]) },
          (res) => {
            let b = '';
            res.on('data', (c) => (b += c));
            res.on('end', () => resolve(b));
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(body).toBe(`no-existe.invalid:${port}`);
    } finally {
      server.close();
    }
  });
});
