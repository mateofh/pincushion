// Utilidades de archivo SQLite para los scripts de operación (backup, restore).
// Usa node:sqlite directamente porque necesita abrir copias en modo solo lectura,
// algo que la interfaz Db de src/server/db/sqlite.ts no expone a propósito.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** Tablas que una base de Pincushion válida debe tener. */
export const REQUIRED_TABLES = ['schema_migrations', 'users', 'bookmarks', 'collections', 'tags', 'bookmark_tags'] as const;

/** Tablas cuyas filas se cuentan en los resúmenes. */
export const COUNTED_TABLES = ['users', 'bookmarks', 'collections', 'tags', 'bookmark_tags', 'sessions', 'bookmarklet_tokens'] as const;

export interface DatabaseReport {
  integrity: string;
  tables: string[];
  counts: Record<string, number>;
  migrations: string[];
}

/** Literal SQL con comillas simples escapadas (VACUUM INTO no admite parámetros). */
export function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** Marca de tiempo apta para nombres de archivo y ordenable: 2026-11-14T13-55-38-123Z. */
export function fileTimestamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

/** Devuelve `base + ext` o, si ya existe, `base-1 + ext`, `base-2 + ext`… */
export function uniquePath(base: string, ext: string): string {
  let candidate = `${base}${ext}`;
  for (let i = 1; existsSync(candidate); i++) candidate = `${base}-${i}${ext}`;
  return candidate;
}

/** Abre el archivo en solo lectura y devuelve integridad, tablas, conteos y migraciones aplicadas. */
export function inspectDatabaseFile(path: string): DatabaseReport {
  if (!existsSync(path)) throw new Error(`No existe el archivo: ${path}`);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const integrityRows = db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
    const integrity = integrityRows.map((r) => r.integrity_check).join('; ');
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(
      (r) => r.name,
    );
    const counts: Record<string, number> = {};
    for (const t of COUNTED_TABLES) {
      if (!tables.includes(t)) continue;
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
      counts[t] = Number(row.n);
    }
    const migrations = tables.includes('schema_migrations')
      ? (db.prepare('SELECT name FROM schema_migrations ORDER BY name').all() as { name: string }[]).map((r) => r.name)
      : [];
    return { integrity, tables, counts, migrations };
  } finally {
    db.close();
  }
}

/** Lanza si el informe no corresponde a una base de Pincushion íntegra. */
export function assertHealthyPincushionDb(report: DatabaseReport, label: string): void {
  if (report.integrity !== 'ok') throw new Error(`${label}: integrity_check falló (${report.integrity})`);
  const missing = REQUIRED_TABLES.filter((t) => !report.tables.includes(t));
  if (missing.length) throw new Error(`${label}: no parece una base de Pincushion (faltan tablas: ${missing.join(', ')})`);
}

/** Copia consistente (incluye lo que esté en el WAL) abriendo el origen en solo lectura. */
export function vacuumFileInto(sourcePath: string, outPath: string): void {
  if (existsSync(outPath)) throw new Error(`El destino ya existe: ${outPath}`);
  const db = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    db.exec(`VACUUM INTO ${sqlString(outPath)}`);
  } finally {
    db.close();
  }
}

/** Borra los archivos `prefix*.db` más antiguos de `dir` dejando los `keep` más recientes. keep = 0 no borra nada. */
export function pruneBackups(dir: string, prefix: string, keep: number): string[] {
  if (keep <= 0 || !existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.db'))
    .map((f) => ({ f, path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    // Más reciente primero: por mtime y, a igualdad, por nombre (la marca ISO es ordenable).
    .sort((a, b) => b.mtime - a.mtime || (a.f < b.f ? 1 : a.f > b.f ? -1 : 0));
  const removed: string[] = [];
  for (const { path } of files.slice(keep)) {
    unlinkSync(path);
    removed.push(path);
  }
  return removed;
}

export function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
}
