/**
 * The activity log (Trophies Round 4, migration 018): things Arc40 did not remember before, kept so trophies can count
 * them. Dates, kinds and yes/no results only: never a path, a file name, an account name or a number from a file.
 *
 *   backup     every backup made (weekly automatic, Back up now, before an update, before an account delete)
 *   wrapped    a year's Arc40 Wrapped watched to its last slide (the year watched)
 *   positions  a saved Fidelity positions import (whether every share count matched)
 *
 * It only knows about things from the day it ships: `activity_log_since` is that day (set the first time Arc40 opens
 * a database after the update, with the app's clock). Demo mode writes only to the demo database, like everything.
 */
import type { DB } from '../db/database.js';
import { toIsoDate, type IsoDate } from '../../../shared/dates.js';
import { getSetting, setSetting } from './settings.js';

export type BackupKind = 'weekly' | 'manual' | 'before_update' | 'before_delete';

export interface LogEntry {
  kind: 'backup' | 'wrapped' | 'positions';
  date: IsoDate;
  at: number;
  backupKind: BackupKind | null;
  year: number | null;
  allMatched: boolean | null;
}

const hasLog = (db: DB) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'activity_log'").get();

function add(db: DB, kind: LogEntry['kind'], now: number, extra: { backupKind?: BackupKind; year?: number; allMatched?: boolean }): void {
  if (!hasLog(db)) return; // a database from before migration 018 (never the case once Arc40 has opened it)
  db.prepare('INSERT INTO activity_log (kind, on_date, at, backup_kind, year, all_matched) VALUES (?, ?, ?, ?, ?, ?)').run(
    kind,
    toIsoDate(now),
    now,
    extra.backupKind ?? null,
    extra.year ?? null,
    extra.allMatched === undefined ? null : extra.allMatched ? 1 : 0,
  );
}

export const logBackup = (db: DB, kind: BackupKind, now: number) => add(db, 'backup', now, { backupKind: kind });
export const logWrappedWatched = (db: DB, year: number, now: number) => add(db, 'wrapped', now, { year });
export const logPositionsImport = (db: DB, allMatched: boolean, now: number) => add(db, 'positions', now, { allMatched });

/** Every log entry, oldest first. */
export function loadActivityLog(db: DB): LogEntry[] {
  if (!hasLog(db)) return [];
  return (
    db.prepare('SELECT kind, on_date, at, backup_kind, year, all_matched FROM activity_log ORDER BY on_date, at, id').all() as {
      kind: LogEntry['kind'];
      on_date: string;
      at: number;
      backup_kind: BackupKind | null;
      year: number | null;
      all_matched: number | null;
    }[]
  ).map((r) => ({
    kind: r.kind,
    date: r.on_date,
    at: r.at,
    backupKind: r.backup_kind,
    year: r.year,
    allMatched: r.all_matched === null ? null : r.all_matched === 1,
  }));
}

/** The day Arc40 started keeping the log (null on a database that has not been opened by the app since the update). */
export function activityLogSince(db: DB): IsoDate | null {
  return getSetting(db, 'activity_log_since');
}

/** Saves the start day once (the first time Arc40 opens this database after the update). Never moves it. */
export function markActivityLogStart(db: DB, now: number): void {
  if (!hasLog(db) || activityLogSince(db) !== null) return;
  setSetting(db, 'activity_log_since', toIsoDate(now));
}
