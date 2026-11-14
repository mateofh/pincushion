import { describe, expect, it } from 'vitest';
import { HIGHLIGHT_CLOSE as C, HIGHLIGHT_OPEN as O, escapeHtml, highlightToHtml } from '../../../src/domain/highlight.ts';

/** Después de quitar los <mark> legítimos no puede quedar ningún "<", ">" ni comilla sin escapar. */
function assertSafe(html: string): void {
  const stripped = html.replace(/<\/?mark>/g, '');
  expect(stripped).not.toMatch(/[<>"'`]/);
  // Todo "&" inicia una entidad conocida.
  expect(stripped.replace(/&(amp|lt|gt|quot|#39|#96);/g, '')).not.toContain('&');
  // Las marcas están bien anidadas.
  let depth = 0;
  for (const m of html.matchAll(/<(\/?)mark>/g)) {
    depth += m[1] ? -1 : 1;
    expect(depth === 0 || depth === 1).toBe(true);
  }
  expect(depth).toBe(0);
}

describe('escapeHtml', () => {
  it('escapa los cinco caracteres y el acento grave', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&\`</a>`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&#96;&lt;/a&gt;');
  });
  it('no doble-escapa de forma especial (escapa & de entidades existentes)', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('highlightToHtml', () => {
  it('convierte centinelas en <mark>', () => {
    expect(highlightToHtml(`La ${O}fermentacion lenta${C} mejora`)).toBe('La <mark>fermentacion lenta</mark> mejora');
  });
  it('varias marcas', () => {
    expect(highlightToHtml(`${O}a${C} y ${O}b${C}`)).toBe('<mark>a</mark> y <mark>b</mark>');
  });
  it('cierra una marca sin cerrar y omite cierres huérfanos', () => {
    expect(highlightToHtml(`x ${O}abierta`)).toBe('x <mark>abierta</mark>');
    expect(highlightToHtml(`x${C} y`)).toBe('x y');
  });
  it('no anida marcas', () => {
    expect(highlightToHtml(`${O}a${O}b${C}c${C}`)).toBe('<mark>ab</mark>c');
  });
  it('omite marcas vacías', () => {
    expect(highlightToHtml(`a${O}${C}b`)).toBe('ab');
    expect(highlightToHtml(`${O}`)).toBe('');
  });
  it('vacío o no cadena → cadena vacía', () => {
    expect(highlightToHtml('')).toBe('');
    expect(highlightToHtml(undefined as unknown as string)).toBe('');
  });

  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg/onload=alert(1)>',
    '"><script>alert(1)</script>',
    "'><img src=x onerror=alert(1)>",
    '</mark><script>alert(1)</script><mark>',
    '<mark onclick="alert(1)">x</mark>',
    '<iframe srcdoc="<script>alert(1)</script>">',
    '<a href="javascript:alert(1)">x</a>',
    '&lt;script&gt;alert(1)&lt;/script&gt;',
    '&#60;script&#62;',
    '<!--',
    ']]><script>',
    '<style>*{}</style>',
    '`${alert(1)}`',
    '<math><mi xlink:href="javascript:alert(1)">',
    '\u0000<script>',
    '<scr\u0000ipt>',
    '\ud800<b>',
    '<\u200bscript>',
    '＜script＞',
  ];

  it.each(payloads)('neutraliza %j fuera de la marca', (p) => {
    const html = highlightToHtml(`antes ${p} después`);
    assertSafe(html);
  });

  it.each(payloads)('neutraliza %j dentro de la marca', (p) => {
    const html = highlightToHtml(`${O}${p}${C}`);
    assertSafe(html);
    expect(html.startsWith('<mark>')).toBe(true);
  });

  it.each(payloads)('neutraliza %j con centinelas intercalados', (p) => {
    const chars = [...p];
    const mixed = chars.map((c, i) => (i % 3 === 0 ? `${O}${c}` : i % 3 === 1 ? `${c}${C}` : c)).join('');
    assertSafe(highlightToHtml(mixed));
  });

  it('quita caracteres de control y surrogates sueltos', () => {
    expect(highlightToHtml('a\u0000b\u0007c\u007fd')).toBe('abcd');
    expect(highlightToHtml('a\ud800b')).toBe('a�b');
    expect(highlightToHtml('a\tb\nc')).toBe('a\tb\nc');
  });

  it('fuzz: texto aleatorio con caracteres peligrosos y centinelas siempre es seguro', () => {
    const alphabet = ['<', '>', '"', "'", '`', '&', '/', '=', 'a', ' ', O, C, '\u0000', 'é', '🍞', ';', '#'];
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 500; i++) {
      const len = Math.floor(rnd() * 40);
      let s = '';
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      assertSafe(highlightToHtml(s));
    }
  });
});
