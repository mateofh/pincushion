// npm run db:migrate — aplica migraciones pendientes, con copia previa (VACUUM INTO) si la DB ya existe.
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from '../src/server/config.ts';
import { openDb, migrate, pendingMigrations } from '../src/server/db/sqlite.ts';

const config = loadConfig();
const existed = existsSync(config.DATABASE_PATH);
const db = openDb(config.DATABASE_PATH);
const pending = pendingMigrations(db);
if (pending.length === 0) {
  console.log('La base de datos ya está al día.');
} else {
  if (existed) {
    const dir = join(dirname(config.DATABASE_PATH), 'backups');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `pre-migrate-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    console.log(`Copia de seguridad: ${file}`);
  }
  const done = migrate(db);
  console.log(`Migraciones aplicadas: ${done.join(', ')}`);
}
db.close();
