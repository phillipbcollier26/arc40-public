/**
 * Trophy Case, Round 4 (Milestone 2): the activity log (migration 018, lib/activityLog.ts). Fake data only.
 * The test clock starts at 2026-11-11 12:00 UTC.
 *
 * What it remembers: each backup (weekly, Back up now, before an update, before an account delete), each year of
 * Arc40 Wrapped watched to the last slide, each saved positions import with yes/no "every share count matched".
 * Dates, kinds and yes/no only: no path, file name, account name or number.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_HEADER, cookieFrom, setupAndLogin, testApp } from './helpers.js';
import { DB_FILENAME, openDatabase } from '../../server/src/db/database.js';
import { activityLogSince, loadActivityLog, logBackup, markActivityLogStart } from '../../server/src/lib/activityLog.js';
import { backupFileDates, backupIfDue, backupNow } from '../../server/src/lib/backup.js';
import { shareCheckClean } from '../../server/src/lib/positionsImport.js';

let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };
const call = (opts: InjectOptions) =>
  t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });
const ok = async (opts: InjectOptions) => {
  const r = await call(opts);
  if (r.statusCode < 200 || r.statusCode > 299) throw new Error(`${opts.method} ${opts.url} -> ${r.statusCode} ${r.body}`);
  return r.json();
};
const log = () => loadActivityLog(t.store.current());
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const fixture = (n: string) => fs.readFileSync(path.resolve('tests/fixtures/csv', n), 'utf8');

beforeEach(async () => {
  t = await testApp();
  auth = await setupAndLogin(t);
});
afterEach(async () => {
  await t.app.close();
});

describe('the log starts empty after the update', () => {
  it('a fresh database has the table, no rows, and the start day is the day Arc40 first opened it', () => {
    expect(log()).toEqual([]);
    expect(activityLogSince(t.store.current())).toBe('2026-11-11');
    // The start day never moves.
    markActivityLogStart(t.store.current(), Date.UTC(2027, 0, 5, 12));
    expect(activityLogSince(t.store.current())).toBe('2026-11-11');
  });

  it('an older database gets an empty log; the safety backup made before migration 018 is its first row', () => {
    const dir = tmp('arc40-log-old-');
    const backups = tmp('arc40-log-bk-');
    const db = openDatabase(dir);
    db.prepare("INSERT INTO accounts (name, institution, type, class, is_investment, sort_order, archived, created_at, updated_at) VALUES ('Fake Checking', 'Fake Bank', 'checking', 'asset', 0, 0, 0, 1, 1)").run();
    // Undo migration 018 (it only creates two tables) so opening again applies it, as on the user's Mac.
    db.exec('DROP TABLE activity_log; DROP TABLE trophy_goal_marks');
    db.prepare("DELETE FROM schema_migrations WHERE name = '018_activity_log.sql'").run();
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();

    // Without the safety backup (ARC40_BACKUPS=off): the log is simply empty.
    const plain = tmp('arc40-log-plain-');
    fs.copyFileSync(path.join(dir, DB_FILENAME), path.join(plain, DB_FILENAME));
    const p = openDatabase(plain);
    expect(loadActivityLog(p)).toEqual([]);
    p.close();

    // With it: one row, the before-update backup, dated by the app clock.
    const when = Date.UTC(2026, 10, 20, 15);
    const m = openDatabase(dir, { backupBeforeMigrate: { dir: backups, now: when } });
    expect(loadActivityLog(m)).toEqual([{ kind: 'backup', date: '2026-11-20', at: when, backupKind: 'before_update', year: null, allMatched: null }]);
    expect(fs.readdirSync(backups).filter((f) => f.endsWith('-before-update.db'))).toHaveLength(1);
    m.close();
  });
});

describe('backups', () => {
  it('Back up now, the weekly backup and the safety backup before an account delete are each logged with their kind', async () => {
    await ok({ method: 'POST', url: '/api/backups' });
    const db = t.store.current();
    t.clock.advance(8 * 24 * 3600 * 1000); // 2026-11-19: the weekly backup is due
    expect(await backupIfDue(db, t.config.backupDir, t.clock.now())).not.toBeNull();
    auth = await relogin(); // the session idled out while the clock jumped
    const id = (await ok({ method: 'POST', url: '/api/accounts', payload: { name: 'Fake Old', type: 'checking' } })).account.id;
    await ok({ method: 'DELETE', url: `/api/accounts/${id}` });
    expect(log().map((e) => [e.date, e.backupKind])).toEqual([
      ['2026-11-11', 'manual'],
      ['2026-11-19', 'weekly'],
      ['2026-11-19', 'before_delete'],
    ]);
  });

  it('a backup that fails is not logged', async () => {
    const file = path.join(tmp('arc40-log-file-'), 'not-a-folder');
    fs.writeFileSync(file, 'x');
    await expect(backupNow(t.store.current(), file, t.clock.now())).rejects.toThrow();
    expect(log()).toEqual([]);
  });

  it('backup files already in the folder give their dates (from the name) and nothing else', () => {
    const dir = tmp('arc40-log-files-');
    for (const f of ['arc40-backup-2026-08-02-101500.db', 'arc40-backup-2026-09-30-090000-before-update.db', 'arc40-backup-oops.db', 'notes.txt'])
      fs.writeFileSync(path.join(dir, f), 'x');
    expect(backupFileDates(dir)).toEqual(['2026-08-02', '2026-09-30']);
    expect(backupFileDates(path.join(dir, 'missing'))).toEqual([]);
  });
});

describe('Arc40 Wrapped watched to the last slide', () => {
  it('stores the year watched and the date; a year without slides or a bad body is refused', async () => {
    const acct = (await ok({ method: 'POST', url: '/api/accounts', payload: { name: 'Fake Checking', type: 'checking' } })).account.id;
    await ok({ method: 'POST', url: '/api/transactions', payload: { accountId: acct, date: '2025-03-04', amount: '40', direction: 'out', description: 'Fake Shop', type: 'expense' } });
    await ok({ method: 'POST', url: '/api/activity/wrapped-watched', payload: { year: 2025 } });
    expect(log()).toEqual([{ kind: 'wrapped', date: '2026-11-11', at: t.clock.now(), backupKind: null, year: 2025, allMatched: null }]);
    expect((await call({ method: 'POST', url: '/api/activity/wrapped-watched', payload: { year: 2019 } })).statusCode).toBe(400);
    expect((await call({ method: 'POST', url: '/api/activity/wrapped-watched', payload: { year: '2025' } })).statusCode).toBe(400);
    expect((await call({ method: 'POST', url: '/api/activity/wrapped-watched', payload: { year: 2025, slides: 3 } })).statusCode).toBe(400);
    expect(log()).toHaveLength(1);
  });

  it('closing early records nothing: only the player calls this route, and only on the last slide', () => {
    const src = fs.readFileSync(path.resolve('web/src/components/Wrapped.tsx'), 'utf8');
    const i = src.indexOf("'/api/activity/wrapped-watched'");
    expect(i).toBeGreaterThan(0);
    // The call sits inside the effect guarded by `last` (the last slide is showing).
    expect(src.slice(src.lastIndexOf('useEffect(', i), i)).toMatch(/if \(!last \|\| !loaded/);
    expect(src.match(/wrapped-watched/g)).toHaveLength(1);
  });
});

describe('positions imports', () => {
  const fund = (accountId: number | null, matches: boolean) => ({ accountId, matches });
  it('every share count matched = yes; a share difference, a fund to set to 0, or nothing matched = no', () => {
    expect(shareCheckClean({ funds: [fund(1, true), fund(2, true), fund(null, false)], missing: [] } as never)).toBe(true);
    expect(shareCheckClean({ funds: [fund(1, true), fund(2, false)], missing: [] } as never)).toBe(false);
    expect(shareCheckClean({ funds: [fund(1, true)], missing: [{ accountId: 1 }] } as never)).toBe(false);
    expect(shareCheckClean({ funds: [fund(null, false)], missing: [] } as never)).toBe(false);
  });

  it('a saved import is logged with the same yes/no the preview flags show; a preview logs nothing', async () => {
    const acct = async (name: string, type: string) => (await ok({ method: 'POST', url: '/api/accounts', payload: { name, type } })).account.id as number;
    const ids = { brokerage: await acct('Brokerage', 'brokerage'), roth: await acct('Roth IRA', 'roth_ira') };
    await ok({ method: 'POST', url: '/api/import/commit', payload: { accountId: ids.brokerage, filename: 'b.csv', text: fixture('fidelity-brokerage.csv') } });
    await ok({ method: 'POST', url: '/api/import/commit', payload: { accountId: ids.roth, filename: 'r.csv', text: fixture('fidelity-roth.csv') } });
    const text = fixture('fidelity-positions.csv');
    const mapping = [
      { name: 'Individual', accountId: ids.brokerage },
      { name: 'ROTH IRA', accountId: ids.roth },
    ];
    await ok({ method: 'POST', url: '/api/investments/positions/preview', payload: { text, mapping } });
    expect(log()).toEqual([]);
    const saved = await ok({ method: 'POST', url: '/api/investments/positions/commit', payload: { text, priceDate: '2026-11-10', mapping } });
    expect(log()).toEqual([{ kind: 'positions', date: '2026-11-11', at: t.clock.now(), backupKind: null, year: null, allMatched: shareCheckClean(saved) }]);
  });
});

describe('privacy and demo mode', () => {
  it('stores no path, file name, account name or number: only these columns exist', async () => {
    await ok({ method: 'POST', url: '/api/backups' });
    const cols = (t.store.current().prepare('PRAGMA table_info(activity_log)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['id', 'kind', 'on_date', 'at', 'backup_kind', 'year', 'all_matched']);
    const dump = JSON.stringify(t.store.current().prepare('SELECT * FROM activity_log').all());
    expect(dump).not.toMatch(/[\\/]|arc40-backup|\.db|Arc40Backups/);
  });

  it('in demo mode the log is written to the demo database only', async () => {
    const real = t.store.current();
    const enter = await call({ method: 'POST', url: '/api/demo/enter' });
    auth = { cookie: cookieFrom(enter), csrf: enter.json().csrfToken };
    const demo = t.store.current();
    expect(demo).not.toBe(real);
    const before = loadActivityLog(demo).length;
    const year = (await ok({ method: 'GET', url: '/api/wrapped/years' })).years[0].year as number;
    await ok({ method: 'POST', url: '/api/activity/wrapped-watched', payload: { year } });
    expect(loadActivityLog(demo)).toHaveLength(before + 1);
    expect(loadActivityLog(real)).toEqual([]);
    // Back up now stays refused in demo mode, so nothing is logged for it.
    expect((await call({ method: 'POST', url: '/api/backups' })).statusCode).toBe(403);
    expect(loadActivityLog(real)).toEqual([]);
  });

  it('logBackup on a database from before 018 does nothing (no table, no error)', () => {
    const dir = tmp('arc40-log-none-');
    const db = openDatabase(dir);
    db.exec('DROP TABLE activity_log');
    expect(() => logBackup(db, 'manual', Date.UTC(2026, 10, 11))).not.toThrow();
    db.close();
  });
});

async function relogin() {
  const r = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: HOST_HEADER, payload: { password: 'correct horse battery' } });
  return { cookie: cookieFrom(r), csrf: r.json().csrfToken as string };
}
