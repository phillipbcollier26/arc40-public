/**
 * The current path (lib/planning.ts) and the planning settings (V2 Phase 3, M2).
 * Fake data only. Today in tests = 2026-11-11, so the complete months are ... Aug, Sep, Oct 2026.
 */
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';
import { baselineMonths, buildBaseline, projectCurrentPath } from '../../server/src/lib/planning.js';
import { simulate } from '../../server/src/lib/projection.js';

let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };
const call = (opts: InjectOptions) =>
  t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });
const ok = async (opts: InjectOptions) => {
  const r = await call(opts);
  expect(r.statusCode, r.body).toBeLessThan(300);
  return r.json();
};
const get = (url: string) => ok({ method: 'GET', url });

let cat: Record<string, number> = {};
const acct = async (name: string, type: string, opening = '0') =>
  (await ok({ method: 'POST', url: '/api/accounts', payload: { name, type, openingBalance: opening, openingDate: '2026-01-01' } })).account.id as number;
const tx = (accountId: number, date: string, amount: string, direction: 'in' | 'out', type: string, category?: string, extra: object = {}) =>
  ok({
    method: 'POST',
    url: '/api/transactions',
    payload: { accountId, date, amount, direction, description: `${type} ${date}`, type, categoryId: category ? cat[category] : null, ...extra },
  });
const activity = (accountId: number, date: string, kind: string, cents: number, taxYear: number | null = null) =>
  t.db
    .prepare("INSERT INTO investment_activity (account_id, date, kind, amount_cents, tax_year, source, created_at) VALUES (?, ?, ?, ?, ?, 'manual', 1)")
    .run(accountId, date, kind, cents, taxYear);

beforeEach(async () => {
  t = await testApp();
  auth = await setupAndLogin(t);
  cat = Object.fromEntries((await get('/api/categories')).categories.map((c: { name: string; id: number }) => [c.name, c.id]));
});
afterEach(async () => {
  await t.app.close();
});

describe('baseline months', () => {
  it('the last N complete months, never before the first money line', () => {
    expect(baselineMonths('2026-11-11', 3, '2025-01-05')).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
    expect(baselineMonths('2026-11-11', 6, '2026-09-20')).toEqual(['2026-09-01', '2026-10-01']);
    expect(baselineMonths('2026-01-02', 3, '2020-01-01')).toEqual(['2025-10-01', '2025-11-01', '2025-12-01']);
    expect(baselineMonths('2026-11-11', 3, null)).toEqual([]);
    expect(baselineMonths('2026-11-11', 3, '2026-11-02')).toEqual([]); // only this (incomplete) month
  });
});

describe('the current path is built from the shared totals', () => {
  const seed = async () => {
    const checking = await acct('Fake Checking', 'checking', '1,000');
    const savings = await acct('Fake Savings', 'savings', '2,000');
    const roth = await acct('Fake Roth', 'roth_ira', '3,000');
    for (const m of ['2026-08', '2026-09', '2026-10']) {
      await tx(checking, `${m}-05`, '900', 'in', 'income', 'Refereeing');
      await tx(checking, `${m}-10`, '300', 'out', 'expense', 'Food');
    }
    await tx(checking, '2026-10-12', '30', 'in', 'expense', 'Food'); // a refund lowers spending
    await tx(checking, '2026-09-01', '5,000', 'in', 'gift', undefined, { giftFrom: 'Fake Relative' }); // never income
    await tx(checking, '2026-09-02', '400', 'out', 'transfer'); // never spending
    await tx(savings, '2026-09-02', '400', 'in', 'transfer');
    await tx(checking, '2026-11-03', '10,000', 'in', 'income', 'Refereeing'); // this month: not counted
    await tx(checking, '2026-04-03', '600', 'in', 'income', 'Other Income'); // only in the 12-month window
    return { checking, savings, roth };
  };

  it('3 / 6 / 12 months: average income, spending (refunds lower it), savings; gifts and transfers never count', async () => {
    await seed();
    const b3 = buildBaseline(t.db, '2026-11-11', 3);
    expect(b3).toMatchObject({ monthsUsed: 3, from: '2026-08-01', to: '2026-10-31', incomeCents: 90_000, spendingCents: 29_000, savingsCents: 61_000 });
    // 6 months: May..Oct. The first money line is in Jan (opening balance is a snapshot, not a line),
    // so all 6 count: income 2,700 / 6, spending 870 / 6.
    const b6 = buildBaseline(t.db, '2026-11-11', 6);
    expect(b6).toMatchObject({ monthsUsed: 6, incomeCents: 45_000, spendingCents: 14_500, savingsCents: 30_500 });
    // 12 months: back to the first money line (April): Apr..Oct = 7 months; April's $600 counts.
    const b12 = buildBaseline(t.db, '2026-11-11', 12);
    expect(b12).toMatchObject({ monthsUsed: 7, incomeCents: 47_143, spendingCents: 12_429, savingsCents: 34_714 });
  });

  it('agrees with the Budget page months (the same totals source)', async () => {
    await seed();
    const flow = await get('/api/cashflow?months=12');
    const rows = (flow.months as { month: string; incomeCents: number; spendingCents: number }[]).filter((r) => r.month >= '2026-08-01' && r.month <= '2026-10-01');
    expect(rows).toHaveLength(3);
    const b = buildBaseline(t.db, '2026-11-11', 3);
    expect(b.incomeCents * 3).toBe(rows.reduce((s, r) => s + r.incomeCents, 0));
    expect(b.spendingCents * 3).toBe(rows.reduce((s, r) => s + r.spendingCents, 0));
  });

  it('starting balances: invested accounts vs cash, the same balances the Accounts page shows', async () => {
    const { roth } = await seed();
    activity(roth, '2026-09-15', 'contribution', 20_000, 2026); // $200 into the Roth
    const b = buildBaseline(t.db, '2026-11-11', 3);
    const accounts = (await get('/api/accounts')).accounts as { id: number; balanceCents: number; type: string }[];
    const sum = (f: (a: { type: string }) => boolean) => accounts.filter(f).reduce((s, a) => s + a.balanceCents, 0);
    expect(b.investedCents).toBe(sum((a) => a.type === 'roth_ira'));
    expect(b.cashCents).toBe(sum((a) => a.type !== 'roth_ira'));
    expect(b.fixedCents).toBe(0);
  });

  it('recent investing is a move (capped at savings); Roth contributions are part of it, never extra', async () => {
    const { roth } = await seed();
    activity(roth, '2026-08-20', 'contribution', 30_000, 2026);
    activity(roth, '2026-10-20', 'contribution', 15_000, 2026);
    const b = buildBaseline(t.db, '2026-11-11', 3);
    expect(b).toMatchObject({ recentInvestingCents: 15_000, toInvestedCents: 15_000, rothMonthlyCents: 15_000, share: { num: 15_000, den: 61_000 } });
    // A big one-off move (e.g. savings -> brokerage) cannot pretend the user invests more than they save.
    activity(roth, '2026-09-25', 'transfer_in', 500_000);
    const c = buildBaseline(t.db, '2026-11-11', 3);
    expect(c.recentInvestingCents).toBe(181_667);
    expect(c.toInvestedCents).toBe(61_000);
    // Money taken out makes the average smaller; below $0 nothing is invested.
    activity(roth, '2026-10-01', 'transfer_out', 700_000);
    expect(buildBaseline(t.db, '2026-11-11', 3).toInvestedCents).toBe(0);
  });

  it('the current path adds savings once: net worth grows by savings + growth only', async () => {
    const { roth } = await seed();
    activity(roth, '2026-08-20', 'contribution', 45_000, 2026);
    const b = buildBaseline(t.db, '2026-11-11', 3);
    const p = projectCurrentPath(b, 24, 0);
    expect(p.at(-1)!.netWorthCents - p[0]!.netWorthCents).toBe(24 * b.savingsCents);
    expect(p.at(-1)!.investedCents - p[0]!.investedCents).toBe(24 * b.toInvestedCents);
    // Same rules as a hand-built simulation with the same inputs (scenarios use this engine too).
    const same = simulate({
      months: 24,
      yearlyReturnBp: 0,
      startCashCents: b.cashCents,
      startInvestedCents: b.investedCents,
      money: () => ({ savingsCents: b.savingsCents, toInvestedCents: b.toInvestedCents }),
    });
    expect(p).toEqual(same);
  });

  it('negative savings invest nothing and shrink cash; no history = all zero', async () => {
    expect(buildBaseline(t.db, '2026-11-11', 3)).toMatchObject({ monthsUsed: 0, incomeCents: 0, spendingCents: 0, savingsCents: 0, share: null });
    const checking = await acct('Fake Checking', 'checking', '500');
    await tx(checking, '2026-10-10', '600', 'out', 'expense', 'Food');
    const b = buildBaseline(t.db, '2026-11-11', 3);
    expect(b).toMatchObject({ monthsUsed: 1, savingsCents: -60_000, toInvestedCents: 0, share: null });
  });

  it('reading the baseline writes nothing', async () => {
    await seed();
    const before = t.db.prepare('SELECT COUNT(*) AS n FROM settings').get();
    await get('/api/planning/baseline?months=6');
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual(before);
    expect((await call({ method: 'GET', url: '/api/planning/baseline?months=4' })).statusCode).toBe(400);
  });
});

describe('planning settings', () => {
  it('defaults: 7% after inflation, no birth month', async () => {
    expect(await get('/api/settings/planning')).toEqual({ returnRateBp: 700, defaultReturnRateBp: 700, birth: null, age: null, futureYouLine: false, today: '2026-11-11' });
  });

  it('saves the return rate as basis points and the birth month/year; returns the age', async () => {
    const r = await ok({ method: 'PUT', url: '/api/settings/planning', payload: { returnRate: '6.5%', birth: { year: 2007, month: 12 } } });
    expect(r).toMatchObject({ returnRateBp: 650, birth: { year: 2007, month: 12 }, age: 18 });
    expect(await ok({ method: 'PUT', url: '/api/settings/planning', payload: { birth: null } })).toMatchObject({ birth: null, age: null, returnRateBp: 650 });
  });

  it.each([
    [{ returnRate: '16' }, 'between 0% and 15%'],
    [{ returnRate: '-1' }, ''],
    [{ returnRate: 'seven' }, 'like 7'],
    [{ returnRate: '7.123' }, 'like 7'],
    [{ returnRate: 7 }, ''],
    [{ birth: { year: 2026, month: 12 } }, 'future'],
    [{ birth: { year: 2007, month: 13 } }, ''],
    [{ birth: { year: 1850, month: 1 } }, ''],
    [{ birth: { year: 2007.5, month: 1 } }, ''],
    [{ birth: { year: 2007, month: 1, day: 3 } }, ''],
    [{ salary: '1' }, ''],
  ])('refuses %j', async (payload, msg) => {
    const r = await call({ method: 'PUT', url: '/api/settings/planning', payload });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain(msg);
  });
});

describe('planning settings in demo mode', () => {
  it('demo shows its own FAKE birth month and return; the real ones are untouched and never shown', async () => {
    await ok({ method: 'PUT', url: '/api/settings/planning', payload: { returnRate: '5.25', birth: { year: 1999, month: 2 } } });
    const enter = await call({ method: 'POST', url: '/api/demo/enter' });
    expect(enter.statusCode, enter.body).toBe(200);
    const demoCookie = enter.cookies.find((x) => x.name.startsWith('arc40_session_'))!;
    auth = { cookie: `${demoCookie.name}=${demoCookie.value}`, csrf: enter.json().csrfToken };
    const demo = await get('/api/settings/planning');
    expect(demo).toMatchObject({ returnRateBp: 700, birth: { year: 2007, month: 6 }, age: 19 }); // demo today = 2026-11-11
    expect(JSON.stringify(demo)).not.toContain('1999');
    const base = await get('/api/planning/baseline?months=3');
    expect(base.monthsUsed).toBe(3);
    expect(base.investedCents).toBeGreaterThan(0);
    // A change in demo mode stays in the demo database.
    await ok({ method: 'PUT', url: '/api/settings/planning', payload: { returnRate: '4' } });
    const exit = await call({ method: 'POST', url: '/api/demo/exit', payload: { password: 'correct horse battery' } });
    expect(exit.statusCode, exit.body).toBe(200);
    const c = exit.cookies.find((x) => x.name.startsWith('arc40_session_'))!;
    auth = { cookie: `${c.name}=${c.value}`, csrf: exit.json().csrfToken };
    expect(await get('/api/settings/planning')).toMatchObject({ returnRateBp: 525, birth: { year: 1999, month: 2 } });
  });
});
