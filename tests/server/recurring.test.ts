/**
 * Recurring charges and subscriptions (V2 Phase 2). Fake merchants and amounts only.
 */
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_HEADER, cookieFrom, setupAndLogin, testApp } from './helpers.js';
import { addDays, addMonths } from '../../shared/dates.js';
import {
  chargesForItem,
  findSeries,
  fitSchedule,
  isActive,
  isNew,
  merchantKey,
  monthlyCents,
  nextDue,
  occurrencesBetween,
  priceIncrease,
  tierFor,
  yearlyCents,
  type Charge,
} from '../../server/src/lib/recurring.js';

let id = 0;
const charge = (date: string, cents: number, description = 'STREAMLY *SUB', extra: Partial<Charge> = {}): Charge => ({
  txId: ++id,
  date,
  amountCents: cents,
  description,
  categoryId: 9,
  splitCategoryIds: [],
  ...extra,
});
const monthly = (start: string, n: number, cents: number, description?: string) =>
  Array.from({ length: n }, (_, i) => charge(addMonths(start, i), cents, description));
const every = (start: string, days: number, n: number, cents: number, description?: string) =>
  Array.from({ length: n }, (_, i) => charge(addDays(start, i * days), cents, description));

describe('schedules', () => {
  it('detects weekly, every-2-weeks, monthly, quarterly and yearly', () => {
    expect(findSeries(every('2026-06-01', 7, 6, 800, 'CAMPUS LAUNDRY')).map((s) => s.schedule)).toEqual(['weekly']);
    expect(findSeries(every('2026-06-01', 14, 4, 1400, 'FITHUB GYM')).map((s) => s.schedule)).toEqual(['biweekly']);
    expect(findSeries(monthly('2026-01-15', 6, 1199)).map((s) => s.schedule)).toEqual(['monthly']);
    expect(findSeries([0, 3, 6, 9].map((m) => charge(addMonths('2025-11-10', m), 4500, 'WATER UTILITY'))).map((s) => s.schedule)).toEqual(['quarterly']);
    expect(findSeries([charge('2025-03-02', 1500, 'NAMEHOST DOMAIN'), charge('2026-03-03', 1500, 'NAMEHOST DOMAIN')]).map((s) => s.schedule)).toEqual(['yearly']);
  });

  it('needs enough repeats: 3 monthly, 2 yearly, 4 weekly', () => {
    expect(findSeries(monthly('2026-01-15', 2, 1199))).toEqual([]);
    expect(findSeries(every('2026-06-01', 7, 3, 800, 'CAMPUS LAUNDRY'))).toEqual([]);
    expect(findSeries([charge('2026-03-02', 1500, 'NAMEHOST DOMAIN')])).toEqual([]);
  });

  it('two charges a year apart only count as yearly when they cost the same and land within a week of a year', () => {
    expect(findSeries([charge('2025-08-12', 6048, 'TEXTBOOKS'), charge('2026-08-14', 6771, 'TEXTBOOKS')])).toEqual([]);
    expect(findSeries([charge('2025-08-01', 1500, 'NAMEHOST DOMAIN'), charge('2026-08-20', 1500, 'NAMEHOST DOMAIN')])).toEqual([]);
    expect(findSeries([charge('2025-08-12', 1500, 'NAMEHOST DOMAIN'), charge('2026-08-14', 1525, 'NAMEHOST DOMAIN')])).toHaveLength(1);
  });

  it('irregular charges are not recurring', () => {
    expect(fitSchedule(['2026-01-03', '2026-01-19', '2026-03-02', '2026-03-09'])).toBeNull();
    expect(findSeries([charge('2026-01-03', 1000), charge('2026-01-03', 1000), charge('2026-02-03', 1000)])).toEqual([]);
  });

  it('a skipped month still counts (once), two skips do not', () => {
    expect(fitSchedule(['2026-01-15', '2026-02-15', '2026-04-15', '2026-05-15'])).toBe('monthly');
    expect(fitSchedule(['2026-01-15', '2026-03-15', '2026-05-15', '2026-06-15'])).toBeNull();
  });

  it('month-end billing (the 31st) and February', () => {
    const dates = ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'];
    expect(fitSchedule(dates)).toBe('monthly');
    expect(occurrencesBetween('2026-01-31', 'monthly', '2026-01-01', '2026-06-30')).toEqual(dates.concat('2026-06-30'));
    expect(nextDue('2026-01-31', 'monthly', '2026-02-01')).toBe('2026-02-28');
    expect(nextDue('2026-01-31', 'monthly', '2026-03-01')).toBe('2026-03-31');
  });

  it('leap years: Feb 29 billing falls back to Feb 28 and returns in the next leap year', () => {
    expect(fitSchedule(['2024-02-29', '2025-02-28'])).toBe('yearly');
    expect(nextDue('2024-02-29', 'yearly', '2025-01-10')).toBe('2025-02-28');
    expect(nextDue('2024-02-29', 'yearly', '2027-03-01')).toBe('2028-02-29');
    expect(occurrencesBetween('2028-01-31', 'monthly', '2028-02-01', '2028-02-29')).toEqual(['2028-02-29']);
  });

  it('next due is today or later and after the newest charge; a late charge is never flagged, just rolled forward', () => {
    expect(nextDue('2026-01-15', 'monthly', '2026-11-15', '2026-11-15')).toBe('2026-12-15');
    expect(nextDue('2026-01-15', 'monthly', '2026-11-20', '2026-10-15')).toBe('2026-12-15');
    expect(nextDue('2026-11-01', 'weekly', '2026-11-11')).toBe('2026-11-15');
    expect(nextDue('2020-01-06', 'biweekly', '2026-11-11')).toBe('2026-11-16');
  });

  it('varying amounts in a small range (a phone bill) are one series', () => {
    const bill = [4520, 4610, 4498, 4705, 4550].map((c, i) => charge(addMonths('2026-05-08', i), c, 'RIDGELINE WIRELESS'));
    const s = findSeries(bill);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ schedule: 'monthly', lowCents: 4498, highCents: 4705, amountCents: 4550 });
  });

  it('two subscriptions from one merchant at different prices are two series', () => {
    const s = findSeries([...monthly('2026-03-03', 5, 299, 'APPLECLOUD BILL'), ...monthly('2026-03-20', 5, 1499, 'APPLECLOUD BILL')]);
    expect(s.map((x) => x.schedule)).toEqual(['monthly', 'monthly']);
    expect(s.map((x) => x.amountCents).sort((a, b) => a - b)).toEqual([299, 1499]);
  });

  it('two same-price subscriptions billed on different days are told apart by billing day', () => {
    const s = findSeries([...monthly('2026-03-03', 5, 999, 'APPLECLOUD BILL'), ...monthly('2026-03-20', 5, 999, 'APPLECLOUD BILL')]);
    expect(s).toHaveLength(2);
    expect(s.map((x) => x.billingDay).sort((a, b) => a! - b!)).toEqual([3, 20]);
    for (const x of s) expect(chargesForItem({ merchantKey: x.merchantKey, refCents: 999, billingDay: x.billingDay }, s.flatMap((y) => y.charges))).toHaveLength(5);
  });

  it('a split charge is one charge: pieces never become their own series', () => {
    // A monthly store run split into 3 pieces is still ONE $42 charge per month.
    const runs = monthly('2026-04-12', 4, 4200, 'PANTRY BOX').map((c) => ({ ...c, splitCategoryIds: [5, 12, 18] }));
    const s = findSeries(runs);
    expect(s).toHaveLength(1);
    expect(s[0]!.amountCents).toBe(4200);
  });

  it('refunds and $0 rows are not charges; merchant keys ignore numbers and punctuation', () => {
    expect(findSeries(monthly('2026-01-15', 4, -1199))).toEqual([]);
    expect(merchantKey('STREAMLY*SUB 866-555-0100 CA')).toBe(merchantKey('STREAMLY SUB 866-555-0199 CA'));
    expect(merchantKey('POS DEBIT FITHUB.COM #44')).toBe('FITHUB');
  });
});

describe('costs, flags and tiers', () => {
  it('monthly and yearly cost in exact cents', () => {
    expect([yearlyCents(1199, 'monthly'), monthlyCents(1199, 'monthly')]).toEqual([14388, 1199]);
    expect([yearlyCents(500, 'weekly'), monthlyCents(500, 'weekly')]).toEqual([26000, 2167]);
    expect([yearlyCents(1500, 'yearly'), monthlyCents(1500, 'yearly')]).toEqual([1500, 125]);
    expect([yearlyCents(4500, 'quarterly'), monthlyCents(4500, 'quarterly')]).toEqual([18000, 1500]);
    expect([yearlyCents(1400, 'biweekly'), monthlyCents(1400, 'biweekly')]).toEqual([36400, 3033]);
  });

  it('price increase: at least 5% and at least $0.50 above the usual amount', () => {
    const up = [...monthly('2026-01-05', 4, 1199), charge('2026-05-05', 1349)];
    expect(priceIncrease(up)).toEqual({ fromCents: 1199, toCents: 1349 });
    expect(priceIncrease([...monthly('2026-01-05', 4, 1199), charge('2026-05-05', 1239)])).toBeNull(); // +3.3%
    expect(priceIncrease([...monthly('2026-01-05', 4, 299), charge('2026-05-05', 339)])).toBeNull(); // +13% but only $0.40
    expect(priceIncrease([4520, 4610, 4498, 4705].map((c, i) => charge(addMonths('2026-05-08', i), c)))).toBeNull(); // a wobbling bill
  });

  it('NEW for 60 days after the first charge; active means charged within two periods', () => {
    expect(isNew('2026-09-12', '2026-11-11')).toBe(true);
    expect(isNew('2026-09-11', '2026-11-11')).toBe(false);
    expect(isActive({ schedule: 'monthly', lastDate: '2026-09-10' }, '2026-11-11')).toBe(true);
    expect(isActive({ schedule: 'monthly', lastDate: '2026-08-15' }, '2026-11-11')).toBe(false);
  });

  it('metal tiers: top third gold, next silver, the rest bronze', () => {
    expect([0, 1, 2].map((r) => tierFor(r, 3))).toEqual(['gold', 'silver', 'bronze']);
    expect([0, 1, 2, 3, 4, 5, 6].map((r) => tierFor(r, 7))).toEqual(['gold', 'gold', 'gold', 'silver', 'silver', 'bronze', 'bronze']);
    expect(tierFor(0, 1)).toBe('gold');
  });
});

// ---------------------------------------------------------------- API

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
let acct = 0;
let cats: { id: number; name: string }[] = [];
const cat = (n: string) => cats.find((c) => c.name === n)!.id;
const spend = (date: string, amount: string, description: string, extra: object = {}) =>
  ok({ method: 'POST', url: '/api/transactions', payload: { accountId: acct, date, amount, direction: 'out', description, type: 'expense', categoryId: cat('Subscriptions'), ...extra } });

describe('Recurring API', () => {
  beforeEach(async () => {
    t = await testApp(); // today = 2026-11-11
    auth = await setupAndLogin(t);
    acct = (await ok({ method: 'POST', url: '/api/accounts', payload: { name: 'Checking', type: 'checking' } })).account.id;
    cats = (await get('/api/categories')).categories;
  });
  afterEach(async () => {
    await t.app.close();
  });

  const streamly = async () => {
    for (const d of ['2026-06-05', '2026-07-05', '2026-08-05', '2026-09-05']) await spend(d, '11.99', 'STREAMLY');
    await spend('2026-10-05', '13.49', 'STREAMLY'); // price went up
  };

  it('suggests, confirms, flags the price increase, and the headline adds up', async () => {
    await streamly();
    const o = await get('/api/recurring');
    expect(o.suggestions).toHaveLength(1);
    const s = o.suggestions[0];
    expect(s).toMatchObject({ name: 'STREAMLY', schedule: 'monthly', amountCents: 1349, yearlyCents: 16188, monthlyCents: 1349, nextDue: '2026-12-05', chargeCount: 5 });
    const c = await ok({ method: 'POST', url: '/api/recurring/confirm', payload: { key: s.key } });
    expect(c.item).toMatchObject({ status: 'confirmed', priceIncrease: { fromCents: 1199, toCents: 1349 }, tier: 'gold' });
    const after = await get('/api/recurring');
    expect(after.suggestions).toEqual([]);
    expect(after.items).toHaveLength(1);
    expect(after.items[0]).toMatchObject({ tier: 'gold', categoryId: cat('Subscriptions') });
    expect(after.totals).toEqual({ yearlyCents: 16188, monthlyCents: 1349, count: 1 });
  });

  it('dismissed suggestions stay dismissed, even after more charges arrive', async () => {
    await streamly();
    const s = (await get('/api/recurring')).suggestions[0];
    await ok({ method: 'POST', url: '/api/recurring/dismiss', payload: { key: s.key } });
    expect((await get('/api/recurring')).suggestions).toEqual([]);
    await spend('2026-11-05', '13.49', 'STREAMLY');
    expect((await get('/api/recurring')).suggestions).toEqual([]);
    expect((await call({ method: 'POST', url: '/api/recurring/confirm', payload: { key: s.key } })).statusCode).toBe(400);
  });

  it('cancel tells you the yearly saving once, stops expecting it, and can be restored', async () => {
    await streamly();
    const s = (await get('/api/recurring')).suggestions[0];
    const item = (await ok({ method: 'POST', url: '/api/recurring/confirm', payload: { key: s.key } })).item;
    const r = await ok({ method: 'POST', url: `/api/recurring/${item.id}/cancel` });
    expect(r.savedPerYearCents).toBe(16188);
    expect(r.item).toMatchObject({ status: 'cancelled', nextDue: null, cancelledOn: '2026-11-11' });
    const o = await get('/api/recurring');
    expect(o.items).toEqual([]);
    expect(o.cancelled).toHaveLength(1);
    expect(o.cancelled[0]).not.toHaveProperty('savedPerYearCents'); // not a lasting badge
    expect(o.suggestions).toEqual([]); // a cancelled one is not suggested again
    expect(o.totals.yearlyCents).toBe(0);
    expect((await call({ method: 'POST', url: `/api/recurring/${item.id}/cancel` })).statusCode).toBe(400);
    await ok({ method: 'POST', url: `/api/recurring/${item.id}/restore` });
    expect((await get('/api/recurring')).items[0].nextDue).toBe('2026-12-05');
  });

  it('only expenses count: transfers, income, gifts and refunds are never recurring charges', async () => {
    for (const d of ['2026-06-05', '2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05']) {
      await ok({ method: 'POST', url: '/api/transactions', payload: { accountId: acct, date: d, amount: '50', direction: 'out', description: 'MONTHLY SAVINGS', type: 'transfer' } });
      await ok({ method: 'POST', url: '/api/transactions', payload: { accountId: acct, date: d, amount: '50', direction: 'in', description: 'LEAGUE PAY', type: 'income' } });
      await ok({ method: 'POST', url: '/api/transactions', payload: { accountId: acct, date: d, amount: '50', direction: 'in', description: 'MOM', type: 'gift' } });
      await ok({ method: 'POST', url: '/api/transactions', payload: { accountId: acct, date: d, amount: '5', direction: 'in', description: 'STORE REFUND', type: 'expense' } });
    }
    expect((await get('/api/recurring')).suggestions).toEqual([]);
  });

  it('a split recurring charge is one charge, counted at its full amount, shown with its pieces\' categories', async () => {
    for (const d of ['2026-07-12', '2026-08-12', '2026-09-12', '2026-10-12']) {
      const tx = (await spend(d, '42', 'PANTRY BOX', { categoryId: cat('Food') })).transaction.id;
      await ok({
        method: 'PUT',
        url: `/api/transactions/${tx}/split`,
        payload: { pieces: [{ categoryId: cat('Food'), amount: '30' }, { categoryId: cat('Shopping'), amount: '12' }] },
      });
    }
    const o = await get('/api/recurring');
    expect(o.suggestions).toHaveLength(1);
    expect(o.suggestions[0]).toMatchObject({ amountCents: 4200, yearlyCents: 50400, chargeCount: 4, categoryId: cat('Food'), splitCategoryIds: [cat('Food'), cat('Shopping')] });
  });

  it('NEW badge for a charge first seen in the last 60 days', async () => {
    for (const d of ['2026-09-20', '2026-10-04', '2026-10-18', '2026-11-01']) await spend(d, '14', 'FITHUB GYM');
    const s = (await get('/api/recurring')).suggestions[0];
    expect(s).toMatchObject({ schedule: 'biweekly', isNew: true, nextDue: '2026-11-15' });
  });

  it('manual recurring expenses: validated, counted, editable, deletable', async () => {
    const bad = async (payload: object, msg: RegExp) => {
      const r = await call({ method: 'POST', url: '/api/recurring', payload });
      expect(r.statusCode, JSON.stringify(payload)).toBe(400);
      expect(r.json().error).toMatch(msg);
    };
    const base = { name: 'Rent share', amount: '400', schedule: 'monthly', nextDue: '2026-12-01', categoryId: cat('Housing') };
    await bad({ ...base, amount: '0' }, /above \$0.00/);
    await bad({ ...base, amount: 400 }, /./); // JSON numbers are not money
    await bad({ ...base, amount: 'lots' }, /like 11.99/);
    await bad({ ...base, schedule: 'daily' }, /./);
    await bad({ ...base, nextDue: '2026-13-01' }, /Pick a date/);
    await bad({ ...base, nextDue: '2035-01-01' }, /three years/);
    await bad({ ...base, categoryId: cat('Refereeing') }, /spending category/);
    await bad({ ...base, name: '' }, /name/);
    const item = (await ok({ method: 'POST', url: '/api/recurring', payload: base })).item;
    expect(item).toMatchObject({ source: 'manual', amountCents: 40000, yearlyCents: 480000, nextDue: '2026-12-01', categoryId: cat('Housing') });
    const moved = (await ok({ method: 'PATCH', url: `/api/recurring/${item.id}`, payload: { nextDue: '2026-12-03', amount: '410' } })).item;
    expect(moved).toMatchObject({ nextDue: '2026-12-03', amountCents: 41000 });
    expect((await get('/api/recurring')).totals.yearlyCents).toBe(492000);
    await ok({ method: 'DELETE', url: `/api/recurring/${item.id}` });
    expect((await get('/api/recurring')).items).toEqual([]);
  });

  it('a detected item keeps the amount from its charges; its next due date can be corrected', async () => {
    await streamly();
    const s = (await get('/api/recurring')).suggestions[0];
    const item = (await ok({ method: 'POST', url: '/api/recurring/confirm', payload: { key: s.key } })).item;
    expect((await call({ method: 'PATCH', url: `/api/recurring/${item.id}`, payload: { amount: '5' } })).statusCode).toBe(400);
    const fixed = (await ok({ method: 'PATCH', url: `/api/recurring/${item.id}`, payload: { nextDue: '2026-12-08', name: 'Streamly' } })).item;
    expect(fixed).toMatchObject({ nextDue: '2026-12-08', name: 'Streamly', amountCents: 1349 });
  });

  it('works in demo mode, where the demo data has subscriptions in every state', async () => {
    const enter = await call({ method: 'POST', url: '/api/demo/enter' });
    expect(enter.statusCode, enter.body).toBe(200);
    auth = { cookie: cookieFrom(enter), csrf: enter.json().csrfToken };
    const o = await get('/api/recurring');
    expect(o.items.length).toBeGreaterThanOrEqual(4);
    expect(o.cancelled.length).toBeGreaterThanOrEqual(1);
    expect(o.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(o.items.some((i: { priceIncrease: unknown }) => i.priceIncrease)).toBe(true);
    expect(o.items.some((i: { isNew: boolean }) => i.isNew)).toBe(true);
    expect(o.items.some((i: { splitCategoryIds: number[] }) => i.splitCategoryIds.length > 1)).toBe(true);
    expect(o.totals.yearlyCents).toBe(o.items.reduce((s: number, i: { yearlyCents: number }) => s + i.yearlyCents, 0));
    const r = await ok({ method: 'POST', url: `/api/recurring/${o.items[0].id}/cancel` });
    expect(r.savedPerYearCents).toBe(o.items[0].yearlyCents);
  });
});
