// Fixtures de Playwright: crea un usuario propio por test directamente en la DB de e2e y abre sesión por la UI.
import { test as base, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { openDb, type Db } from '../../../src/server/db/sqlite.ts';
import { hashPassword } from '../../../src/server/crypto.ts';
import { createApp, type App } from '../../../src/server/context.ts';
import { createFakeFetcher } from '../../../src/server/adapters/fake-fetcher.ts';
import { bookmarkService } from '../../../src/server/services/bookmarks.ts';
import type { Bookmark, SaveInput } from '../../../src/server/contracts.ts';

export const APP_URL = process.env.E2E_APP_URL!;
export const SITE_URL = process.env.E2E_SITE_URL!;
export const PASSWORD = 'contraseña-e2e-segura';

let db: Db | undefined;
let hash: Promise<string> | undefined;

/** Acceso directo a la DB de e2e (WAL permite leer/escribir mientras corre la app). */
export function e2eDb(): Db {
  db ??= openDb(process.env.E2E_DATABASE_PATH!);
  return db;
}

export interface Owner {
  id: number;
  email: string;
  password: string;
}

export async function createOwner(prefix = 'owner'): Promise<Owner> {
  hash ??= hashPassword(PASSWORD);
  const email = `${prefix}-${randomUUID().slice(0, 8)}@example.com`;
  const now = Date.now();
  const id = e2eDb().run(
    'INSERT INTO users (email, password_hash, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    email, await hash, 'Europe/Madrid', now, now,
  ).lastInsertRowid;
  return { id, email, password: PASSWORD };
}

export async function login(page: Page, owner: Owner, next = '/'): Promise<void> {
  await page.goto(`/entrar?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Contraseña').fill(owner.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/entrar'));
}

let serviceApp: App | undefined;

/** App mínima sobre la DB de e2e para crear datos con los servicios reales (no por la UI). */
export function e2eApp(): App {
  serviceApp ??= createApp({
    env: { APP_SECRET: 'e2e-secret-0123456789abcdef0123456789abcdef', APP_ORIGIN: APP_URL, DATABASE_PATH: ':memory:', LOG_LEVEL: 'silent', JOBS_INLINE_WORKER: 'false' },
    db: e2eDb(),
    fetcher: createFakeFetcher(),
  });
  return serviceApp;
}

export interface SeedBookmark extends SaveInput {
  /** Texto para la búsqueda (se escribe tal cual, como si lo hubiera obtenido el fetch). */
  excerpt?: string;
  fetchStatus?: 'pending' | 'retrying' | 'succeeded' | 'failed' | 'skipped';
  trashed?: boolean;
}

/** Crea enlaces para un dueño con el servicio real. Por defecto quedan con fetch 'succeeded' para no depender de la red. */
export function seedBookmarks<const T extends SeedBookmark[]>(owner: Owner, items: T): { [K in keyof T]: Bookmark } {
  const app = e2eApp();
  const svc = bookmarkService(app);
  const out = items.map((item) => {
    const { bookmark } = svc.save(owner.id, item, 'web');
    app.db.run(
      'UPDATE bookmarks SET excerpt = ?, fetch_status = ?, next_attempt_at = NULL, trashed_at = ? WHERE id = ? AND user_id = ?',
      item.excerpt ?? bookmark.excerpt, item.fetchStatus ?? 'succeeded', item.trashed ? Date.now() : null, bookmark.id, owner.id,
    );
    return svc.get(owner.id, bookmark.id) ?? bookmark;
  });
  return out as { [K in keyof T]: Bookmark };
}

export const test = base.extend<{ owner: Owner; signedIn: Page }>({
  owner: async ({}, use) => {
    await use(await createOwner());
  },
  signedIn: async ({ page, owner }, use) => {
    await login(page, owner);
    await use(page);
  },
});

export { expect };
