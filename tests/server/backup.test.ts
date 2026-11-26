import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';
import { makeZip, readZip } from '../../server/src/lib/zip.js';
import { csvCell, money, toCsv } from '../../server/src/lib/exporter.js';
import { backupIfDue, backupNow, isArc40Database, KEEP_BACKUPS, listBackups } from '../../server/src/lib/backup.js';
import { openDatabase } from '../../server/src/db/database.js';
import { buildApp } from '../../server/src/app.js';
import { HOST } from '../../server/src/config.js';
import { restore } from '../../scripts/restore.js';

const tmpdir = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

describe('zip', () => {
  it('round-trips files, including non-ASCII names', () => {
    const z = makeZip([
      { name: 'a.txt', data: Buffer.from('hello') },
      { name: 'csv/café.csv', data: Buffer.from('x,y\r\n1,2\r\n'.repeat(500)) },
    ]);
    const files = readZip(z);
    expect(files.get('a.txt')!.toString()).toBe('hello');
    expect(files.get('csv/café.csv')!.toString()).toBe('x,y\r\n1,2\r\n'.repeat(500));
  });

  it('is a valid ZIP for the system unzip tool (when installed)', () => {
    const which = spawnSync('which', ['unzip']);
    if (which.status !== 0) return;
    const dir = tmpdir('arc40-zip-');
    const f = path.join(dir, 't.zip');
    fs.writeFileSync(f, makeZip([{ name: 'x/y.txt', data: Buffer.from('ok') }]));
    expect(spawnSync('unzip', ['-t', f]).status).toBe(0);
  });
});

describe('CSV export safety', () => {
  it.each([
    ['=SUM(A1:A9)', "'=SUM(A1:A9)"],
    ['+1 555 0100', "'+1 555 0100"],
    ['-cmd', "'-cmd"],
    ['@foo', "'@foo"],
    ['\tTAB', "'\tTAB"],
    ['normal text', 'normal text'],
  ])('text %j is defused', (input, out) => {
    expect(csvCell(input)).toBe(out);
  });

  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a, "b"')).toBe('"a, ""b"""');
    expect(csvCell('=x,y')).toBe(`"'=x,y"`);
  });

  it('amounts stay numbers: negative money is not formula-escaped, and is exact', () => {
    expect(csvCell(money(-1234))).toBe('-12.34');
    expect(csvCell(money(5))).toBe('0.05');
    expect(csvCell(money(0))).toBe('0.00');
    expect(toCsv(['a', 'b'], [[money(-100), 'x']])).toBe('a,b\r\n-1.00,x\r\n');
  });
});

let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };
const call = (opts: InjectOptions) => t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });

describe('export everything', () => {
  beforeEach(async () => {
    t = await testApp();
    const s = await setupAndLogin(t);
    auth = { cookie: s.cookie, csrf: s.csrf };
    const acct = (await call({ method: 'POST', url: '/api/accounts', payload: { name: 'Checking', type: 'checking', openingBalance: '100' } })).json().account.id;
    await call({ method: 'POST', url: '/api/transactions', payload: { accountId: acct, date: '2026-11-01', amount: '12.34', direction: 'out', description: '=HYPERLINK("http://evil")', type: 'expense' } });
    await call({ method: 'POST', url: '/api/transactions', payload: { accountId: acct, date: '2026-11-02', amount: '100', direction: 'in', description: 'Birthday', type: 'gift', giftFrom: 'Mom' } });
  });
  afterEach(async () => {
    await t.app.close();
  });

  it('downloads a ZIP with the database, CSVs and JSON; login data never in CSV/JSON', async () => {
    const res = await call({ method: 'GET', url: '/api/export' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(String(res.headers['content-disposition'])).toMatch(/attachment; filename="arc40-export-2026-11-11\.zip"/);
    const files = readZip(res.rawPayload);
    expect([...files.keys()]).toEqual(
      expect.arrayContaining(['README.txt', 'arc40.db', 'arc40.json', 'csv/transactions.csv', 'csv/accounts.csv', 'csv/balances.csv', 'csv/investment_activity.csv', 'csv/budgets.csv']),
    );

    const tx = files.get('csv/transactions.csv')!.toString();
    expect(tx).toContain(`"'=HYPERLINK(""http://evil"")"`); // defused formula
    expect(tx).toContain(',-12.34,expense,');
    expect(tx).toContain(',100.00,gift,,Mom,');

    const json = JSON.parse(files.get('arc40.json')!.toString());
    expect(json.app_user).toBeUndefined();
    expect(json.sessions).toBeUndefined();
    expect(json.transactions).toHaveLength(2);

    // The database copy is a real, restorable Arc40 database, minus login sessions.
    const dir = tmpdir('arc40-exp-');
    const f = path.join(dir, 'arc40.db');
    fs.writeFileSync(f, files.get('arc40.db')!);
    expect(isArc40Database(f)).toBe(true);
    const d = new DatabaseSync(f, { readOnly: true });
    expect((d.prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n).toBe(2);
    expect((d.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n).toBe(0);
    d.close();
  });

  it('needs login', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/export', headers: HOST_HEADER });
    expect(res.statusCode).toBe(401);
  });

  it('back up now from the app, and list backups', async () => {
    const r = await call({ method: 'POST', url: '/api/backups' });
    expect(r.statusCode).toBe(200);
    const list = (await call({ method: 'GET', url: '/api/backups' })).json();
    expect(list.backups).toHaveLength(1);
    expect(list.backups[0].name).toMatch(/^arc40-backup-2026-11-11-\d{6}\.db$/);
    expect(list.dir).toBe(t.config.backupDir);
    expect(list.dir.startsWith(os.homedir() + '/Arc40Backups')).toBe(false); // tests never touch the real folder
  });
});

describe('weekly automatic backups', () => {
  it('first run backs up, then waits a week; keeps the newest 12', async () => {
    const db = openDatabase(':memory:');
    const dir = tmpdir('arc40-bk-');
    const day = 24 * 60 * 60 * 1000;
    const t0 = Date.UTC(2026, 0, 1, 12);
    expect(await backupIfDue(db, dir, t0)).not.toBeNull();
    expect(await backupIfDue(db, dir, t0 + 6 * day)).toBeNull();
    expect(await backupIfDue(db, dir, t0 + 7 * day)).not.toBeNull();
    for (let i = 0; i < 20; i++) await backupNow(db, dir, t0 + (8 + i) * day);
    const kept = listBackups(dir);
    expect(kept).toHaveLength(KEEP_BACKUPS);
    expect(kept[0]!.name).toContain('2026-01-28'); // newest first
    expect(kept.every((b) => isArc40Database(b.path))).toBe(true);
    expect(fs.readdirSync(dir).some((f) => f.endsWith('.part'))).toBe(false);
  });
});

describe('restore', () => {
  it('brings back the data from a backup and keeps the replaced database aside', async () => {
    const dataDir = tmpdir('arc40-data-');
    const backupDir = tmpdir('arc40-bk-');
    let db = openDatabase(dataDir);
    db.prepare("INSERT INTO accounts (name, type, class, created_at, updated_at) VALUES ('Before', 'checking', 'asset', 0, 0)").run();
    const b = await backupNow(db, backupDir, Date.UTC(2026, 10, 1));
    db.prepare("INSERT INTO accounts (name, type, class, created_at, updated_at) VALUES ('After', 'checking', 'asset', 0, 0)").run();
    db.close();

    const savedAs = await restore(b.path, dataDir);
    db = openDatabase(dataDir);
    expect((db.prepare('SELECT name FROM accounts ORDER BY id').all() as { name: string }[]).map((r) => r.name)).toEqual(['Before']);
    db.close();
    expect(fs.existsSync(savedAs)).toBe(true);
    const old = new DatabaseSync(savedAs, { readOnly: true });
    expect((old.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n).toBe(2); // nothing lost
    old.close();
  });

  it('refuses files that are not Arc40 databases', async () => {
    const dir = tmpdir('arc40-bad-');
    const f = path.join(dir, 'x.db');
    fs.writeFileSync(f, 'not a database');
    await expect(restore(f, dir)).rejects.toThrow(/not an Arc40 database/);
    await expect(restore(path.join(dir, 'missing.db'), dir)).rejects.toThrow(/not found/);
  });

  it('refuses to run while Arc40 is open', async () => {
    const dataDir = tmpdir('arc40-run-');
    const { app } = await buildApp({ dataDir, port: 0, webDistDir: '/nonexistent', backupDir: tmpdir('arc40-bk-') });
    await app.listen({ host: HOST, port: 0 });
    const port = (app.addresses()[0] as { port: number }).port;
    const db = openDatabase(tmpdir('arc40-src-'));
    const b = await backupNow(db, tmpdir('arc40-bk2-'), Date.now());
    await expect(restore(b.path, dataDir, { checkRunning: port })).rejects.toThrow(/still running/);
    await app.close();
  });
});
