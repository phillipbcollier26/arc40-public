/**
 * In-app demo mode: strict isolation from real data. Most tests use a REAL file on disk (not an
 * in-memory database) so they can prove the real arc40.db is never written while demo mode is on.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../server/src/app.js';
import { loadConfig } from '../../server/src/config.js';
import { DataStore } from '../../server/src/db/dataStore.js';
import { openDatabase, type DB } from '../../server/src/db/database.js';
import { demoBlockReason, exportFilename, IMPORT_OFF_IN_DEMO } from '../../server/src/lib/demoPolicy.js';
import { LOCKOUT_MS, MAX_FAILURES } from '../../server/src/auth/loginThrottle.js';
import { cookieFrom, fakeClock, HOST_HEADER, testApp } from './helpers.js';

const PASSWORD = 'real password 123';
/** Values that exist only in the REAL database. None may ever show up while in demo mode. */
const REAL_MARKERS = ['Secret Real Bank', 'Zork Checking', 'PAYCHECK FROM ZORKCORP', '9876543', '98,765.43'];

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

/** An app backed by real files in temp folders, like the user's Mac. */
async function fileApp(dirs = { dataDir: tmp('arc40-real-'), demoDir: tmp('arc40-demo-'), backupDir: tmp('arc40-bk-') }) {
  const clock = fakeClock();
  const built = await buildApp({ ...dirs, now: clock.now, webDistDir: '/nonexistent', port: 4040 });
  cleanups.push(() => built.app.close());
  return { ...built, clock, dirs };
}
type App = Awaited<ReturnType<typeof fileApp>>;

interface Client {
  cookie: string;
  csrf: string;
}

async function call(t: App, c: Client | null, method: string, url: string, payload?: unknown) {
  const res = await t.app.inject({
    method: method as 'GET',
    url,
    headers: { ...HOST_HEADER, ...(c ? { cookie: c.cookie } : {}), ...(c && method !== 'GET' ? { 'x-csrf-token': c.csrf } : {}) },
    payload: payload as object,
  });
  return res;
}

/** Sets the real password and adds real-looking data that must never leak into demo mode. */
async function setupReal(t: App): Promise<Client> {
  const res = await call(t, null, 'POST', '/api/auth/setup', { password: PASSWORD });
  const c = { cookie: cookieFrom(res), csrf: res.json().csrfToken as string };
  const acct = await call(t, c, 'POST', '/api/accounts', {
    name: 'Zork Checking',
    institution: 'Secret Real Bank',
    type: 'checking',
    openingBalance: '98,765.43',
    openingDate: '2026-11-01',
  });
  expect(acct.statusCode).toBeLessThan(300);
  const tx = await call(t, c, 'POST', '/api/transactions', {
    accountId: acct.json().account.id,
    date: '2026-11-05',
    amount: '1,234.00',
    direction: 'in',
    description: 'PAYCHECK FROM ZORKCORP',
    type: 'income',
  });
  expect(tx.statusCode).toBeLessThan(300);
  return c;
}

async function enterDemo(t: App, c: Client): Promise<Client> {
  const res = await call(t, c, 'POST', '/api/demo/enter');
  expect(res.statusCode, res.body).toBe(200);
  return { cookie: cookieFrom(res), csrf: res.json().csrfToken };
}

const sha = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const realFiles = (dir: string) => fs.readdirSync(dir).filter((f) => f.startsWith('arc40.db')).sort();

describe('demo mode isolation', () => {
  it('never writes the real database: byte-for-byte unchanged after adding and editing demo data', async () => {
    const t = await fileApp();
    const real = await setupReal(t);
    const demo = await enterDemo(t, real);

    // The real database is closed in demo mode, so its WAL is folded in and the file stops changing.
    expect(t.store.realIfOpen()).toBeNull();
    const file = path.join(t.dirs.dataDir, 'arc40.db');
    const before = { hash: sha(file), mtime: fs.statSync(file).mtimeMs, files: realFiles(t.dirs.dataDir) };
    expect(before.files).toEqual(['arc40.db']);

    // A busy demo session: add, edit and delete across several areas.
    const accts = (await call(t, demo, 'GET', '/api/accounts')).json().accounts as { id: number; name: string }[];
    const added = await call(t, demo, 'POST', '/api/transactions', {
      accountId: accts[0]!.id, date: '2026-11-10', amount: '12.34', direction: 'out', description: 'Demo coffee', type: 'expense',
    });
    expect(added.statusCode).toBeLessThan(300);
    const txId = added.json().transaction.id as number;
    expect((await call(t, demo, 'PATCH', `/api/transactions/${txId}`, { notes: 'edited in demo' })).statusCode).toBe(200);
    expect((await call(t, demo, 'POST', '/api/categories', { name: 'Demo Category', kind: 'expense' })).statusCode).toBeLessThan(300);
    expect((await call(t, demo, 'POST', '/api/goals', { name: 'Demo goal', target: '500' })).statusCode).toBeLessThan(300);
    expect((await call(t, demo, 'PATCH', `/api/accounts/${accts[0]!.id}`, { name: 'Renamed demo account' })).statusCode).toBe(200);
    expect((await call(t, demo, 'DELETE', `/api/transactions/${txId}`)).statusCode).toBe(200);
    expect((await call(t, demo, 'DELETE', `/api/accounts/${accts[1]!.id}`)).statusCode).toBe(200);
    expect((await call(t, demo, 'GET', '/api/export')).statusCode).toBe(200);
    t.clock.advance(60_000);
    expect((await call(t, demo, 'POST', '/api/auth/keepalive')).statusCode).toBe(200);

    expect(sha(file)).toBe(before.hash);
    expect(fs.statSync(file).mtimeMs).toBe(before.mtime);
    expect(realFiles(t.dirs.dataDir)).toEqual(before.files); // no -wal / -shm: never even opened

    // The demo changes went to the demo database only.
    const demoDb = openDatabase(t.dirs.demoDir);
    try {
      expect(demoDb.prepare("SELECT COUNT(*) AS n FROM categories WHERE name = 'Demo Category'").get()).toEqual({ n: 1 });
    } finally {
      demoDb.close();
    }
  });

  it('trophy clicks in demo mode (turn on, take back, whole shelf, check) never touch the real database', async () => {
    const t = await fileApp();
    const real = await setupReal(t);
    const demo = await enterDemo(t, real);
    const file = path.join(t.dirs.dataDir, 'arc40.db');
    const before = { hash: sha(file), mtime: fs.statSync(file).mtimeMs, files: realFiles(t.dirs.dataDir) };

    const list = (await call(t, demo, 'GET', '/api/trophies')).json() as { counts: { earned: number }; trophies: { key: string; state: string }[] };
    expect(list.counts.earned).toBeGreaterThan(5); // the demo's own trophies
    const earned = list.trophies.find((x) => x.state === 'earned')!.key;
    const off = list.trophies.find((x) => x.state === 'off')!.key;
    expect((await call(t, demo, 'POST', `/api/trophies/${off}/on`, { mode: 'today' })).statusCode).toBe(200);
    expect((await call(t, demo, 'POST', `/api/trophies/${earned}/take-back`)).statusCode).toBe(200);
    expect((await call(t, demo, 'POST', '/api/trophies/groups/roth/on')).statusCode).toBe(200);
    expect((await call(t, demo, 'POST', '/api/trophies/evaluate')).statusCode).toBe(200);
    expect((await call(t, demo, 'GET', `/api/trophies/${earned}`)).json().state).toBe('off');

    expect(sha(file)).toBe(before.hash);
    expect(fs.statSync(file).mtimeMs).toBe(before.mtime);
    expect(realFiles(t.dirs.dataDir)).toEqual(before.files);
  });

  it('Trophies Round 2: demo awards are already celebrated; Play an unlock shows 3 rising ranks and awards / marks nothing', async () => {
    const t = await fileApp();
    const real = await setupReal(t);
    const demo = await enterDemo(t, real);
    const file = path.join(t.dirs.dataDir, 'arc40.db');
    const before = { hash: sha(file), files: realFiles(t.dirs.dataDir) };

    expect((await call(t, demo, 'GET', '/api/trophies/unseen')).json().trophies).toEqual([]); // entering demo opens no pop-up
    // ...not even after the check the app runs when it opens (a watched demo trophy that qualifies was earned at seed time).
    expect((await call(t, demo, 'POST', '/api/trophies/evaluate')).json().earned).toEqual([]);
    expect((await call(t, demo, 'GET', '/api/trophies/unseen')).json().trophies).toEqual([]);
    const list = (await call(t, demo, 'GET', '/api/trophies')).json();
    const play = (await call(t, demo, 'GET', '/api/trophies/demo-unlock')).json().trophies as { key: string; rank: string; stars: number; state: string }[];
    expect(play.map((x) => x.rank)).toEqual(['silver', 'gold', 'arc40', 'arc40']);
    expect(play[2]!.stars).toBeGreaterThan(0); // an Arc40 star level for the build-up
    expect(play.every((x) => x.state === 'earned')).toBe(true);
    // Round 4: the queue ends on The Arc, shown as a preview of it earned (it stays watched in the list below).
    expect(play.at(-1)!.key).toBe('the-arc');
    expect((list.trophies as { key: string; state: string }[]).find((x) => x.key === 'the-arc')!.state).toBe('on');
    // Nothing changed: same trophies, nothing waiting, nothing new earned.
    expect((await call(t, demo, 'GET', '/api/trophies')).json()).toEqual(list);
    expect((await call(t, demo, 'GET', '/api/trophies/unseen')).json().trophies).toEqual([]);
    // Both new shelves show every state, and both have a record plaque with older records.
    for (const g of ['investing', 'refereeing']) {
      const mine = (list.trophies as { group: string; state: string; shape: string; records: unknown[] }[]).filter((x) => x.group === g);
      expect(new Set(mine.map((x) => x.state)), g).toEqual(new Set(['earned', 'on', 'off']));
      expect(mine.some((x) => x.shape === 'plaque' && x.state === 'earned' && x.records.length > 1), g).toBe(true);
    }
    expect(sha(file)).toBe(before.hash);
    expect(realFiles(t.dirs.dataDir)).toEqual(before.files);
  });

  it('Trophies Round 3: both new shelves show every state, a cup mid-run, an earned statuette and one counting from today', async () => {
    const t = await fileApp();
    const real = await setupReal(t);
    const demo = await enterDemo(t, real);
    const file = path.join(t.dirs.dataDir, 'arc40.db');
    const before = { hash: sha(file), files: realFiles(t.dirs.dataDir) };
    expect((await call(t, demo, 'POST', '/api/trophies/evaluate')).json().earned).toEqual([]); // calm: nothing new
    const list = (await call(t, demo, 'GET', '/api/trophies')).json();
    type V = { key: string; group: string; state: string; shape: string; mode: string | null; progress: { fraction: number } | null };
    const all = list.trophies as V[];
    for (const g of ['emergency', 'spending']) {
      const mine = all.filter((x) => x.group === g);
      expect(new Set(mine.map((x) => x.state)), g).toEqual(new Set(['earned', 'on', 'off']));
    }
    const r3 = all.filter((x) => x.group === 'emergency' || x.group === 'spending');
    expect(r3.some((x) => x.shape === 'statuette' && x.state === 'earned')).toBe(true);
    expect(r3.some((x) => x.shape === 'cup' && x.state === 'earned')).toBe(true);
    const midRun = r3.filter((x) => x.shape === 'cup' && x.state === 'on' && x.progress && x.progress.fraction > 0 && x.progress.fraction < 1);
    expect(midRun.length).toBeGreaterThan(0);
    expect(midRun.some((x) => x.mode === 'today')).toBe(true); // the fully funded cup, counting from today
    expect(r3.find((x) => x.key === 'sp.subs-cheaper')!.state).toBe('earned');
    // The demo's cancelled fake plan shows on the Recurring page, like any cancellation.
    const rec = (await call(t, demo, 'GET', '/api/recurring')).json();
    expect(rec.cancelled.map((c: { name: string }) => c.name)).toContain('StreamPlus Sports');
    // One more cancellation in demo mode (as the Recurring e2e spec does) earns nothing, so no unlock moment pops up over
    // the next screen. (It did once: "Cut 3 subscriptions" was watched with 2 already cancelled.)
    const item = (rec.items as { id: number }[])[0]!;
    expect((await call(t, demo, 'POST', `/api/recurring/${item.id}/cancel`)).statusCode).toBe(200);
    expect((await call(t, demo, 'POST', '/api/trophies/evaluate')).json().earned).toEqual([]);
    expect(sha(file)).toBe(before.hash);
    expect(realFiles(t.dirs.dataDir)).toEqual(before.files);
  });

  it('Trophies Round 4: both new shelves show every state, The Arc is watched with its time progress, fake log rows', async () => {
    const t = await fileApp();
    const real = await setupReal(t);
    const demo = await enterDemo(t, real);
    const file = path.join(t.dirs.dataDir, 'arc40.db');
    const before = { hash: sha(file), files: realFiles(t.dirs.dataDir) };
    expect((await call(t, demo, 'POST', '/api/trophies/evaluate')).json().earned).toEqual([]); // calm: nothing new
    expect((await call(t, demo, 'GET', '/api/trophies/unseen')).json().trophies).toEqual([]);
    const list = (await call(t, demo, 'GET', '/api/trophies')).json();
    type V = { key: string; group: string; state: string; shape: string; mode: string | null; progress: { text: string; fraction: number } | null };
    const all = list.trophies as V[];
    for (const g of ['tidy', 'long_game']) {
      const mine = all.filter((x) => x.group === g);
      expect(new Set(mine.map((x) => x.state)), g).toEqual(new Set(['earned', 'on', 'off']));
      expect(mine.some((x) => x.shape === 'cup' && x.state === 'on' && x.progress!.fraction > 0 && x.progress!.fraction < 1), g).toBe(
        g === 'tidy',
      );
    }
    // The log-based trophies are earned from the fake log rows; an anniversary banner is earned and this year's counts down.
    for (const k of ['td.first-backup', 'td.backup.6', 'td.fidelity-clean', 'lg.wrapped.1', 'lg.goals.1', 'lg.collector.25'])
      expect(all.find((x) => x.key === k)?.state, k).toBe('earned');
    expect(all.filter((x) => x.key.startsWith('lg.anniversary:')).map((x) => x.state)).toContain('earned');
    // The Arc: watched, with its time progress, at the end of the list (its own spot, not a shelf).
    const arc = all.at(-1)!;
    expect(arc).toMatchObject({ key: 'the-arc', state: 'on' });
    expect(arc.progress!.text).toMatch(/^\d+ years(, \d+ months?)? to go$/);
    expect(sha(file)).toBe(before.hash);
    expect(realFiles(t.dirs.dataDir)).toEqual(before.files);
  });

  it('shows no real data in any API response while in demo mode', async () => {
    const t = await fileApp();
    const real = await setupReal(t);
    const demo = await enterDemo(t, real);
    const accts = (await call(t, demo, 'GET', '/api/accounts')).json().accounts as { id: number }[];
    const urls = [
      '/api/auth/status', '/api/accounts', '/api/accounts?archived=1', `/api/accounts/${accts[0]!.id}`,
      '/api/networth?range=all', '/api/transactions?limit=500', '/api/categories', '/api/rules', '/api/import/batches',
      '/api/budget', '/api/cashflow?months=24', '/api/settings', '/api/investments', '/api/goals', '/api/dashboard',
      '/api/backups', '/api/export',
    ];
    for (const url of urls) {
      const res = await call(t, demo, 'GET', url);
      expect(res.headers['x-arc40-mode'], url).toBe('demo');
      const body = url === '/api/export' ? res.rawPayload.toString('latin1') : res.body;
      for (const marker of REAL_MARKERS) expect(body, `${url} leaked "${marker}"`).not.toContain(marker);
    }
    // The export is the demo dataset, labeled as demo.
    const exp = await call(t, demo, 'GET', '/api/export');
    expect(exp.headers['content-disposition']).toMatch(/filename="arc40-demo-export-\d{4}-\d{2}-\d{2}\.zip"/);
  });

  it('pins each request to the database it started with, even if the mode switches mid-request', async () => {
    const realDb = openDatabase(':memory:');
    realDb.exec("INSERT INTO settings (key, value) VALUES ('marker', '\"real\"')");
    const store = new DataStore({ realDir: tmp('arc40-r-'), demoDir: tmp('arc40-d-'), injectedReal: realDb, now: fakeClock().now });
    const read = (db: DB) => (db.prepare("SELECT value FROM settings WHERE key = 'marker'").get() as { value: string } | undefined)?.value;
    let seen: (string | undefined)[] = [];
    await new Promise<void>((resolve, reject) => {
      store.pin(() => {
        seen.push(read(store.db));
        store
          .enterDemo(() => {})
          .then(() => {
            seen.push(read(store.db)); // still the real database: this "request" started in real mode
            resolve();
          }, reject);
      });
    });
    expect(seen).toEqual(['"real"', '"real"']);
    // A request that arrives after the switch gets the demo database.
    seen = [];
    store.pin(() => seen.push(read(store.db)));
    expect(seen).toEqual([undefined]);
    store.close();
    realDb.close();
  });

  it('refuses requests from a tab still holding the other mode\'s security token', async () => {
    const t = await fileApp();
    const real = await setupReal(t);
    const demo = await enterDemo(t, real);
    // An old real tab shares the browser cookie (now the demo one) but still has the real CSRF token.
    const stale = { cookie: demo.cookie, csrf: real.csrf };
    const res = await call(t, stale, 'POST', '/api/categories', { name: 'From a stale tab', kind: 'expense' });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('CSRF');
    // And the old real session itself is gone.
    expect((await call(t, real, 'GET', '/api/accounts')).statusCode).toBe(401);
  });

  it('keeps the in-app demo file separate from the real data and from `npm run demo`', () => {
    const a = loadConfig({ port: 4040 });
    const b = loadConfig({ port: 4041, dataDir: path.resolve('demo-data') });
    expect(a.demoDir).toMatch(/demo-data[/\\]in-app-4040$/);
    expect(b.demoDir).toMatch(/demo-data[/\\]in-app-4041$/);
    expect(path.join(b.demoDir, 'arc40.db')).not.toBe(path.join(b.dataDir, 'arc40.db'));
    const same = tmp('arc40-same-');
    expect(() => new DataStore({ realDir: same, demoDir: same, now: Date.now })).toThrow(/must not be the real data folder/);
  });
});

describe('entering and leaving demo mode', () => {
  it('enters with one click from a logged-in real session, and status reports the mode', async () => {
    const t = await fileApp();
    const real = await setupReal(t);
    expect((await call(t, null, 'POST', '/api/demo/enter')).statusCode).toBe(401);
    const demo = await enterDemo(t, real);
    const s = (await call(t, demo, 'GET', '/api/auth/status')).json();
    expect(s).toMatchObject({ mode: 'demo', authenticated: true, setupRequired: false });
    expect((await call(t, demo, 'POST', '/api/demo/enter')).statusCode).toBe(403);
    const names = ((await call(t, demo, 'GET', '/api/accounts')).json().accounts as { name: string }[]).map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(['Everyday Checking', 'High-Yield Savings', 'Roth IRA', 'Index Brokerage']));
  });

  it('leaving needs the REAL password; a wrong one is refused and counts toward the lockout', async () => {
    const t = await fileApp();
    const demo = await enterDemo(t, await setupReal(t));
    expect((await call(t, demo, 'POST', '/api/demo/exit', { password: 'demo1234' })).statusCode).toBe(401); // the demo's own password is not enough
    for (let i = 1; i < MAX_FAILURES; i++) {
      expect((await call(t, demo, 'POST', '/api/demo/exit', { password: `wrong ${i}` })).statusCode).toBe(401);
    }
    // 5 wrong tries: locked, even for the right password, and the login screen shares the same lock.
    expect((await call(t, demo, 'POST', '/api/demo/exit', { password: PASSWORD })).statusCode).toBe(429);
    expect((await call(t, null, 'POST', '/api/auth/login', { password: PASSWORD })).statusCode).toBe(429);
    expect(t.store.mode).toBe('demo');

    t.clock.advance(LOCKOUT_MS + 1);
    const out = await call(t, demo, 'POST', '/api/demo/exit', { password: PASSWORD });
    expect(out.statusCode).toBe(200);
    const real = { cookie: cookieFrom(out), csrf: out.json().csrfToken };
    expect(t.store.mode).toBe('real');
    const names = ((await call(t, real, 'GET', '/api/accounts')).json().accounts as { name: string }[]).map((a) => a.name);
    expect(names).toEqual(['Zork Checking']);
    expect((await call(t, demo, 'GET', '/api/accounts')).statusCode).toBe(401); // demo session ended
    expect((await call(t, real, 'POST', '/api/demo/exit', { password: PASSWORD })).statusCode).toBe(403);
  });

  it('wrong-password logins count toward the same lockout as leaving demo mode', async () => {
    const t = await fileApp();
    const demo = await enterDemo(t, await setupReal(t));
    for (let i = 0; i < MAX_FAILURES; i++) await call(t, null, 'POST', '/api/auth/login', { password: 'nope' });
    expect((await call(t, demo, 'POST', '/api/demo/exit', { password: PASSWORD })).statusCode).toBe(429);
  });

  it('unlocks with the real password after auto-lock in demo mode, and stays in demo', async () => {
    const t = await fileApp();
    const real = await setupReal(t);
    expect((await call(t, real, 'PUT', '/api/settings/session', { idleTimeoutMinutes: 15 })).statusCode).toBe(200);
    const demo = await enterDemo(t, real);
    expect((await call(t, demo, 'GET', '/api/auth/status')).json().idleTimeoutMinutes).toBe(15);
    t.clock.advance(15 * 60_000 + 1); // same auto-lock as real mode
    expect((await call(t, demo, 'GET', '/api/accounts')).statusCode).toBe(401);
    expect((await call(t, null, 'POST', '/api/auth/login', { password: 'demo1234' })).statusCode).toBe(401);
    const back = await call(t, null, 'POST', '/api/auth/login', { password: PASSWORD });
    expect(back.statusCode).toBe(200);
    const c = { cookie: cookieFrom(back), csrf: back.json().csrfToken };
    expect((await call(t, c, 'GET', '/api/auth/status')).json().mode).toBe('demo');
  });

  it('always starts in real mode after a restart', async () => {
    const dirs = { dataDir: tmp('arc40-real-'), demoDir: tmp('arc40-demo-'), backupDir: tmp('arc40-bk-') };
    const first = await fileApp(dirs);
    await enterDemo(first, await setupReal(first));
    expect(first.store.mode).toBe('demo');
    await first.app.close();

    const second = await fileApp(dirs);
    expect(second.store.mode).toBe('real');
    const s = (await call(second, null, 'GET', '/api/auth/status')).json();
    expect(s).toMatchObject({ mode: 'real', authenticated: false, setupRequired: false });
    const login = await call(second, null, 'POST', '/api/auth/login', { password: PASSWORD });
    const c = { cookie: cookieFrom(login), csrf: login.json().csrfToken };
    expect(((await call(second, c, 'GET', '/api/accounts')).json().accounts as { name: string }[])[0]!.name).toBe('Zork Checking');
  });
});

describe('what demo mode turns off', () => {
  it('refuses CSV import on the server', async () => {
    const t = await fileApp();
    const demo = await enterDemo(t, await setupReal(t));
    const accountId = ((await call(t, demo, 'GET', '/api/accounts')).json().accounts as { id: number }[])[0]!.id;
    for (const url of ['/api/import/preview', '/api/import/commit']) {
      const res = await call(t, demo, 'POST', url, { accountId, filename: 'bank.csv', text: 'Date,Amount,Description\n2026-11-01,-5.00,Coffee\n' });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe(IMPORT_OFF_IN_DEMO);
    }
  });

  it('writes nothing to the backup folder: no back up now, no list, no safety backup on delete', async () => {
    const t = await fileApp();
    const real = await setupReal(t);
    expect((await call(t, real, 'POST', '/api/backups')).statusCode).toBe(200); // works in real mode
    const before = fs.readdirSync(t.dirs.backupDir).sort();
    expect(before).toHaveLength(1);

    const demo = await enterDemo(t, real);
    const res = await call(t, demo, 'POST', '/api/backups');
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/turned off in demo mode/);
    expect((await call(t, demo, 'GET', '/api/backups')).json()).toMatchObject({ demo: true, backups: [] });
    const accountId = ((await call(t, demo, 'GET', '/api/accounts')).json().accounts as { id: number }[])[0]!.id;
    expect((await call(t, demo, 'DELETE', `/api/accounts/${accountId}`)).statusCode).toBe(200);
    // The automatic weekly backup has no real database to read while in demo mode.
    expect(t.store.realIfOpen()).toBeNull();
    expect(fs.readdirSync(t.dirs.backupDir).sort()).toEqual(before);
  });

  it('keeps real-only settings (password, auto-lock) read-only in demo mode', async () => {
    const t = await fileApp();
    const demo = await enterDemo(t, await setupReal(t));
    const pw = await call(t, demo, 'POST', '/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'another password' });
    expect(pw.statusCode).toBe(403);
    expect((await call(t, demo, 'PUT', '/api/settings/session', { idleTimeoutMinutes: 30 })).statusCode).toBe(403);
    expect((await call(t, demo, 'POST', '/api/auth/setup', { password: 'whatever123' })).statusCode).toBe(403);
  });

  it('labels demo exports and leaves real ones alone', () => {
    expect(exportFilename('arc40-export-2026-11-12.zip', 'demo')).toBe('arc40-demo-export-2026-11-12.zip');
    expect(exportFilename('arc40-export-2026-11-12.zip', 'real')).toBe('arc40-export-2026-11-12.zip');
    expect(demoBlockReason('real', 'POST', '/api/import/commit')).toBeNull();
    expect(demoBlockReason('demo', 'post', '/api/import/commit')).toBe(IMPORT_OFF_IN_DEMO);
    expect(demoBlockReason('demo', 'GET', '/api/import/batches')).toBeNull();
  });
});

describe('reset demo data', () => {
  const dump = (dir: string) => {
    const db = openDatabase(dir);
    try {
      return ['accounts', 'balance_snapshots', 'transactions', 'investment_activity', 'price_points', 'budgets', 'categories', 'goals']
        .map((tbl) => JSON.stringify(db.prepare(`SELECT * FROM ${tbl} ORDER BY rowid`).all()))
        .join('\n');
    } finally {
      db.close();
    }
  };

  it('only works in demo mode', async () => {
    const t = await testApp();
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/setup', headers: HOST_HEADER, payload: { password: PASSWORD } });
    const c = { cookie: cookieFrom(res), csrf: res.json().csrfToken };
    const r = await t.app.inject({ method: 'POST', url: '/api/demo/reset', headers: { ...HOST_HEADER, cookie: c.cookie, 'x-csrf-token': c.csrf } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe('Reset only works in demo mode.');
    await t.app.close();
  });

  it('rebuilds the same deterministic dataset from scratch and keeps you logged in', async () => {
    const t = await fileApp();
    const demo = await enterDemo(t, await setupReal(t));
    // Copy the fresh demo database aside (through SQLite, so the WAL is included).
    const freshDir = tmp('arc40-fresh-');
    const live = openDatabase(t.dirs.demoDir);
    live.exec(`VACUUM INTO '${path.join(freshDir, 'arc40.db')}'`);
    live.close();
    const fresh = dump(freshDir);

    const accts = (await call(t, demo, 'GET', '/api/accounts')).json().accounts as { id: number }[];
    await call(t, demo, 'POST', '/api/categories', { name: 'Throwaway', kind: 'expense' });
    await call(t, demo, 'DELETE', `/api/accounts/${accts[0]!.id}`);

    const res = await call(t, demo, 'POST', '/api/demo/reset');
    expect(res.statusCode, res.body).toBe(200);
    const after = { cookie: cookieFrom(res), csrf: res.json().csrfToken };
    expect((await call(t, after, 'GET', '/api/auth/status')).json()).toMatchObject({ mode: 'demo', authenticated: true });
    expect(((await call(t, after, 'GET', '/api/accounts')).json().accounts as unknown[]).length).toBe(4);

    const rebuiltDir = tmp('arc40-rebuilt-');
    const live2 = openDatabase(t.dirs.demoDir);
    live2.exec(`VACUUM INTO '${path.join(rebuiltDir, 'arc40.db')}'`);
    live2.close();
    expect(dump(rebuiltDir)).toBe(fresh);
    expect(fs.readdirSync(path.dirname(t.dirs.demoDir)).filter((f) => f.includes('.building-'))).toEqual([]);
  });
});
