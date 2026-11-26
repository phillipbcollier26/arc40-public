/**
 * Fixes from the Arc40 audit (Nov 2026). Each test was written FIRST and failed on the old code.
 * Fake data only: the bank fixtures and made-up rows.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { InjectOptions } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';
import { applyMapping, suggestMapping, findHeaderRow } from '../../server/src/lib/importMapping.js';
import { parseCsv } from '../../server/src/lib/csv.js';

const fixture = (name: string) => fs.readFileSync(path.resolve('tests/fixtures/csv', name), 'utf8');

let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };

const call = (opts: InjectOptions) =>
  t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });
const get = async (url: string) => (await call({ method: 'GET', url })).json();
const post = (url: string, payload: object = {}) => call({ method: 'POST', url, payload });

async function account(name: string, type: string) {
  return (await post('/api/accounts', { name, type })).json().account.id as number;
}
const catId = async (name: string) =>
  ((await get('/api/categories')).categories as { id: number; name: string }[]).find((c) => c.name === name)!.id;
const commitText = async (accountId: number, text: string, filename = 'file.csv') => {
  const res = await post('/api/import/commit', { accountId, filename, text });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};
const balanceOf = async (id: number) => ((await get('/api/accounts')).accounts as { id: number; balanceCents: number }[]).find((a) => a.id === id)!.balanceCents;
const snapshotsOf = async (id: number) => (await get(`/api/accounts/${id}`)).snapshots as { asOf: string; balanceCents: number; source: string }[];
const addTx = async (body: object) => (await post('/api/transactions', body)).json().transaction as { id: number };
const getTx = async (id: number) => (await get(`/api/transactions/${id}`)).transaction as { type: string; categoryId: number | null; transferGroupId: number | null };

beforeEach(async () => {
  t = await testApp();
  const s = await setupAndLogin(t);
  auth = { cookie: s.cookie, csrf: s.csrf };
});

// ---------------------------------------------------------------- F-01

describe('F-01: undoing a re-import never removes the first import\'s balances', () => {
  it('import, import again (nothing new), undo the second: balances unchanged', async () => {
    const a = await account('Checking', 'checking');
    await commitText(a, fixture('wpcu-checking.csv'), 'first.csv');
    const before = { balance: await balanceOf(a), snaps: await snapshotsOf(a) };
    expect(before.balance).toBe(41025);
    expect(before.snaps.length).toBe(7);

    const again = await commitText(a, fixture('wpcu-checking.csv'), 'again.csv');
    expect(again.imported).toBe(0);
    expect((await call({ method: 'DELETE', url: `/api/import/batches/${again.batchId}` })).statusCode).toBe(200);

    expect(await balanceOf(a)).toBe(before.balance);
    expect(await snapshotsOf(a)).toEqual(before.snaps);
  });

  it('a re-import whose balance for a day CHANGED takes that day over; undoing it removes only that day', async () => {
    const a = await account('Checking', 'checking');
    const H = 'Transaction Number,Date,Description,Memo,Amount Debit,Amount Credit,Balance,Check Number';
    await commitText(a, [H, '1,10/02/2026,Coffee,,-5.00,,95.00,', '2,10/01/2026,Pay,,,100.00,100.00,'].join('\n'), 'one.csv');
    // A later file: same two rows, plus a later charge on Oct 2 (so Oct 2 ends lower).
    const second = await commitText(a, [H, '3,10/02/2026,Snack,,-3.00,,92.00,', '1,10/02/2026,Coffee,,-5.00,,95.00,', '2,10/01/2026,Pay,,,100.00,100.00,'].join('\n'), 'two.csv');
    expect(second.imported).toBe(1);
    expect((await snapshotsOf(a)).find((s) => s.asOf === '2026-10-02')!.balanceCents).toBe(9200);

    await call({ method: 'DELETE', url: `/api/import/batches/${second.batchId}` });
    const snaps = await snapshotsOf(a);
    expect(snaps.map((s) => s.asOf)).toEqual(['2026-10-01']); // Oct 1 still belongs to the first import
  });
});

// ---------------------------------------------------------------- F-02

describe('F-02: automatic transfer links never re-type a categorized row', () => {
  it('a categorized expense is not auto-linked; it becomes a suggestion instead', async () => {
    const wpcu = await account('Credit Union Checking', 'checking');
    const cf = await account('Bank Checking', 'checking');
    const food = await catId('Food');
    const grocery = await addTx({ accountId: wpcu, date: '2026-09-29', amount: '55.00', direction: 'out', description: 'Grocery run', type: 'expense', categoryId: food });

    const r = await commitText(cf, fixture('climatefirst-checking.csv'));
    expect(r.transfersLinked).toBe(0);
    expect(await getTx(grocery.id)).toMatchObject({ type: 'expense', categoryId: food, transferGroupId: null });
    expect((await get('/api/transactions?from=2026-09-01&to=2026-09-30')).sums.spendingCents).toBe(5500);

    const s = await get('/api/transfers/suggestions');
    expect(s.suggestions).toHaveLength(1);
    expect(s.suggestions[0].out.id).toBe(grocery.id);
  });

  it('two transfers, or a transfer and an UNcategorized row, still link automatically', async () => {
    const wpcu = await account('Credit Union Checking', 'checking');
    const cf = await account('Bank Checking', 'checking');
    const plain = await addTx({ accountId: wpcu, date: '2026-09-29', amount: '55.00', direction: 'out', description: 'Moved money', type: 'expense' });
    const r = await commitText(cf, fixture('climatefirst-checking.csv'));
    expect(r.transfersLinked).toBe(1);
    expect((await getTx(plain.id)).type).toBe('transfer');
    expect((await get('/api/transfers/suggestions')).suggestions).toHaveLength(0);
  });

  it('linking a suggestion by hand, then unlinking, restores the type AND the category', async () => {
    const wpcu = await account('Credit Union Checking', 'checking');
    const sav = await account('Savings', 'savings');
    const food = await catId('Food');
    const e = await addTx({ accountId: wpcu, date: '2026-11-02', amount: '40.00', direction: 'out', description: 'Store', type: 'expense', categoryId: food });
    const i = await addTx({ accountId: sav, date: '2026-11-02', amount: '40.00', direction: 'in', description: 'Transfer in', type: 'transfer' });
    expect((await post(`/api/transactions/${e.id}/link`, { otherId: i.id })).statusCode).toBe(200);
    expect(await getTx(e.id)).toMatchObject({ type: 'transfer', categoryId: null });
    await post(`/api/transactions/${e.id}/unlink`);
    expect(await getTx(e.id)).toMatchObject({ type: 'expense', categoryId: food, transferGroupId: null });
  });

  it('"Not a pair" hides a suggestion for good', async () => {
    const wpcu = await account('Credit Union Checking', 'checking');
    const cf = await account('Bank Checking', 'checking');
    await addTx({ accountId: wpcu, date: '2026-09-29', amount: '55.00', direction: 'out', description: 'Grocery run', type: 'expense', categoryId: await catId('Food') });
    await commitText(cf, fixture('climatefirst-checking.csv'));
    const [s] = (await get('/api/transfers/suggestions')).suggestions;
    expect((await post('/api/transfers/suggestions/dismiss', { outId: s.out.id, inId: s.in.id })).statusCode).toBe(200);
    expect((await get('/api/transfers/suggestions')).suggestions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- F-05

describe('F-05: Credit or Debit files never guess', () => {
  const H = 'Account Name,Processed Date,Description,Check Number,Credit or Debit,Amount';
  const parse = (lines: string[]) => {
    const rows = parseCsv([H, ...lines].join('\n'));
    return applyMapping(rows, suggestMapping(rows, findHeaderRow(rows)));
  };

  it('a blank or unknown word is skipped as "Credit or Debit is not clear"', () => {
    const r = parse(['X,2026-10-31,PAYROLL DEPOSIT,,,500.00', 'X,2026-10-30,ODD ROW,,Deposit,25.00']);
    expect(r.parsed).toHaveLength(0);
    expect(r.skipped.map((s) => s.reason)).toEqual(['Credit or Debit is not clear', 'Credit or Debit is not clear']);
  });

  it('credit and known debit words still work, any case, spaces trimmed', () => {
    const r = parse(['X,2026-10-31,A,, credit ,1.00', 'X,2026-10-30,B,,DEBIT,2.00', 'X,2026-10-29,C,,dr,3.00', 'X,2026-10-28,D,,Withdrawal,4.00']);
    expect(r.parsed.map((p) => p.amountCents)).toEqual([100, -200, -300, -400]);
    expect(r.skipped).toEqual([]);
  });
});

// ---------------------------------------------------------------- F-01 repair (migration 014)

describe('F-01 repair: migration 014 hands balances back to the oldest import that covers them', () => {
  it('a database hit by the old bug is safe to undo after the update; values never change', async () => {
    const os = await import('node:os');
    const { openDatabase } = await import('../../server/src/db/database.js');
    const { commitImport, undoImport } = await import('../../server/src/lib/importer.js');
    const { createAccount } = await import('../../server/src/lib/accounts.js');
    const real = path.resolve('server/src/db/migrations');
    const upTo013 = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-mig013-'));
    for (const f of fs.readdirSync(real).filter((f) => f < '014')) fs.copyFileSync(path.join(real, f), path.join(upTo013, f));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-f01-'));

    let db = openDatabase(dir, { migrationsDir: upTo013 });
    const a = createAccount(db, { name: 'Checking', institution: 'X', type: 'checking' }, 1).id;
    const first = commitImport(db, { accountId: a, filename: 'a.csv', text: fixture('wpcu-checking.csv') }, 1);
    const second = commitImport(db, { accountId: a, filename: 'b.csv', text: fixture('wpcu-checking.csv') }, 2);
    // What the OLD code did on the second import: every balance moved to the newest import.
    db.prepare('UPDATE balance_snapshots SET import_batch_id = ? WHERE account_id = ?').run(second.batchId, a);
    const before = db.prepare('SELECT as_of, balance_cents, import_batch_id FROM balance_snapshots ORDER BY as_of').all() as { as_of: string; balance_cents: number }[];
    expect(before).toHaveLength(7);
    db.close();

    db = openDatabase(dir); // runs 014
    const after = db.prepare('SELECT as_of, balance_cents, import_batch_id FROM balance_snapshots ORDER BY as_of').all() as { as_of: string; balance_cents: number; import_batch_id: number }[];
    expect(after.map((r) => [r.as_of, r.balance_cents])).toEqual(before.map((r) => [r.as_of, r.balance_cents]));
    expect(new Set(after.map((r) => r.import_batch_id))).toEqual(new Set([first.batchId]));
    undoImport(db, second.batchId);
    expect((db.prepare('SELECT COUNT(*) AS n FROM balance_snapshots').get() as { n: number }).n).toBe(7);
    db.close();
  });
});

// ---------------------------------------------------------------- F-03

describe('F-03: a negative contribution (a reversal) lowers every total', () => {
  const H = 'Run Date,Action,Symbol,Description,Type,Price ($),Quantity,Commission ($),Fees ($),Accrued Interest ($),Amount ($),Cash Balance ($),Settlement Date';
  const FILE = [
    H,
    '10/06/2026,CASH CONTRIBUTION CURRENT YEAR REVERSAL (Cash),,No Description,Cash,,0,,,,-200.00,300.00,',
    '10/05/2026,CASH CONTRIBUTION CURRENT YEAR (Cash),,No Description,Cash,,0,,,,500.00,500.00,',
  ].join('\n');

  it('the preview flags the reversal and still imports it', async () => {
    const roth = await account('Roth IRA', 'roth_ira');
    const p = (await post('/api/import/preview', { accountId: roth, filename: 'h.csv', text: FILE })).json();
    const rev = p.rows.find((r: { amountCents: number }) => r.amountCents === -20000);
    expect(rev.reversal).toBe(true);
    expect(rev.note).toBe('Contribution reversal: this lowers your total');
    expect(p.rows.find((r: { amountCents: number }) => r.amountCents === 50000).reversal).toBeUndefined();
    expect((await commitText(roth, FILE)).imported).toBe(2);
  });

  it('Roth goal, Roth pace, money put in, growth, planning, What if and Wrapped all count $300', async () => {
    const roth = await account('Roth IRA', 'roth_ira');
    await commitText(roth, FILE);
    const g = (await get('/api/goals?year=2026')).roth;
    expect(g.contributedCents).toBe(30000);
    expect(g.pace.contributedCents).toBe(30000);
    expect((await get('/api/investments')).totals).toMatchObject({ putInCents: 30000, growthCents: 0 });
    const base = await get('/api/planning/baseline?months=3');
    expect(base.rothMonthlyCents * base.monthsUsed).toBe(30000);
    const wi = (await post('/api/what-if/project', { baselineMonths: 3, range: '1y', scenarios: [] })).json();
    expect(wi.rothRules.contributedCents).toBe(30000);
    const w = await get('/api/wrapped?year=2026');
    expect(w.slides.find((s: { kind: string }) => s.kind === 'roth').contributedCents).toBe(30000);
  });
});

// ---------------------------------------------------------------- F-04

describe('F-04: a linked transfer keeps matching amounts', () => {
  const linkedPair = async () => {
    const a = await account('Checking', 'checking');
    const b = await account('Savings', 'savings');
    const o = await addTx({ accountId: a, date: '2026-11-03', amount: '50.00', direction: 'out', description: 'Move', type: 'transfer' });
    const i = await addTx({ accountId: b, date: '2026-11-03', amount: '50.00', direction: 'in', description: 'Move', type: 'transfer' });
    expect((await post(`/api/transactions/${o.id}/link`, { otherId: i.id })).statusCode).toBe(200);
    return { o, i };
  };
  const patch = (id: number, payload: object) => call({ method: 'PATCH', url: `/api/transactions/${id}`, payload });

  it('changing the amount or the direction of one side is refused with "Unlink first"', async () => {
    const { i } = await linkedPair();
    const before = (await get('/api/networth?range=1m')).current.totalCents;
    for (const body of [{ amount: '500.00' }, { direction: 'out' }, { amount: '50.00', direction: 'out' }]) {
      const r = await patch(i.id, body);
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toMatch(/Unlink first/);
    }
    expect((await get(`/api/transactions/${i.id}`)).transaction.amountCents).toBe(5000);
    expect((await get('/api/networth?range=1m')).current.totalCents).toBe(before);
  });

  it('other edits still work, and the same amount sent back unchanged is fine (the edit window sends it)', async () => {
    const { i } = await linkedPair();
    const r = await patch(i.id, { amount: '50.00', direction: 'in', description: 'Savings top-up', notes: 'monthly' });
    expect(r.statusCode).toBe(200);
    expect(r.json().transaction).toMatchObject({ description: 'Savings top-up', notes: 'monthly', amountCents: 5000 });
  });

  it('after Unlink the amount can be changed', async () => {
    const { i } = await linkedPair();
    await post(`/api/transactions/${i.id}/unlink`);
    expect((await patch(i.id, { amount: '45.00' })).statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------- F-06

describe('F-06: month-end bills keep their real day after a short month', () => {
  /** A fresh app whose clock reads Mar 1, 2027, with a monthly $12.99 bill charged on the given days. */
  async function billOn(dates: string[]) {
    const app = await testApp();
    app.clock.advance(Date.UTC(2027, 2, 1, 12) - app.clock.now()); // Mar 1, 2027
    const s = await setupAndLogin(app);
    const c = (opts: InjectOptions) =>
      app.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: s.cookie, 'x-csrf-token': s.csrf } });
    const acct = (await c({ method: 'POST', url: '/api/accounts', payload: { name: 'Checking', type: 'checking' } })).json().account.id;
    for (const date of dates) {
      await c({ method: 'POST', url: '/api/transactions', payload: { accountId: acct, date, amount: '12.99', direction: 'out', description: 'STREAMFLIX', type: 'expense' } });
    }
    const sug = (await c({ method: 'GET', url: '/api/recurring' })).json().suggestions;
    expect(sug).toHaveLength(1);
    const item = (await c({ method: 'POST', url: '/api/recurring/confirm', payload: { key: sug[0].key } })).json().item;
    const dueIn = async (month: string) =>
      ((await c({ method: 'GET', url: `/api/recurring/calendar?month=${month}` })).json().bills as { date: string }[]).map((b) => b.date);
    return { item, c, dueIn };
  }

  it('a bill on the 31st: Feb 28 is followed by Mar 31, Apr 30, May 31', async () => {
    const { item, dueIn } = await billOn(['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
    expect(item.nextDue).toBe('2027-03-31');
    expect(await dueIn('2027-04-01')).toEqual(['2027-04-30']);
    expect(await dueIn('2027-05-01')).toEqual(['2027-05-31']);
  });

  it('a bill on the 30th: Feb 28 is followed by Mar 30, Apr 30, May 30', async () => {
    const { item, dueIn } = await billOn(['2026-11-30', '2026-12-30', '2027-01-30', '2027-02-28']);
    expect(item.nextDue).toBe('2027-03-30');
    expect(await dueIn('2027-04-01')).toEqual(['2027-04-30']);
    expect(await dueIn('2027-05-01')).toEqual(['2027-05-30']);
  });

  it('a bill mid-month is unchanged, and a due date the user typed is kept as typed', async () => {
    const mid = await billOn(['2026-11-15', '2026-12-15', '2027-01-15', '2027-02-15']);
    expect(mid.item.nextDue).toBe('2027-03-15');
    const end = await billOn(['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
    const r = await end.c({ method: 'PATCH', url: `/api/recurring/${end.item.id}`, payload: { nextDue: '2027-03-28' } });
    expect(r.json().item.nextDue).toBe('2027-03-28');
  });
});

describe('F-06: keepBillingDay edge cases (pure)', () => {
  it('handles Apr 30, leap years, quarterly, weekly and charges before the anchor only', async () => {
    const { keepBillingDay, nextDue, occurrencesBetween } = await import('../../server/src/lib/recurring.js');
    // A bill on the 31st after a 30-day month: Apr 30 -> May 31.
    const a = keepBillingDay('2026-04-30', 'monthly', ['2026-02-28', '2026-03-31', '2026-04-30']);
    expect(a).toBe('2026-03-31');
    expect(nextDue(a, 'monthly', '2026-05-01', '2026-04-30')).toBe('2026-05-31');
    // A bill on the 29th in a leap year: Feb 29 is its real day, nothing moves.
    expect(keepBillingDay('2028-02-29', 'monthly', ['2028-01-29', '2028-02-29'])).toBe('2028-02-29');
    // A bill on the 29th in a normal year: Feb 28 -> Mar 29.
    const b = keepBillingDay('2027-02-28', 'monthly', ['2026-12-29', '2027-01-29', '2027-02-28']);
    expect(nextDue(b, 'monthly', '2027-03-01', '2027-02-28')).toBe('2027-03-29');
    // Quarterly on the 31st: Nov 30 -> Feb 28 -> May 31.
    const q = keepBillingDay('2027-02-28', 'quarterly', ['2026-08-31', '2026-11-30', '2027-02-28']);
    expect(occurrencesBetween(q, 'quarterly', '2027-03-01', '2027-08-31')).toEqual(['2027-05-31', '2027-08-31']);
    // Weekly and every-2-weeks are never touched; a date that is not a charge (typed by the user) neither.
    expect(keepBillingDay('2027-02-28', 'weekly', ['2027-01-31', '2027-02-28'])).toBe('2027-02-28');
    expect(keepBillingDay('2027-03-28', 'monthly', ['2027-01-31', '2027-02-28'])).toBe('2027-03-28');
  });
});
