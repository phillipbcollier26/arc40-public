/**
 * Database backups. Uses SQLite's online backup (node:sqlite `backup()`), which makes a
 * consistent copy even while Arc40 is running. Backups live OUTSIDE the project folder
 * (default ~/Arc40Backups) so they can never be committed to Git.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite';
import type { DB } from '../db/database.js';
import { rawDb } from '../db/dataStore.js';
import { isValidIsoDate, toIsoDate } from '../../../shared/dates.js';
import { logBackup, type BackupKind } from './activityLog.js';

export const BACKUP_PREFIX = 'arc40-backup-';
export const KEEP_BACKUPS = 12;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function defaultBackupDir(): string {
  return process.env.ARC40_BACKUP_DIR ? path.resolve(process.env.ARC40_BACKUP_DIR) : path.join(os.homedir(), 'Arc40Backups');
}

export interface BackupFile {
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: number;
}

export function listBackups(dir: string): BackupFile[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith('.db'))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, path: path.join(dir, f), sizeBytes: st.size, createdAt: st.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Copies the live database to `dest` and removes login sessions from the copy. */
export async function copyDatabase(db: DB, dest: string): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  const tmp = `${dest}.part`;
  fs.rmSync(tmp, { force: true });
  await sqliteBackup(rawDb(db), tmp); // node:sqlite needs the real object, not the store proxy
  const copy = new DatabaseSync(tmp);
  try {
    copy.exec('DELETE FROM sessions');
  } finally {
    copy.close();
  }
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, dest);
}

/**
 * Makes a dated backup now and keeps only the newest KEEP_BACKUPS. Returns the new file. The backup is written to the
 * activity log (date and kind only) once the file is safely in place (Trophies Round 4).
 */
export async function backupNow(db: DB, dir: string, now: number, kind: BackupKind = 'manual'): Promise<BackupFile> {
  const stamp = new Date(now);
  const name = `${BACKUP_PREFIX}${toIsoDate(now)}-${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}${String(stamp.getSeconds()).padStart(2, '0')}.db`;
  const dest = path.join(dir, name);
  await copyDatabase(db, dest);
  fs.utimesSync(dest, stamp, stamp);
  for (const old of listBackups(dir).slice(KEEP_BACKUPS)) fs.rmSync(old.path, { force: true });
  logBackup(db, kind, now);
  return listBackups(dir).find((b) => b.name === name)!;
}

/**
 * Trophies Round 4 (First backup): the day of every Arc40 backup file in the folder, from its name
 * (arc40-backup-YYYY-MM-DD-...). Only dates leave this function: never a path or a file name.
 */
export function backupFileDates(dir: string): string[] {
  return listBackups(dir)
    .map((b) => /^arc40-backup-(\d{4}-\d{2}-\d{2})-/.exec(b.name)?.[1] ?? null)
    .filter((d): d is string => d !== null && isValidIsoDate(d))
    .sort();
}

/** Weekly rule: back up if there is no backup yet, or the newest is 7+ days old. */
export async function backupIfDue(db: DB, dir: string, now: number): Promise<BackupFile | null> {
  const newest = listBackups(dir)[0];
  if (newest && now - newest.createdAt < WEEK_MS) return null;
  return backupNow(db, dir, now, 'weekly');
}

/** True if the file is an Arc40 database (SQLite with Arc40's tables). */
export function isArc40Database(file: string): boolean {
  try {
    const head = Buffer.alloc(16);
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, head, 0, 16, 0);
    fs.closeSync(fd);
    if (head.toString('latin1') !== 'SQLite format 3\u0000') return false;
    const d = new DatabaseSync(file, { readOnly: true });
    try {
      const t = d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('schema_migrations','accounts','transactions')").get() as { n: number };
      return t.n === 3;
    } finally {
      d.close();
    }
  } catch {
    return false;
  }
}
