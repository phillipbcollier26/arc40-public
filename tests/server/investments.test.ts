import fs from 'node:fs';
import path from 'node:path';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';
import { contributionsForTaxYear, growthBp, holdings, latestPrices, moneyPutIn, shareDelta, valueCents, type Activity } from '../../server/src/lib/investments.js';

const act = (p: Partial<Activity>): Activity => ({ accountId: 1, date: '2026-01-01', kind: 'buy', symbol: 'FXAIX', quantityMicro: 0, amountCents: 0, taxYear: null, ...p });

describe('investment math (exact integers)', () => {
  it('value = shares x price, rounded once to the cent', () => {
    expect(valueCents(178_195_000, 198_200)).toBe(353_182); // 178.195 x $19.82 = $3,531.8249 -> $3,531.82
    expect(valueCents(1_000_000, 2_683_200)).toBe(26_832); // 1 x $268.32
    expect(valueCents(25_000, 2_683_250)).toBe(671); // 0.025 x $268.325 = $6.7081 -> $6.71
    expect(valueCents(5_000, 10_000)).toBe(1); // half a cent rounds away from zero
    expect(valueCents(0, 2_683_200)).toBe(0);
  });

  it('is exact for huge positions (BigInt, no float drift)', () => {
    expect(valueCents(123_456_789_123_456, 99_999_999)).toBe(Number((123_456_789_123_456n * 99_999_999n + 50_000_000n) / 100_000_000n));
  });

  it('buys and reinvests add shares, sells subtract, regardless of the sign in the file', () => {
    expect(shareDelta(act({ kind: 'buy', quantityMicro: -5 }))).toBe(5);
    expect(shareDelta(act({ kind: 'sell', quantityMicro: 5 }))).toBe(-5);
    expect(shareDelta(act({ kind: 'dividend', quantityMicro: 5 }))).toBe(0);
    const h = holdings([act({ quantityMicro: 3_000_000 }), act({ kind: 'reinvest', quantityMicro: 25_000 }), act({ kind: 'sell', quantityMicro: -1_000_000, date: '2026-02-01' })], '2026-01-31');
    expect(h.get(1)!.get('FXAIX')).toBe(3_025_000);
  });

  it('latest price on or before a date', () => {
    const p = latestPrices(
      [
        { symbol: 'X', asOf: '2026-01-01', priceE4: 1 },
        { symbol: 'X', asOf: '2026-03-01', priceE4: 3 },
        { symbol: 'X', asOf: '2026-02-01', priceE4: 2 },
      ],
      '2026-02-15',
    );
    expect(p.get('X')!.priceE4).toBe(2);
  });

  it('money put in = contributions + transfers in - transfers out; dividends are growth, not money put in', () => {
    const acts = [act({ kind: 'contribution', amountCents: 100_000 }), act({ kind: 'transfer_in', amountCents: 50_000 }), act({ kind: 'transfer_out', amountCents: -20_000 }), act({ kind: 'dividend', amountCents: 999 })];
    expect(moneyPutIn(acts, '2026-12-31')).toBe(130_000);
  });

  it('contributions count toward their TAX year, not the calendar year', () => {
    const acts = [act({ kind: 'contribution', amountCents: 100_000, date: '2026-03-10', taxYear: 2025 }), act({ kind: 'contribution', amountCents: 25_000, date: '2026-08-05', taxYear: 2026 }), act({ accountId: 2, kind: 'contribution', amountCents: 9_999, taxYear: 2026 })];
    expect(contributionsForTaxYear(acts, 2026, new Set([1]))).toBe(25_000);
    expect(contributionsForTaxYear(acts, 2025, new Set([1]))).toBe(100_000);
  });

  it('growth percent, and none when nothing was put in', () => {
    expect(growthBp(110_000, 100_000)).toBe(1000);
    expect(growthBp(95_000, 100_000)).toBe(-500);
    expect(growthBp(5_000, 0)).toBeNull();
  });
});

// ---------- API with the fake Fidelity files ----------

const fixture = (n: string) => fs.readFileSync(path.resolve('tests/fixtures/csv', n), 'utf8');
let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };
let roth: number;
let brokerage: number;
let hysa: number;
const call = (opts: InjectOptions) => t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });
const get = async (url: string) => (await call({ method: 'GET', url })).json();

describe('investments and goals API', () => {
  beforeEach(async () => {
    t = await testApp(); // today = 2026-11-11
    const s = await setupAndLogin(t);
    auth = { cookie: s.cookie, csrf: s.csrf };
    const mk = async (name: string, type: string) => (await call({ method: 'POST', url: '/api/accounts', payload: { name, type } })).json().account.id as number;
    roth = await mk('Roth IRA', 'roth_ira');
    brokerage = await mk('Brokerage', 'brokerage');
    hysa = await mk('HYSA', 'savings');
    for (const [id, f] of [[roth, 'fidelity-roth.csv'], [brokerage, 'fidelity-brokerage.csv']] as const) {
      expect((await call({ method: 'POST', url: '/api/import/commit', payload: { accountId: id, filename: f, text: fixture(f) } })).statusCode).toBe(200);
    }
  });
  afterEach(async () => {
    await t.app.close();
  });

  it('holdings come from imported history, priced from the latest buy/reinvest', async () => {
    const inv = await get('/api/investments');
    const h = Object.fromEntries((inv.holdings as { symbol: string; sharesMicro: number; priceE4: number; valueCents: number }[]).map((x) => [x.symbol, x]));
    expect(h.FXAIX).toMatchObject({ sharesMicro: 1_300_500, priceE4: 2_000_000, valueCents: 26_010 }); // 1.3005 x $200.00
    expect(h.FSKAX).toMatchObject({ sharesMicro: 8_000_000, valueCents: 120_000 });
    expect(h.FTIHX).toMatchObject({ sharesMicro: 19_672_000, valueCents: 30_000 }); // 19.672 x $15.25 = $299.998
  });

  it('per account: holdings value includes uninvested cash; money put in counts contributions and transfers', async () => {
    const inv = await get(`/api/investments?accountId=${roth}`);
    expect(inv.perAccount[0]).toMatchObject({ holdingsValueCents: 26_010 + 10_000, putInCents: 35_000 }); // $100 prior-year contribution not invested yet
    expect(inv.holdings.map((x: { symbol: string }) => x.symbol)).toEqual(['FXAIX']);
    expect((await get(`/api/investments?accountId=${hysa}`)).error).toBeDefined();
  });

  it('typed-in prices update values; "use holdings value" records today\'s balance; growth = value - money put in', async () => {
    expect((await call({ method: 'PUT', url: '/api/prices', payload: { prices: [{ symbol: 'FXAIX', price: '220.00' }] } })).statusCode).toBe(200);
    const inv = await get(`/api/investments?accountId=${roth}`);
    expect(inv.holdings[0]).toMatchObject({ priceE4: 2_200_000, valueCents: 28_611 }); // 1.3005 x 220 = 286.11
    const r = (await call({ method: 'POST', url: `/api/investments/${roth}/use-holdings-value` })).json();
    expect(r.balanceCents).toBe(28_611 + 10_000);
    const after = await get(`/api/investments?accountId=${roth}`);
    expect(after.totals).toMatchObject({ valueCents: 38_611, putInCents: 35_000, growthCents: 3_611 });
    expect(after.series.at(-1)).toMatchObject({ valueCents: 38_611, putInCents: 35_000 });
  });

  it('rejects bad prices and needs a price before using holdings value', async () => {
    for (const price of ['0', '-5', 'abc', '1.23456']) {
      expect((await call({ method: 'PUT', url: '/api/prices', payload: { prices: [{ symbol: 'FXAIX', price }] } })).statusCode).toBe(400);
    }
    await call({ method: 'POST', url: '/api/investments/shares', payload: { accountId: brokerage, symbol: 'VTSAX', shares: '2' } });
    const res = await call({ method: 'POST', url: `/api/investments/${brokerage}/use-holdings-value` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('VTSAX');
  });

  it('manual share fix sets the count exactly without touching imported rows', async () => {
    await call({ method: 'POST', url: '/api/investments/shares', payload: { accountId: roth, symbol: 'FXAIX', shares: '1.5' } });
    const inv = await get(`/api/investments?accountId=${roth}`);
    expect(inv.holdings[0].sharesMicro).toBe(1_500_000);
    const imported = t.db.prepare("SELECT COUNT(*) AS n FROM investment_activity WHERE source = 'import'").get() as { n: number };
    expect(imported.n).toBe(8);
  });

  it('Roth goal: 2026 limit $7,500, counts by tax year, shows earned income (not interest or gifts)', async () => {
    const cats = (await get('/api/categories')).categories as { id: number; name: string }[];
    const cat = (n: string) => cats.find((c) => c.name === n)!.id;
    const add = (payload: object) => call({ method: 'POST', url: '/api/transactions', payload: { accountId: hysa, date: '2026-10-01', description: 'x', direction: 'in', ...payload } });
    await add({ amount: '300', type: 'income', categoryId: cat('Refereeing') });
    await add({ amount: '50', type: 'income', categoryId: cat('Interest') });
    await add({ amount: '1000', type: 'gift', giftFrom: 'Mom' });
    const g = await get('/api/goals');
    expect(g.roth).toMatchObject({ year: 2026, limitCents: 750_000, deadline: '2027-04-15', contributedCents: 25_000, remainingCents: 725_000, earnedIncomeCents: 30_000 });
    // A prior-year contribution made in March 2026 counts for 2025
    expect((await get('/api/goals?year=2025')).roth.contributedCents).toBe(10_000);
  });

  it('IRA limit is an editable setting per year', async () => {
    expect((await call({ method: 'PUT', url: '/api/settings/ira', payload: { year: 2027, limit: '8000', deadline: '2028-04-17' } })).statusCode).toBe(200);
    expect((await get('/api/goals?year=2027')).roth).toMatchObject({ limitCents: 800_000, deadline: '2028-04-17', contributedCents: 0 });
    expect((await call({ method: 'PUT', url: '/api/settings/ira', payload: { year: 2027, limit: '0' } })).statusCode).toBe(400);
    expect((await get('/api/goals?year=2030')).roth.limitCents).toBeNull(); // unknown year: not guessed
  });

  it('custom goals use their funding account balance', async () => {
    await call({ method: 'POST', url: `/api/accounts/${hysa}/balances`, payload: { asOf: '2026-11-01', balance: '1250' } });
    const res = await call({ method: 'POST', url: '/api/goals', payload: { name: 'Land fund', target: '50,000', accountId: hysa } });
    expect(res.statusCode).toBe(201);
    const g = (await get('/api/goals')).custom[0];
    expect(g).toMatchObject({ name: 'Land fund', targetCents: 5_000_000, currentCents: 125_000, accountName: 'HYSA' });
    await call({ method: 'PATCH', url: `/api/goals/${g.id}`, payload: { target: '60000' } });
    expect((await get('/api/goals')).custom[0].targetCents).toBe(6_000_000);
    await call({ method: 'DELETE', url: `/api/goals/${g.id}` });
    expect((await get('/api/goals')).custom).toEqual([]);
    expect((await call({ method: 'POST', url: '/api/goals', payload: { name: 'x', target: '0' } })).statusCode).toBe(400);
  });

  it('emergency fund: 6 x average monthly spending of the last 6 full months, plus optional essentials', async () => {
    const add = (date: string, amount: string) => call({ method: 'POST', url: '/api/transactions', payload: { accountId: hysa, date, amount, direction: 'out', description: 'x', type: 'expense' } });
    await add('2026-08-10', '300'); // data starts in August -> Aug, Sep, Oct = 3 months
    await add('2026-10-10', '150');
    await add('2026-11-05', '999'); // current month: not counted
    await call({ method: 'POST', url: `/api/accounts/${hysa}/balances`, payload: { asOf: '2026-11-11', balance: '2000' } });
    let e = (await get('/api/goals')).emergency;
    // transactions in the Roth/brokerage files start in March, so 6 months (May-Oct) are counted
    expect(e).toMatchObject({ monthsUsed: 6, avgMonthlySpendingCents: 7_500, targetCents: 45_000, savingsCents: 200_000 });
    await call({ method: 'PUT', url: '/api/settings/emergency', payload: { essentials: '800' } });
    e = (await get('/api/goals')).emergency;
    expect(e).toMatchObject({ essentialsCents: 80_000, targetCents: 6 * (7_500 + 80_000) });
  });
});
