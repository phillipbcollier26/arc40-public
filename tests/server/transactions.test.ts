import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';

let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };
let checking: number;
let venmo: number;
let savings: number;

const call = (opts: InjectOptions) =>
  t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });
const account = async (name: string, type: string) =>
  (await call({ method: 'POST', url: '/api/accounts', payload: { name, type } })).json().account.id as number;
const cat = async (name: string) =>
  ((await call({ method: 'GET', url: '/api/categories' })).json().categories as { id: number; name: string }[]).find((c) => c.name === name)!.id;
const add = async (payload: Record<string, unknown>) => {
  const res = await call({ method: 'POST', url: '/api/transactions', payload: { accountId: checking, date: '2026-11-01', ...payload } });
  return res;
};
const sums = async (q = '') => (await call({ method: 'GET', url: `/api/transactions?${q}` })).json().sums;

beforeEach(async () => {
  t = await testApp();
  const s = await setupAndLogin(t);
  auth = { cookie: s.cookie, csrf: s.csrf };
  checking = await account('Checking', 'checking');
  savings = await account('HYSA', 'savings');
  venmo = await account('Venmo', 'cash');
});
afterEach(async () => {
  await t.app.close();
});

describe('manual transactions', () => {
  it('adds a cash/Venmo expense with a category', async () => {
    const res = await add({ accountId: venmo, amount: '12.50', direction: 'out', description: 'Pizza split', type: 'expense', categoryId: await cat('Dining Out') });
    expect(res.statusCode).toBe(201);
    expect(res.json().transaction).toMatchObject({ amountCents: -1250, type: 'expense', source: 'manual' });
  });

  it('gift from family: adds money, not income, not spending, remembers who', async () => {
    const res = await add({ accountId: savings, amount: '100', direction: 'in', description: 'Birthday money', type: 'gift', giftFrom: 'Mom' });
    expect(res.json().transaction).toMatchObject({ amountCents: 10000, type: 'gift', giftFrom: 'Mom', categoryId: null });
    const s = await sums();
    expect(s).toMatchObject({ incomeCents: 0, spendingCents: 0, giftCents: 10000 });
  });

  it('a gift can never carry a category', async () => {
    const res = await add({ amount: '50', direction: 'in', description: 'Gift', type: 'gift', categoryId: await cat('Food') });
    expect(res.json().transaction.categoryId).toBeNull();
  });

  it('a category of the wrong kind is dropped (income cannot be "Food")', async () => {
    const res = await add({ amount: '50', direction: 'in', description: 'Game pay', type: 'income', categoryId: await cat('Food') });
    expect(res.json().transaction.categoryId).toBeNull();
  });

  it('a refund (expense with money in) lowers spending', async () => {
    const food = await cat('Food');
    await add({ amount: '40', direction: 'out', description: 'Groceries', type: 'expense', categoryId: food });
    await add({ amount: '15', direction: 'in', description: 'Return', type: 'expense', categoryId: food });
    expect((await sums()).spendingCents).toBe(2500);
  });

  it('income with an optional payer (who paid you)', async () => {
    const res = await add({ amount: '85', direction: 'in', description: 'Varsity game', type: 'income', categoryId: await cat('Refereeing'), payer: 'High school league' });
    expect(res.json().transaction).toMatchObject({ payer: 'High school league', amountCents: 8500 });
  });

  it.each([
    [{ amount: '0', direction: 'out', description: 'x', type: 'expense' }, 'above zero'],
    [{ amount: '1.234', direction: 'out', description: 'x', type: 'expense' }, '25.00'],
    [{ amount: '5', direction: 'out', description: '', type: 'expense' }, 'description'],
    [{ amount: '5', direction: 'out', description: 'x', type: 'expense', date: '2030-01-01' }, 'future'],
    [{ amount: '5', direction: 'sideways', description: 'x', type: 'expense' }, ''],
  ])('rejects %j', async (payload, hint) => {
    const res = await add(payload);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.toLowerCase()).toContain(hint.toLowerCase());
  });

  it('edits type, category and amount', async () => {
    const id = (await add({ amount: '20', direction: 'in', description: 'Cash deposit', type: 'income' })).json().transaction.id;
    const res = await call({ method: 'PATCH', url: `/api/transactions/${id}`, payload: { type: 'gift', giftFrom: 'Grandma', amount: '25.00' } });
    expect(res.json().transaction).toMatchObject({ type: 'gift', giftFrom: 'Grandma', amountCents: 2500 });
    const res2 = await call({ method: 'PATCH', url: `/api/transactions/${id}`, payload: { direction: 'out' } });
    expect(res2.json().transaction.amountCents).toBe(-2500);
  });

  it('bulk-categorizes', async () => {
    const a = (await add({ amount: '5', direction: 'out', description: 'A', type: 'expense' })).json().transaction.id;
    const b = (await add({ amount: '6', direction: 'out', description: 'B', type: 'expense' })).json().transaction.id;
    const res = await call({ method: 'POST', url: '/api/transactions/bulk', payload: { ids: [a, b], categoryId: await cat('Shopping') } });
    expect(res.json().updated).toBe(2);
    expect((await call({ method: 'GET', url: '/api/transactions?categoryId=none' })).json().total).toBe(0);
  });

  it('filters by account, type, date and search text', async () => {
    await add({ amount: '5', direction: 'out', description: 'Coffee', type: 'expense', date: '2026-10-01' });
    await add({ accountId: venmo, amount: '9', direction: 'out', description: 'Tacos 100%_off', type: 'expense' });
    const get = async (q: string) => (await call({ method: 'GET', url: `/api/transactions?${q}` })).json().total;
    expect(await get(`accountId=${venmo}`)).toBe(1);
    expect(await get('from=2026-10-15')).toBe(1);
    expect(await get('q=coffee')).toBe(1);
    expect(await get('q=%25')).toBe(1); // literal %, not a wildcard
    expect(await get('type=income')).toBe(0);
  });

  it('deletes', async () => {
    const id = (await add({ amount: '5', direction: 'out', description: 'A', type: 'expense' })).json().transaction.id;
    expect((await call({ method: 'DELETE', url: `/api/transactions/${id}` })).statusCode).toBe(200);
    expect((await call({ method: 'DELETE', url: `/api/transactions/${id}` })).statusCode).toBe(404);
  });
});

describe('manual transfer links', () => {
  it('links two sides, excludes them from totals, and unlinking restores them', async () => {
    const out = (await add({ amount: '200', direction: 'out', description: 'To savings', type: 'expense' })).json().transaction.id;
    const inn = (await add({ accountId: savings, amount: '200', direction: 'in', description: 'From checking', type: 'income' })).json().transaction.id;
    const cands = (await call({ method: 'GET', url: `/api/transactions/${out}/link-candidates` })).json().candidates;
    expect(cands.map((c: { id: number }) => c.id)).toEqual([inn]);
    expect((await call({ method: 'POST', url: `/api/transactions/${out}/link`, payload: { otherId: inn } })).statusCode).toBe(200);
    expect(await sums()).toMatchObject({ incomeCents: 0, spendingCents: 0, transferCents: 20000 });
    await call({ method: 'POST', url: `/api/transactions/${inn}/unlink` });
    expect(await sums()).toMatchObject({ incomeCents: 20000, spendingCents: 20000 });
  });

  it.each([
    ['same account', async () => [(await add({ amount: '5', direction: 'out', description: 'a', type: 'expense' })).json().transaction.id, (await add({ amount: '5', direction: 'in', description: 'b', type: 'income' })).json().transaction.id]],
    ['different amounts', async () => [(await add({ amount: '5', direction: 'out', description: 'a', type: 'expense' })).json().transaction.id, (await add({ accountId: savings, amount: '6', direction: 'in', description: 'b', type: 'income' })).json().transaction.id]],
  ])('refuses to link %s', async (_label, make) => {
    const [a, b] = await make();
    expect((await call({ method: 'POST', url: `/api/transactions/${a}/link`, payload: { otherId: b } })).statusCode).toBe(400);
  });
});

describe('categories', () => {
  it('ships the default set, including Housing and Food', async () => {
    const names = ((await call({ method: 'GET', url: '/api/categories' })).json().categories as { name: string }[]).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['Housing', 'Food', 'Refereeing', 'Interest', 'Ref Gear & Fees']));
  });

  it('adds, renames, archives and deletes; deleting leaves transactions uncategorized', async () => {
    const res = await call({ method: 'POST', url: '/api/categories', payload: { name: 'Pets', kind: 'expense', group: 'Lifestyle', color: 'bronze' } });
    expect(res.statusCode).toBe(201);
    const id = res.json().category.id;
    expect((await call({ method: 'POST', url: '/api/categories', payload: { name: 'pets', kind: 'expense' } })).statusCode).toBe(400);
    await call({ method: 'PATCH', url: `/api/categories/${id}`, payload: { name: 'Pet Care', archived: true } });
    const tx = (await add({ amount: '30', direction: 'out', description: 'Vet', type: 'expense', categoryId: id })).json().transaction.id;
    await call({ method: 'DELETE', url: `/api/categories/${id}` });
    const after = (await call({ method: 'GET', url: '/api/transactions' })).json().transactions.find((x: { id: number }) => x.id === tx);
    expect(after.categoryId).toBeNull();
  });

  it('rejects colors that are not theme tokens', async () => {
    const res = await call({ method: 'POST', url: '/api/categories', payload: { name: 'X', kind: 'expense', color: 'purple' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('rules', () => {
  it('a new rule categorizes matching uncategorized transactions right away', async () => {
    await add({ amount: '60', direction: 'out', description: 'DF-SPORTS* STATE REF ASSOC', type: 'expense' });
    await add({ amount: '7', direction: 'out', description: 'Something else', type: 'expense' });
    const test = (await call({ method: 'POST', url: '/api/rules/test', payload: { pattern: 'ref assoc' } })).json();
    expect(test.matches).toBe(1);
    const gear = await cat('Ref Gear & Fees');
    const res = await call({ method: 'POST', url: '/api/rules', payload: { pattern: 'REF ASSOC', setCategoryId: gear } });
    expect(res.statusCode).toBe(201);
    expect(res.json().applied).toBe(1);
    const { transactions } = (await call({ method: 'GET', url: `/api/transactions?categoryId=${gear}` })).json();
    expect(transactions).toHaveLength(1);
  });

  it('a gift rule: deposits from a family member become gifts', async () => {
    await add({ accountId: savings, amount: '100', direction: 'in', description: 'Transactor: SAMPLE PARENT', type: 'income' });
    await call({ method: 'POST', url: '/api/rules', payload: { pattern: 'SAMPLE PARENT', direction: 'in', setType: 'gift', setGiftFrom: 'Mom' } });
    const t1 = (await call({ method: 'GET', url: '/api/transactions' })).json().transactions[0];
    expect(t1).toMatchObject({ type: 'gift', giftFrom: 'Mom' });
  });

  it('your rules win over the built-in ones', async () => {
    await call({ method: 'POST', url: '/api/rules', payload: { pattern: 'SPOTIFY', setCategoryId: await cat('Entertainment') } });
    await add({ amount: '11.99', direction: 'out', description: 'SPOTIFY USA', type: 'expense' });
    await call({ method: 'POST', url: '/api/rules/apply' });
    const t1 = (await call({ method: 'GET', url: '/api/transactions' })).json().transactions[0];
    expect(t1.categoryId).toBe(await cat('Entertainment'));
  });

  it.each([
    [{ pattern: 'x', setCategoryId: 1 }, '2 characters'],
    [{ pattern: 'abc' }, 'category or a type'],
    [{ pattern: 'abc', setType: 'gift', setCategoryId: 1 }, ''],
  ])('rejects bad rule %j', async (payload, hint) => {
    const res = await call({ method: 'POST', url: '/api/rules', payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain(hint);
  });

  it('rules are plain text: regex characters match literally', async () => {
    await add({ amount: '3', direction: 'out', description: 'A.B*C', type: 'expense' });
    expect((await call({ method: 'POST', url: '/api/rules/test', payload: { pattern: '.*' } })).json().matches).toBe(0);
    expect((await call({ method: 'POST', url: '/api/rules/test', payload: { pattern: 'b*c' } })).json().matches).toBe(1);
  });
});
