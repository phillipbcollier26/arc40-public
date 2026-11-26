/**
 * Safety backup taken right BEFORE Arc40 applies new migrations to the real database.
 *
 * Why: a migration changes the shape of the user's only copy of their data. If an update ever went
 * wrong, this file is how the user gets back to exactly what they had. If the backup cannot be made and
 * checked, the migration does not run and the database file is left untouched.
 *
 * Synchronous on purpose (openDatabase is synchronous): SQLite's `VACUUM INTO` writes a clean,
 * consistent copy in one statement. The copy is then opened and checked (integrity check + the same
 * tables and applied migrations as the original) before it is given its final name.
 * Never used for demo databases, brand-new empty databases or when ARC40_BACKUPS=off.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Same prefix as the weekly backups, so the file shows in Settings and in `npm run restore`. */
export const BACKUP_FILE_PREFIX = 'arc40-backup-';
export const BEFORE_UPDATE_SUFFIX = '-before-update.db';

export class MigrationBackupError extends Error {
  constructor(
    readonly reason: string,
    readonly pending: string[],
  ) {
    super(
      'Arc40 could not make a safety backup before updating its database, so it did not change your data. ' +
        `Reason: ${reason}`,
    );
    this.name = 'MigrationBackupError';
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** File name like arc40-backup-2026-11-13-140501-before-update.db (local time, like the weekly ones). */
export function beforeUpdateName(now: number): string {
  const d = new Date(now);
  return (
    `${BACKUP_FILE_PREFIX}${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${BEFORE_UPDATE_SUFFIX}`
  );
}

function tableNames(db: DatabaseSync): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(
    (r) => r.name,
  );
}

function migrationNames(db: DatabaseSync): string[] {
  return (db.prepare('SELECT name FROM schema_migrations ORDER BY name').all() as { name: string }[]).map((r) => r.name);
}

/**
 * Copies `db` to `<dir>/arc40-backup-...-before-update.db`, checks the copy and returns its path.
 * Throws MigrationBackupError (and leaves no half-written file) if anything goes wrong.
 */
export function backupBeforeMigrations(db: DatabaseSync, dir: string, now: number, pending: string[]): string {
  const dest = path.join(dir, beforeUpdateName(now));
  const tmp = `${dest}.part`;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!fs.statSync(dir).isDirectory()) throw new Error(`${dir} is not a folder.`);
    fs.rmSync(tmp, { force: true });
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const copy = new DatabaseSync(tmp);
    try {
      const check = copy.prepare('PRAGMA integrity_check').get() as Record<string, unknown>;
      if (Object.values(check)[0] !== 'ok') throw new Error('the backup copy failed SQLite\'s integrity check.');
      if (tableNames(copy).join(',') !== tableNames(db).join(',')) throw new Error('the backup copy is missing tables.');
      if (migrationNames(copy).join(',') !== migrationNames(db).join(',')) throw new Error('the backup copy does not match.');
      copy.exec('DELETE FROM sessions'); // backups never carry login sessions
    } finally {
      copy.close();
    }
    fs.chmodSync(tmp, 0o600);
    if (fs.existsSync(dest)) throw new Error(`${dest} already exists.`);
    fs.renameSync(tmp, dest);
    return dest;
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // nothing was written there (e.g. the "folder" is a file)
    }
    if (e instanceof MigrationBackupError) throw e;
    throw new MigrationBackupError((e as Error).message, pending);
  }
}
