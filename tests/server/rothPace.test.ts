/**
 * Roth pace planner (V2 Phase 3, M3). Fake amounts only.
 * 2026 tax year: limit $7,500 (the saved default), deadline 2027-04-15. Window Jan 1 2026 .. Apr 15 2027 =
 * 469 days and 16 calendar months, so one month of pace = $468.75 and half a month = $234.375.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InjectOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { HOST_HEADER, cookieFrom, fakeClock, setupAndLogin, testApp } from './helpers.js';
import { idealOn, monthsLeft, paceStatus, rothPace } from '../../server/src/lib/rothPace.js';
import { buildApp } from '../../server/src/app.js';
import { openDatabase } from '../../server/src/db/database.js';
import { DEMO_PASSWORD, generateDemoData } from '../../server/src/lib/demo/index.js';

const LIMIT = 750_000;
const DL = '2027-04-15';
const base = { year: 2026, limitCents: LIMIT, deadline: DL, today: '2026-11-11', earnedCents: 1_000_000 };
const c = (date: string, amountCents: number) => ({ date, amountCents });

describe('ideal line, months left, thresholds (pure)', () => {
  it('ideal line: $0 on Jan 1 to the limit on the deadline, straight by days, rounded to the cent', () => {
    expect(idealOn(LIMIT, '2026-01-01', DL, '2026-01-01')).toBe(0);
    expect(idealOn(LIMIT, '2026-01-01', DL, DL)).toBe(LIMIT);
    expect(idealOn(LIMIT, '2026-01-01', DL, '2026-11-11')).toBe(502_132); // 7,500 x 314 / 469 = 5,021.3219
    expect(idealOn(LIMIT, '2026-01-01', DL, '2025-12-31')).toBe(0);
    expect(idealOn(LIMIT, '2026-01-01', DL, '2027-06-01')).toBe(LIMIT);
  });

  it('months left counts this month and the deadline month', () => {
    expect(monthsLeft('2026-11-11', DL)).toBe(6); // Nov, Dec, Jan, Feb, Mar, Apr
    expect(monthsLeft('2027-04-15', DL)).toBe(1);
    expect(monthsLeft('2027-04-16', DL)).toBe(0);
    expect(monthsLeft('2026-01-01', DL)).toBe(16);
  });

  it('status thresholds in months of pace: half a month = on pace, up to 2 months = slightly behind', () => {
    const s = (gap: number) => paceStatus(gap, LIMIT, 16);
    expect(s(0)).toBe('on_pace');
    expect(s(23_437)).toBe('on_pace'); //   $234.37 behind (just under half a month)
    expect(s(23_438)).toBe('behind_slightly');
    expect(s(-23_437)).toBe('on_pace');
    expect(s(-23_438)).toBe('ahead');
    expect(s(93_750)).toBe('behind_slightly'); // exactly 2 months
    expect(s(93_751)).toBe('behind_well');
  });
});

describe('rothPace', () => {
  it('needed per month for both targets, rounded UP to the cent', () => {
    const p = rothPace({ ...base, contributions: [c('2026-03-02', 300_000)], earnedCents: 520_000 });
    expect(p).toMatchObject({ totalMonths: 16, monthsLeft: 6, monthOfPaceCents: 46_875, contributedCents: 300_000 });
    expect(p.limit).toEqual({ targetCents: LIMIT, leftCents: 450_000, neededPerMonthCents: 75_000 });
    // The lower target: earned income so far ($5,200) caps what can go in.
    expect(p.earned).toEqual({ targetCents: 520_000, leftCents: 220_000, neededPerMonthCents: 36_667 }); // 36,666.67 -> up
    const q = rothPace({ ...base, contributions: [c('2026-03-02', 299_999)] });
    expect(q.limit.neededPerMonthCents).toBe(75_001); // 75,000.17 -> up
  });

  it('the earned-income target is the lower of the limit and earned income; over it is flagged', () => {
    expect(rothPace({ ...base, contributions: [], earnedCents: 2_000_000 }).earned.targetCents).toBe(LIMIT);
    expect(rothPace({ ...base, contributions: [], earnedCents: 0 }).earned).toEqual({ targetCents: 0, leftCents: 0, neededPerMonthCents: 0 });
    const over = rothPace({ ...base, contributions: [c('2026-05-01', 350_000)], earnedCents: 300_000 });
    expect(over.overEarned).toBe(true);
    expect(over.earned.leftCents).toBe(0);
    expect(rothPace({ ...base, contributions: [c('2026-05-01', 250_000)], earnedCents: 300_000 }).overEarned).toBe(false);
  });

  it.each([
    [502_132, 'on_pace', 0],
    [480_000, 'on_pace', 22_132],
    [450_000, 'behind_slightly', 52_132],
    [400_000, 'behind_well', 102_132],
    [600_000, 'ahead', -97_868],
    [750_000, 'maxed', -247_868],
    [800_000, 'maxed', -297_868],
  ])('contributed %i -> %s (gap %i)', (amount, status, gap) => {
    const p = rothPace({ ...base, contributions: [c('2026-06-01', amount)] });
    expect(p.status).toBe(status);
    expect(p.gapCents).toBe(gap);
    expect(p.idealTodayCents).toBe(502_132);
  });

  it('after the deadline the year is closed: no needed amount; reaching the limit still says maxed', () => {
    const closed = rothPace({ ...base, today: '2027-04-16', contributions: [c('2026-06-01', 500_000)] });
    expect(closed.status).toBe('closed');
    expect(closed.limit.neededPerMonthCents).toBeNull();
    expect(closed.actual.at(-1)).toEqual({ date: DL, cents: 500_000 });
    expect(rothPace({ ...base, today: '2027-05-01', contributions: [c('2027-04-01', LIMIT)] }).status).toBe('maxed');
  });

  it('chart points: a step per contribution date (same day merged), prior-year contributions made next year, nothing after today', () => {
    const p = rothPace({
      ...base,
      today: '2027-02-10',
      contributions: [c('2026-02-01', 25_000), c('2026-02-01', 5_000), c('2026-09-15', 100_000), c('2027-02-03', 200_000), c('2027-03-01', 99_999)],
    });
    expect(p.actual).toEqual([
      { date: '2026-01-01', cents: 0 },
      { date: '2026-02-01', cents: 30_000 },
      { date: '2026-09-15', cents: 130_000 },
      { date: '2027-02-03', cents: 330_000 },
      { date: '2027-02-10', cents: 330_000 },
    ]);
    expect(p.contributedCents).toBe(330_000); // the March one has not happened yet
    expect(p.ideal).toEqual([
      { date: '2026-01-01', cents: 0 },
      { date: DL, cents: LIMIT },
    ]);
  });

  it('refuses a missing or non-integer limit', () => {
    expect(() => rothPace({ ...base, limitCents: 0, contributions: [] })).toThrow();
    expect(() => rothPace({ ...base, limitCents: 1.5, contributions: [] })).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------

let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };
const call = (opts: InjectOptions) =>
  t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });
const ok = async (opts: InjectOptions) => {
  const r = await call(opts);
  expect(r.statusCode, r.body).toBeLessThan(300);
  return r.json();
};
const contribute = (accountId: number, date: string, cents: number, taxYear: number) =>
  t.db
    .prepare("INSERT INTO investment_activity (account_id, date, kind, amount_cents, tax_year, source, created_at) VALUES (?, ?, 'contribution', ?, ?, 'manual', 1)")
    .run(accountId, date, cents, taxYear);

describe('GET /api/goals pace', () => {
  afterEach(async () => {
    await t.app.close();
  });

  it('is part of the Roth card for the selected year; earned income uses Refereeing + Other Income only', async () => {
    t = await testApp(); // 2026-11-11
    auth = await setupAndLogin(t);
    const roth = (await ok({ method: 'POST', url: '/api/accounts', payload: { name: 'Fake Roth', type: 'roth_ira' } })).account.id;
    const checking = (await ok({ method: 'POST', url: '/api/accounts', payload: { name: 'Fake Checking', type: 'checking' } })).account.id;
    const cats = Object.fromEntries((await ok({ method: 'GET', url: '/api/categories' })).categories.map((x: { name: string; id: number }) => [x.name, x.id]));
    for (const [cat, amt] of [['Refereeing', '2,000'], ['Other Income', '500'], ['Interest', '900']] as const) {
      await ok({ method: 'POST', url: '/api/transactions', payload: { accountId: checking, date: '2026-05-01', amount: amt, direction: 'in', description: cat, type: 'income', categoryId: cats[cat] } });
    }
    await ok({ method: 'POST', url: '/api/transactions', payload: { accountId: checking, date: '2026-05-02', amount: '5,000', direction: 'in', description: 'Gift', type: 'gift', giftFrom: 'Fake Relative' } });
    contribute(roth, '2026-02-10', 200_000, 2026);
    contribute(roth, '2026-04-10', 50_000, 2025); // a 2025 contribution: not this year's
    const g = await ok({ method: 'GET', url: '/api/goals' });
    expect(g.roth.year).toBe(2026);
    expect(g.roth.pace).toMatchObject({
      status: 'behind_well',
      contributedCents: 200_000,
      idealTodayCents: 502_132,
      gapCents: 302_132,
      monthsLeft: 6,
      limit: { targetCents: 750_000, neededPerMonthCents: 91_667 },
      earned: { targetCents: 250_000, leftCents: 50_000, neededPerMonthCents: 8_334 },
    });
    expect(g.roth.pace.contributedCents).toBe(g.roth.contributedCents); // the ring and the pace agree
  });

  it('two open tax years (Jan 1 to the deadline): the pace follows the year shown; a year without a saved limit has no pace', async () => {
    const clock = fakeClock(Date.UTC(2027, 2, 10, 12)); // 2027-03-10
    const dirs = ['data', 'demo', 'bk'].map((p) => fs.mkdtempSync(path.join(os.tmpdir(), `arc40-pace-${p}-`)));
    const built = await buildApp({ db: openDatabase(':memory:'), now: clock.now, webDistDir: '/nonexistent', port: 4040, dataDir: dirs[0], demoDir: dirs[1], backupDir: dirs[2] });
    t = { ...built, clock };
    auth = await setupAndLogin(t);
    const roth = (await ok({ method: 'POST', url: '/api/accounts', payload: { name: 'Fake Roth', type: 'roth_ira' } })).account.id;
    contribute(roth, '2026-06-01', 400_000, 2026);
    contribute(roth, '2027-02-20', 300_000, 2026); // prior-year contribution made in 2027
    contribute(roth, '2027-01-15', 10_000, 2027);

    const now = await ok({ method: 'GET', url: '/api/goals' });
    expect(now.roth.years).toEqual([2027, 2026]);
    expect(now.roth.year).toBe(2027);
    expect(now.roth.limitCents).toBeNull(); // 2027 limit not saved: never guessed
    expect(now.roth.pace).toBeNull();

    const last = await ok({ method: 'GET', url: '/api/goals?year=2026' });
    expect(last.roth.pace).toMatchObject({ contributedCents: 700_000, monthsLeft: 2, limit: { leftCents: 50_000, neededPerMonthCents: 25_000 } });
    expect(last.roth.pace.status).toBe('on_pace'); // ideal 7,500 x 433/469 = 6,924.31; 700,000 is ahead by 7,569 < half a month

    // A saved limit with no deadline: still no pace (the deadline is never guessed either).
    await ok({ method: 'PUT', url: '/api/settings/ira', payload: { year: 2027, limit: '9,999' } });
    const noDl = await ok({ method: 'GET', url: '/api/goals' });
    expect(noDl.roth.limitCents).toBe(999_900);
    expect(noDl.roth.pace).toBeNull();
    await ok({ method: 'PUT', url: '/api/settings/ira', payload: { year: 2027, limit: '9,999', deadline: '2028-04-17' } });
    expect((await ok({ method: 'GET', url: '/api/goals' })).roth.pace.limit.targetCents).toBe(999_900);
  });

  it('no Roth account: no pace', async () => {
    t = await testApp();
    auth = await setupAndLogin(t);
    expect((await ok({ method: 'GET', url: '/api/goals' })).roth.pace).toBeNull();
  });
});

describe('demo data: current year on pace, previous year behind while it is open', () => {
  const demoApp = async (today: string, at: number) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-pace-demo-'));
    await generateDemoData(dir, today, at);
    const clock = fakeClock(at);
    const dirs = ['data', 'demo', 'bk'].map((p) => fs.mkdtempSync(path.join(os.tmpdir(), `arc40-pace-${p}-`)));
    const built = await buildApp({ db: openDatabase(dir), now: clock.now, webDistDir: '/nonexistent', port: 4040, dataDir: dirs[0], demoDir: dirs[1], backupDir: dirs[2] });
    t = { ...built, clock };
    const login = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: HOST_HEADER, payload: { password: DEMO_PASSWORD } });
    auth = { cookie: cookieFrom(login), csrf: login.json().csrfToken };
  };
  afterEach(async () => {
    await t.app.close();
  });

  it('November: this year on pace; savings never below $0; the gift is not income', async () => {
    await demoApp('2026-11-11', Date.UTC(2026, 10, 11, 12));
    const g = await ok({ method: 'GET', url: '/api/goals' });
    expect(g.roth.years).toEqual([2026]);
    expect(g.roth.pace.status).toBe('on_pace');
    expect(g.roth.pace.overEarned).toBe(false); // the demo person earned what they put in
    const accounts = (await ok({ method: 'GET', url: '/api/accounts' })).accounts as { type: string; balanceCents: number }[];
    for (const a of accounts) expect(a.balanceCents).toBeGreaterThanOrEqual(0);
    const tx = await ok({ method: 'GET', url: '/api/transactions?q=Graduation' });
    expect(tx.transactions[0].type).toBe('gift');
    expect(tx.sums.incomeCents).toBe(0);
  });

  it('March (both years open; a fake TEST limit is then saved for the new year): the new year on pace, last year behind (bronze)', async () => {
    await demoApp('2027-03-10', Date.UTC(2027, 2, 10, 12));
    const last = await ok({ method: 'GET', url: '/api/goals?year=2026' });
    expect(last.roth.years).toEqual([2027, 2026]);
    expect(last.roth.pace.status).toBe('behind_slightly');
    expect(last.roth.pace.overEarned).toBe(false);
    expect(last.roth.pace.gapCents).toBeGreaterThan(23_437);
    expect((await ok({ method: 'GET', url: '/api/goals?year=2027' })).roth.limitCents).toBeNull(); // never guessed
    await ok({ method: 'PUT', url: '/api/settings/ira', payload: { year: 2027, limit: '7,500', deadline: '2028-04-17' } }); // fake test value
    const cur = await ok({ method: 'GET', url: '/api/goals?year=2027' });
    expect(cur.roth.pace.status).toBe('on_pace');
  });
});
