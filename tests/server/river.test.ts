/**
 * V2 Phase 4 money river: balancing, totals, transfers (linked, matched without a link, by the bank's text),
 * Invested vs Kept as cash, split pieces, refunds, overspending, "Other" grouping, read-only, demo mode.
 * All data is invented.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';
import { DB_FILENAME, openDatabase } from '../../server/src/db/database.js';
import { generateDemoData } from '../../server/src/lib/demo/index.js';
import {
  accountBalances,
  buildRiver,
  classifyTransfers,
  institutionAliases,
  riverDates,
  RIVER_RANGES,
  type River,
  type RiverAccount,
} from '../../server/src/lib/river.js';
import { moneyRiver } from '../../server/src/lib/moneyRiver.js';
import type { MoneyLine, TransferLeg } from '../../server/src/lib/totals.js';
import { loadMoneyLines, loadTransferLegs } from '../../server/src/lib/totals.js';
import { totals } from '../../server/src/lib/cashflow.js';

const expectBalanced = (r: River) => {
  for (const b of accountBalances(r)) expect(b.inCents, `account ${b.accountId}`).toBe(b.outCents);
  // Every link touches an account node, and node sizes equal their links.
  const ids = new Map(r.nodes.map((n) => [n.id, n]));
  for (const l of r.links) {
    expect(l.cents).toBeGreaterThan(0);
    expect([ids.get(l.source)!.column, ids.get(l.target)!.column]).toEqual(ids.get(l.source)!.column === 0 ? [0, 1] : [1, 2]);
  }
  for (const n of r.nodes) {
    const side = n.column === 0 ? r.links.filter((l) => l.source === n.id) : r.links.filter((l) => l.target === n.id);
    expect(side.reduce((s, l) => s + l.cents, 0), n.label).toBe(n.cents);
  }
};
const node = (r: River, label: string) => r.nodes.find((n) => n.label === label);

// ---------- pure ----------

const ACCTS: RiverAccount[] = [
  { id: 1, name: 'Checking', institution: 'Fake Credit Union', isInvestment: false, sortOrder: 1 },
  { id: 2, name: 'Savings', institution: 'Fake Bank', isInvestment: false, sortOrder: 2 },
  { id: 3, name: 'Roth', institution: 'Fidelity', isInvestment: true, sortOrder: 3 },
  { id: 4, name: 'Brokerage', institution: 'Fidelity', isInvestment: true, sortOrder: 4 },
];
const leg = (txId: number, accountId: number, date: string, amountCents: number, extra: Partial<TransferLeg> = {}): TransferLeg => ({
  txId,
  accountId,
  date,
  amountCents,
  transferGroupId: null,
  partnerAccountId: null,
  text: 'Transfer',
  ...extra,
});
const roles = (legs: TransferLeg[], blocked = new Set<string>()) =>
  Object.fromEntries(classifyTransfers(legs, ACCTS, '2026-10-01', '2026-10-31', blocked).map((c) => [c.txId, `${c.role}/${c.how}`]));

describe('where moved money went (pure)', () => {
  it('a linked bank -> investment transfer is Invested, counted once on the bank side', () => {
    expect(roles([leg(1, 1, '2026-10-05', -500_00, { transferGroupId: 1, partnerAccountId: 3 }), leg(2, 3, '2026-10-05', 500_00, { transferGroupId: 1, partnerAccountId: 1 })])).toEqual({
      1: 'invested/linked',
      2: 'skip/linked',
    });
  });

  it('back out of investments is From investments; between bank accounts is a move; between investment accounts is skipped', () => {
    expect(
      roles([
        leg(1, 3, '2026-10-05', -100_00, { transferGroupId: 1, partnerAccountId: 1 }),
        leg(2, 1, '2026-10-05', 100_00, { transferGroupId: 1, partnerAccountId: 3 }),
        leg(3, 1, '2026-10-06', -40_00, { transferGroupId: 3, partnerAccountId: 2 }),
        leg(4, 2, '2026-10-06', 40_00, { transferGroupId: 3, partnerAccountId: 1 }),
        leg(5, 3, '2026-10-07', -70_00, { transferGroupId: 5, partnerAccountId: 4 }),
        leg(6, 4, '2026-10-07', 70_00, { transferGroupId: 5, partnerAccountId: 3 }),
      ]),
    ).toEqual({ 1: 'skip/linked', 2: 'fromInvestments/linked', 3: 'movedOut/linked', 4: 'movedIn/linked', 5: 'skip/linked', 6: 'skip/linked' });
  });

  it('unlinked sides of the same size within 7 days are paired (only for the picture), never a pair the user unlinked', () => {
    const legs = [leg(1, 1, '2026-10-05', -300_00), leg(2, 3, '2026-10-11', 300_00)];
    expect(roles(legs)).toEqual({ 1: 'invested/matched', 2: 'skip/matched' });
    // 8 days apart: not paired, and the bank text says nothing -> unknown; the Roth side came from outside.
    expect(roles([leg(1, 1, '2026-10-05', -300_00), leg(2, 3, '2026-10-13', 300_00)])).toEqual({ 1: 'unknownOut/none', 2: 'outsideIn/none' });
    expect(roles(legs, new Set(['1-2']))).toEqual({ 1: 'unknownOut/none', 2: 'outsideIn/none' });
  });

  it('a bank transfer naming the investment firm is Invested, and claims the investment side so it is not counted twice', () => {
    const bank = leg(1, 1, '2026-10-05', -250_00, { text: 'ACH DEBIT FID BKG SVC LLC MONEYLINE' });
    expect(roles([bank])).toEqual({ 1: 'invested/name' });
    expect(roles([bank, leg(2, 4, '2026-10-20', 250_00)])).toEqual({ 1: 'invested/name', 2: 'skip/none' });
    // A different amount is not claimed: it really came from outside.
    expect(roles([bank, leg(2, 4, '2026-10-20', 999_00)])).toEqual({ 1: 'invested/name', 2: 'outsideIn/none' });
    expect(roles([leg(1, 1, '2026-10-05', 80_00, { text: 'FIDELITY WITHDRAWAL' })])).toEqual({ 1: 'fromInvestments/name' });
    // Words, not substrings: "FIDELITYX" does not match.
    expect(roles([leg(1, 1, '2026-10-05', -80_00, { text: 'FIDELITYX PAY' })])).toEqual({ 1: 'unknownOut/none' });
  });

  it('the claim works across the range edge: a bank side before the range still claims its investment side', () => {
    expect(roles([leg(1, 1, '2026-09-28', -250_00, { text: 'TRANSFER TO FIDELITY' }), leg(2, 4, '2026-10-12', 250_00)])).toEqual({ 2: 'skip/none' });
  });

  it('an institution a bank account also uses is never used as a hint', () => {
    const accts = [...ACCTS, { id: 5, name: 'Fid Cash', institution: 'Fidelity', isInvestment: false, sortOrder: 5 }];
    expect(institutionAliases(accts).size).toBe(0);
    expect(institutionAliases(ACCTS).get('FID BKG SVC')).toEqual(new Set([3, 4]));
  });

  it('range dates', () => {
    expect(riverDates('month', '2026-11-11')).toEqual({ from: '2026-11-01', to: '2026-11-11' });
    expect(riverDates('3m', '2026-11-11')).toEqual({ from: '2026-09-01', to: '2026-11-11' });
    expect(riverDates('ytd', '2026-11-11')).toEqual({ from: '2026-01-01', to: '2026-11-11' });
    expect(riverDates('12m', '2026-11-11')).toEqual({ from: '2025-12-01', to: '2026-11-11' });
  });
});

const line = (accountId: number, amountCents: number, type: MoneyLine['type'], categoryId: number | null = null): MoneyLine => ({
  txId: 0,
  accountId,
  date: '2026-10-10',
  amountCents,
  type,
  categoryId,
  payer: '',
});
const CATS = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, name: `Cat ${id}`, color: 'gold' }));

describe('building the river (pure)', () => {
  it('keeps what is left as cash, takes overspending from money you already had', () => {
    const r = buildRiver([line(1, 1000_00, 'income', 1), line(1, -400_00, 'expense', 2), line(2, -50_00, 'expense', 2)], [], ACCTS, CATS);
    expectBalanced(r);
    expect(node(r, 'Kept as cash')!.cents).toBe(600_00);
    expect(node(r, 'From money you already had')!.cents).toBe(50_00);
    expect(r.totals).toMatchObject({ incomeCents: 1000_00, spendingCents: 450_00, keptCents: 600_00, fromEarlierCents: 50_00 });
  });

  it('refunds lower spending; a category with more refunds than purchases is a source "Refunds: X"', () => {
    const r = buildRiver([line(1, -100_00, 'expense', 2), line(1, 30_00, 'expense', 2), line(1, 20_00, 'expense', 3)], [], ACCTS, CATS);
    expectBalanced(r);
    expect(node(r, 'Cat 2')!.cents).toBe(70_00);
    expect(node(r, 'Refunds: Cat 3')!.cents).toBe(20_00);
    expect(r.totals.spendingCents).toBe(50_00);
    expect(r.totals.spendingCents).toBe(totals([line(1, -100_00, 'expense', 2), line(1, 30_00, 'expense', 2), line(1, 20_00, 'expense', 3)]).spendingCents);
  });

  it('gifts are their own stream; uncategorized income and spending are labeled', () => {
    const r = buildRiver([line(2, 100_00, 'gift'), line(1, 20_00, 'income'), line(1, -5_00, 'expense')], [], ACCTS, CATS);
    expectBalanced(r);
    expect(node(r, 'Gifts')!.cents).toBe(100_00);
    expect(node(r, 'Uncategorized income')!.cents).toBe(20_00);
    expect(node(r, 'Uncategorized')!.cents).toBe(5_00);
    expect(r.totals.giftCents).toBe(100_00);
  });

  it('an investment account with money from outside Arc40 is a middle node whose leftover is Invested', () => {
    const legs = classifyTransfers([leg(9, 3, '2026-10-10', 500_00)], ACCTS, '2026-10-01', '2026-10-31');
    const r = buildRiver([], legs, ACCTS, CATS);
    expectBalanced(r);
    expect(node(r, 'Put in from outside Arc40')!.cents).toBe(500_00);
    expect(node(r, 'Invested')!.cents).toBe(500_00);
    expect(node(r, 'Roth')!.isInvestment).toBe(true);
  });

  it('groups categories under 3% of spending into Other spending (2 or more), and lists them', () => {
    const lines = [line(1, 10_000_00, 'income', 7), line(1, -5_000_00, 'expense', 1), line(1, -100_00, 'expense', 2), line(1, -50_00, 'expense', 3), line(1, -500_00, 'expense', 4)];
    const r = buildRiver(lines, [], ACCTS, CATS);
    expectBalanced(r);
    const other = node(r, 'Other spending')!;
    expect(other.cents).toBe(150_00);
    expect(other.members).toEqual([
      { label: 'Cat 2', cents: 100_00, categoryId: 2 },
      { label: 'Cat 3', cents: 50_00, categoryId: 3 },
    ]);
    expect(node(r, 'Cat 4')!.cents).toBe(500_00); // 8.9%: its own stream
    expect(r.totals.spendingCents).toBe(5_650_00);
    // Only one small category: it keeps its own name.
    const one = buildRiver(lines.slice(0, 3), [], ACCTS, CATS);
    expect(node(one, 'Other spending')).toBeUndefined();
    expect(node(one, 'Cat 2')!.cents).toBe(100_00);
  });
});

// ---------- API ----------

let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };
const call = (opts: InjectOptions) =>
  t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });
const ok = async (opts: InjectOptions) => {
  const r = await call(opts);
  expect(r.statusCode, r.body).toBeLessThan(300);
  return r.json();
};
const river = async (range: string) => (await ok({ method: 'GET', url: `/api/river?range=${range}` })) as River & { from: string; to: string };

beforeEach(async () => {
  t = await testApp();
  auth = await setupAndLogin(t);
});
afterEach(async () => {
  await t.app.close();
});

describe('GET /api/river', () => {
  let cat: Record<string, number>;
  let acct: { checking: number; savings: number; roth: number };
  const tx = async (accountId: number, date: string, amount: string, direction: 'in' | 'out', type: string, extra: Record<string, unknown> = {}) =>
    (await ok({ method: 'POST', url: '/api/transactions', payload: { accountId, date, amount, direction, description: 'Fake', type, ...extra } })).transaction.id as number;
  const seed = async () => {
    cat = Object.fromEntries(((await ok({ method: 'GET', url: '/api/categories' })).categories as { id: number; name: string }[]).map((c) => [c.name, c.id]));
    const mk = async (name: string, type: string, institution = '') => (await ok({ method: 'POST', url: '/api/accounts', payload: { name, type, institution } })).account.id as number;
    acct = { checking: await mk('Fake Checking', 'checking', 'Fake CU'), savings: await mk('Fake Savings', 'savings', 'Fake Bank'), roth: await mk('Fake Roth', 'roth_ira', 'Fidelity') };
    // This month (clock: 2026-11-11)
    await tx(acct.checking, '2026-11-02', '600', 'in', 'income', { categoryId: cat.Refereeing, payer: 'Fake League' });
    await tx(acct.savings, '2026-11-03', '3.21', 'in', 'income', { categoryId: cat.Interest });
    await tx(acct.savings, '2026-11-04', '100', 'in', 'gift', { giftFrom: 'Fake Mom' });
    await tx(acct.checking, '2026-11-05', '45.50', 'out', 'expense', { categoryId: cat.Food });
    await tx(acct.checking, '2026-11-05', '12', 'in', 'expense', { categoryId: cat.Food }); // refund
    const split = await tx(acct.checking, '2026-11-06', '90', 'out', 'expense', { categoryId: cat.Food });
    await ok({ method: 'PUT', url: `/api/transactions/${split}/split`, payload: { pieces: [{ categoryId: cat.Food, amount: '60' }, { categoryId: cat.Shopping, amount: '30' }] } });
    // Linked checking -> savings, and checking -> Roth.
    const a = await tx(acct.checking, '2026-11-07', '200', 'out', 'transfer');
    const b = await tx(acct.savings, '2026-11-07', '200', 'in', 'transfer');
    await ok({ method: 'POST', url: `/api/transactions/${a}/link`, payload: { otherId: b } });
    const c = await tx(acct.checking, '2026-11-08', '250', 'out', 'transfer');
    const d = await tx(acct.roth, '2026-11-08', '250', 'in', 'transfer');
    await ok({ method: 'POST', url: `/api/transactions/${c}/link`, payload: { otherId: d } });
    // Unlinked: a bank transfer naming Fidelity with no other side.
    await tx(acct.checking, '2026-11-09', '40', 'out', 'transfer', { description: 'ACH DEBIT FID BKG SVC LLC' });
    // Earlier: a month where spending was more than income.
    await tx(acct.checking, '2026-10-03', '50', 'in', 'income', { categoryId: cat.Refereeing });
    await tx(acct.checking, '2026-10-04', '400', 'out', 'expense', { categoryId: cat.Shopping });
  };

  it('balances every account in every range and matches the shared totals', async () => {
    await seed();
    for (const range of RIVER_RANGES) {
      const r = await river(range);
      expectBalanced(r);
      const sums = (await ok({ method: 'GET', url: `/api/transactions?from=${r.from}&to=${r.to}&limit=1` })).sums;
      expect(r.totals.incomeCents, range).toBe(sums.incomeCents);
      expect(r.totals.spendingCents, range).toBe(sums.spendingCents);
      expect(r.totals.giftCents, range).toBe(sums.giftCents);
    }
  });

  it('transfers are never income or spending; Invested = money moved into investment accounts', async () => {
    await seed();
    const r = await river('month');
    const labels = r.nodes.map((n) => n.label);
    expect(labels).not.toContain('Uncategorized income');
    expect(labels).not.toContain('Uncategorized');
    expect(r.totals.incomeCents).toBe(603_21);
    // 250 linked into the Roth + 40 that names Fidelity.
    expect(r.totals.investedCents).toBe(290_00);
    expect(r.matchedTransfers).toBe(1);
    expect(node(r, 'Moved to your other accounts')!.cents).toBe(200_00);
    expect(node(r, 'Moved from your other accounts')!.cents).toBe(200_00);
    // The Roth is not a middle node: its side of the linked transfer is the Invested stream.
    expect(r.nodes.some((n) => n.label === 'Fake Roth')).toBe(false);
    // Invested equals the transfer lines on investment accounts + bank transfers that name the firm.
    const rothIn = (await ok({ method: 'GET', url: `/api/transactions?accountId=${acct.roth}&type=transfer&from=${r.from}&to=${r.to}` })).sums.transferCents;
    expect(r.totals.investedCents).toBe(rothIn + 40_00);
  });

  it('split pieces land in their own categories; refunds lower Food', async () => {
    await seed();
    const r = await river('month');
    expect(r.nodes.find((n) => n.categoryId === cat.Food && n.kind === 'spending')!.cents).toBe(45_50 - 12_00 + 60_00);
    const shop = r.nodes.find((n) => n.categoryId === cat.Shopping) ?? r.nodes.find((n) => n.kind === 'other' && n.column === 2)!.members!.find((m) => m.categoryId === cat.Shopping);
    expect(shop!.cents).toBe(30_00);
  });

  it('a range with more spending than income balances through "From money you already had"', async () => {
    await seed();
    // October alone: $50 in, $400 out. 3 months includes November's surplus too.
    const lines = loadMoneyLines(t.db, { from: '2026-10-01', to: '2026-10-31' });
    const accts = (await ok({ method: 'GET', url: '/api/accounts' })).accounts as { id: number; name: string; institution: string; type: string }[];
    const ra: RiverAccount[] = accts.map((a, i) => ({ id: a.id, name: a.name, institution: a.institution, isInvestment: a.type === 'roth_ira', sortOrder: i }));
    const legs = classifyTransfers(loadTransferLegs(t.db, { from: '2026-09-01', to: '2026-12-31' }), ra, '2026-10-01', '2026-10-31');
    const r = buildRiver(lines, legs, ra, []);
    expectBalanced(r);
    expect(node(r, 'From money you already had')!.cents).toBe(350_00);
  });

  it('validates the range', async () => {
    expect((await call({ method: 'GET', url: '/api/river?range=5y' })).statusCode).toBe(400);
    expect((await call({ method: 'GET', url: '/api/river?range=month&from=2020-01-01' })).statusCode).toBe(400);
    expect((await call({ method: 'GET', url: '/api/river' })).statusCode).toBe(200);
  });

  it('never writes: every table except the login session is identical afterwards', async () => {
    await seed();
    const tables = (t.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name <> 'sessions' ORDER BY name").all() as { name: string }[]).map((x) => x.name);
    const dump = () => tables.map((n) => JSON.stringify(t.db.prepare(`SELECT * FROM "${n}"`).all())).join('\n');
    const before = dump();
    for (const range of RIVER_RANGES) await river(range);
    expect(dump()).toBe(before);
  });

  it('works in demo mode with demo data only', async () => {
    await seed();
    const enter = await call({ method: 'POST', url: '/api/demo/enter' });
    const c = enter.cookies.find((x) => x.name.startsWith('arc40_session_'))!;
    auth = { cookie: `${c.name}=${c.value}`, csrf: enter.json().csrfToken };
    for (const range of RIVER_RANGES) {
      const r = await river(range);
      expectBalanced(r);
      expect(JSON.stringify(r)).not.toMatch(/Fake Checking|Fake Roth|Fake Savings/);
      const sums = (await ok({ method: 'GET', url: `/api/transactions?from=${r.from}&to=${r.to}&limit=1` })).sums;
      expect(r.totals).toMatchObject({ incomeCents: sums.incomeCents, spendingCents: sums.spendingCents, giftCents: sums.giftCents });
    }
  });
});

describe('demo dataset shows the river well', () => {
  it('several sources incl. a gift, two accounts, Invested, a transfer found by the bank text and one by date, Other, an overspent month', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-river-'));
    await generateDemoData(dir, '2026-11-11', Date.UTC(2026, 10, 11, 12));
    const file = path.join(dir, DB_FILENAME);
    const db = openDatabase(dir);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const sha = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const before = sha();
    const year = moneyRiver(db, '12m', '2026-11-11');
    expectBalanced(year);
    expect(year.nodes.filter((n) => n.kind === 'income').length + (node(year, 'Other sources') ? 1 : 0)).toBeGreaterThanOrEqual(2);
    expect(node(year, 'Gifts')!.cents).toBeGreaterThan(0);
    expect(year.nodes.filter((n) => n.kind === 'account').length).toBeGreaterThanOrEqual(2);
    expect(year.totals.investedCents).toBeGreaterThan(0);
    expect(year.matchedTransfers).toBe(2);
    expect(year.unknownTransfers).toBe(0);
    expect(node(year, 'Other spending')!.members!.length).toBeGreaterThanOrEqual(2);
    expect(node(year, 'Kept as cash')!.cents).toBeGreaterThan(0);
    const month = moneyRiver(db, 'month', '2026-11-11');
    expectBalanced(month);
    expect(month.totals.spendingCents).toBeGreaterThan(month.totals.incomeCents);
    expect(node(month, 'From money you already had')!.cents).toBeGreaterThan(0);
    db.close();
    expect(sha()).toBe(before);
  });
});
