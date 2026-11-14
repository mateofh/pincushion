// PageFetcher HTTP real contra el servidor de fixtures en 127.0.0.1 (sockets reales, modo test).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpPageFetcher, fetchFaviconData, fetchPageMetadata } from '../../../src/server/adapters/page-fetcher.ts';
import { PageFetchError, type PageFetcher } from '../../../src/server/adapters/types.ts';
import { createLogger } from '../../../src/server/log.ts';
import { loadConfig, type Config } from '../../../src/server/config.ts';
import { siteConfig, startSite, type Site } from './_site.ts';

let site: Site;
let config: Config;
let fetcher: PageFetcher;

beforeAll(async () => {
  site = await startSite();
  config = siteConfig(site);
  fetcher = createHttpPageFetcher(config, createLogger('silent'));
});
afterAll(() => site.close());

async function fetchError(p: Promise<unknown>): Promise<PageFetchError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(PageFetchError);
    return err as PageFetchError;
  }
  throw new Error('se esperaba un PageFetchError');
}

describe('PageFetcher HTTP: éxito y extracción', () => {
  it('extrae título, descripción, excerpt y favicon; el script que cambia document.title no influye', async () => {
    const m = await fetcher.fetchMetadata(site.url('/articulo'));
    expect(m.finalUrl).toBe(site.url('/articulo'));
    expect(m.title).toBe('Pan de masa madre en casa');
    expect(m.description).toBe('Guía práctica para hornear pan con masa madre.');
    expect(m.excerpt).toContain('fermentación lenta en frío durante toda la noche');
    expect(m.excerpt.startsWith('Pan de masa madre en casa Este artículo')).toBe(true);
    expect(m.excerpt).not.toContain('Menú del sitio');
    expect(m.excerpt).not.toContain('Pie del sitio');
    expect(m.excerpt).not.toContain('document.title');
    expect(JSON.stringify(m)).not.toContain('cambiado por script');
    expect(m.faviconUrl).toBe(site.url('/icono.png'));
  });

  it('prioriza og:title, description > og > twitter, decodifica entidades y prioriza <article>', async () => {
    const m = await fetcher.fetchMetadata(site.url('/og'));
    expect(m.title).toBe('Título & Open Graph');
    expect(m.description).toBe('Descripción OG');
    expect(m.excerpt).toBe('Primer párrafo con <entidades>. Segundo párrafo.');
    expect(m.faviconUrl).toBe(site.url('/img/icono.png?v=2'));
  });

  it('sigue redirecciones relativas y descomprime gzip', async () => {
    const r = await fetcher.fetchMetadata(site.url('/redirige-a-articulo'));
    expect(r.finalUrl).toBe(site.url('/articulo'));
    const g = await fetcher.fetchMetadata(site.url('/articulo-gzip'));
    expect(g.title).toBe('Pan comprimido');
    expect(g.excerpt).toContain('fermentación lenta');
  });

  it('respeta el charset ISO-8859-1 de la cabecera y del <meta>', async () => {
    const a = await fetcher.fetchMetadata(site.url('/latin1'));
    expect(a.title).toBe('Canción de otoño');
    expect(a.excerpt).toBe('Añoranza y café en la montaña.');
    const b = await fetcher.fetchMetadata(site.url('/latin1-meta'));
    expect(b.title).toBe('Niño pequeño');
    expect(b.excerpt).toBe('Pingüino.');
  });

  it('sin favicon válido declarado (solo SVG) cae a /favicon.ico', async () => {
    const m = await fetcher.fetchMetadata(site.url('/con-icono-svg'));
    expect(m.faviconUrl).toBe(site.url('/favicon.ico'));
  });
});

describe('PageFetcher HTTP: errores normalizados', () => {
  it('403 → http_error no reintentable', async () => {
    const e = await fetchError(fetcher.fetchMetadata(site.url('/bloqueado')));
    expect(e).toMatchObject({ code: 'http_error', status: 403, retryable: false });
  });

  it('500 → http_error reintentable', async () => {
    const e = await fetchError(fetcher.fetchMetadata(site.url('/error-500')));
    expect(e).toMatchObject({ code: 'http_error', status: 500, retryable: true });
  });

  it('servidor lento → timeout reintentable dentro del plazo', async () => {
    const t0 = Date.now();
    const e = await fetchError(fetcher.fetchMetadata(site.url('/lento'), { timeoutMs: 300 }));
    expect(e).toMatchObject({ code: 'timeout', retryable: true });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('usa METADATA_TIMEOUT_MS por defecto y respeta un AbortSignal externo', async () => {
    const short = loadConfig({ ...process.env, APP_SECRET: 'x'.repeat(32), PINCUSHION_TEST_MODE: '1', METADATA_TEST_HOSTS: `127.0.0.1:${site.port}`, METADATA_TIMEOUT_MS: '500' });
    const t0 = Date.now();
    const e = await fetchError(fetchPageMetadata(short, site.url('/lento')));
    expect(e.code).toBe('timeout');
    expect(Date.now() - t0).toBeLessThan(2000);
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 100);
    const e2 = await fetchError(fetcher.fetchMetadata(site.url('/lento'), { signal: ctrl.signal }));
    expect(e2.code).toBe('timeout');
  });

  it('respuesta demasiado grande → too_large', async () => {
    const e = await fetchError(fetcher.fetchMetadata(site.url('/enorme')));
    expect(e).toMatchObject({ code: 'too_large', retryable: false });
  });

  it('gzip bomb (20 MB descomprimidos) → too_large sin descomprimirla entera', async () => {
    const t0 = Date.now();
    const e = await fetchError(fetcher.fetchMetadata(site.url('/bomba-gzip')));
    expect(e).toMatchObject({ code: 'too_large', retryable: false });
    expect(e.message).toContain('descomprimido');
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('redirección a 127.0.0.1 (puerto 80 o puerto no permitido) → blocked_address', async () => {
    const a = await fetchError(fetcher.fetchMetadata(site.url('/redirige-a-loopback')));
    expect(a).toMatchObject({ code: 'blocked_address', retryable: false });
    const b = await fetchError(fetcher.fetchMetadata(site.url('/redirige-a-privada')));
    expect(b).toMatchObject({ code: 'blocked_address', retryable: false });
  });

  it('bucle de redirecciones → too_many_redirects', async () => {
    const e = await fetchError(fetcher.fetchMetadata(site.url('/redirige-bucle')));
    expect(e).toMatchObject({ code: 'too_many_redirects', retryable: false });
  });

  it('PDF → not_html no reintentable', async () => {
    const e = await fetchError(fetcher.fetchMetadata(site.url('/documento.pdf')));
    expect(e).toMatchObject({ code: 'not_html', retryable: false });
  });

  it('esquemas, credenciales y URLs inválidas → invalid_url', async () => {
    expect((await fetchError(fetcher.fetchMetadata('ftp://example.com/x'))).code).toBe('invalid_url');
    expect((await fetchError(fetcher.fetchMetadata(`http://u:p@127.0.0.1:${site.port}/articulo`))).code).toBe('invalid_url');
    expect((await fetchError(fetcher.fetchMetadata('no es una url'))).code).toBe('invalid_url');
  });

  it('la excepción de modo test solo vale para el host:puerto exacto', async () => {
    // Mismo servidor por otro nombre: no está en la lista → puerto no permitido.
    const e = await fetchError(fetcher.fetchMetadata(`http://localhost:${site.port}/articulo`));
    expect(e.code).toBe('blocked_address');
    // Sin PINCUSHION_TEST_MODE, ni siquiera el host listado.
    const prod = loadConfig({ APP_SECRET: 'x'.repeat(32), METADATA_TEST_HOSTS: `127.0.0.1:${site.port}` });
    const e2 = await fetchError(fetchPageMetadata(prod, site.url('/articulo')));
    expect(e2.code).toBe('blocked_address');
  });

  it('un nombre que resuelve a una IP privada se bloquea aunque otra dirección sea pública', async () => {
    const f = createHttpPageFetcher(config, createLogger('silent'), {
      resolver: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ],
    });
    const e = await fetchError(f.fetchMetadata('https://mixto.example/'));
    expect(e.code).toBe('blocked_address');
  });
});

describe('Favicons', () => {
  it('acepta PNG e ICO verificados por magic bytes', async () => {
    const png = await fetcher.fetchFavicon(site.url('/icono.png'));
    expect(png?.contentType).toBe('image/png');
    expect(png?.bytes.length).toBeGreaterThan(8);
    const ico = await fetcher.fetchFavicon(site.url('/favicon.ico'));
    expect(ico?.contentType).toBe('image/x-icon');
  });

  it('rechaza SVG (aunque se anuncie como PNG), HTML, demasiado grande y destinos bloqueados', async () => {
    expect(await fetcher.fetchFavicon(site.url('/icono.svg'))).toBeNull();
    expect(await fetcher.fetchFavicon(site.url('/icono-falso.png'))).toBeNull();
    expect(await fetcher.fetchFavicon(site.url('/articulo'))).toBeNull();
    expect(await fetcher.fetchFavicon(site.url('/enorme'))).toBeNull();
    expect(await fetcher.fetchFavicon(site.url('/redirige-a-loopback'))).toBeNull();
    expect(await fetcher.fetchFavicon(site.url('/no-existe.png'))).toBeNull();
    expect(await fetchFaviconData(config, site.url('/lento'), { timeoutMs: 200 })).toBeNull();
  });
});
