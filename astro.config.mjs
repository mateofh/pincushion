// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'middleware' }),
  outDir: process.env.ASTRO_OUT_DIR ?? './dist',
  server: { host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 4321) },
  // El chequeo de origen lo hace src/middleware.ts (con nuestra página 403 y request id).
  security: { checkOrigin: false },
  trailingSlash: 'never',
  build: { inlineStylesheets: 'never' },
  devToolbar: { enabled: false },
  vite: {
    build: { assetsInlineLimit: 0 },
    ssr: { external: ['node:sqlite'] },
  },
});
