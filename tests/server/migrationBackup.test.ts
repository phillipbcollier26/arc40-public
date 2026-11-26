/**
 * Safety backup before migrations (V2 Phase 3, M2).
 * Before Arc40 applies a NEW migration to the REAL database it makes a backup in the backups folder
 * and checks it. If that fails, nothing is migrated and the database file is left exactly as it was.
 * Demo databases, brand-new databases and ARC40_BACKUPS=off never get one.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../server/src/app.js';
import { DB_FILENAME, openDatabase, pendingMigrations } from '../../server/src/db/database.js';
import { BEFORE_UPDATE_SUFFIX, beforeUpdateName, MigrationBackupError } from '../../server/src/db/migrationBackup.js';
import { listBackups } from '../../server/src/lib/backup.js';
import { HOST_HEADER, cookieFrom, fakeClock } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const LAST = '011_price_history_columns.sql';
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  delete process.env.ARC40_BACKUPS;
});

/**
 * A database as it looked BEFORE the newest migration: fully migrated, with some data and a login
 * session, then migration 011 undone (it only creates one table). Opening it again must apply 011.
 */
function oldDatabase(dir: string): string {
  const db = openDatabase(dir);
  db.prepare("INSERT INTO accounts (name, institution, type, class, is_investment, sort_order, archived, created_at, updated_at) VALUES ('Fake Checking', 'Fake Bank', 'checking', 'asset', 0, 0, 0, 1, 1)").run();
  db.prepare("INSERT INTO sessions (token_hash, csrf_token, created_at, last_seen_at) VALUES ('abc', 'def', 1, 1)").run();
  db.exec('DROP TABLE price_history_columns');
  db.prepare('DELETE FROM schema_migrations WHERE name = ?').run(LAST);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
  return path.join(dir, DB_FILENAME);
}

function sha(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function hasTable(file: string, name: string): boolean {
  const d = new DatabaseSync(file, { readOnly: true });
  try {
    return !!d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name);
  } finally {
    d.close();
  }
}

function beforeUpdateFiles(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(BEFORE_UPDATE_SUFFIX)) : [];
}

describe('openDatabase with backupBeforeMigrate', () => {
  it('backs up first, then migrates; the backup is the database as it was, checked, private and listed', () => {
    const dataDir = tmp('arc40-mig-data-');
    const backupDir = path.join(tmp('arc40-mig-bk-'), 'Arc40Backups'); // does not exist yet: created
    const file = oldDatabase(dataDir);
    const now = Date.UTC(2026, 10, 13, 15, 4, 5);
    const made: string[] = [];
    const db = openDatabase(dataDir, { backupBeforeMigrate: { dir: backupDir, now }, onBackup: (f) => made.push(f) });
    cleanups.push(() => db.close());

    expect(pendingMigrations(db)).toEqual([]);
    expect(hasTable(file, 'price_history_columns')).toBe(true); // migrated
    expect(made).toHaveLength(1);
    const backup = made[0]!;
    expect(path.basename(backup)).toBe(beforeUpdateName(now));
    expect(path.basename(backup)).toMatch(/^arc40-backup-\d{4}-\d{2}-\d{2}-\d{6}-before-update\.db$/);
    // The backup is the OLD database: without the new table, with the data, without sessions.
    expect(hasTable(backup, 'price_history_columns')).toBe(false);
    const b = new DatabaseSync(backup, { readOnly: true });
    try {
      expect((b.prepare('SELECT name FROM accounts').get() as { name: string }).name).toBe('Fake Checking');
      expect((b.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n).toBe(0);
      expect((b.prepare('PRAGMA integrity_check').get() as Record<string, string>).integrity_check).toBe('ok');
    } finally {
      b.close();
    }
    expect(fs.statSync(backup).mode & 0o777).toBe(0o600);
    expect(listBackups(backupDir).map((x) => x.path)).toEqual([backup]); // shows in Settings / restore
    expect(fs.readdirSync(backupDir).some((f) => f.endsWith('.part'))).toBe(false);
  });

  it('if the backup fails, nothing is migrated and the database file is byte-for-byte unchanged', () => {
    const dataDir = tmp('arc40-mig-data-');
    const file = oldDatabase(dataDir);
    const before = sha(file);
    const notAFolder = path.join(tmp('arc40-mig-bk-'), 'a-file');
    fs.writeFileSync(notAFolder, 'not a folder');

    let err: unknown;
    try {
      openDatabase(dataDir, { backupBeforeMigrate: { dir: notAFolder, now: Date.now() } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MigrationBackupError);
    expect((err as MigrationBackupError).pending).toEqual([LAST]);
    expect((err as Error).message).toMatch(/did not change your data/);
    expect(sha(file)).toBe(before);
    expect(hasTable(file, 'price_history_columns')).toBe(false);
    const d = new DatabaseSync(file, { readOnly: true });
    expect((d.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE name = ?').get(LAST) as { n: number }).n).toBe(0);
    d.close();
  });

  it('a backup copy that fails its check is removed and blocks the migration', () => {
    const dataDir = tmp('arc40-mig-data-');
    const file = oldDatabase(dataDir);
    const before = sha(file);
    const backupDir = tmp('arc40-mig-bk-');
    // A read-only backups folder: VACUUM INTO cannot write the copy.
    fs.chmodSync(backupDir, 0o500);
    cleanups.push(() => fs.chmodSync(backupDir, 0o700));
    if (process.getuid?.() === 0) return; // root ignores folder permissions (cloud sandbox)
    expect(() => openDatabase(dataDir, { backupBeforeMigrate: { dir: backupDir, now: Date.now() } })).toThrow(MigrationBackupError);
    expect(sha(file)).toBe(before);
    expect(fs.readdirSync(backupDir)).toEqual([]);
  });

  it('no new migration = no backup; a brand-new database = no backup', () => {
    const backupDir = tmp('arc40-mig-bk-');
    const fresh = tmp('arc40-mig-data-');
    openDatabase(fresh, { backupBeforeMigrate: { dir: backupDir, now: Date.now() } }).close(); // new, empty
    openDatabase(fresh, { backupBeforeMigrate: { dir: backupDir, now: Date.now() } }).close(); // up to date
    expect(fs.readdirSync(backupDir)).toEqual([]);
  });

  it('a simulated future migration file also triggers the backup', () => {
    const dataDir = tmp('arc40-mig-data-');
    openDatabase(dataDir).close();
    const migDir = tmp('arc40-mig-files-');
    const real = path.join('server', 'src', 'db', 'migrations');
    for (const f of fs.readdirSync(real)) fs.copyFileSync(path.join(real, f), path.join(migDir, f));
    fs.writeFileSync(path.join(migDir, '999_future.sql'), 'CREATE TABLE future_thing (id INTEGER PRIMARY KEY);');
    const backupDir = tmp('arc40-mig-bk-');
    const db = openDatabase(dataDir, { migrationsDir: migDir, backupBeforeMigrate: { dir: backupDir, now: Date.now() } });
    db.close();
    const files = beforeUpdateFiles(backupDir);
    expect(files).toHaveLength(1);
    expect(hasTable(path.join(backupDir, files[0]!), 'future_thing')).toBe(false);
    expect(hasTable(path.join(dataDir, DB_FILENAME), 'future_thing')).toBe(true);
  });
});

describe('Arc40 startup (buildApp)', () => {
  const start = (dirs: { dataDir: string; demoDir: string; backupDir: string }) =>
    buildApp({ ...dirs, now: fakeClock().now, webDistDir: '/nonexistent', port: 4040 });

  it('backs up the real database before migrating it, then runs normally', async () => {
    const dirs = { dataDir: tmp('arc40-mig-data-'), demoDir: tmp('arc40-mig-demo-'), backupDir: tmp('arc40-mig-bk-') };
    oldDatabase(dirs.dataDir);
    const t = await start(dirs);
    cleanups.push(() => t.app.close());
    expect(beforeUpdateFiles(dirs.backupDir)).toHaveLength(1);
    const res = await t.app.inject({ method: 'GET', url: '/api/health', headers: HOST_HEADER });
    expect(res.statusCode).toBe(200);
  });

  it('refuses to start (and changes nothing) when the backup cannot be made', async () => {
    const dirs = { dataDir: tmp('arc40-mig-data-'), demoDir: tmp('arc40-mig-demo-'), backupDir: path.join(tmp('arc40-mig-bk-'), 'file') };
    fs.writeFileSync(dirs.backupDir, 'x');
    const file = oldDatabase(dirs.dataDir);
    const before = sha(file);
    await expect(start(dirs)).rejects.toBeInstanceOf(MigrationBackupError);
    expect(sha(file)).toBe(before);
    expect(hasTable(file, 'price_history_columns')).toBe(false);
  });

  it('ARC40_BACKUPS=off (npm run demo) skips it', async () => {
    process.env.ARC40_BACKUPS = 'off';
    const dirs = { dataDir: tmp('arc40-mig-data-'), demoDir: tmp('arc40-mig-demo-'), backupDir: tmp('arc40-mig-bk-') };
    oldDatabase(dirs.dataDir);
    const t = await start(dirs);
    cleanups.push(() => t.app.close());
    expect(fs.readdirSync(dirs.backupDir)).toEqual([]);
  });

  it('the in-app demo database is migrated without a backup (demo data never goes to the backups folder)', async () => {
    const dirs = { dataDir: tmp('arc40-mig-data-'), demoDir: tmp('arc40-mig-demo-'), backupDir: tmp('arc40-mig-bk-') };
    const t = await start(dirs);
    cleanups.push(() => t.app.close());
    const setup = await t.app.inject({ method: 'POST', url: '/api/auth/setup', headers: HOST_HEADER, payload: { password: 'correct horse battery' } });
    const c = { cookie: cookieFrom(setup), csrf: setup.json().csrfToken as string };
    // An "older" demo database waiting in the demo folder.
    fs.rmSync(dirs.demoDir, { recursive: true, force: true });
    const demoFile = oldDatabase(dirs.demoDir);
    const res = await t.app.inject({ method: 'POST', url: '/api/demo/enter', headers: { ...HOST_HEADER, cookie: c.cookie, 'x-csrf-token': c.csrf } });
    expect(res.statusCode).toBe(200);
    expect(hasTable(demoFile, 'price_history_columns')).toBe(true);
    expect(fs.readdirSync(dirs.backupDir)).toEqual([]);
  });
});
