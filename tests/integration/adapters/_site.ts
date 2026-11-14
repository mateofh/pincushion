// Arranca el servidor de fixtures en 127.0.0.1 con un puerto libre y da una config de fetcher en modo test.
import type { AddressInfo } from 'node:net';
import { createSiteServer } from '../../e2e/fixtures/site-server.ts';
import { loadConfig, type Config } from '../../../src/server/config.ts';

export interface Site {
  port: number;
  origin: string;
  url(path: string): string;
  close(): Promise<void>;
}

export async function startSite(): Promise<Site> {
  const server = createSiteServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  return {
    port,
    origin,
    url: (path) => origin + path,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function testEnv(site: Site, extra: Record<string, string> = {}): Record<string, string> {
  return {
    APP_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
    DATABASE_PATH: ':memory:',
    PINCUSHION_TEST_MODE: '1',
    METADATA_TEST_HOSTS: `127.0.0.1:${site.port}`,
    METADATA_TIMEOUT_MS: '3000',
    ...extra,
  };
}

export function siteConfig(site: Site, extra: Record<string, string> = {}): Config {
  return loadConfig(testEnv(site, extra));
}
