// El href del bookmarklet es decodificable, no rompe un atributo HTML y abre la URL correcta.
import { describe, expect, it, vi } from 'vitest';
import { buildBookmarkletHref, bookmarkletCode } from '../../../src/server/auth/bookmarklet.ts';

const TOKEN = 'pc_AAAAAAAAAAAAAAAAAAAAAA.' + 'B'.repeat(43);
const ORIGIN = 'https://pin.example.com';

interface FakeMeta {
  getAttribute(n: string): string | null;
}

function meta(attrs: Record<string, string>): FakeMeta {
  return { getAttribute: (n) => attrs[n] ?? null };
}

function run(href: string, page: { href: string; title: string; metas?: FakeMeta[]; popup?: boolean }) {
  expect(href.startsWith('javascript:')).toBe(true);
  const code = decodeURIComponent(href.slice('javascript:'.length));
  const open = vi.fn((_url: string, _name?: string, _features?: string): object | null => (page.popup === false ? null : {}));
  const location = { href: page.href };
  const document = { title: page.title, getElementsByTagName: (t: string) => (t === 'meta' ? (page.metas ?? []) : []) };
  new Function('window', 'document', 'location', code)({ open }, document, location);
  return { open, location, code };
}

function fragment(url: string): URLSearchParams {
  const u = new URL(url);
  return new URLSearchParams(u.hash.slice(1));
}

describe('bookmarkletHref', () => {
  it('no contiene comillas dobles, saltos de línea, < > ni espacios sin escapar', () => {
    const href = buildBookmarkletHref(ORIGIN, TOKEN);
    expect(href).not.toMatch(/["<>\s\n]/);
    // El código decodificado tampoco usa comillas dobles ni `%` (el navegador decodifica el href).
    const code = bookmarkletCode(ORIGIN, TOKEN);
    expect(code).not.toMatch(/["%\n]/);
    expect(decodeURIComponent(href.slice(11))).toBe(code);
  });

  it('abre /bookmarklet/guardar con token, URL, título y descripción en el fragmento', () => {
    const { open } = run(buildBookmarkletHref(ORIGIN, TOKEN), {
      href: 'https://blog.example.org/post?id=7&x=ñ#parte',
      title: 'Título con "comillas" & <b>marcas</b>',
      metas: [meta({ property: 'og:description', content: 'desde og' }), meta({ name: 'Description', content: 'Descripción meta' })],
    });
    expect(open).toHaveBeenCalledTimes(1);
    const [url, name, features] = open.mock.calls[0]!;
    expect(name).toBe('pincushion');
    expect(features).toBe('width=520,height=640');
    expect(url.startsWith(`${ORIGIN}/bookmarklet/guardar#v=1&t=`)).toBe(true);
    const f = fragment(url);
    expect(f.get('v')).toBe('1');
    expect(f.get('t')).toBe(TOKEN);
    expect(f.get('u')).toBe('https://blog.example.org/post?id=7&x=ñ#parte');
    expect(f.get('ti')).toBe('Título con "comillas" & <b>marcas</b>');
    expect(f.get('de')).toBe('Descripción meta');
  });

  it('usa og:description si no hay meta description y recorta 2048/300/1000', () => {
    const { open } = run(buildBookmarkletHref(ORIGIN, TOKEN), {
      href: 'https://e.com/' + 'a'.repeat(3000),
      title: 'T'.repeat(400),
      metas: [meta({ property: 'og:description', content: 'd'.repeat(1500) })],
    });
    const f = fragment(open.mock.calls[0]![0]);
    expect(f.get('u')!.length).toBe(2048);
    expect(f.get('ti')!.length).toBe(300);
    expect(f.get('de')).toBe('d'.repeat(1000));
  });

  it('no deja un surrogate suelto al recortar (no lanza con emoji en el borde)', () => {
    const { open } = run(buildBookmarkletHref(ORIGIN, TOKEN), { href: 'https://e.com/', title: 'x'.repeat(299) + '😀' });
    const f = fragment(open.mock.calls[0]![0]);
    expect(f.get('ti')).toBe('x'.repeat(299));
  });

  it('sin descripción manda de vacío', () => {
    const { open } = run(buildBookmarkletHref(ORIGIN, TOKEN), { href: 'https://e.com/', title: '' });
    const f = fragment(open.mock.calls[0]![0]);
    expect(f.get('de')).toBe('');
    expect(f.get('ti')).toBe('');
  });

  it('si el popup está bloqueado navega la pestaña actual a la misma URL', () => {
    const { open, location } = run(buildBookmarkletHref(ORIGIN, TOKEN), { href: 'https://e.com/a', title: 'A', popup: false });
    const opened = open.mock.calls[0]![0];
    expect(location.href).toBe(opened);
    expect(fragment(location.href).get('u')).toBe('https://e.com/a');
  });

  it('rechaza tokens con formato raro (no se pueden inyectar en el código)', () => {
    expect(() => buildBookmarkletHref(ORIGIN, "pc_x';alert(1);'")).toThrow();
    expect(() => buildBookmarkletHref('javascript:alert(1)', TOKEN)).toThrow();
  });
});
