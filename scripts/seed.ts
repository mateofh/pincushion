// npm run db:seed [-- --reset] [-- --force]
// Carga datos de demostración (alice, bob, dana). Nunca en producción.
//   --reset  borra antes todos los datos de los usuarios demo (sesiones y tokens incluidos)
//   --force  permite sembrar aunque APP_ORIGIN sea https (NODE_ENV=production se rechaza siempre)
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { loadConfig, type Config } from '../src/server/config.ts';
import { openDb, pendingMigrations } from '../src/server/db/sqlite.ts';
import { hashPassword } from '../src/server/crypto.ts';
import { seedDemo } from './lib/seed.ts';
import { DEMO_PASSWORD, DEMO_TIMEZONE } from './lib/seed-data.ts';

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

let values: { reset?: boolean; force?: boolean; help?: boolean };
try {
  ({ values } = parseArgs({ options: { reset: { type: 'boolean' }, force: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } }));
} catch (err) {
  fail(`${(err as Error).message}\nUso: npm run db:seed -- [--reset] [--force]`);
}
if (values.help) {
  console.log('Uso: npm run db:seed -- [--reset] [--force]\n  --reset  borra antes los datos de los usuarios demo\n  --force  permite APP_ORIGIN https');
  process.exit(0);
}

if (process.env.NODE_ENV === 'production') fail('db:seed se niega a ejecutarse con NODE_ENV=production.');

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  fail((err as Error).message);
}
if (config.secureCookies && !values.force) {
  fail(`APP_ORIGIN es https (${config.APP_ORIGIN}): parece un despliegue real. Usa --force si de verdad quieres datos demo ahí.`);
}

if (config.DATABASE_PATH !== ':memory:' && !existsSync(config.DATABASE_PATH)) {
  fail(`No existe la base de datos ${config.DATABASE_PATH}. Ejecuta primero: npm run db:migrate`);
}

const db = openDb(config.DATABASE_PATH);
try {
  const pending = pendingMigrations(db);
  if (pending.length) fail(`Hay migraciones pendientes (${pending.join(', ')}). Ejecuta primero: npm run db:migrate`);

  const summary = seedDemo(db, { now: Date.now(), passwordHash: await hashPassword(DEMO_PASSWORD), reset: Boolean(values.reset) });

  if (values.reset) console.log(`--reset: borrados ${summary.removedUsers} usuarios demo y todos sus datos.`);
  console.log(`Datos demo en ${config.DATABASE_PATH}:`);
  for (const u of summary.users) {
    const state = u.createdUser ? 'creado' : 'ya existía';
    console.log(`  ${u.email.padEnd(18)} ${state.padEnd(10)} enlaces=${u.bookmarks} (+${u.bookmarksInserted}) colecciones=${u.collections} etiquetas=${u.tags}`);
  }
  console.log('');
  console.log(`Credenciales (zona horaria ${DEMO_TIMEZONE}):`);
  for (const u of summary.users) console.log(`  ${u.email} / ${DEMO_PASSWORD}`);
  console.log('Los usuarios que ya existían conservan su contraseña; usa --reset para recrearlos.');
} finally {
  db.close();
}
