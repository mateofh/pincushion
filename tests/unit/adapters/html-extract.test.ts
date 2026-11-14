import { describe, expect, it } from 'vitest';
import { charsetFromContentType, createExtractor, decoderFor, extractFromHtml, sniffCharset, truncateWords } from '../../../src/server/adapters/html-extract.ts';
import { sniffImageType } from '../../../src/server/adapters/page-fetcher.ts';

const BASE = 'https://example.com/blog/post?x=1';

describe('extracción de metadatos', () => {
  it('usa <title> si no hay og:title y descripción por orden de prioridad', () => {
    const r = extractFromHtml(
      '<html><head><title> Hola\n  mundo </title><meta property="og:description" content="og"><meta name="twitter:description" content="tw"></head><body><p>x</p></body></html>',
      BASE, 1000,
    );
    expect(r.title).toBe('Hola mundo');
    expect(r.description).toBe('og');
    const r2 = extractFromHtml('<meta name="twitter:description" content="solo tw"><p>x</p>', BASE, 1000);
    expect(r2.description).toBe('solo tw');
    expect(r2.title).toBeNull();
  });

  it('ignora el <title> de un <svg> y no ejecuta scripts', () => {
    const r = extractFromHtml(
      '<body><svg><title>icono</title></svg><title>Real</title><script>document.title="malo"; document.write("<p>inyectado</p>")</script><p>Texto</p></body>',
      BASE, 1000,
    );
    expect(r.title).toBe('Real');
    expect(r.excerpt).toBe('Texto');
  });

  it('favicon: rel~=icon resuelto contra la URL final; apple-touch-icon si no hay; /favicon.ico por defecto', () => {
    expect(extractFromHtml('<link rel="Shortcut Icon" href="../i.png">', BASE, 100).faviconUrl).toBe('https://example.com/i.png');
    expect(extractFromHtml('<link rel="apple-touch-icon" href="/a.png">', BASE, 100).faviconUrl).toBe('https://example.com/a.png');
    expect(extractFromHtml('<link rel="icon" href="javascript:alert(1)"><link rel="apple-touch-icon" href="//cdn.example.net/a.png">', BASE, 100).faviconUrl).toBe(
      'https://cdn.example.net/a.png',
    );
    expect(extractFromHtml('<link rel="icon" href="data:image/png;base64,AAAA">', BASE, 100).faviconUrl).toBe('https://example.com/favicon.ico');
    expect(extractFromHtml('<link rel="icon" href="/i.svg">', BASE, 100).faviconUrl).toBe('https://example.com/favicon.ico');
    expect(extractFromHtml('<p>nada</p>', BASE, 100).faviconUrl).toBe('https://example.com/favicon.ico');
  });

  it('excerpt: ignora elementos no textuales, separa bloques, colapsa espacios y decodifica entidades', () => {
    const html =
      '<header>Cabecera</header><nav>Menú</nav><aside>Lateral</aside><noscript>Activa JS</noscript><template><p>plantilla</p></template>' +
      '<style>p{color:red}</style><iframe>marco</iframe><form>Formulario</form>' +
      '<div><p>Uno&nbsp;&amp;&#32;dos</p><p>tres<br>cuatro <b>cin</b>co</p></div><footer>Pie</footer>';
    expect(extractFromHtml(html, BASE, 1000).excerpt).toBe('Uno & dos tres cuatro cinco');
  });

  it('excerpt: prioriza <article>/<main> si existen', () => {
    const html = '<div>Ruido</div><main><p>Principal</p></main><div>Más ruido</div><article><p>Artículo</p></article>';
    expect(extractFromHtml(html, BASE, 1000).excerpt).toBe('Principal Artículo');
  });

  it('recorta el excerpt sin cortar palabras', () => {
    const r = extractFromHtml('<p>' + 'palabra '.repeat(100) + '</p>', BASE, 50);
    expect(r.excerpt.length).toBeLessThanOrEqual(50);
    expect(r.excerpt.endsWith('palabra')).toBe(true);
    expect(truncateWords('abc def ghi', 9)).toBe('abc def');
    expect(truncateWords('abcdefghijkl', 5)).toBe('abcde');
    expect(truncateWords('corto', 10)).toBe('corto');
  });

  it('acepta escritura en trozos arbitrarios (streaming)', () => {
    const html = '<title>Partido</title><meta name="description" content="desc &amp; más"><article><p>Hola mundo</p></article>';
    const x = createExtractor(BASE, 1000);
    for (let i = 0; i < html.length; i += 3) x.write(html.slice(i, i + 3));
    expect(x.end()).toMatchObject({ title: 'Partido', description: 'desc & más', excerpt: 'Hola mundo' });
  });

  it('limita título (300) y descripción (1000)', () => {
    const r = extractFromHtml(`<title>${'t '.repeat(400)}</title><meta name="description" content="${'d '.repeat(800)}">`, BASE, 100);
    expect(r.title!.length).toBeLessThanOrEqual(300);
    expect(r.description!.length).toBeLessThanOrEqual(1000);
  });
});

describe('charset', () => {
  it('lee el charset de la cabecera y del <meta>', () => {
    expect(charsetFromContentType('text/html; charset="ISO-8859-1"')).toBe('iso-8859-1');
    expect(charsetFromContentType('text/html')).toBeNull();
    const enc = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'));
    expect(sniffCharset(enc('<meta charset="windows-1252"><title>x</title>'))).toBe('windows-1252');
    expect(sniffCharset(enc('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-15">'))).toBe('iso-8859-15');
    expect(sniffCharset(new Uint8Array([0xef, 0xbb, 0xbf, 0x3c]))).toBe('utf-8');
    expect(sniffCharset(enc('<p>nada</p>'))).toBeNull();
  });

  it('decoderFor cae a UTF-8 con etiquetas desconocidas', () => {
    expect(decoderFor('no-existe').encoding).toBe('utf-8');
    expect(decoderFor('latin1').decode(new Uint8Array([0xf1]))).toBe('ñ');
  });
});

describe('magic bytes de favicons', () => {
  it('reconoce PNG, ICO, GIF, JPEG y WebP y rechaza SVG y otros', () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImageType(new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16]))).toBe('image/x-icon');
    expect(sniffImageType(new Uint8Array(Buffer.from('GIF89a......')))).toBe('image/gif');
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(new Uint8Array(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')))).toBe('image/webp');
    expect(sniffImageType(new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')))).toBeNull();
    expect(sniffImageType(new Uint8Array(Buffer.from('<?xml version="1.0"?><svg/>')))).toBeNull();
    expect(sniffImageType(new Uint8Array(Buffer.from('<html>')))).toBeNull();
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
  });
});
