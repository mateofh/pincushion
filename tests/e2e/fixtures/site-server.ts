// Servidor de "sitios externos" para e2e (en localhost, otro sitio que la app).
// Páginas: /articulo, /bloqueado (403), /lento, /enorme, /redirige-a-privada, /documento.pdf, /csp-estricta.
// El stream de integraciones/QA puede añadir más rutas; mantener las existentes.
import http from 'node:http';

const port = Number(process.env.SITE_PORT ?? 4411);

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

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
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
    default:
      return send(404, 'text/plain', 'no existe');
  }
});

server.listen(port, 'localhost', () => {
  process.stdout.write(`site-server en http://localhost:${port}\n`);
});
