/**
 * Cross-checks: every screen must agree with every other screen about the same money.
 * Imports all six fake bank files (same layouts as the user's banks), adds manual entries on
 * month boundaries, then compares Budget, Cash flow, Transactions, Accounts and Net worth.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';
import { addMonths, endOfMonth } from '../../shared/dates.js';
import { futureYou } from '../../shared/projection.js';
import { workTenths } from '../../shared/workCost.js';
import { merchantKey } from '../../server/src/lib/recurring.js';
import { TrophyData } from '../../server/src/lib/trophies/data.js';
import { money as trophyMoney } from '../../server/src/lib/trophies/format.js';
import { avgMonthlySpending, monthlyNeed } from '../../server/src/lib/emergency.js';
import { getSetting } from '../../server/src/lib/settings.js';

const fixture = (name: string) => fs.readFileSync(path.resolve('tests/fixtures/csv', name), 'utf8');
let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };
const call = (opts: InjectOptions) => t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });
const get = async (url: string) => (await call({ method: 'GET', url })).json();
const ids: Record<string, number> = {};

beforeAll(async () => {
  t = await testApp(); // today = 2026-11-11
  const s = await setupAndLogin(t);
  auth = { cookie: s.cookie, csrf: s.csrf };
  for (const [key, name, type] of [
    ['wpcuChecking', 'Credit Union Checking', 'checking'],
    ['wpcuSavings', 'Credit Union Savings', 'savings'],
    ['cfChecking', 'CF Checking', 'checking'],
    ['cfSavings', 'CF Savings', 'savings'],
    ['brokerage', 'Brokerage', 'brokerage'],
    ['roth', 'Roth IRA', 'roth_ira'],
  ] as const) {
    ids[key] = (await call({ method: 'POST', url: '/api/accounts', payload: { name, type } })).json().account.id;
  }
  for (const [key, file] of [
    ['wpcuChecking', 'wpcu-checking.csv'],
    ['wpcuSavings', 'wpcu-savings.csv'],
    ['cfChecking', 'climatefirst-checking.csv'],
    ['cfSavings', 'climatefirst-savings.csv'],
    ['brokerage', 'fidelity-brokerage.csv'],
    ['roth', 'fidelity-roth.csv'],
  ] as const) {
    const r = await call({ method: 'POST', url: '/api/import/commit', payload: { accountId: ids[key], filename: file, text: fixture(file) } });
    expect(r.statusCode, r.body).toBe(200);
  }
  // Month-boundary and special cases, entered by hand
  const cats = (await get('/api/categories')).categories as { id: number; name: string }[];
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  const add = (payload: object) => call({ method: 'POST', url: '/api/transactions', payload: { accountId: ids.wpcuChecking, description: 'x', ...payload } });
  await add({ date: '2026-10-31', amount: '45', direction: 'in', type: 'income', categoryId: cat('Refereeing') }); // last day of a month
  await add({ date: '2026-11-01', amount: '12.34', direction: 'out', type: 'expense', categoryId: cat('Food') }); // first day of the next
  await add({ date: '2026-11-02', amount: '100', direction: 'in', type: 'gift', giftFrom: 'Mom' });
  await add({ date: '2026-11-03', amount: '5', direction: 'in', type: 'expense', categoryId: cat('Food') }); // refund
  await add({ accountId: ids.cfChecking, date: '2026-11-04', amount: '20', direction: 'out', type: 'expense' }); // uncategorized
  // Split transactions (V2 Phase 2): a store run split three ways and a tournament check split two ways.
  const store = (await add({ date: '2026-09-15', amount: '90', direction: 'out', type: 'expense', categoryId: cat('Food') })).json().transaction.id;
  const okSplit = async (id: number, pieces: object[]) => {
    const r = await call({ method: 'PUT', url: `/api/transactions/${id}/split`, payload: { pieces } });
    expect(r.statusCode, r.body).toBe(200);
  };
  await okSplit(store, [
    { categoryId: cat('Food'), amount: '50.25' },
    { categoryId: cat('Shopping'), amount: '29.75', note: 'towels' },
    { categoryId: cat('Gifts Given'), amount: '10' },
  ]);
  const check = (
    await add({ date: '2026-09-16', amount: '75', direction: 'in', type: 'income', categoryId: cat('Refereeing'), payer: 'Fake Tournament' })
  ).json().transaction.id;
  await okSplit(check, [
    { categoryId: cat('Refereeing'), amount: '60' },
    { categoryId: cat('Interest'), amount: '15', note: 'not earned income' },
  ]);
  // A monthly subscription (V2 Phase 2 recurring detector): 4 charges, the newest one more expensive.
  for (const [d, amt] of [['2026-07-05', '12.99'], ['2026-08-05', '12.99'], ['2026-09-05', '12.99'], ['2026-10-05', '14.49']]) {
    await add({ date: d, amount: amt, direction: 'out', type: 'expense', categoryId: cat('Subscriptions'), description: 'FAKEFLIX STREAMING' });
  }
  for (const [acct, bal] of [['wpcuChecking', '400'], ['cfChecking', '60'], ['cfSavings', '2950'], ['brokerage', '1480'], ['roth', '360']] as const) {
    await call({ method: 'POST', url: `/api/accounts/${ids[acct]}/balances`, payload: { asOf: '2026-11-11', balance: bal } });
  }
});
afterAll(async () => {
  await t.app.close();
});

describe('every screen agrees', () => {
  it('Budget month totals == Cash flow month row == Transactions list sums, for every month', async () => {
    const cf = await get('/api/cashflow?months=12');
    for (const row of cf.months as { month: string; incomeCents: number; spendingCents: number; savingsRateBp: number | null }[]) {
      const b = await get(`/api/budget?month=${row.month}`);
      const list = await get(`/api/transactions?from=${row.month}&to=${endOfMonth(row.month)}&limit=1`);
      expect(b.income.thisMonthCents, row.month).toBe(row.incomeCents);
      expect(b.totals.spentCents, row.month).toBe(row.spendingCents);
      expect(b.savingsRateBp, row.month).toBe(row.savingsRateBp);
      expect(list.sums.incomeCents, row.month).toBe(row.incomeCents);
      expect(list.sums.spendingCents, row.month).toBe(row.spendingCents);
      // categories + uncategorized add up to the month's spending
      const byCat = (b.categories as { spentCents: number }[]).reduce((s, c) => s + c.spentCents, 0);
      expect(byCat + b.uncategorizedCents, row.month).toBe(row.spendingCents);
    }
  });

  it('month boundaries: Oct 31 counts in October, Nov 1 in November', async () => {
    const oct = await get('/api/budget?month=2026-10-01');
    const nov = await get('/api/budget?month=2026-11-01');
    expect(oct.income.thisMonthCents).toBe(4500 + 8500 + 42 + 12 + 1150); // Oct 31 ref pay + Oct 15 payroll + 3 interest/dividend deposits
    expect(nov.totals.spentCents).toBe(1234 - 500 + 2000); // food, refund, uncategorized
    expect(nov.income.thisMonthCents).toBe(0); // the gift is not income
  });

  it('YTD equals the sum of this year\'s months', async () => {
    const cf = await get('/api/cashflow?months=12');
    const year = (cf.months as { month: string; incomeCents: number; spendingCents: number }[]).filter((m) => m.month.startsWith('2026'));
    expect(cf.ytd.incomeCents).toBe(year.reduce((s, m) => s + m.incomeCents, 0));
    expect(cf.ytd.spendingCents).toBe(year.reduce((s, m) => s + m.spendingCents, 0));
  });

  it('flags uncategorized money in that is being counted as income (like a big check)', async () => {
    const cf = await get('/api/cashflow');
    // ref payroll 85 + cash 100 (credit union checking) + 2,000 check (credit union savings) + 3,000 opening deposit (CF savings)
    expect(cf.ytd.uncategorizedIncomeCents).toBe(8500 + 10000 + 200000 + 300000);
  });

  it('no transfer or gift ever reaches income or spending', async () => {
    const all = await get('/api/transactions?limit=500');
    const transferAndGift = (all.transactions as { type: string; amountCents: number }[]).filter((x) => x.type === 'transfer' || x.type === 'gift');
    expect(transferAndGift.length).toBeGreaterThan(5);
    const incomeOnly = (all.transactions as { type: string; amountCents: number }[]).filter((x) => x.type === 'income').reduce((s, x) => s + x.amountCents, 0);
    expect(all.sums.incomeCents).toBe(incomeOnly);
  });

  it('net worth today == sum of the account cards; series ends at today\'s value', async () => {
    const nw = await get('/api/networth?range=all');
    const accts = (await get('/api/accounts')).accounts as { balanceCents: number | null }[];
    expect(nw.current.totalCents).toBe(accts.reduce((s, a) => s + (a.balanceCents ?? 0), 0));
    expect(nw.series.at(-1).totalCents).toBe(nw.current.totalCents);
  });

  it('the net worth series has no step bigger than the money that actually moved that day', async () => {
    // A transfer moves money between accounts: total net worth should change only by real income,
    // spending, gifts and balance corrections, never by the size of a transfer.
    // Since V2 Phase 2 investment accounts are valued daily from fund prices, so the Roth's value
    // also drifts that day (its FXAIX price is estimated between two Fidelity trade prices). That
    // market movement is left out here; the transfer itself must not change the total by a cent.
    const nw = await get('/api/networth?range=all');
    const s = nw.series as { date: string; totalCents: number; byAccount: Record<string, number> }[];
    const transferDay = s.findIndex((p) => p.date === '2026-09-29');
    expect(transferDay).toBeGreaterThan(0);
    const before = s[transferDay - 1]!;
    const after = s[transferDay]!;
    const withoutRoth = (p: typeof before) => p.totalCents - (p.byAccount[ids.roth!] ?? 0);
    expect(withoutRoth(after) - withoutRoth(before)).toBe(0); // $1,500 moved, nothing gained or lost
    expect(after.byAccount[ids.brokerage!]).toBe(150000); // arrived once: 8 x $150 + 19.672 x $15.25, rounded once
    expect(before.byAccount[ids.brokerage!] ?? 0).toBe(0);
  });

  it('dashboard: category treemap, calendar and income-by-source agree with the cash flow months', async () => {
    const d = await get('/api/dashboard');
    const cf = await get('/api/cashflow?months=12');
    const spend12 = (cf.months as { spendingCents: number }[]).reduce((s, m) => s + m.spendingCents, 0);
    const income12 = (cf.months as { incomeCents: number }[]).reduce((s, m) => s + m.incomeCents, 0);
    expect((d.spendingByCategory as { cents: number }[]).reduce((s, c) => s + c.cents, 0)).toBe(spend12);
    const bySource = (d.incomeBySource.sources as { cents: number[] }[]).reduce((s, x) => s + x.cents.reduce((a, b) => a + b, 0), 0);
    expect(bySource).toBe(income12);
    d.incomeBySource.months.forEach((m: string, i: number) => {
      const row = (cf.months as { month: string; incomeCents: number }[]).find((x) => x.month === m)!;
      expect((d.incomeBySource.sources as { cents: number[] }[]).reduce((s, x) => s + x.cents[i]!, 0), m).toBe(row.incomeCents);
    });
    // the calendar covers the last 365 days; every fixture expense is inside it
    expect((d.daily as { cents: number }[]).every((x) => Number.isInteger(x.cents) && x.cents >= 0)).toBe(true);
    // the Oct 31 Refereeing entry, and only the Refereeing PIECE of the split tournament check
    expect(d.incomeByPayer).toEqual([
      { payer: 'Fake Tournament', cents: 6000 },
      { payer: 'Not specified', cents: 4500 },
    ]);
  });

  it('budget months before any data are empty, not errors', async () => {
    const b = await get(`/api/budget?month=${addMonths('2026-01-01', -24)}`);
    expect(b).toMatchObject({ savingsRateBp: null, totals: { spentCents: 0 }, income: { thisMonthCents: 0 } });
  });
});

describe('split transactions: every screen counts the pieces, never the whole', () => {
  const cats = async () => (await get('/api/categories')).categories as { id: number; name: string; kind: string }[];

  it('every category on the Budget page == the Transactions list filtered by that category, every month', async () => {
    const cf = await get('/api/cashflow?months=12');
    const expense = (await cats()).filter((c) => c.kind === 'expense');
    for (const row of cf.months as { month: string }[]) {
      const b = await get(`/api/budget?month=${row.month}`);
      for (const c of expense) {
        const spent = (b.categories as { id: number; spentCents: number }[]).find((x) => x.id === c.id)?.spentCents ?? 0;
        const list = await get(`/api/transactions?from=${row.month}&to=${endOfMonth(row.month)}&categoryId=${c.id}&limit=1`);
        expect(list.sums.spendingCents, `${row.month} ${c.name}`).toBe(spent);
      }
    }
  });

  it('the split pieces show up with their own amounts and categories', async () => {
    const all = await cats();
    const id = (n: string) => all.find((c) => c.name === n)!.id;
    const sep = await get('/api/budget?month=2026-09-01');
    const spent = (n: string) => (sep.categories as { id: number; spentCents: number }[]).find((x) => x.id === id(n))!.spentCents;
    expect(spent('Shopping')).toBe(2975);
    expect(spent('Gifts Given')).toBe(1000);
    const shopping = await get(`/api/transactions?categoryId=${id('Shopping')}&from=2026-09-01&to=2026-09-30`);
    expect(shopping.transactions).toHaveLength(1);
    expect(shopping.transactions[0]).toMatchObject({ amountCents: -2975, split: { position: 2, count: 3, note: 'towels', totalCents: -9000 } });
    // Unfiltered, the store run is 3 rows that add up to the whole $90.
    const day = await get('/api/transactions?from=2026-09-15&to=2026-09-15');
    expect((day.transactions as { amountCents: number }[]).reduce((s2, t2) => s2 + t2.amountCents, 0)).toBe(-9000);
    expect(day.total).toBe(3);
  });

  it('dashboard treemap, gig card and Roth earned income use piece amounts', async () => {
    const all = await cats();
    const id = (n: string) => all.find((c) => c.name === n)!.id;
    const d = await get('/api/dashboard');
    for (const c of d.spendingByCategory as { categoryId: number | null; cents: number }[]) {
      if (c.categoryId === null) continue;
      const list = await get(`/api/transactions?from=${d.from}&to=${d.today}&categoryId=${c.categoryId}&limit=1`);
      expect(list.sums.spendingCents, String(c.categoryId)).toBe(c.cents);
    }
    const cf = await get('/api/cashflow');
    const ref = await get(`/api/transactions?from=2026-01-01&to=2026-12-31&categoryId=${id('Refereeing')}&limit=1`);
    expect(cf.gig.payCents).toBe(ref.sums.incomeCents);
    expect(cf.gig.payCents).toBe(4500 + 6000); // the Oct 31 entry and the $60 piece (not the whole $75)
    const goals = await get('/api/goals?year=2026');
    const other = await get(`/api/transactions?from=2026-01-01&to=2026-12-31&categoryId=${id('Other Income')}&limit=1`);
    expect(goals.roth.earnedIncomeCents).toBe(ref.sums.incomeCents + other.sums.incomeCents); // the $15 Interest piece is not earned
  });

});

describe('recurring charges agree with the transactions they come from', () => {
  it('suggestion and confirmed item costs come straight from the charges; the headline is the sum of the items', async () => {
    const o = await get('/api/recurring');
    const s = (o.suggestions as { key: string; name: string; amountCents: number; yearlyCents: number; chargeCount: number; lastCharge: { amountCents: number; date: string } }[]).find(
      (x) => x.name === 'FAKEFLIX STREAMING',
    )!;
    const charges = (await get('/api/transactions?q=FAKEFLIX')).transactions as { amountCents: number; date: string }[];
    expect(s.chargeCount).toBe(charges.length);
    const newest = [...charges].sort((a, b) => (a.date < b.date ? 1 : -1))[0]!;
    expect(s.lastCharge).toMatchObject({ amountCents: -newest.amountCents, date: newest.date });
    expect(s.amountCents).toBe(-newest.amountCents);
    expect(s.yearlyCents).toBe(s.amountCents * 12);

    await call({ method: 'POST', url: '/api/recurring/confirm', payload: { key: s.key } });
    await call({ method: 'POST', url: '/api/recurring', payload: { name: 'Fake insurance', amount: '20.01', schedule: 'quarterly', nextDue: '2026-12-01' } });
    const after = await get('/api/recurring');
    const items = after.items as { yearlyCents: number; monthlyCents: number; amountCents: number; schedule: string }[];
    expect(items).toHaveLength(2);
    expect(after.totals.yearlyCents).toBe(items.reduce((sum, i) => sum + i.yearlyCents, 0));
    expect(after.totals.yearlyCents).toBe(1449 * 12 + 2001 * 4);
    expect(after.totals.monthlyCents).toBe(Math.round(after.totals.yearlyCents / 12));
    // Detection never changes a transaction or a total.
    expect((await get('/api/transactions?q=FAKEFLIX')).transactions).toEqual(charges);
  });

  it('next 30 days == the calendar over the same days; the checking figure == the Accounts page', async () => {
    const u = await get('/api/recurring/upcoming');
    expect(u.bills.length).toBeGreaterThan(0);
    expect(u.totalCents).toBe((u.bills as { amountCents: number }[]).reduce((sum, b) => sum + b.amountCents, 0));
    const months = [...new Set([u.from.slice(0, 7), u.to.slice(0, 7)])].map((m) => `${m}-01`);
    const cal = (await Promise.all(months.map((m) => get(`/api/recurring/calendar?month=${m}`)))).flatMap((c) => c.bills as { date: string; amountCents: number }[]);
    const inWindow = cal.filter((b) => b.date >= u.from && b.date <= u.to);
    expect(inWindow.reduce((sum, b) => sum + b.amountCents, 0)).toBe(u.totalCents);
    const accts = (await get('/api/accounts')).accounts as { type: string; balanceCents: number | null }[];
    expect(u.checking.balanceCents).toBe(accts.filter((a) => a.type === 'checking').reduce((sum, a) => sum + (a.balanceCents ?? 0), 0));
  });
});

describe('rebuilt investment history agrees everywhere (V2 Phase 2 price history)', () => {
  it('net worth, the Investments page and the account history give the same value for the brokerage on every day', async () => {
    const r = await call({
      method: 'POST',
      url: '/api/investments/price-history/commit',
      payload: { symbol: 'FSKAX', text: fs.readFileSync(path.resolve('tests/fixtures/csv/price-history-close-adj.csv'), 'utf8') },
    });
    expect(r.statusCode, r.body).toBe(200);
    const nw = (await get('/api/networth?range=all')).series as { date: string; byAccount: Record<string, number> }[];
    const inv = (await get(`/api/investments?accountId=${ids.brokerage}`)).series as { date: string; valueCents: number; priceState: string | null; estimated: string[] }[];
    const hist = (await get(`/api/accounts/${ids.brokerage}`)).history as { date: string; cents: number }[];
    const byNw = new Map(nw.map((p) => [p.date, p.byAccount[ids.brokerage!]]));
    const byHist = new Map(hist.map((p) => [p.date, p.cents]));
    let compared = 0;
    for (const p of inv) {
      if (!byNw.has(p.date) || !byHist.has(p.date)) continue;
      expect(byNw.get(p.date), p.date).toBe(p.valueCents);
      expect(byHist.get(p.date), p.date).toBe(p.valueCents);
      compared++;
    }
    expect(compared).toBeGreaterThan(30);
    // FSKAX is estimated in the file's gap; the day as a whole is 'stale' because FTIHX's only price is Sep 29.
    expect(inv.some((p) => p.estimated.includes('FSKAX') && p.priceState === 'stale')).toBe(true);
    // Today the typed balance (1,480.00) still wins on its own date, and every screen shows it.
    const cards = (await get('/api/accounts')).accounts as { id: number; balanceCents: number }[];
    expect(inv.at(-1)!.valueCents).toBe(148000);
    expect(cards.find((a) => a.id === ids.brokerage)!.balanceCents).toBe(148000);
  });
});

/**
 * V2 Phase 4 Arc40 Wrapped: every slide's number equals what another screen shows for the same dates.
 * Runs on the imported bank files (2026 so far), then in demo mode for a full past year and the year so far.
 * Demo mode is entered LAST in this file (nothing after it uses the real data).
 */
async function wrappedAgrees(year: number) {
  const w = await get(`/api/wrapped?year=${year}`);
  const slide = (kind: string) => w.slides.find((s: { kind: string }) => s.kind === kind);
  const sums = async (q: string) => (await get(`/api/transactions?from=${w.from}&to=${w.to}&limit=1${q}`)).sums;
  const all = await sums('');
  let checked = 0;

  const rate = slide('savingsRate');
  if (rate) {
    expect(rate.incomeCents).toBe(all.incomeCents);
    expect(rate.spendingCents).toBe(all.spendingCents);
    if (w.soFar) expect(rate.rateBp).toBe((await get('/api/cashflow?months=12')).ytd.savingsRateBp);
    checked++;
  }
  const top = slide('topCategory');
  if (top) {
    expect(top.cents).toBe((await sums(`&categoryId=${top.categoryId ?? 'none'}`)).spendingCents);
    expect(top.spendingCents).toBe(all.spendingCents);
    checked++;
  }
  const big = slide('biggestMonth');
  if (big) {
    const to = endOfMonth(big.month) < w.to ? endOfMonth(big.month) : w.to;
    expect(big.cents).toBe((await get(`/api/transactions?from=${big.month}&to=${to}&limit=1`)).sums.spendingCents);
    checked++;
  }
  const ref = slide('refereeing');
  if (ref) {
    const refId = ((await get('/api/categories')).categories as { id: number; name: string }[]).find((c) => c.name === 'Refereeing')!.id;
    expect(ref.totalCents).toBe((await sums(`&categoryId=${refId}`)).incomeCents);
    expect(ref.byPayer.reduce((s: number, p: { cents: number }) => s + p.cents, 0)).toBe(ref.totalCents);
    if (w.soFar) {
      // Same payers and amounts as the Dashboard's "refereeing pay by payer" when the year is inside its 12 months.
      const dash = (await get('/api/dashboard')) as { from: string; incomeByPayer: { payer: string; cents: number }[] };
      if (dash.from === w.from) expect(ref.byPayer).toEqual(dash.incomeByPayer);
    }
    checked++;
  }
  const merchant = slide('topMerchant');
  if (merchant) {
    // The Transactions rows for the year (split pieces are rows), grouped by the same merchant key.
    const key = (d: string) => merchantKey(d) || d.trim().toUpperCase();
    const rows = (await get(`/api/transactions?from=${w.from}&to=${w.to}&type=expense&limit=50000`)).transactions as { description: string; amountCents: number }[];
    expect(merchant.cents).toBe(-rows.filter((r) => key(r.description) === key(merchant.name)).reduce((s, r) => s + r.amountCents, 0));
    checked++;
  }
  const nwSlide = slide('netWorth');
  if (nwSlide && w.soFar) {
    expect(nwSlide.endCents).toBe((await get('/api/networth?range=all')).current.totalCents);
    checked++;
  }
  const inv = slide('investments');
  if (inv) {
    expect(inv.endValueCents - inv.startValueCents - inv.putInCents).toBe(inv.growthCents);
    if (w.soFar) expect(inv.endValueCents).toBe((await get('/api/investments')).totals.valueCents);
    checked++;
  }
  const roth = slide('roth');
  if (roth) {
    const g = (await get(`/api/goals?year=${year}`)).roth;
    expect([roth.contributedCents, roth.limitCents, roth.earnedCents]).toEqual([g.contributedCents, g.limitCents, g.earnedIncomeCents]);
    checked++;
  }
  const subs = slide('subscriptions');
  if (subs) {
    for (const it of subs.items) expect(it.cents, it.name).toBe((await sums(`&type=expense&q=${encodeURIComponent(it.name)}`)).spendingCents);
    checked++;
  }
  const work = slide('workCost');
  const wc = await get('/api/work-cost');
  expect(!!work).toBe(wc.active !== null && all.spendingCents > 0);
  if (work) {
    expect(work.tenths).toBe(workTenths(all.spendingCents, wc.active));
    checked++;
  }
  const fy = slide('futureYou');
  const planning = await get('/api/settings/planning');
  if (fy) {
    const engine = futureYou(fy.investedCents, planning.birth, w.today, planning.returnRateBp)!;
    expect([fy.valueCents, fy.age]).toEqual([engine.valueCents, engine.age]);
    if (inv) expect(fy.investedCents).toBe(inv.putInCents);
    checked++;
  } else {
    expect(planning.birth === null || !inv || inv.putInCents <= 0).toBe(true);
  }
  return { w, checked };
}

describe('trophies agree with the Dashboard (Trophies Round 1)', () => {
  it('the daily net worth trophies read == /api/networth on every chart day; progress uses today\'s net worth', async () => {
    const nw = await get('/api/networth?range=all');
    const data = new TrophyData(t.db, '2026-11-11');
    for (const p of nw.series as { date: string; totalCents: number }[]) expect(data.netWorth.on(p.date), p.date).toBe(p.totalCents);
    expect(data.netWorth.days.at(-1)).toEqual({ date: '2026-11-11', cents: nw.current.totalCents });
    const on = await call({ method: 'POST', url: '/api/trophies/nw.1m/on', payload: { mode: 'history' } });
    expect(on.statusCode, on.body).toBe(200);
    const v = (await get('/api/trophies')).trophies.find((x: { key: string }) => x.key === 'nw.1m');
    expect(v.progress.text).toBe(`${trophyMoney(nw.current.totalCents)} of $1,000,000`);
    await call({ method: 'POST', url: '/api/trophies/nw.1m/off' });
  });

  it('Roth trophies use the Goals page totals and the Accounts page balance', async () => {
    const on = async (key: string) => expect((await call({ method: 'POST', url: `/api/trophies/${key}/on`, payload: { mode: 'history' } })).statusCode).toBe(200);
    const view = async (key: string) => (await get(`/api/trophies/${key}`)) as { state: string; progress: { text: string } | null };
    const goals = await get('/api/goals?year=2026');
    await on('roth.maxed:2026');
    const maxed = await view('roth.maxed:2026');
    expect(maxed.state).toBe('on'); // the fixture Roth is not maxed for 2026
    expect(maxed.progress!.text).toBe(`${trophyMoney(goals.roth.contributedCents)} of ${trophyMoney(goals.roth.limitCents)}`);
    // Lifetime total == the sum of every tax year the Goals page shows.
    const years = new Set((t.db.prepare("SELECT DISTINCT tax_year AS y FROM investment_activity WHERE kind = 'contribution' AND tax_year IS NOT NULL").all() as { y: number }[]).map((r) => r.y));
    let total = 0;
    for (const y of years) total += (await get(`/api/goals?year=${y}`)).roth.contributedCents;
    await on('roth.total.150k');
    expect((await view('roth.total.150k')).progress!.text).toBe(`${trophyMoney(total)} of $150,000`);
    // Roth worth today == the Roth card on the Accounts page.
    const acct = ((await get('/api/accounts')).accounts as { id: number; balanceCents: number }[]).find((a) => a.id === ids.roth)!;
    await on('roth.worth.1m');
    expect((await view('roth.worth.1m')).progress!.text).toBe(`${trophyMoney(acct.balanceCents)} of $1,000,000`);
    for (const k of ['roth.maxed:2026', 'roth.total.150k', 'roth.worth.1m']) await call({ method: 'POST', url: `/api/trophies/${k}/off` });
  });
});

describe('Investing trophies agree with Accounts, the Dashboard and Investments (Trophies Round 2)', () => {
  it('investments worth and growth == the Investments page on every chart day; today == Accounts and the Dashboard', async () => {
    const inv = await get('/api/investments');
    const data = new TrophyData(t.db, '2026-11-11');
    // Both fixture investment accounts have Fidelity history, so growth covers the same accounts as the page.
    let compared = 0;
    for (const p of inv.series as { date: string; valueCents: number; putInCents: number }[]) {
      if (data.investing.worth.on(p.date) === null) continue;
      expect(data.investing.worth.on(p.date), p.date).toBe(p.valueCents);
      expect(data.investing.growth.on(p.date), p.date).toBe(p.valueCents - p.putInCents);
      compared++;
    }
    expect(compared).toBeGreaterThan(10);
    expect(data.investing.growth.on('2026-11-11')).toBe(inv.totals.growthCents);
    const accounts = (await get('/api/accounts')).accounts as { id: number; balanceCents: number }[];
    const invToday = accounts.filter((a) => a.id === ids.brokerage || a.id === ids.roth).reduce((s, a) => s + a.balanceCents, 0);
    expect(data.investing.worth.on('2026-11-11')).toBe(invToday);
    const nw = await get('/api/networth?range=all');
    expect(data.investing.worth.on('2026-11-11')).toBe(nw.allocation.find((g: { group: string }) => g.group === 'investments').cents);
    // Through the trophy: progress text is the same number.
    await call({ method: 'POST', url: '/api/trophies/inv.worth.5m/on', payload: { mode: 'history' } });
    expect((await get('/api/trophies/inv.worth.5m')).progress.text).toBe(`${trophyMoney(invToday)} of $5,000,000`);
    await call({ method: 'POST', url: '/api/trophies/inv.worth.5m/off' });
  });
});

describe('Refereeing trophies agree with the Dashboard and the Budget refereeing card (Trophies Round 2)', () => {
  it('ref income == income by payer and the Refereeing row of income by source; this year == the gig card pay and costs', async () => {
    const dash = await get('/api/dashboard');
    const ref = new TrophyData(t.db, '2026-11-11').refereeing;
    const inWindow = ref.income.filter((r) => r.date >= dash.from && r.date <= '2026-11-11');
    expect(inWindow.map((r) => r.cents).sort()).toEqual([4500, 6000]); // the $45 entry and the $60 split piece (not the whole $75 check)
    expect(inWindow.reduce((s, r) => s + r.cents, 0)).toBe((dash.incomeByPayer as { cents: number }[]).reduce((s, p) => s + p.cents, 0));
    const row = (dash.incomeBySource.sources as { name: string; cents: number[] }[]).find((x) => x.name === 'Refereeing')!;
    (dash.incomeBySource.months as string[]).forEach((m, i) => {
      const mine = ref.income.filter((r) => r.date.startsWith(m.slice(0, 7))).reduce((s, r) => s + r.cents, 0);
      expect(mine, m).toBe(row.cents[i]);
    });
    const gig = (await get('/api/cashflow')).gig;
    expect(ref.income.filter((r) => r.date >= '2026-01-01').reduce((s, r) => s + r.cents, 0)).toBe(gig.payCents);
    expect(ref.costs.filter((r) => r.date >= '2026-01-01').reduce((s, r) => s + r.cents, 0)).toBe(gig.costsCents);
    // Through the trophy: the lifetime progress is the same total.
    await call({ method: 'POST', url: '/api/trophies/ref.lifetime.100k/on', payload: { mode: 'history' } });
    const all = ref.income.reduce((s, r) => s + r.cents, 0);
    expect((await get('/api/trophies/ref.lifetime.100k')).progress.text).toBe(`${trophyMoney(all)} of $100,000`);
    await call({ method: 'POST', url: '/api/trophies/ref.lifetime.100k/off' });
  });
});

describe('Emergency fund and savings trophies agree with Goals, the Dashboard ring and Accounts (Trophies Round 3)', () => {
  it('savings today == the Goals card (and the Accounts balances); 6 x the monthly amount == the Goals target', async () => {
    const goals = (await get('/api/goals')).emergency;
    const em = new TrophyData(t.db, '2026-11-11').emergency;
    expect(goals.savingsAccounts.length).toBeGreaterThan(0);
    expect(em.savings.on('2026-11-11')).toBe(goals.savingsCents);
    const accts = (await get('/api/accounts')).accounts as { type: string; archived: boolean; balanceCents: number }[];
    expect(em.savings.on('2026-11-11')).toBe(accts.filter((a) => a.type === 'savings' && !a.archived).reduce((s, a) => s + a.balanceCents, 0));
    expect(goals.targetCents).not.toBeNull();
    expect(6 * em.need('2026-11-11')!).toBe(goals.targetCents);
  });

  it('every month: the monthly amount == the Goals card function for that month; savings == the net worth series', async () => {
    const em = new TrophyData(t.db, '2026-11-11').emergency;
    const nw = new TrophyData(t.db, '2026-11-11');
    const essentials = getSetting(t.db, 'emergency_essentials_cents');
    let checked = 0;
    for (let m = '2025-01-01'; m <= '2026-11-01'; m = addMonths(m, 1)) {
      const n = monthlyNeed(avgMonthlySpending(t.db, m).avgCents, essentials);
      expect(em.need(m), m).toBe(n !== null && n > 0 ? n : null);
      expect(em.need(endOfMonth(m)), m).toBe(em.need(m));
      if (n !== null) checked++;
    }
    expect(checked).toBeGreaterThan(3);
    // The savings days are the same days as the net worth series (one value per calendar day, no gaps).
    expect(em.savings.days.map((d) => d.date)).toEqual(nw.netWorth.days.map((d) => d.date));
  });
});

describe('Spending habits trophies agree with Cash flow, the Budget page and Recurring (Trophies Round 3)', () => {
  it('income, spending and savings rate per month == /api/cashflow (24 months)', async () => {
    const cf = (await get('/api/cashflow?months=24')).months as { month: string; incomeCents: number; spendingCents: number; savingsRateBp: number | null }[];
    const sp = new TrophyData(t.db, '2026-11-11').spending;
    let checked = 0;
    for (const m of cf) {
      const r = sp.months.find((x) => x.month === m.month);
      if (!r) {
        expect([m.incomeCents, m.spendingCents], m.month).toEqual([0, 0]); // before the first data
        continue;
      }
      expect([r.incomeCents + 0, r.spendingCents + 0, r.savingsRateBp], m.month).toEqual([m.incomeCents, m.spendingCents, m.savingsRateBp]);
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
  });

  it('spent and limit per budgeted category == /api/budget, with an every-month limit and a one-month override', async () => {
    const food = ((await get('/api/categories')).categories as { id: number; name: string }[]).find((c) => c.name === 'Food')!.id;
    const put = (month: string | null, limit: string | null) => call({ method: 'PUT', url: '/api/budget', payload: { categoryId: food, month, limit } });
    await put(null, '200');
    await put('2026-10-01', '350');
    try {
      const sp = new TrophyData(t.db, '2026-11-11').spending;
      for (let m = '2026-05-01'; m <= '2026-11-01'; m = addMonths(m, 1)) {
        const b = await get(`/api/budget?month=${m}`);
        for (const c of b.categories as { id: number; spentCents: number; limitCents: number | null }[]) {
          expect(sp.byCategory(m).get(c.id) ?? 0, `${m} ${c.id}`).toBe(c.spentCents);
          expect(sp.limits(m).get(c.id)?.limitCents ?? null, `${m} ${c.id}`).toBe(c.limitCents);
        }
      }
      expect(sp.limits('2026-10-01').get(food)!.limitCents).toBe(35_000);
      expect(sp.limits('2026-09-01').get(food)!.limitCents).toBe(20_000);
    } finally {
      await put('2026-10-01', null);
      await put(null, '0');
    }
  });

  it('subscriptions cut == the Recurring page cancelled list', async () => {
    const rec = await get('/api/recurring');
    expect(new TrophyData(t.db, '2026-11-11').spending.cancellations.length).toBe(rec.cancelled.length);
  });
});

describe('Keeping things tidy trophies agree with the Transactions page (Trophies Round 4)', () => {
  it('transactions tracked == the Transactions page total; uncategorized per month == its Uncategorized filter', async () => {
    const tidy = new TrophyData(t.db, '2026-11-11').tidy;
    expect(tidy.lineDates.length).toBe((await get('/api/transactions?limit=1')).total);
    let checked = 0;
    for (const m of tidy.months) {
      const to = addMonths(m.month, 1);
      const end = new Date(Date.parse(to) - 86_400_000).toISOString().slice(0, 10);
      const none = await get(`/api/transactions?categoryId=none&from=${m.month}&to=${end}&limit=1`);
      expect(m.uncategorized, m.month).toBe(none.total);
      const all = await get(`/api/transactions?from=${m.month}&to=${end}&limit=1`);
      const transfers = await get(`/api/transactions?type=transfer&from=${m.month}&to=${end}&limit=1`);
      const gifts = await get(`/api/transactions?type=gift&from=${m.month}&to=${end}&limit=1`);
      expect(m.incomeExpense + m.transfers + gifts.total, m.month).toBe(all.total);
      expect(m.transfers, m.month).toBe(transfers.total);
      checked++;
    }
    expect(checked).toBeGreaterThan(2);
  });
});

describe('The long game trophies agree with the Goals page (Trophies Round 4)', () => {
  it("a goal's progress == the Goals page's current amount (today), for every account", async () => {
    const accounts = (await get('/api/accounts')).accounts as { id: number }[];
    const made: number[] = [];
    try {
      for (const a of accounts) made.push((await call({ method: 'POST', url: '/api/goals', payload: { name: 'Fake goal', target: '1', accountId: a.id } })).json().id);
      const data = new TrophyData(t.db, '2026-11-11');
      const goals = (await get('/api/goals')).custom as { id: number; accountId: number; currentCents: number }[];
      for (const g of goals.filter((x) => made.includes(x.id))) {
        const days = data.accountDays(g.accountId);
        expect(days.at(-1)!.date).toBe('2026-11-11');
        expect(days.at(-1)!.cents ?? 0, `account ${g.accountId}`).toBe(g.currentCents);
      }
      expect(made.length).toBeGreaterThan(1);
    } finally {
      for (const id of made) await call({ method: 'DELETE', url: `/api/goals/${id}` });
    }
  });
});

describe('Arc40 Wrapped agrees with every other screen (V2 Phase 4)', () => {
  it('the imported bank files, this year so far', async () => {
    await call({ method: 'PUT', url: '/api/work-cost', payload: { refPayPerGame: '55', selection: 'ref' } });
    await call({ method: 'PUT', url: '/api/settings/planning', payload: { birth: { year: 2006, month: 3 } } });
    const { w, checked } = await wrappedAgrees(2026);
    expect(w.soFar).toBe(true);
    expect(checked).toBeGreaterThanOrEqual(7);
  });

  it('demo mode: a full past year and this year so far', async () => {
    const enter = await call({ method: 'POST', url: '/api/demo/enter' });
    const c = enter.cookies.find((x) => x.name.startsWith('arc40_session_'))!;
    auth = { cookie: `${c.name}=${c.value}`, csrf: enter.json().csrfToken };
    const past = await wrappedAgrees(2025);
    expect(past.w.soFar).toBe(false);
    expect(past.checked).toBeGreaterThanOrEqual(8);
    const now = await wrappedAgrees(2026);
    expect(now.checked).toBe(11); // every slide, every one checked
  });
});
