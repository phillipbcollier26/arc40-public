import fs from 'node:fs';
import path from 'node:path';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';

const fixture = (name: string) => fs.readFileSync(path.resolve('tests/fixtures/csv', name), 'utf8');

let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };
let ids: Record<string, number>;

const call = (opts: InjectOptions) =>
  t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });

async function account(name: string, type: string) {
  const res = await call({ method: 'POST', url: '/api/accounts', payload: { name, type } });
  return res.json().account.id as number;
}

const preview = (accountId: number, file: string, extra: object = {}) =>
  call({ method: 'POST', url: '/api/import/preview', payload: { accountId, filename: file, text: fixture(file), ...extra } });
const commit = async (accountId: number, file: string) => {
  const res = await call({ method: 'POST', url: '/api/import/commit', payload: { accountId, filename: file, text: fixture(file) } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};
const txs = async (query = '') => (await call({ method: 'GET', url: `/api/transactions?limit=500${query}` })).json();
const catId = async (name: string) =>
  ((await call({ method: 'GET', url: '/api/categories' })).json().categories as { id: number; name: string }[]).find((c) => c.name === name)!.id;

beforeEach(async () => {
  t = await testApp();
  const s = await setupAndLogin(t);
  auth = { cookie: s.cookie, csrf: s.csrf };
  ids = {
    wpcuChecking: await account('Credit Union Checking', 'checking'),
    wpcuSavings: await account('Credit Union Savings', 'savings'),
    cfChecking: await account('Bank Checking', 'checking'),
    cfSavings: await account('Bank Savings', 'savings'),
    brokerage: await account('Fidelity Brokerage', 'brokerage'),
    roth: await account('Fidelity Roth IRA', 'roth_ira'),
  };
});
afterEach(async () => {
  await t.app.close();
});

describe('preview', () => {
  it('recognizes the bank, shows what will happen, and saves nothing', async () => {
    const res = await preview(ids.wpcuChecking!, 'wpcu-checking.csv');
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p).toMatchObject({ format: 'generic', preset: 'Wright-Patt Credit Union', mappingSource: 'preset', mappingProblem: null });
    expect(p.counts).toEqual({ total: 8, new: 7, duplicate: 0, skipped: 1 });
    expect(p.balancesFound).toBe(7);
    expect(p.rows[0]).toMatchObject({ description: 'Spotify USA NY', amountCents: -1199, type: 'expense', status: 'new' });
    expect((await txs()).total).toBe(0);
  });

  it('a Fidelity file needs no mapping', async () => {
    const p = (await preview(ids.roth!, 'fidelity-roth.csv')).json();
    expect(p).toMatchObject({ format: 'fidelity', mapping: null });
    expect(p.rows.filter((r: { type: string | null }) => r.type === 'transfer')).toHaveLength(2);
  });

  it('refuses a Fidelity file in a bank account, with a clear message', async () => {
    const res = await preview(ids.wpcuChecking!, 'fidelity-roth.csv');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Roth IRA or brokerage/);
  });

  it.each([
    ['', /empty/],
    ['PK\u0003\u0004\u0000binary', /CSV/],
    ['just one line', /empty/],
  ])('rejects malformed file %#', async (text, msg) => {
    const res = await call({ method: 'POST', url: '/api/import/preview', payload: { accountId: ids.wpcuChecking, filename: 'x.csv', text } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(msg);
  });

  it('reports a mapping problem instead of importing garbage', async () => {
    const res = await preview(ids.wpcuChecking!, 'wpcu-checking.csv', {
      mapping: { headerRow: 3, dateColumn: 'Missing', dateFormat: 'MDY', descriptionColumns: ['Memo'], amountMode: 'single', amountColumn: 'Balance' },
    });
    expect(res.json().mappingProblem).toMatch(/date/);
    const c = await call({
      method: 'POST',
      url: '/api/import/commit',
      payload: {
        accountId: ids.wpcuChecking,
        filename: 'x.csv',
        text: fixture('wpcu-checking.csv'),
        mapping: { headerRow: 3, dateColumn: 'Missing', dateFormat: 'MDY', descriptionColumns: ['Memo'], amountMode: 'single', amountColumn: 'Balance' },
      },
    });
    expect(c.statusCode).toBe(400);
  });

  it('needs login and the CSRF token', async () => {
    const noAuth = await t.app.inject({ method: 'POST', url: '/api/import/preview', headers: HOST_HEADER, payload: {} });
    expect(noAuth.statusCode).toBe(401);
    const noCsrf = await t.app.inject({ method: 'POST', url: '/api/import/commit', headers: { ...HOST_HEADER, cookie: auth.cookie }, payload: {} });
    expect(noCsrf.statusCode).toBe(403);
  });
});

describe('commit', () => {
  it('imports, applies rules, records balances and remembers the mapping', async () => {
    const r = await commit(ids.wpcuChecking!, 'wpcu-checking.csv');
    expect(r).toMatchObject({ imported: 7, duplicates: 0, skipped: 1, balancesRecorded: 7 });

    const list = (await txs()).transactions as { description: string; categoryId: number | null; type: string; amountCents: number }[];
    const by = (d: string) => list.find((x) => x.description.includes(d))!;
    expect(by('Spotify').categoryId).toBe(await catId('Subscriptions'));
    expect(by('KROGER').categoryId).toBe(await catId('Food'));
    expect(by('PARKING').categoryId).toBe(await catId('Transportation'));
    expect(by('COFFEE')).toMatchObject({ type: 'expense', categoryId: null });
    expect(by('PAYROLL')).toMatchObject({ type: 'income', categoryId: null });

    const snaps = t.db.prepare("SELECT COUNT(*) AS n FROM balance_snapshots WHERE source = 'import'").get() as { n: number };
    expect(snaps.n).toBe(7);
    const map = t.db.prepare('SELECT config FROM csv_mappings WHERE account_id = ?').get(ids.wpcuChecking!) as { config: string };
    expect(JSON.parse(map.config).amountMode).toBe('debitCredit');
    expect((await preview(ids.wpcuChecking!, 'wpcu-checking.csv')).json().mappingSource).toBe('saved');
  });

  it('re-importing the same file adds nothing', async () => {
    await commit(ids.wpcuChecking!, 'wpcu-checking.csv');
    const again = await preview(ids.wpcuChecking!, 'wpcu-checking.csv');
    expect(again.json().counts).toMatchObject({ new: 0, duplicate: 7 });
    expect(again.json().alreadyImported).not.toBeNull();
    const r = await commit(ids.wpcuChecking!, 'wpcu-checking.csv');
    expect(r.imported).toBe(0);
    expect((await txs()).total).toBe(7);
  });

  it('an overlapping download only adds the new rows', async () => {
    const full = fixture('wpcu-checking.csv').split('\n');
    const older = [...full.slice(0, 4), ...full.slice(8)].join('\n'); // header + the older rows only
    await call({ method: 'POST', url: '/api/import/commit', payload: { accountId: ids.wpcuChecking, filename: 'old.csv', text: older } });
    expect((await txs()).total).toBe(3);
    const r = await commit(ids.wpcuChecking!, 'wpcu-checking.csv');
    expect(r).toMatchObject({ imported: 4, duplicates: 3 });
    expect((await txs()).total).toBe(7);
  });

  it('keeps two genuinely identical charges on the same day', async () => {
    const r = await commit(ids.cfChecking!, 'climatefirst-checking.csv');
    expect(r.imported).toBe(4);
    expect((await txs(`&accountId=${ids.cfChecking}&q=EXAMPLE MART`)).total).toBe(2);
    expect((await commit(ids.cfChecking!, 'climatefirst-checking.csv')).imported).toBe(0);
  });

  it('typed-in balances are never overwritten by imported ones', async () => {
    await call({ method: 'POST', url: `/api/accounts/${ids.wpcuChecking}/balances`, payload: { asOf: '2026-10-29', balance: '999.99' } });
    await commit(ids.wpcuChecking!, 'wpcu-checking.csv');
    const row = t.db.prepare("SELECT balance_cents, source FROM balance_snapshots WHERE account_id = ? AND as_of = '2026-10-29'").get(ids.wpcuChecking!) as {
      balance_cents: number;
      source: string;
    };
    expect(row).toEqual({ balance_cents: 99999, source: 'manual' });
  });

  it('stores Fidelity activity with exact shares and tax years', async () => {
    await commit(ids.roth!, 'fidelity-roth.csv');
    const acts = t.db.prepare('SELECT kind, quantity_micro, price_e4, amount_cents, tax_year FROM investment_activity ORDER BY id').all();
    expect(acts).toHaveLength(5);
    expect(acts[3]).toMatchObject({ kind: 'contribution', amount_cents: 25000, tax_year: 2026 });
    expect(acts[4]).toMatchObject({ kind: 'contribution', amount_cents: 10000, tax_year: 2025 });
    const cash = (await txs(`&accountId=${ids.roth}`)).transactions as { type: string; description: string }[];
    expect(cash.map((c) => c.description).sort()).toEqual(['Contribution (2025 tax year)', 'Contribution (2026 tax year)']);
    expect(cash.every((c) => c.type === 'transfer')).toBe(true);
    // Dividends are investment growth, NOT transactions/income.
    expect((await txs('&type=income')).total).toBe(0);
  });
});

describe('transfers between your own accounts', () => {
  async function importEverything() {
    for (const [acct, file] of [
      ['wpcuChecking', 'wpcu-checking.csv'],
      ['wpcuSavings', 'wpcu-savings.csv'],
      ['cfChecking', 'climatefirst-checking.csv'],
      ['cfSavings', 'climatefirst-savings.csv'],
      ['brokerage', 'fidelity-brokerage.csv'],
      ['roth', 'fidelity-roth.csv'],
    ] as const) {
      await commit(ids[acct]!, file);
    }
  }

  it('links credit union -> brokerage, checking -> Roth, and bank savings -> checking', async () => {
    await importEverything();
    const all = (await txs()).transactions as { id: number; accountId: number; amountCents: number; type: string; transferGroupId: number | null }[];
    const linked = all.filter((x) => x.transferGroupId !== null);
    const groups = new Map<number, typeof linked>();
    for (const x of linked) groups.set(x.transferGroupId!, [...(groups.get(x.transferGroupId!) ?? []), x]);
    const pairs = [...groups.values()].map((g) => g.map((x) => x.amountCents).sort((a, b) => a - b));
    expect(pairs).toEqual(expect.arrayContaining([[-150000, 150000], [-25000, 25000], [-5500, 5500]]));
    expect(groups.size).toBe(3);
    expect(linked.every((x) => x.type === 'transfer')).toBe(true);
  });

  it('transfers never count as income or spending (exact totals)', async () => {
    await importEverything();
    const { sums } = await txs();
    // Spending: Spotify 11.99 + coffee 6.45 + parking 10.00 + Kroger 23.40 + 2 x 4.25 = 60.34
    expect(sums.spendingCents).toBe(6034);
    // Income: ref pay 85 + cash 100 + dividends 0.42 + check 2000 + interest 0.12 + 11.50 + 10.95 + opening deposit 3000
    expect(sums.incomeCents).toBe(520799);
    expect(Number.isInteger(sums.spendingCents) && Number.isInteger(sums.incomeCents)).toBe(true);
  });

  it('interest is categorized as Interest income', async () => {
    await importEverything();
    const interest = await catId('Interest');
    const { transactions } = await txs(`&categoryId=${interest}`);
    expect(transactions.map((x: { amountCents: number }) => x.amountCents).sort((a: number, b: number) => a - b)).toEqual([12, 42, 1095, 1150]);
  });

  it('undoing an import removes its rows and restores the other side of its transfers', async () => {
    await commit(ids.wpcuSavings!, 'wpcu-savings.csv');
    const r = await commit(ids.brokerage!, 'fidelity-brokerage.csv');
    expect(r.transfersLinked).toBe(1);
    const res = await call({ method: 'DELETE', url: `/api/import/batches/${r.batchId}` });
    expect(res.statusCode).toBe(200);
    const left = (await txs()).transactions as { amountCents: number; type: string; transferGroupId: number | null }[];
    const wpcuLeg = left.find((x) => x.amountCents === -150000)!;
    expect(wpcuLeg).toMatchObject({ type: 'expense', transferGroupId: null });
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM investment_activity').get()).toEqual({ n: 0 });
    // Importing again works and links again
    expect((await commit(ids.brokerage!, 'fidelity-brokerage.csv')).transfersLinked).toBe(1);
  });

  it('net worth stays continuous across a transfer to an account with no balance history', async () => {
    await commit(ids.wpcuSavings!, 'wpcu-savings.csv');
    await commit(ids.brokerage!, 'fidelity-brokerage.csv');
    await call({ method: 'POST', url: `/api/accounts/${ids.brokerage}/balances`, payload: { asOf: '2026-11-11', balance: '1480.00' } });
    const nw = (await call({ method: 'GET', url: '/api/networth?range=all' })).json();
    const at = (d: string) => nw.series.find((p: { date: string }) => p.date === d).totalCents;
    // 09/18: 3,512.42 in savings. 09/29: 2,012.42 left in savings + 1,500 now at Fidelity = same total.
    expect(at('2026-09-18')).toBe(351242);
    expect(at('2026-09-29')).toBe(351242);
    // today: Fidelity's real value replaces the money-put-in estimate
    expect(nw.current.totalCents).toBe(201284 + 148000);
  });

  it('lists import history', async () => {
    await commit(ids.cfSavings!, 'climatefirst-savings.csv');
    const b = (await call({ method: 'GET', url: `/api/import/batches?accountId=${ids.cfSavings}` })).json().batches;
    expect(b[0]).toMatchObject({ filename: 'climatefirst-savings.csv', rowsImported: 4 });
  });
});
