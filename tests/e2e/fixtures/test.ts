// Fixtures de Playwright: crea un usuario propio por test directamente en la DB de e2e y abre sesión por la UI.
import { test as base, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { openDb, type Db } from '../../../src/server/db/sqlite.ts';
import { hashPassword } from '../../../src/server/crypto.ts';

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
