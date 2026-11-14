// Borra y recrea la DB de e2e (solo con NODE_ENV=test y una ruta dentro de test-results/).
import { existsSync, unlinkSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { openDb, migrate } from '../src/server/db/sqlite.ts';

const path = process.env.DATABASE_PATH ?? '';
const safeRoot = resolve('test-results') + sep;
if (process.env.NODE_ENV !== 'test' || !resolve(path).startsWith(safeRoot)) {
  console.error('e2e-reset-db: se niega a borrar una DB fuera de test-results/ o sin NODE_ENV=test');
  process.exit(1);
}
for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) unlinkSync(path + suffix);
const db = openDb(path);
migrate(db);
db.close();
