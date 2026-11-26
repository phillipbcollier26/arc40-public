/**
 * Bills calendar and "Next 30 days" (V2 Phase 2). Fake bills only. Today in tests = 2026-11-11.
 */
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';
import { dueDatesBetween } from '../../server/src/lib/recurring.js';

describe('due dates (pure)', () => {
  it('start at the next due date and follow the schedule', () => {
    expect(dueDatesBetween('2026-10-05', 'monthly', '2026-12-05', '2026-11-11', '2027-02-28')).toEqual(['2026-12-05', '2027-01-05', '2027-02-05']);
    expect(dueDatesBetween('2026-11-13', 'weekly', '2026-11-13', '2026-11-11', '2026-12-10')).toEqual(['2026-11-13', '2026-11-20', '2026-11-27', '2026-12-04']);
  });
  it('a next due date set a month ahead means nothing is due before it (not one period earlier)', async () => {
    const { nextDue } = await import('../../server/src/lib/recurring.js');
    expect(nextDue('2026-12-11', 'monthly', '2026-11-11')).toBe('2026-12-11');
    expect(nextDue('2026-11-25', 'weekly', '2026-11-11')).toBe('2026-11-25');
  });
  it('month-end bills land on the last day of short months', () => {
    expect(dueDatesBetween('2026-10-31', 'monthly', '2026-11-30', '2026-11-11', '2027-03-31')).toEqual(['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);
  });
});

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
const addBill = async (name: string, amount: string, schedule: string, nextDue: string) =>
  (await ok({ method: 'POST', url: '/api/recurring', payload: { name, amount, schedule, nextDue } })).item as { id: number };

describe('bills API', () => {
  beforeEach(async () => {
    t = await testApp(); // today = 2026-11-11
    auth = await setupAndLogin(t);
  });
  afterEach(async () => {
    await t.app.close();
  });
  const accounts = async () => {
    await ok({ method: 'POST', url: '/api/accounts', payload: { name: 'Checking', type: 'checking', openingBalance: '100', openingDate: '2026-11-01' } });
    // Savings never counts toward the checking warning.
    await ok({ method: 'POST', url: '/api/accounts', payload: { name: 'Savings', type: 'savings', openingBalance: '5000', openingDate: '2026-11-01' } });
  };

  it('next 30 days: every due date from today through day 30, totaled, warned when more than checking holds', async () => {
    await accounts();
    await addBill('Phone', '40', 'monthly', '2026-11-20');
    await addBill('Laundry', '10', 'weekly', '2026-11-13');
    const u = await get('/api/recurring/upcoming');
    expect(u).toMatchObject({ from: '2026-11-11', to: '2026-12-10', totalCents: 8000, checking: { balanceCents: 10000, accounts: 1 }, overChecking: false });
    expect(u.bills.map((b: { date: string; name: string }) => `${b.date} ${b.name}`)).toEqual([
      '2026-11-13 Laundry',
      '2026-11-20 Laundry',
      '2026-11-20 Phone',
      '2026-11-27 Laundry',
      '2026-12-04 Laundry',
    ]);
    await addBill('Gym', '30', 'monthly', '2026-12-10'); // the 30th day counts
    const v = await get('/api/recurring/upcoming');
    expect(v.totalCents).toBe(11000);
    expect(v.overChecking).toBe(true);
    await addBill('Insurance', '99', 'monthly', '2026-12-11'); // day 31: not in the next 30 days
    expect((await get('/api/recurring/upcoming')).totalCents).toBe(11000);
  });

  it('with no checking account there is nothing to warn about', async () => {
    await addBill('Phone', '40', 'monthly', '2026-11-20');
    expect(await get('/api/recurring/upcoming')).toMatchObject({ totalCents: 4000, checking: null, overChecking: false });
  });

  it('cancelled items never appear; restoring brings them back', async () => {
    await accounts();
    const phone = await addBill('Phone', '40', 'monthly', '2026-11-20');
    await ok({ method: 'POST', url: `/api/recurring/${phone.id}/cancel` });
    expect((await get('/api/recurring/upcoming')).bills).toEqual([]);
    expect((await get('/api/recurring/calendar?month=2026-12-01')).bills).toEqual([]);
    await ok({ method: 'POST', url: `/api/recurring/${phone.id}/restore` });
    expect((await get('/api/recurring/calendar?month=2026-12-01')).bills).toHaveLength(1);
  });

  it('calendar: one month, nothing before today, and a corrected due date moves every later date', async () => {
    const phone = await addBill('Phone', '40', 'monthly', '2026-11-05'); // already past this month
    const nov = await get('/api/recurring/calendar?month=2026-11-01');
    expect(nov.bills).toEqual([]); // Nov 5 is before today; it is not listed
    const dec = await get('/api/recurring/calendar?month=2026-12-01');
    expect(dec.bills.map((b: { date: string }) => b.date)).toEqual(['2026-12-05']);
    expect(dec.totalCents).toBe(4000);
    await ok({ method: 'PATCH', url: `/api/recurring/${phone.id}`, payload: { nextDue: '2026-12-09' } });
    expect((await get('/api/recurring/calendar?month=2026-12-01')).bills.map((b: { date: string }) => b.date)).toEqual(['2026-12-09']);
    expect((await get('/api/recurring/calendar?month=2027-03-01')).bills.map((b: { date: string }) => b.date)).toEqual(['2027-03-09']);
  });

  it('a detected subscription already charged this month is due next month, not again', async () => {
    await accounts();
    const acct = (await get('/api/accounts')).accounts[0].id;
    for (const d of ['2026-08-03', '2026-09-03', '2026-10-03', '2026-11-03']) {
      await ok({ method: 'POST', url: '/api/transactions', payload: { accountId: acct, date: d, amount: '9.99', direction: 'out', description: 'STREAMLY', type: 'expense' } });
    }
    const s = (await get('/api/recurring')).suggestions[0];
    await ok({ method: 'POST', url: '/api/recurring/confirm', payload: { key: s.key } });
    const u = await get('/api/recurring/upcoming');
    expect(u.bills.map((b: { date: string; amountCents: number }) => [b.date, b.amountCents])).toEqual([['2026-12-03', 999]]);
  });

  it('the calendar refuses past months, far-off months and bad input', async () => {
    for (const m of ['2026-10-01', '2028-12-01', '2026-11-15', 'soon']) {
      expect((await call({ method: 'GET', url: `/api/recurring/calendar?month=${m}` })).statusCode, m).toBe(400);
    }
    expect((await call({ method: 'GET', url: '/api/recurring/calendar?month=2028-11-01' })).statusCode).toBe(200);
    expect((await get('/api/recurring/calendar')).month).toBe('2026-11-01');
  });
});
