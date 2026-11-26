/**
 * V2 Phase 4 Arc40 Wrapped (server side): years and "so far", every slide, skipped slides, investment growth kept
 * apart from money put in, refereeing without a games count, work cost and future you following Settings, no
 * export routes, read-only, demo mode. All data is invented. The test clock starts at 2026-11-11.
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
import { merchantTotals, roundDiv, shareBp, wrappedYear, type Wrapped, type WrappedSlide } from '../../server/src/lib/wrapped.js';
import { futureYou, growLump } from '../../shared/projection.js';
import { workTenths } from '../../shared/workCost.js';
import type { MoneyLine } from '../../server/src/lib/totals.js';

let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };
const call = (opts: InjectOptions) =>
  t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });
const ok = async (opts: InjectOptions) => {
  const r = await call(opts);
  expect(r.statusCode, r.body).toBeLessThan(300);
  return r.json();
};
const wrapped = async (year: number) => (await ok({ method: 'GET', url: `/api/wrapped?year=${year}` })) as Wrapped;
const slide = <K extends WrappedSlide['kind']>(w: Wrapped, kind: K) => w.slides.find((s) => s.kind === kind) as Extract<WrappedSlide, { kind: K }> | undefined;
const kinds = (w: Wrapped) => w.slides.map((s) => s.kind);

beforeEach(async () => {
  t = await testApp();
  auth = await setupAndLogin(t);
});
afterEach(async () => {
  await t.app.close();
});

let cat: Record<string, number>;
let acct: { checking: number; savings: number; roth: number };
const tx = async (accountId: number, date: string, amount: string, direction: 'in' | 'out', type: string, extra: Record<string, unknown> = {}) =>
  (await ok({ method: 'POST', url: '/api/transactions', payload: { accountId, date, amount, direction, description: 'Fake', type, ...extra } })).transaction.id as number;
const accounts = async () => {
  cat = Object.fromEntries(((await ok({ method: 'GET', url: '/api/categories' })).categories as { id: number; name: string }[]).map((c) => [c.name, c.id]));
  const mk = async (name: string, type: string) => (await ok({ method: 'POST', url: '/api/accounts', payload: { name, type, institution: 'Fake Bank' } })).account.id as number;
  acct = { checking: await mk('Fake Checking', 'checking'), savings: await mk('Fake Savings', 'savings'), roth: await mk('Fake Roth', 'roth_ira') };
};
/** Investment activity written the way an import does (contribution + buy at a price), with that day's price. */
const fund = (symbol: string) => t.db.prepare("INSERT OR IGNORE INTO securities (symbol, name) VALUES (?, 'FAKE FUND')").run(symbol);
const invest = (accountId: number, date: string, cents: number, priceE4: number, taxYear: number) => {
  fund('FAKEX');
  const ins = t.db.prepare(
    `INSERT INTO investment_activity (account_id, date, kind, symbol, description, quantity_micro, price_e4, amount_cents, tax_year, raw_action, source, created_at)
     VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, 'FAKE', 'manual', 0)`,
  );
  ins.run(accountId, date, 'contribution', '', 0, null, cents, taxYear);
  const qty = Math.floor((cents * 100 * 1_000_000) / priceE4);
  ins.run(accountId, date, 'buy', 'FAKEX', qty, priceE4, -cents, null);
  t.db.prepare("INSERT OR REPLACE INTO price_points (symbol, as_of, source, price_e4) VALUES ('FAKEX', ?, 'trade', ?)").run(date, priceE4);
};

describe('pure helpers', () => {
  const line = (txId: number, date: string, amountCents: number, description: string, categoryId = 1): MoneyLine => ({
    txId,
    accountId: 1,
    date,
    amountCents,
    type: 'expense',
    categoryId,
    payer: '',
    description,
  });
  it('merchants group by the merchant key, count split pieces at their amounts, one visit per transaction, refunds lower it', () => {
    const m = merchantTotals([
      line(1, '2026-01-02', -60_00, 'Corner Market', 1), // a split transaction: two pieces, one visit
      line(1, '2026-01-02', -30_00, 'Corner Market', 2),
      line(2, '2026-02-02', -10_00, 'CORNER MARKET #12'),
      line(3, '2026-02-09', 5_00, 'Corner Market'), // refund
      line(4, '2026-03-01', -99_00, 'Gadget Shop'),
    ]);
    expect(m).toEqual([
      { key: 'GADGET SHOP', name: 'Gadget Shop', cents: 99_00, visits: 1 },
      { key: 'CORNER MARKET', name: 'Corner Market', cents: 95_00, visits: 2 },
    ]);
  });
  it('sorts merchants by spending and leaves out net refunds', () => {
    const m = merchantTotals([line(1, '2026-01-02', -10_00, 'Alpha Shop'), line(2, '2026-01-03', -20_00, 'Bravo Shop'), line(3, '2026-01-04', 5_00, 'Charlie Shop')]);
    expect(m.map((x) => x.name)).toEqual(['Bravo Shop', 'Alpha Shop']);
  });
  it('rounds shares and averages with whole numbers', () => {
    expect(shareBp(1, 3)).toBe(3333);
    expect(shareBp(2, 3)).toBe(6667);
    expect(shareBp(5, 0)).toBe(0);
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(-5, 2)).toBe(-3);
    expect(roundDiv(10, 3)).toBe(3);
  });
});

describe('years and "so far"', () => {
  it('lists the years with data, newest first; the current year is "so far" until Dec 31, then the full year', async () => {
    await accounts();
    await tx(acct.checking, '2025-03-01', '100', 'in', 'income', { categoryId: cat.Refereeing });
    await tx(acct.checking, '2026-02-01', '10', 'out', 'expense', { categoryId: cat.Food });
    expect((await ok({ method: 'GET', url: '/api/wrapped/years' })).years).toEqual([
      { year: 2026, soFar: true },
      { year: 2025, soFar: false },
    ]);
    const now = await wrapped(2026);
    expect(now).toMatchObject({ year: 2026, soFar: true, from: '2026-01-01', to: '2026-11-11' });
    expect(await wrapped(2025)).toMatchObject({ soFar: false, from: '2025-01-01', to: '2025-12-31' });
    // After Dec 31 the year is complete.
    t.clock.advance(60 * 86_400_000); // 2027-01-10
    auth = await reLogin();
    const full = await wrapped(2026);
    expect(full).toMatchObject({ soFar: false, to: '2026-12-31' });
    expect((await ok({ method: 'GET', url: '/api/wrapped/years' })).years[0]).toEqual({ year: 2026, soFar: false });
  });

  it('refuses years without data, future years and anything that is not a year', async () => {
    await accounts();
    await tx(acct.checking, '2026-02-01', '10', 'out', 'expense', { categoryId: cat.Food });
    expect((await call({ method: 'GET', url: '/api/wrapped?year=2019' })).statusCode).toBe(404);
    expect((await call({ method: 'GET', url: '/api/wrapped?year=2030' })).json().error).toMatch(/not happened yet/);
    expect((await call({ method: 'GET', url: '/api/wrapped?year=abc' })).statusCode).toBe(400);
    expect((await call({ method: 'GET', url: '/api/wrapped?year=1999' })).statusCode).toBe(400);
    expect((await call({ method: 'GET', url: '/api/wrapped?year=2026&share=1' })).statusCode).toBe(400);
    expect((await call({ method: 'GET', url: '/api/wrapped' })).statusCode).toBe(400);
  });
});

async function reLogin() {
  // The session idled out while the clock jumped: log in again with the same password.
  const r = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: HOST_HEADER, payload: { password: 'correct horse battery' } });
  const c = r.cookies.find((x) => x.name.startsWith('arc40_session_'))!;
  return { cookie: `${c.name}=${c.value}`, csrf: r.json().csrfToken as string };
}

describe('slides', () => {
  it('skips every slide that has nothing to show (no empty slides)', async () => {
    await accounts();
    await tx(acct.savings, '2026-05-01', '100', 'in', 'gift', { giftFrom: 'Fake Grandma' });
    const w = await wrapped(2026);
    expect(kinds(w)).toEqual(['netWorth']); // a gift is money, but not income, spending or investing
  });

  it('refereeing season: earnings, by who paid and the busiest month, and never a number of games', async () => {
    await accounts();
    await tx(acct.checking, '2026-03-05', '60', 'in', 'income', { categoryId: cat.Refereeing, payer: 'Fake League' });
    await tx(acct.checking, '2026-09-05', '80', 'in', 'income', { categoryId: cat.Refereeing, payer: 'Fake League' });
    await tx(acct.checking, '2026-09-06', '70', 'in', 'income', { categoryId: cat.Refereeing, payer: 'Fake Assignor' });
    await tx(acct.checking, '2026-09-07', '20', 'in', 'income', { categoryId: cat.Interest });
    const r = slide(await wrapped(2026), 'refereeing')!;
    expect(r.totalCents).toBe(210_00);
    expect(r.byPayer).toEqual([
      { payer: 'Fake League', cents: 140_00 },
      { payer: 'Fake Assignor', cents: 70_00 },
    ]);
    expect(r.busiestMonth).toEqual({ month: '2026-09-01', cents: 150_00 });
    expect(Object.keys(r).sort()).toEqual(['busiestMonth', 'byPayer', 'kind', 'months', 'totalCents']);
    expect(JSON.stringify(r)).not.toMatch(/game|count/i);
  });

  it('spending slides: top merchant, biggest month, top category, savings rate; transfers and gifts never count', async () => {
    await accounts();
    await tx(acct.checking, '2026-01-10', '1000', 'in', 'income', { categoryId: cat.Refereeing });
    await tx(acct.checking, '2026-01-11', '300', 'out', 'expense', { categoryId: cat.Food, description: 'Fake Grocer' });
    await tx(acct.checking, '2026-02-11', '50', 'out', 'expense', { categoryId: cat.Food, description: 'Fake Grocer' });
    await tx(acct.checking, '2026-02-12', '120', 'out', 'expense', { categoryId: cat.Shopping, description: 'Fake Mall' });
    const a = await tx(acct.checking, '2026-02-13', '900', 'out', 'transfer');
    const b = await tx(acct.savings, '2026-02-13', '900', 'in', 'transfer');
    await ok({ method: 'POST', url: `/api/transactions/${a}/link`, payload: { otherId: b } });
    await tx(acct.savings, '2026-02-14', '500', 'in', 'gift', { giftFrom: 'Fake Mom' });
    const w = await wrapped(2026);
    expect(slide(w, 'topMerchant')).toMatchObject({ name: 'Fake Grocer', cents: 350_00, visits: 2, shareBp: shareBp(350_00, 470_00) });
    expect(slide(w, 'biggestMonth')).toMatchObject({ month: '2026-01-01', cents: 300_00 });
    expect(slide(w, 'topCategory')).toMatchObject({ name: 'Food', cents: 350_00, spendingCents: 470_00 });
    expect(slide(w, 'savingsRate')).toMatchObject({ incomeCents: 1000_00, spendingCents: 470_00, keptCents: 530_00, rateBp: 5300 });
  });

  it('a year with large contributions and flat prices shows (near) zero investment growth, not the contributions', async () => {
    await accounts();
    invest(acct.roth, '2026-01-05', 3000_00, 1_000_000, 2026); // $100.0000 a share
    invest(acct.roth, '2026-06-01', 3000_00, 1_000_000, 2026);
    const inv = slide(await wrapped(2026), 'investments')!;
    expect(inv.putInCents).toBe(6000_00);
    expect(Math.abs(inv.growthCents)).toBeLessThanOrEqual(1);
    expect(inv.endValueCents - inv.startValueCents).toBe(inv.putInCents + inv.growthCents);
  });

  it('a price rise is growth, and the money put in stays separate', async () => {
    await accounts();
    invest(acct.roth, '2026-01-05', 1000_00, 1_000_000, 2026); // 10 shares at $100
    t.db.prepare("INSERT INTO price_points (symbol, as_of, source, price_e4) VALUES ('FAKEX', '2026-11-11', 'history', 1_100_000)").run(); // $110 today
    const inv = slide(await wrapped(2026), 'investments')!;
    expect(inv).toMatchObject({ putInCents: 1000_00, growthCents: 100_00, endValueCents: 1100_00, startValueCents: 0 });
  });

  it('no price on the first day of the year: no growth slide (never guessed), but future you still uses the money put in', async () => {
    await accounts();
    await ok({ method: 'PUT', url: '/api/settings/planning', payload: { birth: { year: 2007, month: 6 } } });
    // Shares held since 2025 with no price at all until 2026.
    fund('FAKEY');
    t.db
      .prepare(
        "INSERT INTO investment_activity (account_id, date, kind, symbol, description, quantity_micro, price_e4, amount_cents, tax_year, raw_action, source, created_at) VALUES (?, '2025-06-01', 'other', 'FAKEY', '', 5000000, NULL, 0, NULL, 'FAKE', 'manual', 0)",
      )
      .run(acct.roth);
    t.db.prepare("INSERT INTO price_points (symbol, as_of, source, price_e4) VALUES ('FAKEY', '2026-03-01', 'history', 500_000)").run();
    invest(acct.roth, '2026-03-01', 500_00, 500_000, 2026);
    const w = await wrapped(2026);
    expect(slide(w, 'investments')).toBeUndefined();
    expect(slide(w, 'futureYou')!.investedCents).toBe(500_00);
  });

  it('subscriptions come from saved recurring items (cancelled ones too, for the charges they had)', async () => {
    await accounts();
    for (const d of ['2026-08-07', '2026-09-07', '2026-10-07', '2026-11-07']) {
      await tx(acct.checking, d, '12.99', 'out', 'expense', { categoryId: cat.Subscriptions, description: 'Fake Stream' });
    }
    expect(slide(await wrapped(2026), 'subscriptions')).toBeUndefined(); // only a suggestion so far
    const sug = (await ok({ method: 'GET', url: '/api/recurring' })).suggestions as { key: string; name: string }[];
    expect(sug.map((x) => x.name)).toEqual(['Fake Stream']);
    const item = (await ok({ method: 'POST', url: '/api/recurring/confirm', payload: { key: sug[0]!.key } })).item.id as number;
    // A manual item has no matched charges: it is counted as "not counted", never guessed.
    await ok({ method: 'POST', url: '/api/recurring', payload: { name: 'Manual Insurance', amount: '10', schedule: 'monthly', nextDue: '2026-12-01', categoryId: cat.Subscriptions } });
    const sub = slide(await wrapped(2026), 'subscriptions')!;
    expect(sub).toMatchObject({ totalCents: 4 * 12_99, chargeCount: 4, manualNotCounted: 1 });
    expect(sub.items).toEqual([{ name: 'Fake Stream', cents: 4 * 12_99, charges: 4, status: 'confirmed' }]);
    // The same charges on Transactions:
    const sums = (await ok({ method: 'GET', url: '/api/transactions?q=Fake%20Stream&from=2026-01-01&to=2026-11-11&limit=1' })).sums;
    expect(sub.totalCents).toBe(sums.spendingCents);
    await ok({ method: 'POST', url: `/api/recurring/${item}/cancel` });
    expect(slide(await wrapped(2026), 'subscriptions')).toMatchObject({ totalCents: 4 * 12_99, items: [{ status: 'cancelled' }] });
  });

  it('Roth progress for the tax year matches Goals', async () => {
    await accounts();
    invest(acct.roth, '2026-02-02', 2500_00, 1_000_000, 2026);
    await ok({ method: 'PUT', url: '/api/settings/ira', payload: { year: 2026, limit: '7,500', deadline: '2027-04-15' } });
    const r = slide(await wrapped(2026), 'roth')!;
    const goals = (await ok({ method: 'GET', url: '/api/goals?year=2026' })).roth;
    expect(r).toMatchObject({ taxYear: 2026, contributedCents: goals.contributedCents, limitCents: goals.limitCents, earnedCents: goals.earnedIncomeCents, percentBp: 3333 });
  });

  it('work cost follows the Settings choice: off = no slide; games or hours of a job', async () => {
    await accounts();
    await tx(acct.checking, '2026-04-04', '123.45', 'out', 'expense', { categoryId: cat.Food });
    expect(slide(await wrapped(2026), 'workCost')).toBeUndefined();
    await ok({ method: 'PUT', url: '/api/work-cost', payload: { refPayPerGame: '60', selection: 'ref' } });
    const games = slide(await wrapped(2026), 'workCost')!;
    expect(games).toMatchObject({ unit: 'game', tenths: workTenths(123_45, { unit: 'game', title: null, num: 6000, den: 1 }), text: '2.1 games' });
    const job = (await ok({ method: 'POST', url: '/api/work-jobs', payload: { title: 'Fake Lifeguard', payKind: 'hourly', pay: '16.50' } })).job.id;
    await ok({ method: 'PUT', url: '/api/work-cost', payload: { selection: `job:${job}` } });
    expect(slide(await wrapped(2026), 'workCost')).toMatchObject({ unit: 'hour', title: 'Fake Lifeguard', text: '7.5 hours as a Fake Lifeguard' });
    await ok({ method: 'PUT', url: '/api/work-cost', payload: { selection: 'off' } });
    expect(slide(await wrapped(2026), 'workCost')).toBeUndefined();
  });

  it('future you uses the projection engine and the Settings rate; no birth month = no slide', async () => {
    await accounts();
    invest(acct.roth, '2026-02-02', 1000_00, 1_000_000, 2026);
    expect(slide(await wrapped(2026), 'futureYou')).toBeUndefined();
    await ok({ method: 'PUT', url: '/api/settings/planning', payload: { birth: { year: 2007, month: 6 }, returnRate: '6' } });
    const f = slide(await wrapped(2026), 'futureYou')!;
    const engine = futureYou(1000_00, { year: 2007, month: 6 }, '2026-11-11', 600)!;
    expect(f).toEqual({ kind: 'futureYou', investedCents: 1000_00, age: 40, months: engine.months, valueCents: engine.valueCents, returnRateBp: 600 });
    expect(f.valueCents).toBe(growLump(1000_00, 600, engine.months));
  });
});

describe('no export, no writes', () => {
  it('has no export, share, save or download routes for Wrapped, and only GET routes at all', async () => {
    for (const url of ['/api/wrapped/export', '/api/wrapped/share', '/api/wrapped/save', '/api/wrapped/download', '/api/wrapped/image']) {
      for (const method of ['GET', 'POST', 'PUT'] as const) expect(t.app.hasRoute({ method, url }), `${method} ${url}`).toBe(false);
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) expect(t.app.hasRoute({ method, url: '/api/wrapped' })).toBe(false);
    const src = fs.readFileSync(path.resolve('server/src/routes/wrapped.ts'), 'utf8');
    expect(src.match(/app\.(get|post|put|patch|delete)\(/g)).toEqual(['app.get(', 'app.get(']);
  });

  it('never writes: every table except the login session is identical afterwards', async () => {
    await accounts();
    await tx(acct.checking, '2026-01-10', '1000', 'in', 'income', { categoryId: cat.Refereeing });
    invest(acct.roth, '2026-02-02', 1000_00, 1_000_000, 2026);
    const tables = (t.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name <> 'sessions' ORDER BY name").all() as { name: string }[]).map((x) => x.name);
    const dump = () => tables.map((n) => JSON.stringify(t.db.prepare(`SELECT * FROM "${n}"`).all())).join('\n');
    const before = dump();
    await ok({ method: 'GET', url: '/api/wrapped/years' });
    await wrapped(2026);
    expect(dump()).toBe(before);
  });
});

describe('demo mode', () => {
  it('shows the demo year with every slide, and never real data', async () => {
    await accounts();
    await tx(acct.checking, '2026-01-10', '1000', 'in', 'income', { categoryId: cat.Refereeing, payer: 'Fake Real League' });
    const enter = await call({ method: 'POST', url: '/api/demo/enter' });
    const c = enter.cookies.find((x) => x.name.startsWith('arc40_session_'))!;
    auth = { cookie: `${c.name}=${c.value}`, csrf: enter.json().csrfToken };
    const years = (await ok({ method: 'GET', url: '/api/wrapped/years' })).years as { year: number; soFar: boolean }[];
    expect(years[0]).toEqual({ year: 2026, soFar: true });
    expect(years[1]).toEqual({ year: 2025, soFar: false });
    const w = await wrapped(2026);
    expect(kinds(w)).toEqual(['topMerchant', 'biggestMonth', 'refereeing', 'netWorth', 'savingsRate', 'investments', 'subscriptions', 'roth', 'topCategory', 'workCost', 'futureYou']);
    expect(JSON.stringify(w)).not.toMatch(/Fake Real League|Fake Checking|Fake Roth/);
    const last = await wrapped(2025);
    expect(last.soFar).toBe(false);
    expect(kinds(last)).toContain('futureYou');
  });

  it('the demo dataset file is byte-for-byte unchanged after building every year', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-wrapped-'));
    await generateDemoData(dir, '2026-11-11', Date.UTC(2026, 10, 11, 12));
    const file = path.join(dir, DB_FILENAME);
    const db = openDatabase(dir);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const sha = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const before = sha();
    for (const y of [2026, 2025, 2024]) expect(wrappedYear(db, y, '2026-11-11').slides.length).toBeGreaterThan(0);
    db.close();
    expect(sha()).toBe(before);
  });
});
