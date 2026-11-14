// Servidor de producción: sirve dist/client, delega en Astro y apaga ordenadamente.
// El worker de jobs arranca de forma perezosa desde la app en la primera petición (getApp).
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sirv from 'sirv';

const root = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.ASTRO_OUT_DIR ? join(process.cwd(), process.env.ASTRO_OUT_DIR) : join(root, '..', 'dist');
const { handler } = await import(join(outDir, 'server', 'entry.mjs'));

const assets = sirv(join(outDir, 'client'), {
  etag: true,
  setHeaders(res, path) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (path.startsWith('/_astro/') || path.startsWith('/vendor/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  },
});

const port = Number(process.env.PORT ?? 4321);
const host = process.env.HOST ?? '127.0.0.1';

const server = http.createServer((req, res) => {
  assets(req, res, () => handler(req, res));
});
server.headersTimeout = 20_000;
server.requestTimeout = 30_000;

server.listen(port, host, () => {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'server.listening', host, port }) + '\n');
});

function shutdown(signal) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'server.shutdown', signal }) + '\n');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
