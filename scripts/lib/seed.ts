// Lógica del seed de demostración. Idempotente por clave natural:
// usuarios por email, colecciones y etiquetas por (user_id, name_key), enlaces por (user_id, normalized_url).
// Un enlace que ya existe no se toca (ni sus etiquetas), así que re-ejecutar no duplica ni pisa ediciones.
import type { Db } from '../../src/server/db/sqlite.ts';
import { domainOf, normalizeUrl, parseUserUrl } from '../../src/domain/url.ts';
import { tagKey } from '../../src/domain/tags.ts';
import { collectionKey } from '../../src/domain/bookmark-rules.ts';
import { randomToken } from '../../src/server/crypto.ts';
import { DEMO_TIMEZONE, DEMO_USERS, type SeedBookmark, type SeedUser } from './seed-data.ts';

const DAY = 86_400_000;

export interface SeedOptions {
  now: number;
  /** Hash de la contraseña demo (scrypt), calculado fuera para no repetirlo. */
  passwordHash: string;
  /** Borra antes todos los datos de los usuarios demo. */
  reset: boolean;
  users?: readonly SeedUser[];
}

export interface SeedUserSummary {
  email: string;
  userId: number;
  createdUser: boolean;
  bookmarksInserted: number;
  bookmarks: number;
  collections: number;
  tags: number;
}

export interface SeedSummary {
  removedUsers: number;
  users: SeedUserSummary[];
}

/** Borra los datos de los usuarios demo (y los propios usuarios). Devuelve cuántos usuarios borró. */
export function resetDemoUsers(db: Db, emails: readonly string[]): number {
  let removed = 0;
  for (const email of emails) {
    const u = db.get<{ id: number }>('SELECT id FROM users WHERE email = ?', email);
    if (!u) continue;
    // Orden explícito (los enlaces referencian colecciones sin ON DELETE).
    db.run('DELETE FROM bookmarks WHERE user_id = ?', u.id); // bookmark_tags en cascada; FTS por trigger
    db.run('DELETE FROM tags WHERE user_id = ?', u.id);
    db.run('DELETE FROM collections WHERE user_id = ?', u.id);
    db.run('DELETE FROM bookmarklet_tokens WHERE user_id = ?', u.id);
    db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    db.run('DELETE FROM favicons WHERE user_id = ?', u.id);
    db.run('DELETE FROM users WHERE id = ?', u.id); // audit_events en cascada
    removed++;
  }
  return removed;
}

function fetchColumns(b: SeedBookmark, createdAt: number, now: number) {
  const f = b.fetch ?? { status: 'succeeded' as const };
  switch (f.status) {
    case 'succeeded':
      return { status: 'succeeded', code: null, attempts: 1, next: null, fetchedAt: createdAt + 4_000 };
    case 'skipped':
      return { status: 'skipped', code: 'not_html', attempts: 1, next: null, fetchedAt: createdAt + 2_000 };
    case 'failed':
      return { status: 'failed', code: f.code, attempts: f.attempts, next: null, fetchedAt: null };
    case 'retrying':
      return { status: 'retrying', code: f.code, attempts: f.attempts, next: now + f.retryInMs, fetchedAt: null };
  }
}

function seedUser(db: Db, spec: SeedUser, opts: SeedOptions): SeedUserSummary {
  const { now } = opts;
  const existing = db.get<{ id: number }>('SELECT id FROM users WHERE email = ?', spec.email);
  const userId =
    existing?.id ??
    db.run(
      'INSERT INTO users (email, password_hash, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      spec.email,
      opts.passwordHash,
      DEMO_TIMEZONE,
      now - 180 * DAY,
      now,
    ).lastInsertRowid;

  const collectionIds = new Map<string, number>();
  for (const name of spec.collections) {
    const key = collectionKey(name);
    db.run(
      'INSERT INTO collections (user_id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, name_key) DO NOTHING',
      userId, name, key, now - 175 * DAY, now - 175 * DAY,
    );
    collectionIds.set(name, db.get<{ id: number }>('SELECT id FROM collections WHERE user_id = ? AND name_key = ?', userId, key)!.id);
  }

  const tagIds = new Map<string, number>();
  const tagId = (name: string): number => {
    const key = tagKey(name);
    const cached = tagIds.get(key);
    if (cached !== undefined) return cached;
    db.run('INSERT INTO tags (user_id, name, name_key, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, name_key) DO NOTHING', userId, name, key, now - 175 * DAY);
    const id = db.get<{ id: number }>('SELECT id FROM tags WHERE user_id = ? AND name_key = ?', userId, key)!.id;
    tagIds.set(key, id);
    return id;
  };

  let inserted = 0;
  for (const b of spec.bookmarks) {
    const u = parseUserUrl(b.url);
    const normalized = normalizeUrl(u);
    if (db.get('SELECT 1 FROM bookmarks WHERE user_id = ? AND normalized_url = ?', userId, normalized)) continue;
    const domain = domainOf(u);
    const createdAt = Math.round(now - b.daysAgo * DAY);
    const trashedAt = b.trashedDaysAgo === undefined ? null : now - b.trashedDaysAgo * DAY;
    if (trashedAt !== null && trashedAt <= createdAt) throw new Error(`Seed inconsistente: ${b.url} va a la papelera antes de crearse`);
    const f = fetchColumns(b, createdAt, now);
    const collectionId = b.collection === undefined ? null : collectionIds.get(b.collection);
    if (collectionId === undefined) throw new Error(`Seed inconsistente: colección desconocida ${b.collection}`);
    const title = b.titleSource === 'fallback' ? domain : b.title;
    const id = db.run(
      `INSERT INTO bookmarks (user_id, url, normalized_url, domain, title, title_source, description, excerpt, collection_id, is_favorite,
         fetch_status, fetch_error_code, fetch_attempts, next_attempt_at, fetched_at, created_at, updated_at, trashed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId, u.toString(), normalized, domain, title, b.titleSource, b.description, b.excerpt, collectionId, b.favorite ? 1 : 0,
      f.status, f.code, f.attempts, f.next, f.fetchedAt, createdAt, trashedAt ?? f.fetchedAt ?? createdAt, trashedAt,
    ).lastInsertRowid;
    for (const t of b.tags) {
      db.run('INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id, user_id) VALUES (?, ?, ?)', id, tagId(t), userId);
    }
    inserted++;
  }

  if (spec.revokedTokenDaysAgo !== undefined && !db.get('SELECT 1 FROM bookmarklet_tokens WHERE user_id = ?', userId)) {
    const revokedAt = now - spec.revokedTokenDaysAgo * DAY;
    db.run(
      'INSERT INTO bookmarklet_tokens (id, user_id, created_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?)',
      randomToken(16), userId, revokedAt - 90 * DAY, revokedAt - 2 * DAY, revokedAt,
    );
  }

  const count = (sql: string) => db.get<{ n: number }>(sql, userId)!.n;
  return {
    email: spec.email,
    userId,
    createdUser: !existing,
    bookmarksInserted: inserted,
    bookmarks: count('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ?'),
    collections: count('SELECT COUNT(*) AS n FROM collections WHERE user_id = ?'),
    tags: count('SELECT COUNT(*) AS n FROM tags WHERE user_id = ?'),
  };
}

/** Inserta los datos demo en una sola transacción. */
export function seedDemo(db: Db, opts: SeedOptions): SeedSummary {
  const users = opts.users ?? DEMO_USERS;
  return db.transaction(() => {
    const removedUsers = opts.reset ? resetDemoUsers(db, users.map((u) => u.email)) : 0;
    return { removedUsers, users: users.map((u) => seedUser(db, u, opts)) };
  });
}
