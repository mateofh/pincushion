// npm run db:restore -- --from <archivo> [--force]
// Reemplaza la base de datos por una copia. Detén el servidor antes.
//   --from <archivo>  copia a restaurar (se valida con integrity_check y tablas de Pincushion)
//   --force           restaura aunque el -wal se haya modificado hace menos de 10 s (servidor activo)
// Pasos: valida el origen → lo materializa en un temporal junto a la DB (VACUUM INTO) → guarda la DB actual
// en backups/pre-restore-<ISO>.db → checkpoint y borra -wal/-shm viejos → rename atómico del temporal.
import { parseArgs } from 'node:util';
import { loadDotEnv } from '../src/server/config.ts';
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { listMigrations, openDb } from '../src/server/db/sqlite.ts';
import {
  assertHealthyPincushionDb,
  fileTimestamp,
  formatCounts,
  inspectDatabaseFile,
  sqlString,
  uniquePath,
  vacuumFileInto,
} from './lib/sqlite-files.ts';

const USAGE = 'Uso: npm run db:restore -- --from <archivo> [--force]';
const ACTIVE_WINDOW_MS = 10_000;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

let values: { from?: string; force?: boolean; help?: boolean };
try {
  ({ values } = parseArgs({ options: { from: { type: 'string' }, force: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } }));
} catch (err) {
  fail(`${(err as Error).message}\n${USAGE}`);
}
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!values.from) fail(`Falta --from.\n${USAGE}`);

loadDotEnv();
const dbPath = resolve(process.env.DATABASE_PATH || './data/pincushion.db');
const from = resolve(values.from);
if (!existsSync(from)) fail(`No existe el archivo origen: ${from}`);
if (from === dbPath) fail('El origen es la propia base de datos.');

const wal = `${dbPath}-wal`;
if (existsSync(wal) && !values.force) {
  const age = Date.now() - statSync(wal).mtimeMs;
  if (age < ACTIVE_WINDOW_MS) {
    fail(`El servidor parece activo (${wal} modificado hace ${Math.round(age / 1000)} s). Detenlo y reintenta, o usa --force.`);
  }
}

let sourceReport: ReturnType<typeof inspectDatabaseFile>;
try {
  sourceReport = inspectDatabaseFile(from);
  assertHealthyPincushionDb(sourceReport, 'El archivo origen');
} catch (err) {
  fail((err as Error).message);
}

mkdirSync(dirname(dbPath), { recursive: true });
const tmp = uniquePath(`${dbPath}.restore-${process.pid}`, '.tmp');
let preRestore: string | null = null;
try {
  // 1. Temporal en el mismo directorio (rename atómico) y sin WAL pendiente.
  vacuumFileInto(from, tmp);
  assertHealthyPincushionDb(inspectDatabaseFile(tmp), 'La copia temporal');

  // 2. Copia de la DB actual y checkpoint para no dejar nada en el WAL.
  if (existsSync(dbPath)) {
    const dir = join(dirname(dbPath), 'backups');
    mkdirSync(dir, { recursive: true });
    preRestore = uniquePath(join(dir, `pre-restore-${fileTimestamp()}`), '.db');
    const db = openDb(dbPath);
    try {
      db.exec(`VACUUM INTO ${sqlString(preRestore)}`);
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      db.close();
    }
  }

  // 3. Un -wal viejo se aplicaría sobre el archivo nuevo: hay que borrarlo antes del rename.
  for (const side of [`${dbPath}-wal`, `${dbPath}-shm`]) if (existsSync(side)) unlinkSync(side);

  // 4. Reemplazo atómico.
  renameSync(tmp, dbPath);
} catch (err) {
  if (existsSync(tmp)) unlinkSync(tmp);
  fail(`Restauración abortada, la base de datos no se modificó: ${(err as Error).message}`);
}

const restored = inspectDatabaseFile(dbPath);
console.log(`Base de datos restaurada desde ${from}`);
console.log(`  ${dbPath}: integrity_check=${restored.integrity} ${formatCounts(restored.counts)}`);
if (preRestore) console.log(`  copia de la base anterior: ${preRestore}`);
const pending = listMigrations().map((m) => m.name).filter((n) => !restored.migrations.includes(n));
if (pending.length) console.log(`  Atención: la copia tiene migraciones pendientes (${pending.join(', ')}). Ejecuta npm run db:migrate.`);
