// Adaptador HTTP real de metadatos y favicons.
// Guarda SSRF en cada salto (ssrf.ts) con la conexión fijada a la IP validada, redirecciones manuales ≤5,
// timeout total con AbortSignal, límites de bytes crudos y descomprimidos (zlib en streaming), solo HTML,
// charset por cabecera o <meta>, sin cookies. La extracción usa htmlparser2 sin ejecutar nada.
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import type { Readable } from 'node:stream';
import type { Config } from '../config.ts';
import type { Logger } from '../log.ts';
import { PageFetchError, type FaviconData, type PageFetcher, type PageMetadata } from './types.ts';
import { pinnedLookup, resolveTarget, type GuardConfig, type Resolver } from './ssrf.ts';
import { charsetFromContentType, createExtractor, decoderFor, sniffCharset } from './html-extract.ts';

export const USER_AGENT = 'PincushionBot/1.0 (+vista previa de enlaces)';
export const MAX_REDIRECTS = 5;
export const FAVICON_MAX_BYTES = 102_400;
const FAVICON_TIMEOUT_MS = 5_000;

type FetcherConfig = Pick<Config, 'METADATA_TIMEOUT_MS' | 'METADATA_MAX_BYTES' | 'EXCERPT_MAX_CHARS'> & GuardConfig;

export interface HttpFetcherOptions {
  /** Resolver DNS alternativo (tests). */
  resolver?: Resolver;
}

interface RequestCtx {
  config: FetcherConfig;
  signal: AbortSignal;
  /** Lanza el error adecuado si la señal se abortó. */
  abortError(): PageFetchError;
  accept: string;
  resolver?: Resolver;
}

const NON_RETRYABLE_NET = /^(ERR_TLS|CERT_|UNABLE_TO|DEPTH_ZERO|SELF_SIGNED|ERR_SSL|HPE_|ERR_INVALID)/;

function networkError(err: unknown): PageFetchError {
  if (err instanceof PageFetchError) return err;
  const code = String((err as NodeJS.ErrnoException)?.code ?? '');
  return new PageFetchError('network', `Error de red${code ? ` (${code})` : ''}`, { retryable: !NON_RETRYABLE_NET.test(code) });
}

/** Combina timeout total y señal externa en un solo AbortController. */
function makeDeadline(timeoutMs: number, external?: AbortSignal) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  timer.unref?.();
  const onExternal = () => ctrl.abort();
  if (external) {
    if (external.aborted) ctrl.abort();
    else external.addEventListener('abort', onExternal, { once: true });
  }
  return {
    signal: ctrl.signal,
    abortError: () =>
      new PageFetchError('timeout', timedOut || !external?.aborted ? 'Tiempo de espera agotado' : 'Operación cancelada', { retryable: true }),
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternal);
    },
  };
}

/** Una petición GET a un destino ya validado y fijado. Resuelve con la respuesta (sin leer el cuerpo). */
async function requestOnce(url: URL, ctx: RequestCtx): Promise<http.IncomingMessage> {
  const target = await raceAbort(resolveTarget(url, ctx.config, ctx.resolver), ctx);
  const mod = target.url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        method: 'GET',
        protocol: target.url.protocol,
        hostname: target.hostname,
        port: target.port,
        path: target.url.pathname + target.url.search,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: ctx.accept,
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'es,en;q=0.8',
        },
        lookup: pinnedLookup(target.addresses),
        agent: false,
        signal: ctx.signal,
        // Sin cookies: nunca se envían ni se guardan las Set-Cookie.
      },
      resolve,
    );
    req.on('error', (err) => reject(ctx.signal.aborted ? ctx.abortError() : networkError(err)));
    req.end();
  });
}

function raceAbort<T>(p: Promise<T>, ctx: RequestCtx): Promise<T> {
  if (ctx.signal.aborted) return Promise.reject(ctx.abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(ctx.abortError());
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        ctx.signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        ctx.signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/** Sigue redirecciones manualmente (revalidando cada salto) hasta una respuesta 2xx. */
async function getFollowing(start: string, ctx: RequestCtx): Promise<{ res: http.IncomingMessage; finalUrl: URL }> {
  let current: URL;
  try {
    current = new URL(start);
  } catch {
    throw new PageFetchError('invalid_url', 'URL no válida');
  }
  for (let hop = 0; ; hop++) {
    const res = await requestOnce(current, ctx);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && status !== 304) {
      const location = res.headers.location;
      res.destroy();
      if (!location) throw new PageFetchError('http_error', `Redirección sin destino (${status})`, { status });
      if (hop >= MAX_REDIRECTS) throw new PageFetchError('too_many_redirects', 'Demasiadas redirecciones');
      try {
        current = new URL(location, current);
      } catch {
        throw new PageFetchError('invalid_url', 'Redirección a una URL no válida');
      }
      continue;
    }
    if (status < 200 || status >= 300) {
      res.destroy();
      const retryable = status >= 500 || status === 408 || status === 429;
      throw new PageFetchError('http_error', `Respuesta HTTP ${status}`, { status, retryable });
    }
    return { res, finalUrl: current };
  }
}

function decompressorFor(encoding: string | undefined, firstByte: number | undefined): zlib.Gunzip | zlib.Inflate | zlib.InflateRaw | zlib.BrotliDecompress | null {
  const enc = (encoding ?? '').trim().toLowerCase();
  if (!enc || enc === 'identity') return null;
  if (enc === 'gzip' || enc === 'x-gzip') return zlib.createGunzip();
  if (enc === 'br') return zlib.createBrotliDecompress();
  if (enc === 'deflate') return firstByte !== undefined && (firstByte & 0x0f) === 8 ? zlib.createInflate() : zlib.createInflateRaw();
  throw new PageFetchError('network', `Codificación no soportada (${enc})`, { retryable: false });
}

/**
 * Lee el cuerpo con límites: `maxRaw` sobre bytes de red y `maxDecoded` tras descomprimir.
 * Corta la conexión en cuanto se supera cualquiera de los dos. Llama a onChunk con bytes ya descomprimidos.
 */
function readBody(res: http.IncomingMessage, ctx: RequestCtx, maxRaw: number, maxDecoded: number, onChunk: (b: Buffer) => void): Promise<void> {
  const declared = Number(res.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxRaw) {
    res.destroy();
    return Promise.reject(new PageFetchError('too_large', 'La respuesta es demasiado grande'));
  }
  return new Promise<void>((resolve, reject) => {
    let raw = 0;
    let decoded = 0;
    let settled = false;
    let decomp: ReturnType<typeof decompressorFor> | undefined;
    const fail = (err: PageFetchError) => {
      if (settled) return;
      settled = true;
      ctx.signal.removeEventListener('abort', onAbort);
      res.destroy();
      decomp?.destroy();
      reject(err);
    };
    const done = () => {
      if (settled) return;
      settled = true;
      ctx.signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => fail(ctx.abortError());
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    const onDecoded = (b: Buffer) => {
      if (settled) return;
      decoded += b.length;
      if (decoded > maxDecoded) return fail(new PageFetchError('too_large', 'El contenido descomprimido es demasiado grande'));
      try {
        onChunk(b);
      } catch (err) {
        fail(networkError(err));
      }
    };

    res.on('data', (chunk: Buffer) => {
      if (settled) return;
      raw += chunk.length;
      if (raw > maxRaw) return fail(new PageFetchError('too_large', 'La respuesta es demasiado grande'));
      if (decomp === undefined) {
        try {
          decomp = decompressorFor(res.headers['content-encoding'], chunk[0]);
        } catch (err) {
          return fail(networkError(err));
        }
        if (decomp) {
          decomp.on('data', onDecoded);
          decomp.on('error', () => fail(new PageFetchError('network', 'Contenido comprimido corrupto', { retryable: false })));
          decomp.on('end', done);
        }
      }
      if (decomp) decomp.write(chunk);
      else onDecoded(chunk);
    });
    res.on('end', () => {
      if (settled) return;
      if (decomp) decomp.end();
      else done();
    });
    res.on('aborted', () => fail(ctx.signal.aborted ? ctx.abortError() : new PageFetchError('network', 'Conexión interrumpida', { retryable: true })));
    res.on('error', (err) => fail(ctx.signal.aborted ? ctx.abortError() : networkError(err)));
    res.on('close', () => {
      if (!res.complete) fail(ctx.signal.aborted ? ctx.abortError() : new PageFetchError('network', 'Conexión interrumpida', { retryable: true }));
    });
    (res as Readable).resume();
  });
}

const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);

export async function fetchPageMetadata(
  config: FetcherConfig,
  url: string,
  opts: { signal?: AbortSignal; timeoutMs?: number; resolver?: Resolver } = {},
): Promise<PageMetadata> {
  const deadline = makeDeadline(opts.timeoutMs ?? config.METADATA_TIMEOUT_MS, opts.signal);
  const ctx: RequestCtx = {
    config,
    signal: deadline.signal,
    abortError: deadline.abortError,
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
    resolver: opts.resolver,
  };
  try {
    const { res, finalUrl } = await getFollowing(url, ctx);
    const contentType = String(res.headers['content-type'] ?? '');
    const mime = contentType.split(';')[0]!.trim().toLowerCase();
    if (!HTML_TYPES.has(mime)) {
      res.destroy();
      throw new PageFetchError('not_html', `Tipo de contenido no HTML (${mime || 'desconocido'})`);
    }
    const extractor = createExtractor(finalUrl, config.EXCERPT_MAX_CHARS);
    const headerCharset = charsetFromContentType(contentType);
    let decoder: TextDecoder | null = headerCharset ? decoderFor(headerCharset) : null;
    let pending: Buffer[] = [];
    let pendingLen = 0;
    const SNIFF_BYTES = 1024;
    const flushPending = () => {
      const all = Buffer.concat(pending);
      pending = [];
      decoder ??= decoderFor(sniffCharset(all));
      extractor.write(decoder.decode(all, { stream: true }));
    };
    await readBody(res, ctx, config.METADATA_MAX_BYTES, config.METADATA_MAX_BYTES * 2, (chunk) => {
      if (decoder && pending.length === 0) {
        extractor.write(decoder.decode(chunk, { stream: true }));
        return;
      }
      pending.push(chunk);
      pendingLen += chunk.length;
      if (pendingLen >= SNIFF_BYTES) flushPending();
    });
    if (pending.length) flushPending();
    if (decoder) extractor.write(decoder.decode());
    const out = extractor.end();
    return { finalUrl: finalUrl.href, ...out };
  } finally {
    deadline.dispose();
  }
}

/** Detecta el tipo de imagen por sus magic bytes. SVG (y cualquier otro) → null. */
export function sniffImageType(b: Uint8Array): FaviconData['contentType'] | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((x, j) => b[i + j] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0x00, 0x00, 0x01, 0x00) && b.length > 6) return 'image/x-icon';
  if (at(0, 0x47, 0x49, 0x46, 0x38) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return 'image/gif';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

export async function fetchFaviconData(
  config: FetcherConfig,
  url: string,
  opts: { signal?: AbortSignal; timeoutMs?: number; resolver?: Resolver } = {},
): Promise<FaviconData | null> {
  const deadline = makeDeadline(opts.timeoutMs ?? Math.min(config.METADATA_TIMEOUT_MS, FAVICON_TIMEOUT_MS), opts.signal);
  const ctx: RequestCtx = {
    config,
    signal: deadline.signal,
    abortError: deadline.abortError,
    accept: 'image/png,image/x-icon,image/vnd.microsoft.icon,image/gif,image/jpeg,image/webp;q=0.9,*/*;q=0.1',
    resolver: opts.resolver,
  };
  try {
    const { res } = await getFollowing(url, ctx);
    const chunks: Buffer[] = [];
    await readBody(res, ctx, FAVICON_MAX_BYTES, FAVICON_MAX_BYTES, (c) => chunks.push(c));
    const bytes = new Uint8Array(Buffer.concat(chunks));
    const contentType = sniffImageType(bytes);
    return contentType ? { contentType, bytes } : null;
  } catch {
    return null;
  } finally {
    deadline.dispose();
  }
}

export function createHttpPageFetcher(config: FetcherConfig, log: Logger, options: HttpFetcherOptions = {}): PageFetcher {
  return {
    async fetchMetadata(url, opts = {}) {
      try {
        return await fetchPageMetadata(config, url, { ...opts, resolver: options.resolver });
      } catch (err) {
        const e = networkError(err);
        log.debug('fetcher.metadata_failed', { code: e.code, status: e.status, retryable: e.retryable });
        throw e;
      }
    },
    fetchFavicon(url, opts = {}) {
      return fetchFaviconData(config, url, { ...opts, resolver: options.resolver });
    },
  };
}
