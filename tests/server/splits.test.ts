/**
 * Split transactions (V2 Phase 2). Fake data only.
 * Server rules: pieces add up exactly, 2 to 50 pieces, same-kind categories, non-zero, same sign,
 * only income/expense. Totals use pieces; balances use the whole transaction; re-imports never
 * touch existing rows; undoing an import removes its splits.
 */
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_HEADER, cookieFrom, setupAndLogin, testApp } from './helpers.js';
import { planSplit } from '../../server/src/lib/splits.js';

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

beforeEach(async () => {
  t = await testApp(); // today = 2026-11-11
  auth = await setupAndLogin(t);
});
afterEach(async () => {
  await t.app.close();
});

let cats: { id: number; name: string; kind: string }[] = [];
const cat = (n: string) => cats.find((c) => c.name === n)!.id;
const setup = async () => {
  cats = (await get('/api/categories')).categories;
  return (await ok({ method: 'POST', url: '/api/accounts', payload: { name: 'Checking', type: 'checking', openingBalance: '1000', openingDate: '2026-01-01' } })).account.id as number;
};
const addTx = async (accountId: number, payload: object) =>
  (await ok({ method: 'POST', url: '/api/transactions', payload: { accountId, description: 'Corner Market', date: '2026-11-02', ...payload } })).transaction
    .id as number;
const split = (id: number, pieces: object[]) => call({ method: 'PUT', url: `/api/transactions/${id}/split`, payload: { pieces } });
const errorOf = async (id: number, pieces: object[]) => {
  const r = await split(id, pieces);
  expect(r.statusCode, r.body).toBe(400);
  return r.json().error as string;
};

describe('planSplit (pure)', () => {
  const kinds = new Map<number, 'income' | 'expense'>([
    [1, 'expense'],
    [2, 'expense'],
    [3, 'income'],
  ]);
  const kindOf = (id: number) => kinds.get(id);
  const out = { type: 'expense' as const, amountCents: -10000 };

  it('accepts pieces that add up exactly and gives them the transaction sign', () => {
    const r = planSplit(out, [{ categoryId: 1, amount: '60.01' }, { categoryId: 2, amount: '39.99' }], kindOf);
    expect(r).toEqual({ ok: true, pieces: [{ categoryId: 1, amountCents: -6001, note: '' }, { categoryId: 2, amountCents: -3999, note: '' }] });
  });

  it('a refund (money in, expense) splits into positive pieces', () => {
    const r = planSplit({ type: 'expense', amountCents: 2500 }, [{ categoryId: 1, amount: '20' }, { categoryId: 2, amount: '5' }], kindOf);
    expect(r.ok && r.pieces.map((p) => p.amountCents)).toEqual([2000, 500]);
  });

  it('refuses a mismatch of even one cent, either way', () => {
    expect(planSplit(out, [{ categoryId: 1, amount: '60' }, { categoryId: 2, amount: '39.99' }], kindOf)).toEqual({
      ok: false,
      error: 'The pieces add up to $99.99, $0.01 short of $100.00.',
    });
    expect(planSplit(out, [{ categoryId: 1, amount: '60' }, { categoryId: 2, amount: '40.01' }], kindOf)).toEqual({
      ok: false,
      error: 'The pieces add up to $100.01, $0.01 more than $100.00.',
    });
  });

  it('refuses wrong-kind or unknown categories, zero and wrong-sign pieces, bad numbers', () => {
    const e = (pieces: { categoryId: number; amount: string }[]) => {
      const r = planSplit(out, pieces, kindOf);
      return r.ok ? null : r.error;
    };
    expect(e([{ categoryId: 1, amount: '50' }, { categoryId: 3, amount: '50' }])).toBe('Piece 2: pick a spending category.');
    expect(e([{ categoryId: 1, amount: '50' }, { categoryId: 99, amount: '50' }])).toBe('Piece 2: pick a spending category.');
    expect(e([{ categoryId: 1, amount: '100' }, { categoryId: 2, amount: '0.00' }])).toBe('Piece 2: each piece needs an amount above $0.00.');
    expect(e([{ categoryId: 1, amount: '110' }, { categoryId: 2, amount: '-10' }])).toBe('Piece 2 must be money out, like the whole transaction.');
    expect(e([{ categoryId: 1, amount: 'ten' }, { categoryId: 2, amount: '90' }])).toBe('Piece 1: enter an amount like 12.50.');
  });

  it('refuses fewer than 2 or more than 50 pieces, and transfers or gifts', () => {
    expect(planSplit(out, [{ categoryId: 1, amount: '100' }], kindOf)).toMatchObject({ ok: false, error: 'A split needs at least 2 pieces.' });
    const many = Array.from({ length: 51 }, () => ({ categoryId: 1, amount: '1' }));
    expect(planSplit({ type: 'expense', amountCents: -5100 }, many, kindOf)).toMatchObject({ ok: false, error: 'A split can have at most 50 pieces.' });
    for (const type of ['transfer', 'gift'] as const) {
      expect(planSplit({ type, amountCents: -100 }, [{ categoryId: 1, amount: '0.5' }, { categoryId: 2, amount: '0.5' }], kindOf)).toMatchObject({
        ok: false,
        error: 'Only income and spending can be split. Transfers and gifts stay whole.',
      });
    }
  });
});

describe('split API', () => {
  it('saves a split; every total uses the pieces; the balance uses the whole amount once', async () => {
    const a = await setup();
    const id = await addTx(a, { amount: '90', direction: 'out', type: 'expense', categoryId: cat('Food') });
    const balanceBefore = (await get(`/api/accounts/${a}`)).account.balanceCents;
    const spentBefore = (await get('/api/budget?month=2026-11-01')).totals.spentCents;

    const r = await split(id, [
      { categoryId: cat('Food'), amount: '50.25' },
      { categoryId: cat('Shopping'), amount: '29.75', note: 'towels' },
      { categoryId: cat('Gifts Given'), amount: '10' },
    ]);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().splits.map((p: { amountCents: number }) => p.amountCents)).toEqual([-5025, -2975, -1000]);

    expect((await get(`/api/accounts/${a}`)).account.balanceCents).toBe(balanceBefore);
    const b = await get('/api/budget?month=2026-11-01');
    expect(b.totals.spentCents).toBe(spentBefore);
    const spent = (n: string) => (b.categories as { id: number; spentCents: number }[]).find((c) => c.id === cat(n))!.spentCents;
    expect([spent('Food'), spent('Shopping'), spent('Gifts Given')]).toEqual([5025, 2975, 1000]);
    const tree = (await get('/api/dashboard')).spendingByCategory as { categoryId: number; cents: number }[];
    expect(tree.find((x) => x.categoryId === cat('Shopping'))!.cents).toBe(2975);
    const cal = (await get('/api/dashboard')).daily as { date: string; cents: number }[];
    expect(cal.find((x) => x.date === '2026-11-02')!.cents).toBe(9000);

    const whole = await get(`/api/transactions/${id}`);
    expect(whole.transaction).toMatchObject({ amountCents: -9000, categoryId: cat('Food'), split: null });
    expect(whole.splits).toHaveLength(3);
  });

  it('an income split feeds the refereeing card and the savings rate with piece amounts', async () => {
    const a = await setup();
    const id = await addTx(a, { amount: '75', direction: 'in', type: 'income', categoryId: cat('Refereeing'), description: 'Tournament check' });
    expect((await split(id, [{ categoryId: cat('Refereeing'), amount: '60' }, { categoryId: cat('Interest'), amount: '15' }])).statusCode).toBe(200);
    const cf = await get('/api/cashflow');
    expect(cf.gig.payCents).toBe(6000);
    expect(cf.ytd.incomeCents).toBe(7500);
    expect((await get('/api/goals?year=2026')).roth.earnedIncomeCents).toBe(6000);
  });

  it('the server rejects every broken split, whatever the browser sends', async () => {
    const a = await setup();
    const id = await addTx(a, { amount: '100', direction: 'out', type: 'expense', categoryId: cat('Food') });
    const food = cat('Food');
    expect(await errorOf(id, [{ categoryId: food, amount: '60' }, { categoryId: food, amount: '39.99' }])).toBe(
      'The pieces add up to $99.99, $0.01 short of $100.00.',
    );
    expect(await errorOf(id, [{ categoryId: food, amount: '100' }])).toBe('A split needs at least 2 pieces.');
    expect(await errorOf(id, Array.from({ length: 51 }, () => ({ categoryId: food, amount: '1' })))).toBe('A split can have at most 50 pieces.');
    expect(await errorOf(id, [{ categoryId: food, amount: '100' }, { categoryId: cat('Refereeing'), amount: '0.00' }])).toMatch(/Piece 2/);
    expect(await errorOf(id, [{ categoryId: food, amount: '50' }, { categoryId: cat('Refereeing'), amount: '50' }])).toBe(
      'Piece 2: pick a spending category.',
    );
    expect(await errorOf(id, [{ categoryId: food, amount: '110' }, { categoryId: food, amount: '-10' }])).toBe(
      'Piece 2 must be money out, like the whole transaction.',
    );
    expect(await errorOf(id, [{ categoryId: food, amount: 50 }, { categoryId: food, amount: '50' }])).toBeTruthy(); // JSON numbers are not money
    expect((await get(`/api/transactions/${id}`)).splits).toEqual([]); // nothing was saved
  });

  it('50 pieces is fine', async () => {
    const a = await setup();
    const id = await addTx(a, { amount: '50', direction: 'out', type: 'expense', categoryId: cat('Food') });
    const r = await split(id, Array.from({ length: 50 }, () => ({ categoryId: cat('Food'), amount: '1' })));
    expect(r.statusCode, r.body).toBe(200);
    expect((await get('/api/transactions?limit=500')).total).toBe(50); // one row per piece (the opening balance is not a transaction)
  });

  it('transfers and gifts cannot be split', async () => {
    const a = await setup();
    for (const type of ['transfer', 'gift']) {
      const id = await addTx(a, { amount: '20', direction: 'in', type });
      expect(await errorOf(id, [{ categoryId: cat('Refereeing'), amount: '10' }, { categoryId: cat('Interest'), amount: '10' }])).toBe(
        'Only income and spending can be split. Transfers and gifts stay whole.',
      );
    }
  });

  it('a split keeps its amount, type and category until the split is removed; other edits work', async () => {
    const a = await setup();
    const id = await addTx(a, { amount: '30', direction: 'out', type: 'expense', categoryId: cat('Food'), notes: 'old' });
    await split(id, [{ categoryId: cat('Food'), amount: '20' }, { categoryId: cat('Shopping'), amount: '10' }]);
    const patch = (payload: object) => call({ method: 'PATCH', url: `/api/transactions/${id}`, payload });
    for (const p of [{ amount: '31' }, { type: 'transfer' }, { categoryId: cat('Shopping') }, { direction: 'in' }]) {
      const r = await patch(p);
      expect(r.statusCode, JSON.stringify(p)).toBe(400);
      expect(r.json().error).toMatch(/Remove the split first/);
    }
    expect((await patch({ description: 'Market run', notes: 'new', amount: '30.00', direction: 'out', type: 'expense' })).statusCode).toBe(200);
    expect((await get(`/api/transactions/${id}`)).transaction).toMatchObject({ description: 'Market run', notes: 'new', amountCents: -3000 });

    const bulk = await ok({ method: 'POST', url: '/api/transactions/bulk', payload: { ids: [id], categoryId: cat('Health') } });
    expect(bulk).toEqual({ updated: 0, skippedSplits: 1 });
    expect((await get(`/api/transactions/${id}`)).splits).toHaveLength(2);

    // Remove split: back to one category, the one it had before.
    const r = await ok({ method: 'DELETE', url: `/api/transactions/${id}/split` });
    expect(r.transaction.categoryId).toBe(cat('Food'));
    const list = await get(`/api/transactions?categoryId=${cat('Food')}`);
    expect(list.transactions).toHaveLength(1);
    expect(list.transactions[0]).toMatchObject({ amountCents: -3000, split: null });
    expect((await patch({ amount: '31' })).statusCode).toBe(200);
  });

  it('a split is never linked as a transfer, by hand or automatically, and rules leave it alone', async () => {
    const a = await setup();
    const b = (await ok({ method: 'POST', url: '/api/accounts', payload: { name: 'Savings', type: 'savings' } })).account.id;
    const id = await addTx(a, { amount: '40', direction: 'out', type: 'expense', categoryId: null, description: 'TRANSFER TO SAVINGS' });
    await split(id, [{ categoryId: cat('Food'), amount: '20' }, { categoryId: cat('Shopping'), amount: '20' }]);
    const other = await addTx(b, { amount: '40', direction: 'in', type: 'transfer', description: 'TRANSFER FROM CHECKING' });
    const link = await call({ method: 'POST', url: `/api/transactions/${id}/link`, payload: { otherId: other } });
    expect(link.statusCode).toBe(400);
    expect(link.json().error).toBe('A split transaction cannot be a transfer. Remove the split first.');
    expect((await get(`/api/transactions/${other}/link-candidates`)).candidates).toEqual([]);
    await ok({ method: 'POST', url: '/api/rules/apply' });
    expect((await get(`/api/transactions/${id}`)).transaction.type).toBe('expense');
    // It is not "uncategorized" either: its pieces have categories.
    expect((await get('/api/transactions?categoryId=none')).total).toBe(0);
  });

  it('deleting a split transaction removes its pieces', async () => {
    const a = await setup();
    const id = await addTx(a, { amount: '30', direction: 'out', type: 'expense', categoryId: cat('Food') });
    await split(id, [{ categoryId: cat('Food'), amount: '20' }, { categoryId: cat('Shopping'), amount: '10' }]);
    await ok({ method: 'DELETE', url: `/api/transactions/${id}` });
    expect((await get('/api/transactions')).total).toBe(0);
    expect((await get('/api/budget?month=2026-11-01')).totals.spentCents).toBe(0);
  });

  it('search finds a piece by its note', async () => {
    const a = await setup();
    const id = await addTx(a, { amount: '30', direction: 'out', type: 'expense', categoryId: cat('Food') });
    await split(id, [{ categoryId: cat('Food'), amount: '20' }, { categoryId: cat('Shopping'), amount: '10', note: 'birthday candles' }]);
    const r = await get('/api/transactions?q=candles');
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].split.note).toBe('birthday candles');
  });
});

describe('imports never touch existing rows', () => {
  const FILE = [
    'Date,Description,Amount,Balance',
    '11/02/2026,CORNER MARKET #12,-90.00,910.00',
    '11/03/2026,COFFEE CART,-4.50,905.50',
    '11/04/2026,COFFEE CART,-4.50,901.00',
  ].join('\n');
  const MORE = FILE + '\n11/05/2026,BOOK SHOP,-12.00,889.00';
  const commit = (accountId: number, text: string) =>
    ok({ method: 'POST', url: '/api/import/commit', payload: { accountId, filename: 'bank.csv', text } });

  it('re-importing leaves split, re-categorized and annotated rows exactly as they were', async () => {
    const a = (await ok({ method: 'POST', url: '/api/accounts', payload: { name: 'Checking', type: 'checking' } })).account.id;
    cats = (await get('/api/categories')).categories;
    await commit(a, FILE);
    const rows = (await get(`/api/transactions?accountId=${a}`)).transactions as { id: number; description: string }[];
    const market = rows.find((r) => r.description.startsWith('CORNER') || r.description.startsWith('Corner'))!.id;
    const coffee = rows.find((r) => /coffee/i.test(r.description))!.id;
    await split(market, [{ categoryId: cat('Food'), amount: '60' }, { categoryId: cat('Shopping'), amount: '30' }]);
    await ok({ method: 'PATCH', url: `/api/transactions/${coffee}`, payload: { categoryId: cat('Dining Out'), notes: 'with Sam', description: 'Coffee' } });

    const snapshot = () =>
      t.store
        .current()
        .prepare(
          `SELECT t.*, (SELECT json_group_array(json_array(position, category_id, amount_cents, note)) FROM transaction_splits s WHERE s.transaction_id = t.id) AS pieces
           FROM transactions t ORDER BY id`,
        )
        .all();
    const before = JSON.stringify(snapshot());
    const again = await commit(a, FILE);
    expect(again.imported).toBe(0);
    expect(JSON.stringify(snapshot())).toBe(before);

    // A newer download with one extra row adds only that row.
    const more = await commit(a, MORE);
    expect(more.imported).toBe(1);
    const after = snapshot() as { id: number }[];
    expect(after).toHaveLength(4);
    expect(JSON.stringify(after.slice(0, 3))).toBe(before); // the three existing rows are untouched
  });

  it('undoing the import that brought a split transaction in deletes the split too, and history says so first', async () => {
    const a = (await ok({ method: 'POST', url: '/api/accounts', payload: { name: 'Checking', type: 'checking' } })).account.id;
    cats = (await get('/api/categories')).categories;
    const c = await commit(a, FILE);
    const rows = (await get(`/api/transactions?accountId=${a}`)).transactions as { id: number }[];
    await split(rows[0]!.id, [{ categoryId: cat('Food'), amount: '2.50' }, { categoryId: cat('Shopping'), amount: '2' }]);
    const batch = (await get('/api/import/batches')).batches.find((x: { id: number }) => x.id === c.batchId);
    expect(batch.splitCount).toBe(1);
    await ok({ method: 'DELETE', url: `/api/import/batches/${c.batchId}` });
    expect((await get('/api/transactions')).total).toBe(0);
    const left = t.store.current().prepare('SELECT COUNT(*) AS n FROM transaction_splits').get() as { n: number };
    expect(left.n).toBe(0);
  });
});

describe('demo mode', () => {
  it('splits work in demo mode and the demo data has split transactions to look at', async () => {
    const enter = await call({ method: 'POST', url: '/api/demo/enter' });
    expect(enter.statusCode, enter.body).toBe(200);
    auth = { cookie: cookieFrom(enter), csrf: enter.json().csrfToken };
    const list = await get('/api/transactions?limit=500');
    const pieces = (list.transactions as { id: number; split: { count: number } | null }[]).filter((x) => x.split);
    expect(pieces.length).toBeGreaterThanOrEqual(6);
    const id = pieces[0]!.id;
    const whole = await get(`/api/transactions/${id}`);
    expect(whole.splits.reduce((s: number, p: { amountCents: number }) => s + p.amountCents, 0)).toBe(whole.transaction.amountCents);
    expect((await call({ method: 'DELETE', url: `/api/transactions/${id}/split` })).statusCode).toBe(200);
  });
});
