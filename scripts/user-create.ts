// npm run user:create -- --email tu@correo --password '…' [--timezone Europe/Madrid]
// Crea el dueño de una biblioteca. No hay registro público.
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/server/config.ts';
import { openDb, pendingMigrations } from '../src/server/db/sqlite.ts';
import { hashPassword } from '../src/server/crypto.ts';
import { isValidTimeZone, newPasswordProblem } from '../src/server/auth/account.ts';

let values: { email?: string; password?: string; timezone?: string };
try {
  ({ values } = parseArgs({ options: { email: { type: 'string' }, password: { type: 'string' }, timezone: { type: 'string', default: 'UTC' } } }));
} catch (err) {
  console.error(`${(err as Error).message}\nUso: npm run user:create -- --email tu@correo --password "…" [--timezone Europe/Madrid]`);
  process.exit(1);
}
const email = (values.email ?? '').trim().toLowerCase();
const password = values.password ?? '';
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length < 3 || email.length > 254) {
  console.error('Email inválido. Uso: npm run user:create -- --email tu@correo --password "…"');
  process.exit(1);
}
const pwProblem = newPasswordProblem(password);
if (pwProblem) {
  console.error(pwProblem.replace('La contraseña nueva', 'La contraseña'));
  process.exit(1);
}
if (!isValidTimeZone(values.timezone)) {
  console.error(`Zona horaria desconocida: ${values.timezone} (usa un nombre IANA, p. ej. Europe/Madrid)`);
  process.exit(1);
}
const config = loadConfig();
const db = openDb(config.DATABASE_PATH);
if (pendingMigrations(db).length) {
  console.error('Hay migraciones pendientes. Ejecuta primero: npm run db:migrate');
  process.exit(1);
}
const now = Date.now();
try {
  db.run('INSERT INTO users (email, password_hash, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', email, await hashPassword(password), values.timezone!, now, now);
  console.log(`Usuario creado: ${email}`);
} catch (err) {
  if (String(err).includes('UNIQUE')) {
    console.error(`Ya existe un usuario con el email ${email}.`);
    process.exit(1);
  }
  throw err;
}
db.close();
