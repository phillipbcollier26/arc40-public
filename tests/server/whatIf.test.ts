/**
 * What if (V2 Phase 3, M5a). Fake data built so every number can be checked by hand.
 * Today = 2026-11-11, so the 3-month baseline is Aug, Sep, Oct 2026. Each of those months:
 *   income  Refereeing $1,000
 *   spending Food $300 + Entertainment $100 = $400          -> savings $600 a month
 *   transfer checking -> savings $100 (never income or spending)
 *   Roth contribution $200 (investment activity, tax year 2026) -> recent investing $200 = Roth $200
 * Balances today: checking $1,000 + 3 x ($1,000 - $400 - $100) = $2,500; savings $300; Roth $600.
 * The return rate is set to 0% unless a test says otherwise, so the growth is easy to check.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';
import { openDatabase, DB_FILENAME } from '../../server/src/db/database.js';
import { generateDemoData } from '../../server/src/lib/demo/index.js';
import { buildBaseline, planningSettings, projectCurrentPath } from '../../server/src/lib/planning.js';
import { fiHorizon, rangeMonths, whatIf } from '../../server/src/lib/whatIf.js';

let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };
const call = (opts: InjectOptions) =>
  t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });
const ok = async (opts: InjectOptions) => {
  const r = await call(opts);
  expect(r.statusCode, r.body).toBeLessThan(300);
  return r.json();
};
let cat: Record<string, number> = {};
let ids: { checking: number; savings: number; roth: number } = { checking: 0, savings: 0, roth: 0 };

const project = (payload: object) => ok({ method: 'POST', url: '/api/what-if/project', payload: { baselineMonths: 3, range: '1y', scenarios: [], ...payload } });
const refused = async (payload: object, msg = '') => {
  const r = await call({ method: 'POST', url: '/api/what-if/project', payload: { baselineMonths: 3, range: '1y', scenarios: [], ...payload } });
  expect(r.statusCode, r.body).toBe(400);
  expect(r.json().error).toContain(msg);
};

async function seed() {
  cat = Object.fromEntries((await ok({ method: 'GET', url: '/api/categories' })).categories.map((c: { name: string; id: number }) => [c.name, c.id]));
  const acct = async (name: string, type: string, opening?: string) =>
    (await ok({ method: 'POST', url: '/api/accounts', payload: { name, type, ...(opening ? { openingBalance: opening, openingDate: '2026-01-01' } : {}) } })).account.id as number;
  ids = { checking: await acct('Fake Checking', 'checking', '1,000'), savings: await acct('Fake Savings', 'savings'), roth: await acct('Fake Roth', 'roth_ira') };
  const tx = (accountId: number, date: string, amount: string, direction: 'in' | 'out', type: string, category?: string) =>
    ok({ method: 'POST', url: '/api/transactions', payload: { accountId, date, amount, direction, description: `${type} ${date}`, type, categoryId: category ? cat[category] : null } });
  for (const m of ['2026-08', '2026-09', '2026-10']) {
    await tx(ids.checking, `${m}-05`, '1,000', 'in', 'income', 'Refereeing');
    await tx(ids.checking, `${m}-10`, '300', 'out', 'expense', 'Food');
    await tx(ids.checking, `${m}-12`, '100', 'out', 'expense', 'Entertainment');
    await tx(ids.checking, `${m}-15`, '100', 'out', 'transfer');
    await tx(ids.savings, `${m}-15`, '100', 'in', 'transfer');
    t.db
      .prepare("INSERT INTO investment_activity (account_id, date, kind, amount_cents, tax_year, source, created_at) VALUES (?, ?, 'contribution', 20000, 2026, 'manual', 1)")
      .run(ids.roth, `${m}-20`);
  }
  await ok({ method: 'PUT', url: '/api/settings/planning', payload: { returnRate: '0', birth: { year: 2007, month: 6 } } });
}

beforeEach(async () => {
  t = await testApp();
  auth = await setupAndLogin(t);
});
afterEach(async () => {
  await t.app.close();
});

describe('ranges and horizon (pure)', () => {
  const birth = { year: 2007, month: 6 };
  it('1, 5 and 10 years; until 40 and 65 from the birth month; refused without one or when already past', () => {
    expect(rangeMonths('1y', '2026-11-11', null)).toBe(12);
    expect(rangeMonths('5y', '2026-11-11', null)).toBe(60);
    expect(rangeMonths('10y', '2026-11-11', null)).toBe(120);
    expect(rangeMonths('to40', '2026-11-11', birth)).toBe(247); // Nov 2026 -> Jun 2047
    expect(rangeMonths('to65', '2026-11-11', birth)).toBe(547);
    expect(rangeMonths('to40', '2026-11-11', null)).toMatch(/birth month/);
    expect(rangeMonths('to40', '2026-11-11', { year: 1980, month: 1 })).toMatch(/already 40/);
    expect(rangeMonths('to65', '2026-11-11', { year: 1950, month: 1 })).toMatch(/already 65/);
  });
  it('years until FI are searched to age 65, or 10 years without a birth month', () => {
    expect(fiHorizon('2026-11-11', birth, 12)).toEqual({ months: 547, label: 'age 65' });
    expect(fiHorizon('2026-11-11', null, 60)).toEqual({ months: 120, label: '10 years' });
    expect(fiHorizon('2026-11-11', { year: 1980, month: 1 }, 120)).toEqual({ months: 218, label: 'age 65' }); // 46 now
    expect(fiHorizon('2026-11-11', { year: 1950, month: 1 }, 120)).toEqual({ months: 120, label: 'the end of this range' });
  });
});

describe('POST /api/what-if/project', () => {
  beforeEach(seed);

  it('the current path comes from the shared totals; transfers never count; balances split into cash and invested', async () => {
    const r = await project({});
    expect(r.baseline).toMatchObject({ monthsUsed: 3, incomeCents: 100_000, spendingCents: 40_000, savingsCents: 60_000, toInvestedCents: 20_000, rothMonthlyCents: 20_000 });
    expect(r.baseline).toMatchObject({ cashCents: 280_000, investedCents: 60_000 });
    expect(r.current).toMatchObject({ savingsRateBp: 6_000, savingsRateChangeBp: 0, returnRateBp: 0, investedMonthlyCents: 20_000 });
    // 0% return: net worth grows by savings exactly, $600 a month, and only $200 of it is invested.
    expect(r.current.series).toHaveLength(13);
    expect(r.current.end).toEqual({ netWorthCents: 340_000 + 12 * 60_000, investedCents: 60_000 + 12 * 20_000, cashCents: 280_000 + 12 * 40_000 });
    expect(r.categories.find((c: { id: number }) => c.id === cat.Food).avgCents).toBe(30_000);
  });

  it('a scenario with no changes gives exactly the current path (same rules, same engine)', async () => {
    const r = await project({ range: 'to65', scenarios: [{ name: 'Nothing changes', changes: [] }] });
    const { name: _a, ...cur } = r.current;
    const { name: _b, ...same } = r.scenarios[0];
    expect(same).toEqual(cur);
    // ...and the same as lib/planning.ts's projectCurrentPath.
    const b = buildBaseline(t.db, '2026-11-11', 3);
    const pts = projectCurrentPath(b, 547, 0);
    expect(r.current.series.map((p: { netWorthCents: number }) => p.netWorthCents)).toEqual(pts.map((p) => p.netWorthCents));
  });

  it('spending down or up moves savings 1:1 and the invested share with it; the savings rate change is shown', async () => {
    const r = await project({
      scenarios: [
        { name: 'Less food', changes: [{ kind: 'spending', categoryId: cat.Food, direction: 'down', amount: '100' }] },
        { name: 'More fun', changes: [{ kind: 'spending', categoryId: cat.Entertainment, direction: 'up', amount: '50' }] },
      ],
    });
    const [less, more] = r.scenarios;
    expect(less).toMatchObject({ spendingCents: 30_000, savingsCents: 70_000, savingsRateBp: 7_000, savingsRateChangeBp: 1_000, investedMonthlyCents: 23_333 }); // 700 x 200/600
    expect(more).toMatchObject({ spendingCents: 45_000, savingsCents: 55_000, savingsRateBp: 5_500, savingsRateChangeBp: -500, investedMonthlyCents: 18_333 });
    expect(less.end.netWorthCents).toBe(340_000 + 12 * 70_000);
  });

  it('a cut can only take a category down to $0 a month (clamped and noted)', async () => {
    const r = await project({ scenarios: [{ name: 'No food', changes: [{ kind: 'spending', categoryId: cat.Food, direction: 'down', amount: '500' }] }] });
    expect(r.scenarios[0].spendingCents).toBe(10_000);
    expect(r.scenarios[0].notes.join(' ')).toMatch(/Food can only go down to \$0/);
  });

  it('a Roth amount replaces the recent one: a move from cash, never new money; capped at each year’s limit', async () => {
    const r = await project({ scenarios: [{ name: 'Roth $500', changes: [{ kind: 'roth', monthly: '500' }] }] });
    const s = r.scenarios[0];
    expect(s).toMatchObject({ rothMonthlyCents: 50_000, investedMonthlyCents: 50_000, savingsCents: 60_000 });
    // Net worth is the same as the current path (money only moved); $500 a month went in instead of $200.
    expect(s.end).toEqual({ netWorthCents: 340_000 + 12 * 60_000, investedCents: 60_000 + 12 * 50_000, cashCents: 280_000 + 12 * 10_000 });
    expect(s.end.netWorthCents).toBe(r.current.end.netWorthCents);

    // $3,000 a month: 2026 has $6,900 of room left (limit $7,500, $600 in), so Nov $3,000 + Dec $3,000, then the
    // yearly cap (later years use the newest saved limit, $7,500). Cash covers the moves until it runs out.
    const big = (await project({ range: '5y', scenarios: [{ name: 'Huge', changes: [{ kind: 'roth', monthly: '3,000' }] }] })).scenarios[0];
    expect(big.notes.join(' ')).toMatch(/stops at each year’s limit/);
    expect(big.end.netWorthCents).toBe(340_000 + 60 * 60_000); // still only savings added
    const years = big.series.filter((p: { month: number }) => p.month === 14)[0]; // end of 2027 (Nov 2026 + 14)
    // invested by then <= start + 2026 room + 2027 limit
    expect(years.investedCents).toBeLessThanOrEqual(60_000 + 690_000 + 750_000);
  });

  it('a return rate for one scenario only; 0% vs 7% on the invested money only (cash earns nothing)', async () => {
    const r = await project({ scenarios: [{ name: '7%', changes: [{ kind: 'return', rate: '7' }] }] });
    const s = r.scenarios[0];
    expect(s.returnRateBp).toBe(700);
    expect(r.current.returnRateBp).toBe(0);
    expect(s.end.cashCents).toBe(r.current.end.cashCents); // cash never grows
    expect(s.end.investedCents).toBeGreaterThan(r.current.end.investedCents);
    // $600 grows to $642.00 in 12 months; 12 x $200 at 7% (end of month) = $2,476.06
    expect(s.end.investedCents).toBe(64_200 + 247_606);
  });

  it('FI number = 25 x yearly spending (each path its own); only invested money counts; "never" when not reached', async () => {
    const r = await project({
      range: '10y',
      scenarios: [
        {
          name: 'Spend $100',
          changes: [
            { kind: 'spending', categoryId: cat.Food, direction: 'down', amount: '300' },
            { kind: 'spending', categoryId: cat.Entertainment, direction: 'down', amount: '0' },
          ],
        },
      ],
    });
    // Current: $400 x 12 x 25 = $120,000; invested $600 + $200 a month reaches it in month 597, past age 65 (547).
    expect(r.current.fi).toEqual({ numberCents: 12_000_000, month: null, date: null, age: null });
    expect(r.fiHorizon).toEqual({ months: 547, label: 'age 65' });
    // Spending $100: FI $30,000; savings $900, invested $300 a month: 600 + 300 m >= 30,000 -> m = 98.
    expect(r.scenarios[0].fi).toMatchObject({ numberCents: 3_000_000, month: 98, date: '2034-12-31', age: 27 });
    // Cash does not count: a huge cash balance changes nothing.
    await ok({ method: 'POST', url: `/api/accounts/${ids.savings}/balances`, payload: { asOf: '2026-11-10', balance: '1,000,000' } });
    const rich = await project({ range: '10y' });
    expect(rich.baseline.cashCents).toBeGreaterThan(12_000_000);
    expect(rich.current.fi.month).toBeNull();
  });

  it('goal dates: custom goal on its account, the Roth limit before the deadline, the emergency fund', async () => {
    await ok({ method: 'POST', url: '/api/goals', payload: { name: 'Fake land fund', target: '1,000', accountId: ids.savings } });
    await ok({ method: 'POST', url: '/api/goals', payload: { name: 'Fake Roth goal', target: '1,000', accountId: ids.roth } });
    await ok({ method: 'POST', url: '/api/goals', payload: { name: 'No account', target: '50' } });
    const r = await project({
      scenarios: [
        { name: 'Roth $1,150', changes: [{ kind: 'roth', monthly: '1,150' }] },
        { name: 'Less food', changes: [{ kind: 'spending', categoryId: cat.Food, direction: 'down', amount: '100' }] },
      ],
    });
    const g = r.current.goals;
    // Savings $300 + $100 a month >= $1,000 -> month 7 (May 2027). Roth $600 + $200 a month >= $1,000 -> month 2.
    expect(g.custom.map((x: { name: string; month: number | null; date: string | null }) => [x.name, x.month, x.date])).toEqual([
      ['Fake land fund', 7, '2027-05-31'],
      ['Fake Roth goal', 2, '2026-12-31'],
      ['No account', null, null],
    ]);
    // Roth 2026: $6,900 left, $200 a month -> 35 months: not before the deadline (6 months left).
    expect(g.roth).toMatchObject({ year: 2026, limitCents: 750_000, contributedCents: 60_000, monthlyCents: 20_000, beforeDeadline: false, month: null });
    // $1,150 a month: ceil(6,900 / 1,150) = 6 months, April 2027 (the deadline month).
    expect(r.scenarios[0].goals.roth).toMatchObject({ beforeDeadline: true, month: 6, date: '2027-04-30' });
    // Emergency: 6 x $400 = $2,400; savings $300 + $100 a month -> month 21. Less food: 6 x $300 -> month 15.
    expect(g.emergency).toMatchObject({ targetCents: 240_000, currentCents: 30_000, month: 21 });
    expect(r.scenarios[1].goals.emergency).toMatchObject({ targetCents: 180_000, month: 15 });
  });

  it('a gift in the baseline months changes nothing (gifts are not income)', async () => {
    const before = await project({});
    await ok({ method: 'POST', url: '/api/transactions', payload: { accountId: ids.checking, date: '2026-09-20', amount: '5,000', direction: 'in', description: 'Gift', type: 'gift', giftFrom: 'Fake Relative' } });
    const after = await project({});
    expect(after.baseline.savingsCents).toBe(before.baseline.savingsCents);
    expect(after.current.savingsRateBp).toBe(before.current.savingsRateBp);
  });

  it('6 and 12 months use the same shared totals (months before the first money line are not counted)', async () => {
    const r = await project({ baselineMonths: 12 });
    expect(r.baseline).toMatchObject({ monthsUsed: 3, incomeCents: 100_000 }); // first line is in August
  });

  it('up to 3 scenarios; until 40 / 65; validation and caps', async () => {
    const sc = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `S${i}`, changes: [] }));
    expect((await project({ range: 'to40', scenarios: sc(3) })).scenarios).toHaveLength(3);
    expect((await project({ range: 'to40' })).current.series).toHaveLength(248);
    await refused({ scenarios: sc(4) }, 'up to 3');
    await refused({ scenarios: [{ name: 'x', changes: Array.from({ length: 11 }, () => ({ kind: 'return', rate: '5' })) }] }, 'up to 10');
    await refused({ scenarios: [{ name: 'x', changes: [{ kind: 'roth', monthly: '1' }, { kind: 'roth', monthly: '2' }] }] }, 'once');
    await refused({ scenarios: [{ name: 'x', changes: [{ kind: 'spending', categoryId: cat.Refereeing, direction: 'up', amount: '5' }] }] }, 'spending category');
    await refused({ scenarios: [{ name: 'x', changes: [{ kind: 'spending', categoryId: cat.Food, direction: 'up', amount: '-5' }] }] }, 'minus');
    await refused({ scenarios: [{ name: 'x', changes: [{ kind: 'spending', categoryId: cat.Food, direction: 'up', amount: 5 }] }] });
    await refused({ scenarios: [{ name: 'x', changes: [{ kind: 'spending', categoryId: cat.Food, direction: 'up', amount: '100,001' }] }] }, 'more than');
    await refused({ scenarios: [{ name: 'x', changes: [{ kind: 'roth', monthly: '10,000.01' }] }] }, 'more than');
    await refused({ scenarios: [{ name: 'x', changes: [{ kind: 'return', rate: '16' }] }] }, '15%');
    await refused({ scenarios: [{ name: 'x'.repeat(41), changes: [] }] }, '40 characters');
    await refused({ range: '20y' });
    await refused({ baselineMonths: 4 }, '3, 6 or 12');
    await ok({ method: 'PUT', url: '/api/settings/planning', payload: { birth: null } });
    await refused({ range: 'to65' }, 'birth month');
  });

  it('never writes to the database: every table except the login session is identical afterwards', async () => {
    const tables = (t.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name <> 'sessions' ORDER BY name").all() as { name: string }[]).map((x) => x.name);
    const dump = () => tables.map((n) => JSON.stringify(t.db.prepare(`SELECT * FROM "${n}"`).all())).join('\n');
    const before = dump();
    await project({ range: 'to65', scenarios: [{ name: 'A', changes: [{ kind: 'roth', monthly: '500' }, { kind: 'return', rate: '5' }] }, { name: 'B', changes: [{ kind: 'spending', categoryId: cat.Food, direction: 'down', amount: '50' }] }] });
    await project({ baselineMonths: 12, range: '10y', scenarios: [] });
    expect(dump()).toBe(before);
  });
});

describe('never writes (file level)', () => {
  it('running every kind of scenario against a database file leaves the file byte-for-byte unchanged', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-whatif-'));
    await generateDemoData(dir, '2026-11-11', Date.UTC(2026, 10, 11, 12));
    const file = path.join(dir, DB_FILENAME);
    const sha = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const db = openDatabase(dir);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const before = sha();
    const st = planningSettings(db);
    const food = (db.prepare("SELECT id FROM categories WHERE name = 'Food'").get() as { id: number }).id;
    for (const n of [3, 6, 12] as const) {
      const b = buildBaseline(db, '2026-11-11', n);
      for (const range of ['1y', '5y', '10y', 'to40', 'to65'] as const) {
        const r = whatIf(db, b, {
          range,
          birth: st.birth,
          defaultRateBp: st.returnRateBp,
          scenarios: [
            { name: 'A', changes: [{ kind: 'spending', categoryId: food, deltaCents: -5_000 }] },
            { name: 'B', changes: [{ kind: 'roth', monthlyCents: 62_500 }] },
            { name: 'C', changes: [{ kind: 'return', rateBp: 400 }] },
          ],
        });
        expect('error' in r).toBe(false);
      }
    }
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
    expect(sha()).toBe(before);
  });
});

describe('demo mode', () => {
  it('works on the demo data and never shows the real birth month or numbers', async () => {
    await seed(); // real: birth 2007-06, 0%
    await ok({ method: 'PUT', url: '/api/settings/planning', payload: { birth: { year: 1999, month: 2 } } });
    const enter = await call({ method: 'POST', url: '/api/demo/enter' });
    const c = enter.cookies.find((x) => x.name.startsWith('arc40_session_'))!;
    auth = { cookie: `${c.name}=${c.value}`, csrf: enter.json().csrfToken };
    const r = await project({ range: 'to40', scenarios: [{ name: 'Same', changes: [] }] });
    expect(r.age).toBe(19); // the demo person, not the real one (27)
    expect(r.defaultReturnRateBp).toBe(700);
    expect(r.rangeMonths).toBe(247);
    expect(r.baseline.incomeCents).not.toBe(100_000);
    expect(JSON.stringify(r)).not.toMatch(/Fake Checking|Fake Roth/);
    // The demo's fake land fund (brokerage, grows): a higher return finishes it sooner.
    const land = (x: { goals: { custom: { name: string; month: number | null }[] } }) => x.goals.custom.find((g) => g.name === 'Land fund')!.month;
    const rates = await project({ range: 'to65', scenarios: [{ name: '4%', changes: [{ kind: 'return', rate: '4' }] }, { name: '10%', changes: [{ kind: 'return', rate: '10' }] }] });
    expect(land(rates.current)).not.toBeNull();
    expect(land(rates.scenarios[1])!).toBeLessThan(land(rates.current)!);
    expect(land(rates.current)!).toBeLessThan(land(rates.scenarios[0]) ?? Infinity);
  });
});
