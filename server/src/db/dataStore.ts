/**
 * THE one place that decides which database a request uses: the real one (data/arc40.db) or the
 * in-app demo copy (demo-data/in-app-<port>/arc40.db).
 *
 * How isolation works:
 * - Every request is pinned to the database that was active when it ARRIVED (AsyncLocalStorage).
 *   A mode switch in the middle of a slow request cannot make it finish against the other file.
 * - Routes keep receiving one `db` object. It is a thin proxy that forwards to the pinned database,
 *   so no route can pick the wrong one by accident.
 * - While demo mode is on, the real database is CLOSED. Nothing can write to it, even by mistake.
 *   Only the real password hash (and the auto-lock minutes) are kept in memory, to check the
 *   password when leaving demo mode and to lock after the same idle time.
 * - The mode lives in memory only, so Arc40 always starts in real mode.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { DB_FILENAME, openDatabase, type DB, type OpenOptions } from './database.js';
import { getPasswordHash } from '../auth/password.js';
import { getSetting } from '../lib/settings.js';
import { generateDemoData, removeDbFiles } from '../lib/demo/index.js';
import { toIsoDate } from '../../../shared/dates.js';
import type { Mode } from '../lib/demoPolicy.js';
import { markActivityLogStart } from '../lib/activityLog.js';

interface Pin {
  db: DB;
  mode: Mode;
}

const RAW = Symbol('arc40.rawDb');

/** The real DatabaseSync behind a store proxy (node:sqlite's backup() needs the real object). */
export function rawDb(db: DB): DB {
  return ((db as unknown as Record<symbol, DB | undefined>)[RAW] ?? db) as DB;
}

export interface DataStoreOptions {
  /** Folder of the real arc40.db. Ignored when `injectedReal` is given (tests). */
  realDir: string;
  /** Folder of the in-app demo database. Never the same as realDir. */
  demoDir: string;
  /** Tests pass an in-memory real database. It is kept open (closing would erase it). */
  injectedReal?: DB;
  now: () => number;
  /**
   * Where the REAL database is backed up before new migrations run (null = never, e.g.
   * ARC40_BACKUPS=off). The demo database never gets this.
   */
  migrationBackupDir?: string | null;
  /** Told the path of a pre-migration backup (main.ts prints it). */
  onMigrationBackup?: (file: string) => void;
}

export class DataStore {
  private readonly als = new AsyncLocalStorage<Pin>();
  private realDb: DB | null;
  private demoDb: DB | null = null;
  private _mode: Mode = 'real';
  private switching = false;
  /** Cached while in demo mode only (the real database is closed then). */
  private realHash: string | null = null;
  private realIdleMinutes = 60;
  readonly db: DB;

  constructor(private readonly opts: DataStoreOptions) {
    if (path.resolve(opts.demoDir) === path.resolve(opts.realDir)) {
      throw new Error('The demo folder must not be the real data folder.');
    }
    this.realDb = opts.injectedReal ?? openDatabase(opts.realDir, this.realOpenOptions());
    markActivityLogStart(this.realDb, opts.now());
    const store = this;
    this.db = new Proxy({} as DB, {
      get(_t, prop) {
        const target = store.active().db;
        if (prop === RAW) return target;
        const v = Reflect.get(target, prop, target) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  }

  /** Options for opening the REAL database: backup before migrations when configured. */
  private realOpenOptions(): OpenOptions {
    const dir = this.opts.migrationBackupDir;
    return dir ? { backupBeforeMigrate: { dir, now: this.opts.now() }, onBackup: this.opts.onMigrationBackup } : {};
  }

  get mode(): Mode {
    return this._mode;
  }

  /** The database the current request is pinned to (or the active one outside a request). */
  active(): Pin {
    return this.als.getStore() ?? { db: this.current(), mode: this._mode };
  }

  /** The active database right now, ignoring any request pin. */
  current(): DB {
    const db = this._mode === 'demo' ? this.demoDb : this.realDb;
    if (!db) throw new Error('No database is open.');
    return db;
  }

  /** The real database, or null while demo mode has it closed. For the backup timer. */
  realIfOpen(): DB | null {
    return this._mode === 'real' ? this.realDb : null;
  }

  /** Runs `fn` with this request pinned to the database that is active now. */
  pin(fn: () => void): void {
    this.als.run({ db: this.current(), mode: this._mode }, fn);
  }

  /** The real password hash, also while the real database is closed. */
  realPasswordHash(): string | null {
    return this._mode === 'demo' ? this.realHash : getPasswordHash(this.realDb!);
  }

  realIdleTimeoutMinutes(): number {
    return this._mode === 'demo' ? this.realIdleMinutes : getSetting(this.realDb!, 'session_idle_minutes');
  }

  get demoFile(): string {
    return path.join(this.opts.demoDir, DB_FILENAME);
  }

  /**
   * Switches to demo mode. `beforeClose` runs against the real database just before it is
   * closed (used to end the real login session). Builds the demo data first if it is missing.
   */
  async enterDemo(beforeClose: (real: DB) => void): Promise<DB> {
    if (this._mode === 'demo') throw new Error('Demo mode is already on.');
    return this.exclusive(async () => {
      if (!fs.existsSync(this.demoFile)) await this.buildDemoInto(this.opts.demoDir);
      // Everything below is synchronous, so no other request runs in between.
      const real = this.realDb!;
      this.realHash = getPasswordHash(real);
      this.realIdleMinutes = getSetting(real, 'session_idle_minutes');
      beforeClose(real);
      const demo = openDatabase(this.opts.demoDir);
      markActivityLogStart(demo, this.opts.now());
      if (!this.opts.injectedReal) {
        real.close();
        this.realDb = null;
      }
      this.demoDb = demo;
      this._mode = 'demo';
      return demo;
    });
  }

  /** Back to real data. The caller has already checked the real password. */
  exitDemo(beforeClose: (demo: DB) => void): DB {
    if (this._mode !== 'demo') throw new Error('Demo mode is already off.');
    const demo = this.demoDb!;
    beforeClose(demo);
    const real = this.realDb ?? openDatabase(this.opts.realDir, this.realOpenOptions());
    markActivityLogStart(real, this.opts.now());
    demo.close();
    this.demoDb = null;
    this.realDb = real;
    this.realHash = null;
    this._mode = 'real';
    return real;
  }

  /** Rebuilds the demo dataset from scratch (demo mode only) and returns the new database. */
  async resetDemo(): Promise<DB> {
    if (this._mode !== 'demo') throw new Error('Reset only works in demo mode.');
    return this.exclusive(async () => {
      // Build into a temporary folder first, then swap it in, so a failure leaves the old data.
      const tmp = `${this.opts.demoDir}.building-${crypto.randomBytes(4).toString('hex')}`;
      try {
        await this.buildDemoInto(tmp);
        this.demoDb!.close();
        removeDbFiles(this.opts.demoDir);
        fs.renameSync(path.join(tmp, DB_FILENAME), this.demoFile);
        this.demoDb = openDatabase(this.opts.demoDir);
        markActivityLogStart(this.demoDb, this.opts.now());
        return this.demoDb;
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  }

  /** Closes whatever is open (app shutdown). Injected test databases are left to the test. */
  close(): void {
    this.demoDb?.close();
    this.demoDb = null;
    if (!this.opts.injectedReal) this.realDb?.close();
    this.realDb = null;
  }

  private async buildDemoInto(dir: string): Promise<void> {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const now = this.opts.now();
    await generateDemoData(dir, toIsoDate(now), now);
    if (!isDemoFile(path.join(dir, DB_FILENAME))) throw new Error('Demo data could not be built.');
  }

  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.switching) throw new Error('Arc40 is already switching. Try again in a moment.');
    this.switching = true;
    try {
      return await fn();
    } finally {
      this.switching = false;
    }
  }
}

/** Sanity check that a freshly built demo file is a complete Arc40 database. */
function isDemoFile(file: string): boolean {
  const d = new DatabaseSync(file, { readOnly: true });
  try {
    return (d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'transactions'").get() as { n: number }).n === 1;
  } finally {
    d.close();
  }
}
