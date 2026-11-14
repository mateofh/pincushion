// Servidor de "sitios externos" para e2e (en localhost, otro sitio que la app).
// Páginas: /articulo, /bloqueado (403), /lento, /enorme, /redirige-a-privada, /documento.pdf, /csp-estricta.
// Rutas añadidas por integraciones: /articulo-gzip, /bomba-gzip, /error-500, /redirige-bucle, /redirige-a-loopback,
// /redirige-a-articulo, /latin1, /latin1-meta, /og, /con-icono-svg, /icono.svg, /icono-falso.png, /favicon.ico.
// El stream de integraciones/QA puede añadir más rutas; mantener las existentes.
// Se puede importar (createSiteServer) desde pruebas de integración o ejecutar directamente (escucha en SITE_PORT).
import http from 'node:http';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

// PNG 1×1 azul válido.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function page(title: string, description: string, body: string, extraHead = ''): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title}</title>
<meta name="description" content="${description}"><link rel="icon" href="/icono.png">${extraHead}</head>
<body><header><nav>Menú del sitio</nav></header><main><article><h1>${title}</h1>${body}</article></main>
<footer>Pie del sitio</footer><script>document.title = 'cambiado por script';</script></body></html>`;
}

const ARTICLE_BODY =
  '<p>Este artículo explica cómo hornear pan en casa.</p>' +
  '<p>El truco que casi nadie cuenta es la fermentación lenta en frío durante toda la noche, que desarrolla sabor.</p>' +
  '<p>También hablamos de hidratación, harinas y temperatura del horno.</p>';

// ICO mínimo (cabecera ICONDIR + una entrada); basta para la verificación por magic bytes.
const ICO = Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 22, 0, 0, 0, 22, 0, 0, 0, 0, 0]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script><rect width="1" height="1"/></svg>';

let bomb: Buffer | undefined;
/** 20 MB de ceros comprimidos con gzip (~20 KB en la red). */
function gzipBomb(): Buffer {
  bomb ??= zlib.gzipSync(Buffer.alloc(20 * 1024 * 1024, 0x20), { level: 9 });
  return bomb;
}

export function createSiteServer(): http.Server {
  return http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const send = (status: number, type: string, body: string | Buffer, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'Content-Type': type, ...headers });
    res.end(body);
  };
  switch (url.pathname) {
    case '/salud':
      return send(200, 'text/plain', 'ok');
    case '/articulo':
    case '/articulo-2':
    case '/articulo-3':
      return send(200, 'text/html; charset=utf-8', page('Pan de masa madre en casa', 'Guía práctica para hornear pan con masa madre.', ARTICLE_BODY));
    case '/csp-estricta':
      return send(
        200,
        'text/html; charset=utf-8',
        page('Página con CSP estricta', 'Una página que restringe scripts y formularios.', ARTICLE_BODY),
        { 'Content-Security-Policy': "default-src 'self'; form-action 'self'; script-src 'self'" },
      );
    case '/icono.png':
      return send(200, 'image/png', PNG, { 'Cache-Control': 'no-store' });
    case '/bloqueado':
      return send(403, 'text/html; charset=utf-8', '<!doctype html><title>Acceso denegado</title><h1>403</h1>');
    case '/lento':
      setTimeout(() => send(200, 'text/html; charset=utf-8', page('Lento', 'Tarda mucho', '<p>lento</p>')), 10_000).unref();
      return;
    case '/enorme':
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.write('<!doctype html><title>Enorme</title><p>');
      for (let i = 0; i < 400; i++) res.write('x'.repeat(10_000));
      return res.end('</p>');
    case '/redirige-a-privada':
      res.writeHead(302, { Location: 'http://127.0.0.1:1/privado' });
      return res.end();
    case '/documento.pdf':
      return send(200, 'application/pdf', '%PDF-1.4 fake');
    case '/articulo-gzip':
      return send(200, 'text/html; charset=utf-8', zlib.gzipSync(page('Pan comprimido', 'Servido con gzip.', ARTICLE_BODY)), {
        'Content-Encoding': 'gzip',
      });
    case '/bomba-gzip':
      return send(200, 'text/html; charset=utf-8', gzipBomb(), { 'Content-Encoding': 'gzip' });
    case '/error-500':
      return send(500, 'text/html; charset=utf-8', '<!doctype html><title>Error</title><h1>500</h1>');
    case '/redirige-bucle':
      res.writeHead(302, { Location: '/redirige-bucle' });
      return res.end();
    case '/redirige-a-loopback':
      res.writeHead(302, { Location: 'http://127.0.0.1/privado' });
      return res.end();
    case '/redirige-a-articulo':
      res.writeHead(301, { Location: '/articulo' });
      return res.end();
    case '/latin1':
      return send(
        200,
        'text/html; charset=ISO-8859-1',
        Buffer.from('<!doctype html><title>Canción de otoño</title><p>Añoranza y café en la montaña.</p>', 'latin1'),
      );
    case '/latin1-meta':
      return send(
        200,
        'text/html',
        Buffer.from('<!doctype html><head><meta charset="iso-8859-1"><title>Niño pequeño</title></head><p>Pingüino.</p>', 'latin1'),
      );
    case '/og':
      return send(
        200,
        'text/html; charset=utf-8',
        '<!doctype html><html><head><title>Título del documento</title>' +
          '<meta property="og:title" content="Título &amp; Open Graph">' +
          '<meta property="og:description" content="Descripción OG">' +
          '<meta name="twitter:description" content="Descripción Twitter">' +
          '<link rel="apple-touch-icon" href="/apple.png"><link rel="shortcut icon" href="img/icono.png?v=2">' +
          '</head><body><nav>Inicio Blog</nav><div>Texto suelto fuera del artículo.</div>' +
          '<article><p>Primer&nbsp;párrafo   con &lt;entidades&gt;.</p><aside>Publicidad</aside><p>Segundo párrafo.</p></article>' +
          '<form><input name="q"> Buscar</form></body></html>',
      );
    case '/con-icono-svg':
      return send(
        200,
        'text/html; charset=utf-8',
        '<!doctype html><title>Icono vectorial</title><link rel="icon" href="/icono.svg" type="image/svg+xml"><p>Solo declara un SVG.</p>',
      );
    case '/icono.svg':
      return send(200, 'image/svg+xml', SVG);
    case '/icono-falso.png':
      return send(200, 'image/png', SVG);
    case '/favicon.ico':
      return send(200, 'image/x-icon', ICO);
    default:
      return send(404, 'text/plain', 'no existe');
  }
  });
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.SITE_PORT ?? 4411);
  createSiteServer().listen(port, 'localhost', () => {
    process.stdout.write(`site-server en http://localhost:${port}\n`);
  });
}
