// Extracción de metadatos y texto plano de HTML con htmlparser2 en streaming. Nunca ejecuta nada:
// solo tokeniza. Título (og:title > <title>), descripción (description > og:description >
// twitter:description), favicon (rel~=icon > apple-touch-icon > /favicon.ico) y excerpt.
import { Parser } from 'htmlparser2';

export const TITLE_MAX = 300;
export const DESCRIPTION_MAX = 1000;

export interface ExtractResult {
  title: string | null;
  description: string | null;
  excerpt: string;
  faviconUrl: string | null;
}

/** Elementos cuyo contenido no forma parte del texto del artículo. */
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'math', 'nav', 'header', 'footer', 'aside', 'form', 'iframe', 'object', 'canvas', 'select', 'button', 'head']);
/** Elementos en línea: no separan palabras. */
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'del', 'ins']);

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Recorta a `max` caracteres sin partir palabras (salvo una sola palabra más larga que el límite). */
export function truncateWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.5 ? cut.slice(0, space) : s.slice(0, max)).trim();
}

function clean(s: string | null | undefined, max: number): string | null {
  if (s == null) return null;
  const c = truncateWords(collapseWhitespace(s), max);
  return c ? c : null;
}

function resolveHttp(href: string, base: URL): string | null {
  try {
    const u = new URL(href.trim(), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export interface Extractor {
  write(chunk: string): void;
  end(): ExtractResult;
}

/** Crea un extractor incremental. `baseUrl` es la URL final (tras redirecciones). */
export function createExtractor(baseUrl: string | URL, excerptMax: number): Extractor {
  const base = new URL(String(baseUrl));
  // Recolecta hasta un margen: el texto se colapsa al final y luego se recorta.
  const rawCap = excerptMax * 4 + 1024;
  const meta = new Map<string, string>();
  let titleTag: string | null = null;
  let titleBuf: string | null = null;
  let iconHref: string | null = null;
  let appleHref: string | null = null;
  let skipDepth = 0;
  let mainDepth = 0;
  let svgDepth = 0;
  let allText = '';
  let mainText = '';

  const sep = () => {
    if (allText.length < rawCap && !allText.endsWith(' ')) allText += ' ';
    if (mainDepth > 0 && mainText.length < rawCap && !mainText.endsWith(' ')) mainText += ' ';
  };

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        // <title> cuenta en cualquier sitio salvo dentro de <svg>/<math> (que tienen su propio <title>).
        if (name === 'svg' || name === 'math') svgDepth++;
        if (name === 'title' && svgDepth === 0 && titleTag === null && titleBuf === null) titleBuf = '';
        if (name === 'meta') {
          const key = (attribs.property ?? attribs.name ?? '').trim().toLowerCase();
          const content = attribs.content;
          if (key && content != null && !meta.has(key)) meta.set(key, content);
        } else if (name === 'link' && attribs.href) {
          const rel = (attribs.rel ?? '').toLowerCase().split(/\s+/);
          const type = (attribs.type ?? '').toLowerCase();
          const href = attribs.href;
          const isSvg = type.includes('svg') || /\.svgz?(\?|#|$)/i.test(href);
          if (!isSvg && !href.trim().toLowerCase().startsWith('data:')) {
            if (rel.includes('icon') && iconHref === null) iconHref = href;
            else if ((rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) && appleHref === null) appleHref = href;
          }
        }
        if (SKIP.has(name)) skipDepth++;
        if (name === 'article' || name === 'main') mainDepth++;
        if (!INLINE.has(name)) sep();
      },
      onclosetag(name) {
        if (name === 'title' && titleBuf !== null) {
          titleTag = titleBuf;
          titleBuf = null;
        }
        if ((name === 'svg' || name === 'math') && svgDepth > 0) svgDepth--;
        if (SKIP.has(name) && skipDepth > 0) skipDepth--;
        if ((name === 'article' || name === 'main') && mainDepth > 0) mainDepth--;
        if (!INLINE.has(name)) sep();
      },
      ontext(data) {
        if (titleBuf !== null) {
          if (titleBuf.length < TITLE_MAX * 4) titleBuf += data;
          return;
        }
        if (skipDepth > 0) return;
        if (allText.length < rawCap) allText += data;
        if (mainDepth > 0 && mainText.length < rawCap) mainText += data;
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );

  return {
    write(chunk: string) {
      parser.write(chunk);
    },
    end(): ExtractResult {
      parser.end();
      const title = clean(meta.get('og:title'), TITLE_MAX) ?? clean(titleTag, TITLE_MAX);
      const description =
        clean(meta.get('description'), DESCRIPTION_MAX) ??
        clean(meta.get('og:description'), DESCRIPTION_MAX) ??
        clean(meta.get('twitter:description'), DESCRIPTION_MAX);
      const main = collapseWhitespace(mainText);
      const excerpt = truncateWords(main || collapseWhitespace(allText), excerptMax);
      const faviconUrl =
        (iconHref && resolveHttp(iconHref, base)) ?? (appleHref && resolveHttp(appleHref, base)) ?? resolveHttp('/favicon.ico', base);
      return { title, description, excerpt, faviconUrl };
    },
  };
}

/** Atajo para HTML ya decodificado. */
export function extractFromHtml(html: string, baseUrl: string | URL, excerptMax: number): ExtractResult {
  const x = createExtractor(baseUrl, excerptMax);
  x.write(html);
  return x.end();
}

/**
 * Busca la codificación en los primeros bytes (BOM o <meta charset> / http-equiv), como el
 * "prescan" del estándar HTML simplificado. Devuelve la etiqueta o null.
 */
export function sniffCharset(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  const head = Buffer.from(bytes.subarray(0, 2048)).toString('latin1');
  const m =
    /<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_:.-]+)/i.exec(head) ??
    /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([a-z0-9_:.-]+)/i.exec(head);
  return m ? m[1]!.toLowerCase() : null;
}

/** Charset del Content-Type, si lo hay. */
export function charsetFromContentType(ct: string | undefined): string | null {
  const m = /charset\s*=\s*"?([^";\s]+)/i.exec(ct ?? '');
  return m ? m[1]!.toLowerCase() : null;
}

/** TextDecoder para la etiqueta dada, o UTF-8 si no la reconoce. */
export function decoderFor(label: string | null): TextDecoder {
  if (label) {
    try {
      return new TextDecoder(label, { fatal: false });
    } catch {
      /* etiqueta desconocida */
    }
  }
  return new TextDecoder('utf-8', { fatal: false });
}
