import { defineConfig, devices } from '@playwright/test';

// App en 127.0.0.1 y sitio de fixtures en localhost: sitios distintos, sin cookies compartidas.
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 4410);
const SITE_PORT = Number(process.env.E2E_SITE_PORT ?? 4411);
export const APP_URL = `http://127.0.0.1:${APP_PORT}`;
export const SITE_URL = `http://localhost:${SITE_PORT}`;
const DB = process.env.E2E_DATABASE_PATH ?? `./test-results/e2e-${APP_PORT}.db`;

process.env.E2E_DATABASE_PATH = DB;
process.env.E2E_APP_URL = APP_URL;
process.env.E2E_SITE_URL = SITE_URL;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/artifacts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: APP_URL,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: process.env.CI ? 'on-first-retry' : 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } }, grepInvert: process.env.NOCTURNO ? /@solo-movil|@solo-sin-js/ : /@solo-movil|@solo-sin-js|@nocturno/ },
    { name: 'movil', use: { ...devices['Pixel 7'] }, grep: /@movil/, grepInvert: process.env.NOCTURNO ? undefined : /@nocturno/ },
    { name: 'sin-js', use: { ...devices['Desktop Chrome'], javaScriptEnabled: false }, grep: /@sin-js/, grepInvert: /@nocturno/ },
  ],
  webServer: [
    {
      command: `node tests/e2e/fixtures/site-server.ts`,
      url: `${SITE_URL}/salud`,
      reuseExistingServer: false,
      env: { SITE_PORT: String(SITE_PORT) },
    },
    {
      command: `node scripts/e2e-reset-db.ts && node server/entry.mjs`,
      url: `${APP_URL}/healthz`,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        PORT: String(APP_PORT),
        HOST: '127.0.0.1',
        APP_ORIGIN: APP_URL,
        APP_SECRET: 'e2e-secret-0123456789abcdef0123456789abcdef',
        DATABASE_PATH: DB,
        LOG_LEVEL: 'warn',
        PINCUSHION_TEST_MODE: '1',
        METADATA_TEST_HOSTS: `localhost:${SITE_PORT}`,
        METADATA_TIMEOUT_MS: '3000',
        RATE_LIMIT_LOGIN_PER_MIN: '1000',
        ASTRO_OUT_DIR: process.env.ASTRO_OUT_DIR ?? '',
      },
    },
  ],
});
