import { describe, expect, it } from 'vitest';
import { InvalidUrlError, MAX_URL_LENGTH, URL_MESSAGES, domainOf, normalizeUrl, parseUserUrl, unsavableReason } from '../../../src/domain/url.ts';

const key = (s: string) => normalizeUrl(parseUserUrl(s));

describe('parseUserUrl', () => {
  it.each([
    ['example.com', 'https://example.com/'],
    ['  example.com/a  ', 'https://example.com/a'],
    ['http://example.com', 'http://example.com/'],
    ['HTTPS://Example.COM/Path', 'https://example.com/Path'],
    ['example.com:8080/x', 'https://example.com:8080/x'],
    ['localhost:3000', 'https://localhost:3000/'],
    ['http://localhost/a', 'http://localhost/a'],
    ['//example.com/p', 'https://example.com/p'],
    ['http://Bücher.example/', 'http://xn--bcher-kva.example/'],
    ['https://例え.jp/', 'https://xn--r8jz45g.jp/'],
    ['http://192.168.1.10/x', 'http://192.168.1.10/x'],
    ['http://[::1]:8080/', 'http://[::1]:8080/'],
    ['https://example.com./', 'https://example.com./'],
  ])('%s → %s', (input, href) => {
    expect(parseUserUrl(input).href).toBe(href);
  });

  it.each([
    ['javascript:alert(1)'],
    ['JavaScript:alert(document.cookie)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['file:///etc/passwd'],
    ['about:blank'],
    ['chrome://settings'],
    ['blob:https://example.com/uuid'],
    ['ftp://example.com/file'],
    ['mailto:a@example.com'],
    ['view-source:https://example.com'],
    ['chrome-extension://abc/page.html'],
  ])('rechaza el esquema de %s', (input) => {
    expect(() => parseUserUrl(input)).toThrow(InvalidUrlError);
    expect(() => parseUserUrl(input)).toThrow(URL_MESSAGES.scheme);
  });

  it('rechaza credenciales en la URL', () => {
    expect(() => parseUserUrl('https://user:pass@example.com/')).toThrow(URL_MESSAGES.credentials);
    expect(() => parseUserUrl('https://user@example.com/')).toThrow(URL_MESSAGES.credentials);
  });

  it.each(['http://intranet/', 'servidor', 'http://a..b/', 'http://./', 'http://.example.com/'])('rechaza el host sin dominio completo %s', (input) => {
    expect(() => parseUserUrl(input)).toThrow(InvalidUrlError);
  });

  it('rechaza vacío, espacios internos y caracteres de control', () => {
    expect(() => parseUserUrl('')).toThrow(URL_MESSAGES.empty);
    expect(() => parseUserUrl('   ')).toThrow(URL_MESSAGES.empty);
    expect(() => parseUserUrl('https://exa mple.com')).toThrow(InvalidUrlError);
    expect(() => parseUserUrl('https://example.com/\u0000')).toThrow(InvalidUrlError);
    expect(() => parseUserUrl('https://example.com/\u202e')).toThrow(InvalidUrlError);
    expect(() => parseUserUrl('https://example.com/a\nb')).toThrow(InvalidUrlError);
    expect(() => parseUserUrl('http://')).toThrow(InvalidUrlError);
  });

  it('aplica el límite de longitud a la entrada y a la forma serializada', () => {
    const ok = `https://example.com/${'a'.repeat(MAX_URL_LENGTH - 'https://example.com/'.length)}`;
    expect(parseUserUrl(ok).href).toHaveLength(MAX_URL_LENGTH);
    expect(() => parseUserUrl(`${ok}a`)).toThrow(URL_MESSAGES.tooLong);
    // Cabe como entrada pero crece al codificarse (é → %C3%A9).
    const grows = `https://example.com/${'é'.repeat(1000)}`;
    expect(grows.length).toBeLessThan(MAX_URL_LENGTH);
    expect(() => parseUserUrl(grows)).toThrow(URL_MESSAGES.tooLong);
  });

  it('los mensajes de error están en español', () => {
    for (const m of Object.values(URL_MESSAGES)) expect(m).toMatch(/[a-záéíóúñ]/i);
    try {
      parseUserUrl('javascript:alert(1)');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidUrlError);
      expect((e as Error).name).toBe('InvalidUrlError');
    }
  });
});

describe('normalizeUrl', () => {
  it('http://www.Example.com/a/?utm_source=x#frag y https://example.com/a dan la misma clave', () => {
    expect(key('http://www.Example.com/a/?utm_source=x#frag')).toBe(key('https://example.com/a'));
    expect(key('https://example.com/a')).toBe('example.com/a');
  });

  it('?b=2&a=1 == ?a=1&b=2', () => {
    expect(key('https://example.com/p?b=2&a=1')).toBe(key('https://example.com/p?a=1&b=2'));
    expect(key('https://example.com/p?b=2&a=1')).toBe('example.com/p?a=1&b=2');
  });

  it.each([
    // [entrada, clave]
    ['https://example.com', 'example.com'],
    ['https://example.com/', 'example.com'],
    ['https://example.com///', 'example.com'],
    ['https://example.com/a/b/', 'example.com/a/b'],
    ['https://www.example.com/a', 'example.com/a'],
    ['https://WWW.EXAMPLE.COM/A', 'example.com/A'],
    ['https://www.com/', 'www.com'],
    ['https://www2.example.com/', 'www2.example.com'],
    ['https://example.com./a', 'example.com/a'],
    ['http://example.com:80/a', 'example.com/a'],
    ['https://example.com:443/a', 'example.com/a'],
    ['https://example.com:8443/a', 'example.com:8443/a'],
    ['http://example.com:443/a', 'example.com:443/a'],
    ['https://example.com/Ruta/CON/Mayusculas', 'example.com/Ruta/CON/Mayusculas'],
    ['https://example.com/a/./b/../c', 'example.com/a/c'],
    ['https://example.com/%7Euser/%41bc', 'example.com/~user/Abc'],
    ['https://example.com/a%2fb', 'example.com/a%2Fb'],
    ['https://example.com/caf%c3%a9', 'example.com/caf%C3%A9'],
    ['https://example.com/café', 'example.com/caf%C3%A9'],
    ['https://example.com/a#seccion', 'example.com/a'],
    ['https://example.com/#!/inbox/', 'example.com#!/inbox'],
    ['https://app.example.com/#/settings', 'app.example.com#/settings'],
    ['https://app.example.com/#/', 'app.example.com'],
    ['https://app.example.com/#!', 'app.example.com'],
    ['https://example.com/?', 'example.com'],
    ['https://example.com/?utm_source=a&utm_medium=b&UTM_Campaign=c', 'example.com'],
    ['https://example.com/?fbclid=1&gclid=2&dclid=3&msclkid=4&mc_cid=5&mc_eid=6&igshid=7&ref_src=8&_hsenc=9&_hsmi=10&yclid=11&q=ok', 'example.com?q=ok'],
    ['https://example.com/?q=a+b', 'example.com?q=a+b'],
    ['https://example.com/?q=a%20b', 'example.com?q=a+b'],
    ['https://example.com/?q=a%2Bb', 'example.com?q=a%2Bb'],
    ['https://example.com/?a=2&a=1', 'example.com?a=2&a=1'],
    ['https://example.com/?z=1&a=2&a=1', 'example.com?a=2&a=1&z=1'],
    ['https://example.com/?flag', 'example.com?flag='],
    ['https://Bücher.example/x', 'xn--bcher-kva.example/x'],
    ['https://github.com/o/r/blob/main/x?ref=dev', 'github.com/o/r/blob/main/x?ref=dev'],
    ['https://example.com/?si=keep', 'example.com?si=keep'],
    ['https://www.youtube.com/watch?v=abc&si=XYZ&feature=share', 'youtube.com/watch?v=abc'],
    ['https://youtu.be/abc?si=XYZ', 'youtu.be/abc'],
    ['https://open.spotify.com/track/1?si=abc', 'open.spotify.com/track/1'],
    ['http://[::1]:8080/a/', '[::1]:8080/a'],
  ])('%s → %s', (input, expected) => {
    expect(key(input)).toBe(expected);
  });

  it('http y https son equivalentes', () => {
    expect(key('http://example.com/x?y=1')).toBe(key('https://example.com/x?y=1'));
  });

  it('el path distingue mayúsculas; el host no', () => {
    expect(key('https://EXAMPLE.com/A')).toBe(key('https://example.com/A'));
    expect(key('https://example.com/A')).not.toBe(key('https://example.com/a'));
  });

  it('es idempotente sobre su propia salida reinterpretada como URL', () => {
    for (const s of ['https://www.example.com/a/?b=2&a=1&utm_x=1#!/r/', 'http://example.com:8080/%7Ex?q=a%20b']) {
      const k = key(s);
      expect(key(`https://${k}`)).toBe(k);
    }
  });
});

describe('domainOf', () => {
  it.each([
    ['https://www.Example.com/a', 'example.com'],
    ['https://sub.example.com/', 'sub.example.com'],
    ['https://example.com./', 'example.com'],
    ['https://www.com/', 'www.com'],
    ['http://Bücher.example', 'xn--bcher-kva.example'],
    ['http://localhost:3000', 'localhost'],
  ])('%s → %s', (input, expected) => {
    expect(domainOf(parseUserUrl(input))).toBe(expected);
  });
});

describe('unsavableReason', () => {
  it.each([
    ['https://example.com/a'],
    ['http://localhost:4420/articulo'],
    ['example.com'],
  ])('%s se puede guardar', (input) => {
    expect(unsavableReason(input)).toBeNull();
  });

  it.each([
    ['about:blank', /internas del navegador/],
    ['about:newtab', /internas del navegador/],
    ['chrome://extensions', /internas del navegador/],
    ['edge://settings', /internas del navegador/],
    ['file:///Users/ana/doc.pdf', /archivos de tu equipo/],
    ['chrome-extension://abc/popup.html', /extensiones/],
    ['moz-extension://abc/page.html', /extensiones/],
    ['data:text/html,hola', /no tiene una dirección web/],
    ['blob:https://example.com/123', /no tiene una dirección web/],
    ['javascript:void(0)', /no tiene una dirección web/],
    ['view-source:https://example.com', /view-source/],
    ['ftp://example.com/x', /http o https/],
    ['mailto:a@b.com', /http o https/],
    ['', /No llegó la dirección/],
    ['https://user:pw@example.com', /usuario o contraseña/],
    ['http://intranet/', /dominio completo/],
  ])('%s → mensaje', (input, re) => {
    const r = unsavableReason(input);
    expect(r).not.toBeNull();
    expect(r).toMatch(re);
  });

  it('nunca lanza', () => {
    for (const s of ['%%%', 'http://[', '\u0000', 'a'.repeat(5000), undefined as unknown as string]) {
      expect(() => unsavableReason(s)).not.toThrow();
      expect(typeof unsavableReason(s)).toBe('string');
    }
  });
});
