import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';

let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };

beforeEach(async () => {
  t = await testApp(); // clock: 2026-11-11
  const s = await setupAndLogin(t);
  auth = { cookie: s.cookie, csrf: s.csrf };
});
afterEach(async () => {
  await t.app.close();
});

const call = (opts: InjectOptions) =>
  t.app.inject({
    ...opts,
    headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) },
  });

async function makeAccount(body: Record<string, unknown>) {
  const res = await call({ method: 'POST', url: '/api/accounts', payload: body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().account as { id: number; class: string; isInvestment: boolean };
}

describe('accounts API', () => {
  it('requires login', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/accounts', headers: HOST_HEADER });
    expect(res.statusCode).toBe(401);
  });

  it('creates an account with an opening balance', async () => {
    const a = await makeAccount({
      name: 'Credit Union Checking',
      institution: 'Hometown Credit Union',
      type: 'checking',
      openingBalance: '$1,234.56',
      openingDate: '2026-10-01',
    });
    expect(a.class).toBe('asset');
    const list = (await call({ method: 'GET', url: '/api/accounts' })).json().accounts;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Credit Union Checking', balanceCents: 123456, balanceAsOf: '2026-10-01', group: 'cash' });
  });

  it('marks investment accounts and derives liability class from type', async () => {
    const roth = await makeAccount({ name: 'Roth', type: 'roth_ira' });
    expect(roth.isInvestment).toBe(true);
    const card = await makeAccount({ name: 'Card', type: 'credit_card' });
    expect(card.class).toBe('liability');
  });

  it.each([
    [{ name: '', type: 'checking' }, 'name'],
    [{ name: 'x'.repeat(61), type: 'checking' }, '60'],
    [{ name: 'X', type: 'piggy_bank' }, 'type'],
    [{ name: 'X', type: 'checking', openingBalance: '12.345' }, 'amount'],
    [{ name: 'X', type: 'checking', openingBalance: 'lots' }, 'amount'],
    [{ name: 'X', type: 'checking', openingBalance: 12.5 }, ''],
    [{ name: 'X', type: 'checking', openingBalance: '10', openingDate: '2026-02-30' }, 'date'],
    [{ name: 'X', type: 'checking', openingBalance: '10', openingDate: '2027-01-01' }, 'future'],
  ])('rejects bad input %j', async (payload, hint) => {
    const res = await call({ method: 'POST', url: '/api/accounts', payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.toLowerCase()).toContain(hint);
  });

  it('a JSON number is never accepted as money (only text, parsed to cents)', async () => {
    const a = await makeAccount({ name: 'X', type: 'checking' });
    const res = await call({ method: 'POST', url: `/api/accounts/${a.id}/balances`, payload: { asOf: '2026-11-01', balance: 0.1 } });
    expect(res.statusCode).toBe(400);
  });

  it('renames, archives and unarchives', async () => {
    const a = await makeAccount({ name: 'Old', type: 'savings' });
    await call({ method: 'PATCH', url: `/api/accounts/${a.id}`, payload: { name: 'Bank HYSA' } });
    await call({ method: 'PATCH', url: `/api/accounts/${a.id}`, payload: { archived: true } });
    expect((await call({ method: 'GET', url: '/api/accounts' })).json().accounts).toHaveLength(0);
    const all = (await call({ method: 'GET', url: '/api/accounts?archived=1' })).json().accounts;
    expect(all[0]).toMatchObject({ name: 'Bank HYSA', archived: true });
  });

  it('deleting an account deletes its balances', async () => {
    const a = await makeAccount({ name: 'X', type: 'checking', openingBalance: '50' });
    expect((await call({ method: 'DELETE', url: `/api/accounts/${a.id}` })).statusCode).toBe(200);
    const n = (t.db.prepare('SELECT COUNT(*) AS n FROM balance_snapshots').get() as { n: number }).n;
    expect(n).toBe(0);
    expect((await call({ method: 'DELETE', url: `/api/accounts/${a.id}` })).statusCode).toBe(404);
  });

  it('changes need the CSRF token', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { ...HOST_HEADER, cookie: auth.cookie },
      payload: { name: 'X', type: 'checking' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('balances API', () => {
  it('records balances over time and replaces a same-day entry', async () => {
    const a = await makeAccount({ name: 'HYSA', type: 'savings' });
    const post = (asOf: string, balance: string) =>
      call({ method: 'POST', url: `/api/accounts/${a.id}/balances`, payload: { asOf, balance } });
    expect((await post('2026-09-01', '1000')).statusCode).toBe(201);
    expect((await post('2026-10-01', '1500.50')).statusCode).toBe(201);
    expect((await post('2026-10-01', '1600.25')).statusCode).toBe(201); // replaces
    const detail = (await call({ method: 'GET', url: `/api/accounts/${a.id}` })).json();
    expect(detail.snapshots.map((s: { asOf: string; balanceCents: number }) => [s.asOf, s.balanceCents])).toEqual([
      ['2026-10-01', 160025],
      ['2026-09-01', 100000],
    ]);
  });

  it('stores balances as SQLite integers', async () => {
    const a = await makeAccount({ name: 'X', type: 'checking', openingBalance: '0.30' });
    const row = t.db.prepare('SELECT typeof(balance_cents) AS t, balance_cents AS c FROM balance_snapshots WHERE account_id = ?').get(a.id) as { t: string; c: number };
    expect(row).toEqual({ t: 'integer', c: 30 });
  });

  it('the database itself refuses a fractional balance', () => {
    t.db.prepare("INSERT INTO accounts (name, type, class, created_at, updated_at) VALUES ('x','checking','asset',0,0)").run();
    expect(() =>
      t.db.prepare("INSERT INTO balance_snapshots (account_id, as_of, balance_cents, created_at) VALUES (1, '2026-01-01', 10.5, 0)").run(),
    ).toThrow(/CHECK/);
  });

  it('allows negative balances (overdraft) and zero', async () => {
    const a = await makeAccount({ name: 'X', type: 'checking' });
    for (const bal of ['-25.10', '0']) {
      const res = await call({ method: 'POST', url: `/api/accounts/${a.id}/balances`, payload: { asOf: '2026-11-01', balance: bal } });
      expect(res.statusCode).toBe(201);
    }
  });

  it('deletes a balance', async () => {
    const a = await makeAccount({ name: 'X', type: 'checking', openingBalance: '5' });
    const snap = (await call({ method: 'GET', url: `/api/accounts/${a.id}` })).json().snapshots[0];
    expect((await call({ method: 'DELETE', url: `/api/balances/${snap.id}` })).statusCode).toBe(200);
    expect((await call({ method: 'GET', url: `/api/accounts/${a.id}` })).json().snapshots).toHaveLength(0);
  });

  it('404s for unknown accounts', async () => {
    const res = await call({ method: 'POST', url: '/api/accounts/999/balances', payload: { asOf: '2026-01-01', balance: '1' } });
    expect(res.statusCode).toBe(404);
  });
});

describe('net worth API', () => {
  it('reports zero and no data on a fresh install', async () => {
    const nw = (await call({ method: 'GET', url: '/api/networth' })).json();
    expect(nw).toMatchObject({ hasData: false, current: { totalCents: 0 }, change: { cents: 0, basisPoints: null } });
  });

  it('sums accounts, tracks change over the range and breaks down allocation', async () => {
    const chk = await makeAccount({ name: 'Checking', type: 'checking', openingBalance: '500', openingDate: '2025-12-01' });
    const hysa = await makeAccount({ name: 'HYSA', type: 'savings', openingBalance: '2000', openingDate: '2025-12-01' });
    const roth = await makeAccount({ name: 'Roth', type: 'roth_ira', openingBalance: '3000', openingDate: '2026-01-15' });
    await call({ method: 'POST', url: `/api/accounts/${chk.id}/balances`, payload: { asOf: '2026-11-01', balance: '650.25' } });
    await call({ method: 'POST', url: `/api/accounts/${hysa.id}/balances`, payload: { asOf: '2026-10-01', balance: '2400' } });
    await call({ method: 'POST', url: `/api/accounts/${roth.id}/balances`, payload: { asOf: '2026-11-10', balance: '3912.40' } });

    const nw = (await call({ method: 'GET', url: '/api/networth?range=1y' })).json();
    expect(nw.today).toBe('2026-11-11');
    expect(nw.current.totalCents).toBe(65025 + 240000 + 391240);
    // range starts 2025-11-11, before any data: net worth 0, so % change is null
    expect(nw.change.cents).toBe(nw.current.totalCents);
    expect(nw.change.basisPoints).toBeNull();
    expect(nw.series[0]).toMatchObject({ date: '2025-11-11', totalCents: 0 });
    expect(nw.series.at(-1).date).toBe('2026-11-11');
    expect(nw.allocation).toEqual(
      expect.arrayContaining([
        { group: 'cash', label: 'Cash', cents: 65025 + 240000 },
        { group: 'investments', label: 'Investments', cents: 391240 },
      ]),
    );

    const three = (await call({ method: 'GET', url: '/api/networth?range=3m' })).json();
    // 2026-08-11 net worth: 500 + 2000 + 3000 = 5500.00
    expect(three.series[0]).toMatchObject({ date: '2026-08-11', totalCents: 550000 });
    expect(three.change.cents).toBe(three.current.totalCents - 550000);
    expect(three.change.basisPoints).toBe(Math.round(((three.current.totalCents - 550000) * 10000) / 550000));
  });

  it('archived accounts still count toward net worth history', async () => {
    const a = await makeAccount({ name: 'Old', type: 'savings', openingBalance: '100', openingDate: '2026-01-01' });
    await call({ method: 'POST', url: `/api/accounts/${a.id}/balances`, payload: { asOf: '2026-06-01', balance: '0' } });
    await call({ method: 'PATCH', url: `/api/accounts/${a.id}`, payload: { archived: true } });
    const nw = (await call({ method: 'GET', url: '/api/networth?range=all' })).json();
    expect(nw.series[0]).toMatchObject({ date: '2026-01-01', totalCents: 10000 });
    expect(nw.current.totalCents).toBe(0);
  });

  it('rejects unknown ranges', async () => {
    expect((await call({ method: 'GET', url: '/api/networth?range=forever' })).statusCode).toBe(400);
  });
});
