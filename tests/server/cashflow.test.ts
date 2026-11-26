import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { incomeAverage, monthlyRows, savingsRateBp, setAsideCents, spendingByCategory, totals, type CashTx } from '../../server/src/lib/cashflow.js';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';

const tx = (date: string, amountCents: number, type: CashTx['type'], categoryId: number | null = null): CashTx => ({ date, amountCents, type, categoryId });

describe('savings rate math', () => {
  it('(income - spending) / income in basis points', () => {
    expect(savingsRateBp(100_000, 25_000)).toBe(7500); // 75.00%
    expect(savingsRateBp(30_000, 10_000)).toBe(6667); // 66.67% (rounded)
    expect(savingsRateBp(100_000, 100_000)).toBe(0);
  });

  it('spending more than you earn is a negative rate, not hidden', () => {
    expect(savingsRateBp(10_000, 15_000)).toBe(-5000);
    expect(savingsRateBp(30_000, 40_000)).toBe(-3333);
  });

  it('no income -> null (shown as "No income this month"), never a division by zero', () => {
    expect(savingsRateBp(0, 5_000)).toBeNull();
    expect(savingsRateBp(0, 0)).toBeNull();
    expect(savingsRateBp(-100, 0)).toBeNull(); // a reversed paycheck is not "income"
  });

  it('transfers and gifts never count as income or spending; refunds lower spending', () => {
    const t = totals([
      tx('2026-10-01', 50_000, 'income'),
      tx('2026-10-02', -12_000, 'expense'),
      tx('2026-10-03', 2_000, 'expense'), // refund
      tx('2026-10-04', -20_000, 'transfer'),
      tx('2026-10-04', 20_000, 'transfer'),
      tx('2026-10-05', 100_000, 'gift'),
    ]);
    expect(t).toEqual({ incomeCents: 50_000, spendingCents: 10_000, giftCents: 100_000 });
    expect(savingsRateBp(t.incomeCents, t.spendingCents)).toBe(8000);
  });

  it('a month with only a gift has no income: rate is null, not 100%', () => {
    const [row] = monthlyRows([tx('2026-10-05', 100_000, 'gift'), tx('2026-10-06', -500, 'expense')], '2026-10-01', '2026-10-01');
    expect(row).toMatchObject({ incomeCents: 0, spendingCents: 500, savingsRateBp: null });
  });

  it('monthly rows include empty months and YTD comes from totals, not an average of rates', () => {
    const txs = [tx('2026-01-10', 10_000, 'income'), tx('2026-01-11', -9_000, 'expense'), tx('2026-03-01', 90_000, 'income')];
    const rows = monthlyRows(txs, '2026-01-01', '2026-03-01');
    expect(rows.map((r) => r.savingsRateBp)).toEqual([1000, null, 10000]);
    const ytd = totals(txs);
    expect(savingsRateBp(ytd.incomeCents, ytd.spendingCents)).toBe(9100); // (100k - 9k) / 100k, not avg(10%, 100%)
  });

  it('spending by category, refunds netted, uncategorized as null', () => {
    const m = spendingByCategory([tx('2026-10-01', -3_000, 'expense', 5), tx('2026-10-02', 1_000, 'expense', 5), tx('2026-10-03', -700, 'expense'), tx('2026-10-03', 9_999, 'income', 1)]);
    expect([...m.entries()]).toEqual([
      [5, 2_000],
      [null, 700],
    ]);
  });
});

describe('income average for irregular pay', () => {
  const txs = [
    tx('2026-07-15', 30_000, 'income'),
    tx('2026-08-15', 60_000, 'income'),
    tx('2026-09-15', 0 + 90_000, 'income'),
    tx('2026-10-15', 120_000, 'income'),
    tx('2026-11-05', 999_999, 'income'), // current month: never counted
  ];
  it('averages the last N complete months', () => {
    expect(incomeAverage(txs, '2026-11-01', 3)).toEqual({ avgCents: 90_000, monthsUsed: 3 });
  });
  it('a quiet month counts as zero instead of being skipped', () => {
    const quiet = txs.filter((t) => t.date !== '2026-09-15');
    expect(incomeAverage(quiet, '2026-11-01', 3).avgCents).toBe(60_000);
  });
  it('a new user is not averaged against months before their data started', () => {
    expect(incomeAverage(txs, '2026-11-01', 12)).toEqual({ avgCents: 75_000, monthsUsed: 4 });
    expect(incomeAverage([], '2026-11-01', 3)).toEqual({ avgCents: null, monthsUsed: 0 });
    expect(incomeAverage([tx('2026-11-02', 5, 'income')], '2026-11-01', 3)).toEqual({ avgCents: null, monthsUsed: 0 });
  });
});

describe('gig tax set-aside estimate', () => {
  it('is off at 0%, uses pay minus costs by default, never negative', () => {
    expect(setAsideCents(100_000, 20_000, 0, true)).toBe(0);
    expect(setAsideCents(100_000, 20_000, 2500, true)).toBe(20_000);
    expect(setAsideCents(100_000, 20_000, 2500, false)).toBe(25_000);
    expect(setAsideCents(10_000, 20_000, 2500, true)).toBe(0);
    expect(setAsideCents(33_333, 0, 1000, false)).toBe(3_333);
  });
});

// ---------- API ----------

let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };
let checking: number;
const call = (opts: InjectOptions) => t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });
const cat = async (name: string) => ((await call({ method: 'GET', url: '/api/categories' })).json().categories as { id: number; name: string }[]).find((c) => c.name === name)!.id;
const add = (date: string, amount: string, direction: 'in' | 'out', type: string, categoryId: number | null = null) =>
  call({ method: 'POST', url: '/api/transactions', payload: { accountId: checking, date, amount, direction, description: 'x', type, categoryId } });

describe('budget and cash flow API', () => {
  beforeEach(async () => {
    t = await testApp(); // today = 2026-11-11
    const s = await setupAndLogin(t);
    auth = { cookie: s.cookie, csrf: s.csrf };
    checking = (await call({ method: 'POST', url: '/api/accounts', payload: { name: 'Checking', type: 'checking' } })).json().account.id;
  });
  afterEach(async () => {
    await t.app.close();
  });

  it('Housing and Food start with a $0 limit', async () => {
    const b = (await call({ method: 'GET', url: '/api/budget' })).json();
    expect(b.month).toBe('2026-11-01');
    const by = (n: string) => b.categories.find((c: { name: string }) => c.name === n);
    expect(by('Housing').limitCents).toBe(0);
    expect(by('Food').limitCents).toBe(0);
    expect(by('Dining Out').limitCents).toBeNull();
  });

  it('default limits, one-month overrides, spent with refunds, and clearing', async () => {
    const dining = await cat('Dining Out');
    await call({ method: 'PUT', url: '/api/budget', payload: { categoryId: dining, month: null, limit: '100' } });
    await call({ method: 'PUT', url: '/api/budget', payload: { categoryId: dining, month: '2026-11-01', limit: '150.50' } });
    await add('2026-11-02', '40', 'out', 'expense', dining);
    await add('2026-11-03', '5.25', 'in', 'expense', dining); // refund
    await add('2026-10-20', '99', 'out', 'expense', dining); // other month
    const nov = (await call({ method: 'GET', url: '/api/budget' })).json().categories.find((c: { id: number }) => c.id === dining);
    expect(nov).toMatchObject({ limitCents: 15050, isOverride: true, spentCents: 3475 });
    const oct = (await call({ method: 'GET', url: '/api/budget?month=2026-10-01' })).json().categories.find((c: { id: number }) => c.id === dining);
    expect(oct).toMatchObject({ limitCents: 10000, isOverride: false, spentCents: 9900 });
    await call({ method: 'PUT', url: '/api/budget', payload: { categoryId: dining, month: '2026-11-01', limit: null } });
    const after = (await call({ method: 'GET', url: '/api/budget' })).json().categories.find((c: { id: number }) => c.id === dining);
    expect(after).toMatchObject({ limitCents: 10000, isOverride: false });
  });

  it.each([
    [{ month: null, limit: '-5' }, 'negative'],
    [{ month: null, limit: '12.345' }, '150.00'],
    [{ month: '2026-11-15', limit: '5' }, 'month'],
  ])('rejects %j', async (extra, hint) => {
    const res = await call({ method: 'PUT', url: '/api/budget', payload: { categoryId: await cat('Shopping'), ...extra } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain(hint);
  });

  it('refuses a budget on an income category', async () => {
    const res = await call({ method: 'PUT', url: '/api/budget', payload: { categoryId: await cat('Refereeing'), month: null, limit: '5' } });
    expect(res.statusCode).toBe(400);
  });

  it('warns when limits add up to more than average income', async () => {
    await add('2026-10-05', '200', 'in', 'income', await cat('Refereeing'));
    await call({ method: 'PUT', url: '/api/budget', payload: { categoryId: await cat('Shopping'), month: null, limit: '250' } });
    const b = (await call({ method: 'GET', url: '/api/budget' })).json();
    expect(b.income).toMatchObject({ avgCents: 20000, avgMonths: 3, monthsUsed: 1, overAverage: true });
  });

  it('cash flow: monthly rows, YTD rate from totals, gifts and transfers excluded, zero-income months null', async () => {
    const ref = await cat('Refereeing');
    await add('2026-09-10', '300', 'in', 'income', ref);
    await add('2026-09-12', '60', 'out', 'expense', await cat('Ref Gear & Fees'));
    await add('2026-10-01', '100', 'in', 'gift');
    await add('2026-10-02', '30', 'out', 'expense', await cat('Food'));
    await add('2026-10-03', '50', 'out', 'transfer');
    const cf = (await call({ method: 'GET', url: '/api/cashflow?months=3' })).json();
    expect(cf.months.map((m: { month: string; savingsRateBp: number | null }) => [m.month, m.savingsRateBp])).toEqual([
      ['2026-09-01', 8000],
      ['2026-10-01', null],
      ['2026-11-01', null],
    ]);
    expect(cf.ytd).toMatchObject({ incomeCents: 30000, spendingCents: 9000, giftCents: 10000, savingsRateBp: 7000, year: 2026 });
    expect(cf.gig).toMatchObject({ payCents: 30000, costsCents: 6000, netCents: 24000, setAsideCents: 0 });
  });

  it('tax set-aside is an optional percent setting', async () => {
    await add('2026-09-10', '300', 'in', 'income', await cat('Refereeing'));
    expect((await call({ method: 'PUT', url: '/api/settings/budget', payload: { taxSetAsidePercent: '22.5' } })).statusCode).toBe(200);
    expect((await call({ method: 'GET', url: '/api/settings' })).json().taxSetAsideBp).toBe(2250);
    expect((await call({ method: 'GET', url: '/api/cashflow' })).json().gig.setAsideCents).toBe(6750);
    for (const bad of ['101', 'abc', '-3', '1.234']) {
      expect((await call({ method: 'PUT', url: '/api/settings/budget', payload: { taxSetAsidePercent: bad } })).statusCode).toBe(400);
    }
    expect((await call({ method: 'PUT', url: '/api/settings/budget', payload: { incomeAvgMonths: 5 } })).statusCode).toBe(400);
    expect((await call({ method: 'PUT', url: '/api/settings/budget', payload: { incomeAvgMonths: 6 } })).statusCode).toBe(200);
  });
});
