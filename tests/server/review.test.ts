/**
 * v1 review tests (fake data only).
 *
 * Two kinds of tests live here:
 *  - Regression tests: behavior that is correct today and must stay that way.
 *  - Former KNOWN BUG tests (the three v1 known issues). They were fixed in V2 Phase 2
 *    and are now normal regression tests. A future known bug can again be documented
 *    with `it.fails`, which asserts the CORRECT behavior and passes once fixed.
 */
import type { InjectOptions } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { HOST_HEADER, cookieFrom, setupAndLogin, testApp } from './helpers.js';
import { buildApp } from '../../server/src/app.js';
import { openDatabase } from '../../server/src/db/database.js';
import { listBackups } from '../../server/src/lib/backup.js';
import { escapeHtml } from '../../web/src/lib/format.js';
import { parseCsv, CsvError } from '../../server/src/lib/csv.js';
import { applyMapping, parseBankDate, suggestMapping } from '../../server/src/lib/importMapping.js';
import { parseMoneyToCents, formatCents, sumCents } from '../../shared/money.js';
import { savingsRateBp, totals } from '../../server/src/lib/cashflow.js';
import { findTransferPairs, pairKey } from '../../server/src/lib/transfers.js';

let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };

beforeEach(async () => {
  t = await testApp();
  const s = await setupAndLogin(t);
  auth = { cookie: s.cookie, csrf: s.csrf };
});

const call = (opts: InjectOptions) =>
  t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });

async function account(name: string, type = 'checking'): Promise<number> {
  return (await call({ method: 'POST', url: '/api/accounts', payload: { name, institution: 'Fake Bank', type } })).json().account.id;
}
const commit = (accountId: number, text: string, filename = 'fake.csv') =>
  call({ method: 'POST', url: '/api/import/commit', payload: { accountId, filename, text } });
const preview = (accountId: number, text: string) =>
  call({ method: 'POST', url: '/api/import/preview', payload: { accountId, filename: 'fake.csv', text } });
const rows = () =>
  t.db.prepare('SELECT id, account_id, date, amount_cents, description, type, category_id, transfer_group_id FROM transactions ORDER BY id').all() as {
    id: number;
    account_id: number;
    date: string;
    amount_cents: number;
    description: string;
    type: string;
    category_id: number | null;
    transfer_group_id: number | null;
  }[];
const catId = async (name: string) =>
  ((await call({ method: 'GET', url: '/api/categories' })).json().categories as { id: number; name: string }[]).find((c) => c.name === name)!.id;

// ---------------------------------------------------------------- money

describe('money parsing and formatting', () => {
  it.each([
    ['1,234.56', 123456],
    ['$1,234.56', 123456],
    ['(12.34)', -1234],
    ['12.34-', -1234],
    ['-$0.00', 0],
    [' 5 ', 500],
    ['.5', 50],
    ['12.', 1200],
    ['00012.00', 1200],
    ['9999999999999.99', 999999999999999],
  ])('parses %s as %i cents', (text, cents) => {
    expect(parseMoneyToCents(text)).toBe(cents);
  });

  it.each(['1.234,56', '12.34 CR', '1e3', '0x10', '1,23', '5.555', '--5', '-(5)', '', 'abc', '99999999999999'])(
    'rejects %s instead of guessing',
    (text) => {
      expect(() => parseMoneyToCents(text)).toThrow();
    },
  );

  it('never produces negative zero', () => {
    expect(Object.is(parseMoneyToCents('-0.00'), -0)).toBe(false);
    expect(Object.is(parseMoneyToCents('(0.00)'), -0)).toBe(false);
  });

  it('adds cents exactly where floats would drift', () => {
    // 0.1 + 0.2 !== 0.3 in floating point; in cents it is exact.
    expect(sumCents([10, 20])).toBe(30);
    expect(sumCents(Array(1000).fill(parseMoneyToCents('0.01')))).toBe(1000);
    expect(formatCents(sumCents([parseMoneyToCents('19.99'), parseMoneyToCents('0.01')]))).toBe('$20.00');
    expect(() => sumCents([0.1, 0.2])).toThrow();
  });

  it('formats negatives, signs and large numbers', () => {
    expect(formatCents(-123456)).toBe('-$1,234.56');
    expect(formatCents(5, { sign: true })).toBe('+$0.05');
    expect(formatCents(0, { sign: true })).toBe('$0.00');
    expect(formatCents(100000000)).toBe('$1,000,000.00');
  });
});

describe('savings rate math', () => {
  it('no income is null, never 0% and never a division by zero', () => {
    expect(savingsRateBp(0, 5000)).toBeNull();
    expect(savingsRateBp(-100, 0)).toBeNull();
  });
  it('spending above income gives a negative rate', () => {
    expect(savingsRateBp(10000, 15000)).toBe(-5000);
  });
  it('rounds to the nearest basis point, half away from zero', () => {
    expect(savingsRateBp(3, 1)).toBe(6667); // 66.666...%
    expect(savingsRateBp(3, 5)).toBe(-6667);
  });
  it('transfers and gifts never count; refunds lower spending', () => {
    const tx = (amountCents: number, type: 'income' | 'expense' | 'transfer' | 'gift') => ({ date: '2026-11-01', amountCents, type, categoryId: null });
    const r = totals([tx(10000, 'income'), tx(-3000, 'expense'), tx(500, 'expense'), tx(-50000, 'transfer'), tx(19000, 'gift')]);
    expect(r).toEqual({ incomeCents: 10000, spendingCents: 2500, giftCents: 19000 });
  });
});

// ---------------------------------------------------------------- CSV parsing

describe('messy CSV files', () => {
  const messy =
    '﻿Date,Description,Amount,Balance\r\n' +
    '11/03/2026,"ACME, INC ""BEST""",-10.00,90.00\r\n' +
    '\r\n' +
    ',,,\r\n' +
    '11/02/2026,"multi\nline",-5.00,100.00\r\n' +
    '11/01/2026,DEPOSIT,"1,000.00",105.00\r\n' +
    '11/01/2026,BAD AMOUNT,12.345,0\r\n' +
    'not a date,X,1,1\r\n' +
    'Downloaded 11/04/2026\r\n';

  it('handles BOM, CRLF, quoted commas, escaped quotes, multi-line cells, blank and footer rows', () => {
    const parsed = parseCsv(messy);
    const { parsed: ok, skipped } = applyMapping(parsed, suggestMapping(parsed, 0));
    expect(ok.map((r) => [r.date, r.amountCents, r.description])).toEqual([
      ['2026-11-03', -1000, 'ACME, INC "BEST"'],
      ['2026-11-02', -500, 'multi line'],
      ['2026-11-01', 100000, 'DEPOSIT'],
    ]);
    // Bad rows are reported with their spreadsheet row number (a multi-line cell is one row),
    // never guessed or silently dropped.
    expect(skipped).toEqual([
      { line: 7, reason: 'The amount is not a valid number' },
      { line: 8, reason: '"not a date" is not a date' },
    ]);
  });

  it('refuses a cut-off file and binary files', () => {
    expect(() => parseCsv('a,"b\n')).toThrow(CsvError);
    expect(() => parseCsv('a,b\u0000c\n')).toThrow(CsvError);
  });

  it.each([
    ['11/1/26', 'MDY', '2026-11-01'],
    ['2026-11-01T00:00:00', 'YMD', '2026-11-01'],
    ['1.11.2026', 'DMY', '2026-11-01'],
    ['02/29/2028', 'MDY', '2028-02-29'],
    ['02/30/2026', 'MDY', null],
    ['13/01/2026', 'MDY', null],
    ['Nov 1, 2026', 'MDY', null],
  ] as const)('date %s (%s) -> %s', (text, fmt, iso) => {
    expect(parseBankDate(text, fmt)).toBe(iso);
  });

  it('debit/credit columns: a negative debit is still money out; both filled is reported', () => {
    const p = parseCsv('Date,Description,Debit,Credit\n11/02/2026,NEG DEBIT,-5.00,\n11/03/2026,PAY,,7.00\n11/04/2026,BOTH,5.00,5.00\n');
    const r = applyMapping(p, suggestMapping(p, 0));
    expect(r.parsed.map((x) => x.amountCents)).toEqual([-500, 700]);
    expect(r.skipped).toEqual([{ line: 4, reason: 'Both money-out and money-in are filled in' }]);
  });
});

// ---------------------------------------------------------------- import end to end

describe('import', () => {
  const file1 = 'Date,Description,Amount\n11/01/2026,COFFEE SHOP,-4.50\n11/01/2026,COFFEE SHOP,-4.50\n11/02/2026,"BOOKS, USED",-20.00\n';

  it('importing the same file twice adds nothing the second time', async () => {
    const a = await account('Checking');
    expect((await commit(a, file1)).json().imported).toBe(3);
    const again = await preview(a, file1);
    expect(again.json().alreadyImported).not.toBeNull();
    expect((await commit(a, file1)).json()).toMatchObject({ imported: 0, duplicates: 3 });
    expect(rows()).toHaveLength(3);
  });

  it('keeps two genuinely identical charges, and an overlapping file only adds the new rows', async () => {
    const a = await account('Checking');
    await commit(a, file1);
    const overlap = 'Date,Description,Amount\n11/01/2026,COFFEE SHOP,-4.50\n11/01/2026,COFFEE SHOP,-4.50\n11/01/2026,COFFEE SHOP,-4.50\n11/03/2026,GAS,-30.00\n';
    expect((await commit(a, overlap)).json()).toMatchObject({ imported: 2, duplicates: 2 });
    expect(rows().filter((r) => r.description === 'COFFEE SHOP')).toHaveLength(3);
  });

  it('the same file into a different account is not treated as a duplicate', async () => {
    const a = await account('Checking');
    const b = await account('Other Checking');
    await commit(a, file1);
    expect((await commit(b, file1)).json().imported).toBe(3);
  });

  it('undo removes exactly what the import added', async () => {
    const a = await account('Checking');
    const res = (await commit(a, file1)).json();
    await call({ method: 'POST', url: '/api/transactions', payload: { accountId: a, date: '2026-11-01', amount: '1', direction: 'out', description: 'manual', type: 'expense' } });
    await call({ method: 'DELETE', url: `/api/import/batches/${res.batchId}` });
    expect(rows().map((r) => r.description)).toEqual(['manual']);
  });

  it('a refund typed as expense lowers spending in the transaction sums', async () => {
    const a = await account('Checking');
    await commit(a, 'Date,Description,Amount\n11/01/2026,KROGER,-50.00\n11/03/2026,KROGER RETURN,20.00\n');
    const refund = rows().find((r) => r.amount_cents === 2000)!;
    await call({ method: 'PATCH', url: `/api/transactions/${refund.id}`, payload: { type: 'expense', categoryId: await catId('Food') } });
    const sums = (await call({ method: 'GET', url: '/api/transactions' })).json().sums;
    expect(sums).toMatchObject({ incomeCents: 0, spendingCents: 3000 });
  });

  it('CSV text with HTML or formulas is stored as plain text', async () => {
    const a = await account('Checking');
    await commit(a, 'Date,Description,Amount\n11/01/2026,"<img src=x onerror=alert(1)>",-1.00\n11/02/2026,"=HYPERLINK(""x"")",-2.00\n');
    expect(rows().map((r) => r.description)).toEqual(['<img src=x onerror=alert(1)>', '=HYPERLINK("x")']);
  });

  it('search with SQL-looking text is just text', async () => {
    const a = await account('Checking');
    await commit(a, file1);
    for (const q of ["' OR 1=1 --", '%', '_', "'; DROP TABLE transactions; --"]) {
      const r = await call({ method: 'GET', url: `/api/transactions?q=${encodeURIComponent(q)}` });
      expect(r.statusCode).toBe(200);
      expect(r.json().total).toBe(0);
    }
    expect(rows()).toHaveLength(3);
  });

  it('refunds lower spending; tax refunds, Zelle, interest and pay stay income', async () => {
    const a = await account('Checking');
    await commit(
      a,
      'Date,Description,Amount\n11/01/2026,KROGER #100,-50.00\n11/02/2026,KROGER #100 RETURN,20.00\n' +
        '11/03/2026,IRS TREAS 310 TAX REF,300.00\n11/04/2026,ZELLE FROM FRIEND,15.00\n11/05/2026,INTEREST PAID,0.42\n11/06/2026,REF ASSIGNING CO PAYROLL,85.00\n',
    );
    const byDesc = Object.fromEntries(rows().map((r) => [r.description, r]));
    expect(byDesc['KROGER #100 RETURN']).toMatchObject({ type: 'expense', category_id: await catId('Food') });
    expect(byDesc['IRS TREAS 310 TAX REF']).toMatchObject({ type: 'income' });
    expect(byDesc['ZELLE FROM FRIEND']).toMatchObject({ type: 'income' });
    expect(byDesc['INTEREST PAID']).toMatchObject({ type: 'income', category_id: await catId('Interest') });
    expect(byDesc['REF ASSIGNING CO PAYROLL']).toMatchObject({ type: 'income' });
    const sums = (await call({ method: 'GET', url: '/api/transactions' })).json().sums;
    expect(sums).toMatchObject({ spendingCents: 3000, incomeCents: 30000 + 1500 + 42 + 8500 });
  });

  it('your own money-in rule still beats the refund guess', async () => {
    const a = await account('Checking');
    await call({ method: 'POST', url: '/api/rules', payload: { matchType: 'contains', pattern: 'KROGER', direction: 'in', setType: 'gift', setGiftFrom: 'Mom' } });
    await commit(a, 'Date,Description,Amount\n11/02/2026,KROGER GIFT CARD,20.00\n');
    expect(rows()[0]).toMatchObject({ type: 'gift', category_id: null });
  });

  it('a $0.00 row is skipped and reported, never saved as a $0 transaction', async () => {
    const a = await account('Checking');
    const r = (await commit(a, 'Date,Description,Amount\n11/01/2026,STATEMENT NOTE,0.00\n11/02/2026,LUNCH,-8.00\n')).json();
    expect(r).toMatchObject({ imported: 1, skipped: 1 });
  });

  it('a store refund (money in from a merchant with a spending rule) is imported as a refund in that category', async () => {
    const a = await account('Checking');
    await commit(a, 'Date,Description,Amount\n11/03/2026,KROGER #100 REFUND,20.00\n');
    expect(rows()[0]).toMatchObject({ type: 'expense', category_id: await catId('Food') });
  });
});

// ---------------------------------------------------------------- manual entry

describe('manual entry validation', () => {
  const base = { date: '2026-11-05', amount: '10', direction: 'out', description: 'Lunch', type: 'expense' };
  const post = async (patch: object) => {
    const accountId = await account('Checking');
    return call({ method: 'POST', url: '/api/transactions', payload: { ...base, accountId, ...patch } });
  };

  it.each([
    ['empty description', { description: '   ' }, 'Add a short description.'],
    ['text amount', { amount: 'abc' }, 'Enter an amount like 25.00.'],
    ['zero amount', { amount: '0.00' }, 'Enter an amount above zero.'],
    ['too-large amount', { amount: '99999999999999' }, 'Enter an amount like 25.00.'],
    ['impossible date', { date: '2026-02-30' }, 'Pick a valid date.'],
    ['US-style date', { date: '11/05/2026' }, 'Pick a valid date.'],
    ['future date', { date: '2027-01-01' }, 'That date is in the future.'],
    ['missing account', { accountId: 99999 }, 'Pick an account.'],
  ])('rejects %s with a plain message', async (_name, patch, message) => {
    const r = await post(patch);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe(message);
    expect(rows()).toHaveLength(0);
  });

  it.each([
    ['description', { description: 'x'.repeat(201) }, 200],
    ['notes', { notes: 'x'.repeat(501) }, 500],
    ['gift from', { type: 'gift', giftFrom: 'x'.repeat(61) }, 60],
  ])('too-long %s gets a plain message', async (_name, patch, max) => {
    const r = await post(patch);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe(`That is too long. Keep it to ${max} characters or fewer.`);
  });

  it.each([
    ['money as a JSON number', { amount: 10 }],
    ['unknown type', { type: 'loan' }],
  ])('rejects %s', async (_name, patch) => {
    expect((await post(patch)).statusCode).toBe(400);
    expect(rows()).toHaveLength(0);
  });

  it('the direction decides the sign, whatever sign was typed', async () => {
    expect((await post({ amount: '-10', direction: 'out' })).json().transaction.amountCents).toBe(-1000);
  });

  it('a category of the wrong kind is dropped, not stored', async () => {
    const r = await post({ categoryId: await catId('Refereeing') });
    expect(r.json().transaction.categoryId).toBeNull();
  });

  it('keeps unicode text exactly', async () => {
    expect((await post({ description: 'café ☕ 日本' })).json().transaction.description).toBe('café ☕ 日本');
  });

  it('a non-number limit in the transactions URL is a plain 400, not a crash', async () => {
    const r = await call({ method: 'GET', url: '/api/transactions?limit=abc' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('The page size must be a whole number.');
    for (const url of ['/api/transactions?offset=-1', '/api/transactions?accountId=1e3', '/api/transactions?categoryId=x']) {
      expect((await call({ method: 'GET', url })).statusCode, url).toBe(400);
    }
    expect((await call({ method: 'GET', url: '/api/transactions?categoryId=none&limit=5&offset=0' })).statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------- security

describe('login is required for every API route', () => {
  it.each(['/%61pi/accounts', '/%61%70%69/accounts', '/%61pi/export', '/api/%61ccounts', '/%61pi/settings'])(
    'a URL-encoded path (%s) still needs a login',
    async (url) => {
      const anon = await t.app.inject({ method: 'GET', url, headers: HOST_HEADER });
      expect(anon.statusCode).toBe(401);
    },
  );

  it('a malformed percent-encoding is refused, not crashed on', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/%E0%A4%A/accounts', headers: HOST_HEADER });
    expect(r.statusCode).toBeLessThan(500);
  });

  it('public routes still work through an encoded path, and logged-in encoded paths work', async () => {
    const status = await t.app.inject({ method: 'GET', url: '/%61pi/auth/status', headers: HOST_HEADER });
    expect(status.statusCode).toBe(200);
    expect((await call({ method: 'GET', url: '/%61pi/accounts' })).statusCode).toBe(200);
  });

  it('a URL-encoded path does not skip the CSRF check on changes', async () => {
    const id = await account('Checking');
    // Logged in, but no CSRF token: must be refused.
    const r = await t.app.inject({ method: 'DELETE', url: `/%61pi/accounts/${id}`, headers: { ...HOST_HEADER, cookie: auth.cookie } });
    expect(r.statusCode).toBe(403);
  });

  it('the normal path still requires login', async () => {
    const anon = await t.app.inject({ method: 'GET', url: '/api/accounts', headers: HOST_HEADER });
    expect(anon.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------- transfers

describe('transfer links', () => {
  it('findTransferPairs skips blocked pairs and picks the next best one', () => {
    const c = (id: number, accountId: number, date: string, amountCents: number, type: 'transfer' | 'income') =>
      ({ id, accountId, date, amountCents, type, transferGroupId: null });
    const cands = [c(1, 1, '2026-11-01', -5000, 'transfer'), c(2, 2, '2026-11-01', 5000, 'income'), c(3, 3, '2026-11-02', 5000, 'transfer')];
    expect(findTransferPairs(cands)).toEqual([[1, 2]]);
    expect(findTransferPairs(cands, 3, new Set([pairKey(2, 1)]))).toEqual([[1, 3]]);
  });

  async function wronglyLinkedPair() {
    const chk = await account('Checking');
    const sav = await account('Savings', 'savings');
    // A $50 Zelle from a friend lands in savings two days after an unrelated $50 transfer out of checking.
    await commit(sav, 'Date,Description,Amount\n11/03/2026,ZELLE FROM FRIEND,50.00\n', 's.csv');
    await commit(chk, 'Date,Description,Amount\n11/01/2026,ONLINE TRANSFER TO VENMO,-50.00\n', 'c1.csv');
    const zelle = rows().find((r) => r.description.includes('ZELLE'))!;
    expect(zelle.transfer_group_id).not.toBeNull(); // auto-linked (wrongly)
    return { chk, zelle };
  }

  it('unlinking restores the original type', async () => {
    const { zelle } = await wronglyLinkedPair();
    await call({ method: 'POST', url: `/api/transactions/${zelle.id}/unlink`, payload: {} });
    expect(rows().find((r) => r.id === zelle.id)).toMatchObject({ type: 'income', transfer_group_id: null });
  });

  it('an unlinked pair stays unlinked after the next, unrelated import', async () => {
    const { chk, zelle } = await wronglyLinkedPair();
    await call({ method: 'POST', url: `/api/transactions/${zelle.id}/unlink`, payload: {} });
    await commit(chk, 'Date,Description,Amount\n11/05/2026,KROGER,-12.00\n', 'c2.csv');
    expect(rows().find((r) => r.id === zelle.id)).toMatchObject({ type: 'income', transfer_group_id: null });
  });

  it('re-typing a linked transfer as income sticks after the next import', async () => {
    const { chk, zelle } = await wronglyLinkedPair();
    await call({ method: 'PATCH', url: `/api/transactions/${zelle.id}`, payload: { type: 'income' } });
    await commit(chk, 'Date,Description,Amount\n11/05/2026,KROGER,-12.00\n', 'c2.csv');
    expect(rows().find((r) => r.id === zelle.id)).toMatchObject({ type: 'income', transfer_group_id: null });
  });

  it('linking the same pair by hand still works after unlinking it', async () => {
    const { zelle } = await wronglyLinkedPair();
    const venmo = rows().find((r) => r.description.includes('VENMO'))!;
    await call({ method: 'POST', url: `/api/transactions/${zelle.id}/unlink`, payload: {} });
    const r = await call({ method: 'POST', url: `/api/transactions/${venmo.id}/link`, payload: { otherId: zelle.id } });
    expect(r.statusCode).toBe(200);
    expect(rows().find((x) => x.id === zelle.id)!.transfer_group_id).not.toBeNull();
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM transfer_link_blocks').get()).toEqual({ n: 0 });
  });

  it('a blocked transfer can still pair with a different, correct other side', async () => {
    const { zelle } = await wronglyLinkedPair();
    const venmo = rows().find((r) => r.description.includes('VENMO'))!;
    await call({ method: 'POST', url: `/api/transactions/${zelle.id}/unlink`, payload: {} });
    const other = await account('Venmo', 'cash');
    await commit(other, 'Date,Description,Amount\n11/01/2026,TRANSFER FROM BANK,50.00\n', 'v.csv');
    const arrived = rows().find((r) => r.account_id === other)!;
    expect(rows().find((r) => r.id === venmo.id)!.transfer_group_id).toBe(Math.min(venmo.id, arrived.id));
    expect(rows().find((r) => r.id === zelle.id)).toMatchObject({ type: 'income', transfer_group_id: null });
  });

  it('deleting a transaction removes its blocks', async () => {
    const { zelle } = await wronglyLinkedPair();
    await call({ method: 'POST', url: `/api/transactions/${zelle.id}/unlink`, payload: {} });
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM transfer_link_blocks').get()).toEqual({ n: 1 });
    await call({ method: 'DELETE', url: `/api/transactions/${zelle.id}` });
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM transfer_link_blocks').get()).toEqual({ n: 0 });
  });

  it('deleting an account clears the link on the other half of its transfers', async () => {
    const a = await account('Old Checking');
    const b = await account('Savings', 'savings');
    const mk = async (accountId: number, direction: string) =>
      (await call({ method: 'POST', url: '/api/transactions', payload: { accountId, date: '2026-11-05', amount: '100', direction, description: 'TRANSFER', type: 'transfer' } })).json().transaction.id;
    const out = await mk(a, 'out');
    const inn = await mk(b, 'in');
    await call({ method: 'POST', url: `/api/transactions/${out}/link`, payload: { otherId: inn } });
    await call({ method: 'DELETE', url: `/api/accounts/${a}` });
    expect(rows().find((r) => r.id === inn)!.transfer_group_id).toBeNull();
  });

  it('deleting an account saves a safety backup first', async () => {
    const a = await account('Old Checking');
    expect(listBackups(t.config.backupDir)).toHaveLength(0);
    expect((await call({ method: 'DELETE', url: `/api/accounts/${a}` })).statusCode).toBe(200);
    const backups = listBackups(t.config.backupDir);
    expect(backups).toHaveLength(1);
    // The backup still has the account that was just deleted.
    const copy = new DatabaseSync(backups[0]!.path, { readOnly: true });
    expect(copy.prepare('SELECT name FROM accounts').all()).toEqual([{ name: 'Old Checking' }]);
    copy.close();
  });

  it('if the safety backup fails, nothing is deleted', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-test-'));
    const notAFolder = path.join(dir, 'file');
    fs.writeFileSync(notAFolder, 'x');
    const db = openDatabase(':memory:');
    const { app } = await buildApp({ db, now: () => Date.UTC(2026, 10, 11, 12), webDistDir: '/nonexistent', port: 4040, backupDir: notAFolder });
    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: HOST_HEADER, payload: { password: 'long enough pw' } });
    const h = { ...HOST_HEADER, cookie: cookieFrom(setup), 'x-csrf-token': setup.json().csrfToken };
    const id = (await app.inject({ method: 'POST', url: '/api/accounts', headers: h, payload: { name: 'Keep me', institution: 'X', type: 'checking' } })).json().account.id;
    const r = await app.inject({ method: 'DELETE', url: `/api/accounts/${id}`, headers: h });
    expect(r.statusCode).toBe(500);
    expect(r.json().error).toMatch(/nothing was deleted/);
    expect(db.prepare('SELECT name FROM accounts').all()).toEqual([{ name: 'Keep me' }]);
  });
});

// ---------------------------------------------------------------- categories

describe('category renames', () => {
  it('renaming "Refereeing" keeps the Roth earned-income reference (categories have a role)', async () => {
    const a = await account('Checking');
    const ref = await catId('Refereeing');
    await call({ method: 'POST', url: '/api/transactions', payload: { accountId: a, date: '2026-11-01', amount: '300', direction: 'in', description: 'Game pay', type: 'income', categoryId: ref } });
    const before = (await call({ method: 'GET', url: '/api/goals?year=2026' })).json().roth.earnedIncomeCents;
    expect(before).toBe(30000);
    await call({ method: 'PATCH', url: `/api/categories/${ref}`, payload: { name: 'Ref Pay' } });
    const after = (await call({ method: 'GET', url: '/api/goals?year=2026' })).json().roth.earnedIncomeCents;
    expect(after).toBe(30000);
  });
});

// ---------------------------------------------------------------- chart tooltips

describe('chart tooltip text', () => {
  it('escapeHtml turns names into plain text', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(escapeHtml("Tom & Jerry's")).toBe('Tom &amp; Jerry&#39;s');
    expect(escapeHtml('FXAIX')).toBe('FXAIX');
  });

  it('every tooltip name in charts.ts goes through escapeHtml', () => {
    const src = fs.readFileSync(path.resolve('web/src/lib/charts.ts'), 'utf8');
    // Raw ${x.name} / ${x.seriesName} inside an HTML tooltip would render as HTML.
    const raw = src.split('\n').filter((l) => /<div|<span/.test(l) && /\$\{[\w.!\[\]]*\.(name|seriesName)\}/.test(l));
    expect(raw).toEqual([]);
  });
});
