// Montaje común de las pruebas de datos: app en memoria, dos usuarios y los cuatro servicios.
import { createTestApp, createUser, type TestApp } from '../../helpers/app.ts';
import { bookmarkService } from '../../../src/server/services/bookmarks.ts';
import { searchService } from '../../../src/server/services/search.ts';
import { collectionService } from '../../../src/server/services/collections.ts';
import { tagService } from '../../../src/server/services/tags.ts';

export async function setup() {
  const app: TestApp = createTestApp();
  const alice = await createUser(app, 'alice@example.com');
  const bob = await createUser(app, 'bob@example.com');
  return {
    app,
    alice,
    bob,
    bookmarks: bookmarkService(app),
    search: searchService(app),
    collections: collectionService(app),
    tags: tagService(app),
  };
}

export type Ctx = Awaited<ReturnType<typeof setup>>;

export function tagNames(b: { tags: { name: string }[] }): string[] {
  return b.tags.map((t) => t.name);
}
