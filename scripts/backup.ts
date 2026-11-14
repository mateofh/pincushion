// npm run db:backup [-- --out <ruta>] [-- --keep 7]
// Copia en caliente con VACUUM INTO (seguro con el servidor activo), verifica la copia y rota las antiguas.
//   --out <ruta>  archivo destino (por defecto <dir de la DB>/backups/pincushion-<ISO>.db)
//   --keep <n>    copias pincushion-*.db que se conservan en el directorio destino (7; 0 = no borrar)
import { parseArgs } from 'node:util';
import { loadDotEnv } from '../src/server/config.ts';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { openDb } from '../src/server/db/sqlite.ts';
import {
  assertHealthyPincushionDb,
  fileTimestamp,
  formatCounts,
  inspectDatabaseFile,
  pruneBackups,
  sqlString,
  uniquePath,
} from './lib/sqlite-files.ts';

const USAGE = 'Uso: npm run db:backup -- [--out <ruta>] [--keep <n>]';
const PREFIX = 'pincushion-';

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

let values: { out?: string; keep?: string; help?: boolean };
try {
  ({ values } = parseArgs({ options: { out: { type: 'string' }, keep: { type: 'string', default: '7' }, help: { type: 'boolean', short: 'h' } } }));
} catch (err) {
  fail(`${(err as Error).message}\n${USAGE}`);
}
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
const keep = Number(values.keep);
if (!Number.isInteger(keep) || keep < 0) fail(`--keep debe ser un entero >= 0.\n${USAGE}`);

// Solo hace falta la ruta de la DB: no se exige APP_SECRET para sacar una copia.
loadDotEnv();
const dbPath = resolve(process.env.DATABASE_PATH || './data/pincushion.db');
if (!existsSync(dbPath)) fail(`No existe la base de datos: ${dbPath}`);

const out = values.out
  ? resolve(values.out)
  : uniquePath(join(dirname(dbPath), 'backups', `${PREFIX}${fileTimestamp()}`), '.db');
if (out === dbPath) fail('--out no puede ser la propia base de datos.');
if (existsSync(out)) fail(`El destino ya existe: ${out}`);
mkdirSync(dirname(out), { recursive: true });

const source = inspectDatabaseFile(dbPath);
const db = openDb(dbPath);
try {
  db.exec(`VACUUM INTO ${sqlString(out)}`);
} finally {
  db.close();
}

try {
  const copy = inspectDatabaseFile(out);
  assertHealthyPincushionDb(copy, 'La copia');
  const missing = source.tables.filter((t) => !copy.tables.includes(t));
  if (missing.length || copy.tables.length !== source.tables.length) {
    throw new Error(`La copia no tiene las mismas tablas que el origen (faltan: ${missing.join(', ') || '—'})`);
  }
  console.log(`Copia creada: ${out}`);
  console.log(`  integrity_check=ok tablas=${copy.tables.length} ${formatCounts(copy.counts)}`);
} catch (err) {
  unlinkSync(out);
  fail(`Copia descartada: ${(err as Error).message}`);
}

// La retención solo toca copias con el prefijo estándar (nunca pre-migrate-* ni pre-restore-*).
const removed = basename(out).startsWith(PREFIX) ? pruneBackups(dirname(out), PREFIX, keep) : [];
for (const r of removed) console.log(`  borrada copia antigua: ${basename(r)}`);
if (keep > 0) console.log(`  retención: se conservan las últimas ${keep} copias ${PREFIX}*.db en ${dirname(out)}`);
