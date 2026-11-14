// Guarda SSRF para peticiones salientes (metadatos y favicons).
// - Solo http/https, sin credenciales en la URL y puertos 80/443.
// - Resuelve DNS una vez, rechaza si CUALQUIER dirección está en un rango bloqueado y fija la conexión
//   a las direcciones validadas (lookup propio que no vuelve a resolver → sin DNS rebinding).
// - Excepción de pruebas: con PINCUSHION_TEST_MODE, los host:puerto EXACTOS de METADATA_TEST_HOSTS.
import net from 'node:net';
import { promises as dnsPromises } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { PageFetchError } from './types.ts';

const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['255.255.255.255', 32],
];

const V6_BLOCKED: [string, number][] = [
  ['::', 96], // :: (no especificada), ::1 (loopback) y las "IPv4-compatibles" obsoletas
  ['fc00::', 7], // ULA
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
  ['64:ff9b::', 96], // NAT64
  ['100::', 64], // discard-only
  ['2001:db8::', 32], // documentación
];

function buildBlockList(): net.BlockList {
  const bl = new net.BlockList();
  for (const [a, p] of V4_BLOCKED) bl.addSubnet(a, p, 'ipv4');
  for (const [a, p] of V6_BLOCKED) bl.addSubnet(a, p, 'ipv6');
  return bl;
}

/** Lista de rangos bloqueados (las mapeadas ::ffff:0:0/96 y 6to4 se validan por su IPv4 embebida). */
export const blockList: net.BlockList = buildBlockList();

/** Expande una IPv6 textual a 16 bytes. Devuelve null si no es válida. */
export function ipv6ToBytes(input: string): Uint8Array | null {
  let s = input.split('%')[0]!;
  if (net.isIPv6(s) === false) return null;
  const out = new Uint8Array(16);
  // IPv4 embebida al final (::ffff:1.2.3.4)
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  let tailWords: number[] = [];
  if (tail.includes('.')) {
    const parts = tail.split('.').map(Number);
    tailWords = [(parts[0]! << 8) | parts[1]!, (parts[2]! << 8) | parts[3]!];
    s = s.slice(0, lastColon + 1) + '0:0';
  }
  const [head, rest] = s.includes('::') ? s.split('::') as [string, string] : [s, null];
  const headWords = head ? head.split(':').filter((w) => w !== '').map((w) => parseInt(w, 16)) : [];
  const restWords = rest ? rest.split(':').filter((w) => w !== '').map((w) => parseInt(w, 16)) : [];
  const words: number[] = rest === null ? headWords : [...headWords, ...Array(8 - headWords.length - restWords.length).fill(0), ...restWords];
  if (words.length !== 8) return null;
  if (tailWords.length) {
    words[6] = tailWords[0]!;
    words[7] = tailWords[1]!;
  }
  words.forEach((w, i) => {
    out[i * 2] = (w >> 8) & 0xff;
    out[i * 2 + 1] = w & 0xff;
  });
  return out;
}

/** IPv4 embebida en una IPv6 mapeada (::ffff:a.b.c.d) o 6to4 (2002:aabb:ccdd::/16), si la hay. */
function embeddedIPv4(bytes: Uint8Array): string | null {
  const isMapped = bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (isMapped) return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return `${bytes[2]}.${bytes[3]}.${bytes[4]}.${bytes[5]}`;
  return null;
}

/** true si la dirección IP (v4 o v6) está en un rango no permitido o no es una IP válida. */
export function isBlockedAddress(address: string): boolean {
  const ip = address.split('%')[0]!;
  const family = net.isIP(ip);
  if (family === 4) return blockList.check(ip, 'ipv4');
  if (family !== 6) return true;
  const bytes = ipv6ToBytes(ip);
  if (!bytes) return true;
  const v4 = embeddedIPv4(bytes);
  if (v4) return blockList.check(v4, 'ipv4');
  return blockList.check(ip, 'ipv6');
}

export interface GuardConfig {
  PINCUSHION_TEST_MODE: boolean;
  testHosts: Set<string>;
}

export interface ResolvedTarget {
  url: URL;
  /** Nombre de host sin corchetes (para SNI y cabecera Host). */
  hostname: string;
  port: number;
  /** Direcciones validadas a las que se fija la conexión (la primera es la preferida). */
  addresses: { address: string; family: 4 | 6 }[];
  /** true si se permitió por la excepción de modo test. */
  testHost: boolean;
}

function effectivePort(u: URL): number {
  if (u.port) return Number(u.port);
  return u.protocol === 'https:' ? 443 : 80;
}

/** Valida esquema, credenciales y puerto. Lanza PageFetchError (invalid_url / blocked_address). */
export function checkUrl(raw: string | URL, config: GuardConfig): { url: URL; hostname: string; port: number; testHost: boolean } {
  let url: URL;
  try {
    url = typeof raw === 'string' ? new URL(raw) : new URL(raw.href);
  } catch {
    throw new PageFetchError('invalid_url', 'URL no válida');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new PageFetchError('invalid_url', 'Solo se permiten http y https');
  if (url.username || url.password) throw new PageFetchError('invalid_url', 'La URL no puede incluir credenciales');
  if (!url.hostname) throw new PageFetchError('invalid_url', 'URL sin host');
  const port = effectivePort(url);
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const key = `${url.hostname.toLowerCase()}:${port}`;
  const testHost = config.PINCUSHION_TEST_MODE && config.testHosts.has(key);
  if (!testHost && port !== 80 && port !== 443) throw new PageFetchError('blocked_address', 'Puerto no permitido');
  return { url, hostname, port, testHost };
}

export type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;

const defaultResolver: Resolver = (hostname) => dnsPromises.lookup(hostname, { all: true, verbatim: true });

/** Comprueba la URL y resuelve el host validando TODAS las direcciones. */
export async function resolveTarget(raw: string | URL, config: GuardConfig, resolver: Resolver = defaultResolver): Promise<ResolvedTarget> {
  const { url, hostname, port, testHost } = checkUrl(raw, config);
  let addrs: { address: string; family: number }[];
  const literal = net.isIP(hostname);
  if (literal) addrs = [{ address: hostname, family: literal }];
  else {
    try {
      addrs = await resolver(hostname);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      throw new PageFetchError('network', `No se pudo resolver el host (${code ?? 'error'})`, { retryable: code !== 'ENOTFOUND' });
    }
  }
  if (!addrs.length) throw new PageFetchError('network', 'El host no tiene direcciones', { retryable: true });
  const addresses = addrs.map((a) => ({ address: a.address, family: (a.family === 6 ? 6 : 4) as 4 | 6 }));
  if (!testHost && addresses.some((a) => isBlockedAddress(a.address))) {
    throw new PageFetchError('blocked_address', 'La dirección de destino no está permitida');
  }
  return { url, hostname, port, addresses, testHost };
}

/**
 * `lookup` compatible con http.request / net.connect que devuelve SIEMPRE las direcciones ya validadas,
 * sin volver a consultar el DNS (evita DNS rebinding entre la validación y la conexión).
 */
export function pinnedLookup(addresses: { address: string; family: 4 | 6 }[]): LookupFunction {
  if (!addresses.length) throw new Error('pinnedLookup necesita al menos una dirección');
  return ((_hostname: string, options: unknown, callback: unknown) => {
    const cb = (typeof options === 'function' ? options : callback) as (...args: unknown[]) => void;
    const opts = (typeof options === 'object' && options !== null ? options : {}) as { all?: boolean; family?: number | string };
    const fam = opts.family === 'IPv6' ? 6 : opts.family === 'IPv4' ? 4 : Number(opts.family) || 0;
    const list = fam ? addresses.filter((a) => a.family === fam) : addresses;
    process.nextTick(() => {
      if (!list.length) {
        const err = Object.assign(new Error('Sin direcciones validadas para esa familia'), { code: 'ENOTFOUND' });
        return opts.all ? cb(err, []) : cb(err, '', 0);
      }
      if (opts.all) cb(null, list.map((a) => ({ address: a.address, family: a.family })));
      else cb(null, list[0]!.address, list[0]!.family);
    });
  }) as LookupFunction;
}
