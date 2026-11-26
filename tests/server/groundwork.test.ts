/**
 * V2 Phase 2 groundwork: one shared totals source, category roles, and Fidelity history
 * actions Arc40 does not recognize (flagged, answered by the user, never guessed).
 * All data here is invented. The "unknown" action texts below are made-up placeholders, NOT real
 * Fidelity wording: the point is that ANY unrecognized text is flagged instead of guessed.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';
import { actionKey, classifyAction, maskAccountNumbers, resolveAction } from '../../server/src/lib/fidelity.js';

let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };
const call = (opts: InjectOptions) =>
  t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });
const ok = async (opts: InjectOptions) => {
  const r = await call(opts);
  expect(r.statusCode, r.body).toBeLessThan(300);
  return r.json();
};

beforeEach(async () => {
  t = await testApp();
  auth = await setupAndLogin(t);
});
afterEach(async () => {
  await t.app.close();
});

const account = async (name: string, type: string) => (await ok({ method: 'POST', url: '/api/accounts', payload: { name, type } })).account.id as number;
const catId = async (name: string) =>
  ((await ok({ method: 'GET', url: '/api/categories' })).categories as { id: number; name: string }[]).find((c) => c.name === name)!.id;

const HEADER =
  'Run Date,Action,Symbol,Description,Type,Price ($),Quantity,Commission ($),Fees ($),Accrued Interest ($),Amount ($),Cash Balance ($),Settlement Date';
const FAKE_ACCT = 'Z98765432';
const fidelityFile = (extra: string[] = []) =>
  [
    ',,,,,,,,,,,,',
    HEADER,
    '09/29/2026,YOU BOUGHT PROSPECTUS UNDER SEPARATE COVER FIDELITY 500 INDEX FUND (FXAIX) (Cash),FXAIX,FIDELITY 500 INDEX FUND,Cash,200.00,5,,,,-1000.00,0,09/30/2026',
    '09/28/2026,Electronic Funds Transfer Received (Cash),,No Description,Cash,,0,,,,1000.00,1000.00,',
    ...extra,
    ',,,,,,,,,,,,',
    'Date downloaded 10/31/2026 09:00 am,,,,,,,,,,,,',
  ].join('\n');
// Invented placeholder actions (not Fidelity wording), one carrying a fake account number.
const UNKNOWN_IN = `09/20/2026,EXAMPLE CASH MOVE FROM ${FAKE_ACCT} (Cash),,No Description,Cash,,0,,,,800.00,800.00,`;
const UNKNOWN_IN_KEY = 'EXAMPLE CASH MOVE FROM •••• (CASH)';
const UNKNOWN_ODD = '09/21/2026,EXAMPLE ODD ENTRY (Cash),,No Description,Cash,,0,,,,5.00,805.00,';

const preview = (accountId: number, text: string) => ok({ method: 'POST', url: '/api/import/preview', payload: { accountId, filename: 'h.csv', text } });
const commit = (accountId: number, text: string) => ok({ method: 'POST', url: '/api/import/commit', payload: { accountId, filename: 'h.csv', text } });
const invest = async (accountId: number) => (await ok({ method: 'GET', url: `/api/investments?accountId=${accountId}` })).totals;
const answer = (action: string, treatAs: string) => ok({ method: 'PUT', url: '/api/import/fidelity-actions', payload: { action, treatAs } });
const transferTxs = async (accountId: number) =>
  ((await ok({ method: 'GET', url: `/api/transactions?accountId=${accountId}&type=transfer` })).transactions as { amountCents: number; rawDescription: string }[]);

describe('account-like numbers are masked', () => {
  it('masks long digit runs, keeps short numbers like a fund name', () => {
    expect(maskAccountNumbers('FROM Z98765432 TO 123-456789')).toBe('FROM •••• TO ••••');
    expect(maskAccountNumbers('FIDELITY 500 INDEX FUND')).toBe('FIDELITY 500 INDEX FUND');
    expect(maskAccountNumbers('2026 TAX YEAR 1234')).toBe('2026 TAX YEAR 1234');
    expect(actionKey(`  example   cash move from ${FAKE_ACCT} (Cash) `)).toBe(UNKNOWN_IN_KEY);
  });

  it('recognized actions keep their built-in meaning; an answer only applies to unknown ones', () => {
    expect(classifyAction('Electronic Funds Transfer Received (Cash)')).toBe('transfer_in');
    const answers = new Map([[actionKey('Electronic Funds Transfer Received (Cash)'), 'growth' as const]]);
    expect(resolveAction('Electronic Funds Transfer Received (Cash)', answers).kind).toBe('transfer_in');
    expect(resolveAction('EXAMPLE ODD ENTRY', new Map()).unknown).toBe(true);
    expect(resolveAction('EXAMPLE ODD ENTRY', new Map([['EXAMPLE ODD ENTRY', 'ignore' as const]])).kind).toBeNull();
  });
});

describe('Fidelity actions Arc40 does not recognize', () => {
  it('are flagged in the preview with their (masked) text, never guessed', async () => {
    const b = await account('Brokerage', 'brokerage');
    const p = await preview(b, fidelityFile([UNKNOWN_IN, UNKNOWN_ODD]));
    expect(p.unknownActions).toEqual([
      { action: UNKNOWN_IN_KEY, rows: 1, cashCents: 80000, treatAs: null },
      { action: 'EXAMPLE ODD ENTRY (CASH)', rows: 1, cashCents: 500, treatAs: null },
    ]);
    expect(p.rows.filter((r: { unknownAction?: string }) => r.unknownAction).map((r: { unknownAction: string }) => r.unknownAction)).toEqual([
      UNKNOWN_IN_KEY,
      'EXAMPLE ODD ENTRY (CASH)',
    ]);
    expect(JSON.stringify(p)).not.toContain('98765432');
  });

  it('until answered their cash is growth; answering "money put in" fixes rows already imported', async () => {
    const b = await account('Brokerage', 'brokerage');
    await commit(b, fidelityFile([UNKNOWN_IN]));
    // The account is really worth $1,800 (the $800 that arrived plus the $1,000 transfer).
    await ok({ method: 'POST', url: `/api/accounts/${b}/balances`, payload: { asOf: '2026-10-01', balance: '1800' } });
    const before = await invest(b);
    expect(before.growthCents).toBe(80000); // the unknown $800 wrongly looks like growth
    expect(before.putInCents).toBe(100000); // only the recognized $1,000 transfer

    const r = await answer(`EXAMPLE CASH MOVE FROM ${FAKE_ACCT} (Cash)`, 'transfer_in');
    expect(r).toEqual({ key: UNKNOWN_IN_KEY, rowsUpdated: 1 });
    const after = await invest(b);
    expect(after.putInCents).toBe(180000); // now counted as money put in
    expect(after.growthCents).toBe(0); // and no longer as growth
    const txs = await transferTxs(b);
    expect(txs.map((x) => x.amountCents).sort()).toEqual([100000, 80000].sort());
    expect(txs.find((x) => x.amountCents === 80000)!.rawDescription).toBe(`EXAMPLE CASH MOVE FROM •••• (Cash)`);

    // The preview now shows the answer; re-importing the same file adds nothing.
    const p = await preview(b, fidelityFile([UNKNOWN_IN]));
    expect(p.unknownActions[0].treatAs).toBe('transfer_in');
    expect(p.rows.some((x: { unknownAction?: string }) => x.unknownAction)).toBe(false);
    expect(p.counts.new).toBe(0);
    const again = await commit(b, fidelityFile([UNKNOWN_IN]));
    expect(again.imported).toBe(0);
    expect(await transferTxs(b)).toHaveLength(2);
  });

  it('changing the answer to growth removes the transfer again; transfers never count as income or spending', async () => {
    const b = await account('Brokerage', 'brokerage');
    await commit(b, fidelityFile([UNKNOWN_IN]));
    await answer(UNKNOWN_IN_KEY, 'transfer_in');
    await answer(UNKNOWN_IN_KEY, 'growth');
    expect((await invest(b)).putInCents).toBe(100000);
    expect(await transferTxs(b)).toHaveLength(1);
    const cf = await ok({ method: 'GET', url: '/api/cashflow?months=12' });
    expect(cf.ytd.incomeCents).toBe(0);
    expect(cf.ytd.spendingCents).toBe(0);
  });

  it('a later import uses the remembered answer; "ignore" skips the row and removes imported copies', async () => {
    const b = await account('Brokerage', 'brokerage');
    await answer('EXAMPLE CASH MOVE FROM 11111111 (Cash)', 'transfer_out'); // same key: digits are masked
    await commit(b, fidelityFile([UNKNOWN_IN, UNKNOWN_ODD]));
    expect((await invest(b)).putInCents).toBe(100000 - 80000);

    const r = await answer('EXAMPLE ODD ENTRY (Cash)', 'ignore');
    expect(r.rowsUpdated).toBe(1);
    const p = await preview(b, fidelityFile([UNKNOWN_IN, UNKNOWN_ODD]));
    expect(p.skipped.map((s: { reason: string }) => s.reason)).toContain('Ignored, as you chose: "EXAMPLE ODD ENTRY (CASH)"');
    const activity = (await ok({ method: 'GET', url: `/api/investments?accountId=${b}` })).activity as { amountCents: number }[];
    expect(activity.some((a) => a.amountCents === 500)).toBe(false);
  });

  it('undoing the import also removes a transfer created by an answer', async () => {
    const b = await account('Brokerage', 'brokerage');
    const c = await commit(b, fidelityFile([UNKNOWN_IN]));
    await answer(UNKNOWN_IN_KEY, 'transfer_in');
    expect(await transferTxs(b)).toHaveLength(2);
    await ok({ method: 'DELETE', url: `/api/import/batches/${c.batchId}` });
    expect(await transferTxs(b)).toHaveLength(0);
  });

  it('the fake account number is never stored', async () => {
    const b = await account('Brokerage', 'brokerage');
    await commit(b, fidelityFile([UNKNOWN_IN]));
    await answer(UNKNOWN_IN_KEY, 'transfer_in');
    const db = t.store.current();
    for (const [table, col] of [
      ['investment_activity', 'raw_action'],
      ['transactions', 'raw_description'],
      ['fidelity_action_rules', 'action_key'],
    ]) {
      const rows = db.prepare(`SELECT ${col} AS v FROM ${table}`).all() as { v: string }[];
      expect(rows.some((x) => x.v.includes('98765432')), table).toBe(false);
    }
  });

  it('answers are validated', async () => {
    expect((await call({ method: 'PUT', url: '/api/import/fidelity-actions', payload: { action: 'X', treatAs: 'income' } })).statusCode).toBe(400);
    expect((await call({ method: 'PUT', url: '/api/import/fidelity-actions', payload: { action: '', treatAs: 'growth' } })).statusCode).toBe(400);
    expect((await call({ method: 'PUT', url: '/api/import/fidelity-actions', payload: { action: 'x'.repeat(301), treatAs: 'growth' } })).statusCode).toBe(400);
    await answer('EXAMPLE ODD ENTRY', 'growth');
    expect((await ok({ method: 'GET', url: '/api/import/fidelity-actions' })).answers).toMatchObject([{ action: 'EXAMPLE ODD ENTRY', treatAs: 'growth' }]);
  });

  it('the real-layout fixtures have no unknown actions', async () => {
    const b = await account('Brokerage', 'brokerage');
    const r = await account('Roth', 'roth_ira');
    for (const [id, f] of [[b, 'fidelity-brokerage.csv'], [r, 'fidelity-roth.csv']] as const) {
      const p = await preview(id, fs.readFileSync(path.resolve('tests/fixtures/csv', f), 'utf8'));
      expect(p.unknownActions, f).toEqual([]);
    }
  });
});

describe('category roles: renaming a category never breaks a total', () => {
  it('renamed refereeing pay and costs still feed the gig card and the payer chart', async () => {
    const a = await account('Checking', 'checking');
    const ref = await catId('Refereeing');
    const gear = await catId('Ref Gear & Fees');
    const tx = (payload: object) => ok({ method: 'POST', url: '/api/transactions', payload: { accountId: a, description: 'x', ...payload } });
    await tx({ date: '2026-10-01', amount: '300', direction: 'in', type: 'income', categoryId: ref, payer: 'Fake League' });
    await tx({ date: '2026-10-02', amount: '40', direction: 'out', type: 'expense', categoryId: gear });
    const gigBefore = (await ok({ method: 'GET', url: '/api/cashflow' })).gig;
    const payBefore = (await ok({ method: 'GET', url: '/api/dashboard' })).incomeByPayer;
    expect(gigBefore).toMatchObject({ payCents: 30000, costsCents: 4000 });
    expect(payBefore).toEqual([{ payer: 'Fake League', cents: 30000 }]);

    await ok({ method: 'PATCH', url: `/api/categories/${ref}`, payload: { name: 'Game Pay' } });
    await ok({ method: 'PATCH', url: `/api/categories/${gear}`, payload: { name: 'Whistles' } });
    expect((await ok({ method: 'GET', url: '/api/cashflow' })).gig).toEqual(gigBefore);
    expect((await ok({ method: 'GET', url: '/api/dashboard' })).incomeByPayer).toEqual(payBefore);
  });
});

describe('one shared totals source', () => {
  it('no server file adds up income or spending with its own SQL', () => {
    const dir = path.resolve('server/src');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(dir);
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith(path.join('lib', 'totals.ts'))) continue;
      const src = fs.readFileSync(f, 'utf8');
      // Every SQL string (template literal or quoted) that filters on income/expense must read money_lines.
      for (const m of src.matchAll(/`[^`]*`|"[^"\n]*"/g)) {
        const sql = m[0];
        if (/type\s*(=|IN)\s*\(?\s*'(income|expense)'/i.test(sql) && /SUM\s*\(/i.test(sql) && !sql.includes('money_lines')) {
          offenders.push(`${path.relative(dir, f)}: ${sql.slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
