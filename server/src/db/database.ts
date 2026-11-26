import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupBeforeMigrations } from './migrationBackup.js';
import { logBackup } from '../lib/activityLog.js';

export type DB = DatabaseSync;

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export const DB_FILENAME = 'arc40.db';

export interface OpenOptions {
  /**
   * REAL database only: back up here before applying any new migration (see migrationBackup.ts).
   * Leave it out for demo databases, tests and ARC40_BACKUPS=off.
   */
  backupBeforeMigrate?: { dir: string; now: number } | null;
  /** Tests only: a different migrations folder (to simulate a new migration). */
  migrationsDir?: string;
  /** Called with the backup's path when one was made (main.ts prints it). */
  onBackup?: (file: string) => void;
}

/** Opens (or creates) the database and applies any pending migrations. */
export function openDatabase(dataDir: string | ':memory:', opts: OpenOptions = {}): DB {
  let file = ':memory:';
  if (dataDir !== ':memory:') {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    file = path.join(dataDir, DB_FILENAME);
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  const dir = opts.migrationsDir ?? MIGRATIONS_DIR;
  const backup = opts.backupBeforeMigrate;
  let madeAt: number | null = null;
  if (backup && file !== ':memory:') {
    const pending = pendingMigrations(db, dir);
    // A brand-new database has nothing to lose, so it needs no backup.
    if (pending.length && hasAppliedMigrations(db)) {
      try {
        const made = backupBeforeMigrations(db, backup.dir, backup.now, pending);
        opts.onBackup?.(made);
        madeAt = backup.now;
      } catch (e) {
        db.close(); // nothing was migrated; leave the file exactly as it was
        throw e;
      }
    }
  }
  runMigrations(db, dir);
  // Trophies Round 4: the safety backup goes in the activity log once the log table exists (it may have just been
  // created by this very update).
  if (madeAt !== null) logBackup(db, 'before_update', madeAt);
  return db;
}

function migrationFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
}

function hasAppliedMigrations(db: DB): boolean {
  const t = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (!t) return false;
  return (db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n > 0;
}

/** Migration files not yet applied to `db`. Reads only (never creates a table). */
export function pendingMigrations(db: DB, dir: string = MIGRATIONS_DIR): string[] {
  const t = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  const applied = new Set(
    t ? (db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name) : [],
  );
  return migrationFiles(dir).filter((f) => !applied.has(f));
}

/**
 * Migrations are plain .sql files named NNN_description.sql, applied in order,
 * each inside a transaction. Never edit a migration that has shipped; add a new one.
 */
export function runMigrations(db: DB, dir: string = MIGRATIONS_DIR): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`);
  const applied = new Set(
    (db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name),
  );
  for (const f of migrationFiles(dir)) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    transaction(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, Date.now());
    });
  }
}

/** Runs fn inside a transaction; rolls back on throw. */
export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
