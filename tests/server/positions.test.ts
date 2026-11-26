/**
 * Fidelity positions import (V2 Phase 2). The fixture uses the column layout the user shared with
 * invented values; the account numbers in it are fake and must never be stored or returned.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_HEADER, cookieFrom, setupAndLogin, testApp } from './helpers.js';
import { parseCsv } from '../../server/src/lib/csv.js';
import { findPositionsHeader, inferPriceDate, parseDownloaded, parsePositions } from '../../server/src/lib/positions.js';
import { bestPrices } from '../../server/src/lib/prices.js';

const FILE = fs.readFileSync(path.resolve('tests/fixtures/csv/fidelity-positions.csv'), 'utf8');
const FAKE_NUMBERS = ['Z99999901', '99999901', '900000001'];
const parse = (text: string) => {
  const rows = parseCsv(text);
  return parsePositions(rows, findPositionsHeader(rows)!);
};
const HEADER = FILE.split('\n')[0]!;

describe('parsing the positions layout', () => {
  it('reads funds, the download date and skips the footer text', () => {
    const p = parse(FILE);
    expect(p.funds.map((f) => [f.accountName, f.symbol, f.quantityMicro, f.priceE4])).toEqual([
      ['Individual', 'FSKAX', 8_000_000, 1_524_000],
      ['Individual', 'FTIHX', 19_700_000, 153_100],
      ['ROTH IRA', 'FXAIX', 1_301_000, 2_011_200],
    ]);
    expect(p.downloaded).toEqual({ date: '2026-11-10', minutes: 20 * 60 + 34, text: 'Date downloaded Nov-10-2026 8:34 p.m' });
    expect(p.skipped).toEqual([]);
    expect(p.cash).toEqual([]);
  });

  it('never reads the account number column', () => {
    const json = JSON.stringify(parse(FILE));
    for (const n of FAKE_NUMBERS) expect(json).not.toContain(n);
  });

  it('price date: evening download = that day; daytime = the weekday before; weekend = Friday', () => {
    expect(inferPriceDate(parseDownloaded('Date downloaded Nov-10-2026 8:34 p.m ET')!).date).toBe('2026-11-10');
    expect(inferPriceDate(parseDownloaded('Date downloaded Nov-10-2026 9:05 a.m ET')!).date).toBe('2026-11-09');
    expect(inferPriceDate(parseDownloaded('Date downloaded Nov-09-2026 11:00 a.m ET')!).date).toBe('2026-11-06'); // Monday morning -> Friday
    expect(inferPriceDate(parseDownloaded('Date downloaded Nov-14-2026 8:34 p.m ET')!).date).toBe('2026-11-13'); // Saturday
    expect(inferPriceDate(parseDownloaded('Date downloaded Nov-10-2026')!).date).toBe('2026-11-10'); // no time given
    expect(parseDownloaded('Date downloaded Foo-10-2026')).toBeNull();
  });

  it('cash and pending lines are never fund prices (assumed format: not in the sample the user shared)', () => {
    const text = [
      HEADER,
      'Z1,Individual,SPAXX**,HELD IN MONEY MARKET,,,,$12.34,,,,,1%,,,Cash,',
      'Z1,Individual,Pending Activity,,,,,$5.00,,,,,,,,,',
      'Z1,Individual,FSKAX,FIDELITY TOTAL MARKET INDEX FUND,1,$100.00,,$100.00,,,,,,,,Cash,',
    ].join('\n');
    const p = parse(text);
    expect(p.funds.map((f) => f.symbol)).toEqual(['FSKAX']);
    expect(p.cash.map((c) => [c.kind, c.symbol, c.valueCents])).toEqual([
      ['cash', 'SPAXX', 1234],
      ['pending', 'PENDING ACTIVITY', 500],
    ]);
  });

  it('bad lines are reported, never guessed', () => {
    const p = parse([HEADER, 'Z1,Individual,FSKAX,X,abc,$100.00,,,,,,,,,,Cash,', 'Z1,Individual,FTIHX,X,2,$0.00,,,,,,,,,,Cash,'].join('\n'));
    expect(p.funds).toEqual([]);
    expect(p.skipped.map((s) => s.reason)).toEqual(['Could not read the share count or price for FSKAX', 'The share count or price for FTIHX is not usable']);
  });

  it('price sources: history file > positions file > Fidelity trade price > typed in', () => {
    const pts = (['manual', 'trade', 'positions', 'history'] as const).map((source, i) => ({ symbol: 'FXAIX', asOf: '2026-11-10', source, priceE4: 100 + i }));
    expect(bestPrices(pts)).toEqual([{ symbol: 'FXAIX', asOf: '2026-11-10', source: 'history', priceE4: 103 }]);
    expect(bestPrices(pts.slice(0, 3))[0]!.source).toBe('positions');
    expect(bestPrices(pts.slice(0, 2))[0]!.source).toBe('trade');
    expect(bestPrices(pts.slice(0, 1))[0]!.source).toBe('manual');
  });
});

// ---------------------------------------------------------------- API

let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };
const responses: string[] = [];
const call = async (opts: InjectOptions) => {
  const r = await t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });
  responses.push(r.body);
  return r;
};
const ok = async (opts: InjectOptions) => {
  const r = await call(opts);
  expect(r.statusCode, r.body).toBeLessThan(300);
  return r.json();
};
const fixture = (n: string) => fs.readFileSync(path.resolve('tests/fixtures/csv', n), 'utf8');
let ids: { brokerage: number; roth: number };

const preview = (payload: object = {}) => ok({ method: 'POST', url: '/api/investments/positions/preview', payload: { text: FILE, ...payload } });
const commit = (payload: object) => call({ method: 'POST', url: '/api/investments/positions/commit', payload: { text: FILE, priceDate: '2026-11-10', ...payload } });
const mapping = () => [
  { name: 'Individual', accountId: ids.brokerage },
  { name: 'ROTH IRA', accountId: ids.roth },
];
const priceCount = () => (t.store.current().prepare('SELECT COUNT(*) AS n FROM price_points').get() as { n: number }).n;

describe('positions import API', () => {
  beforeEach(async () => {
    t = await testApp(); // today = 2026-11-11
    auth = await setupAndLogin(t);
    responses.length = 0;
    const acct = async (name: string, type: string) => (await ok({ method: 'POST', url: '/api/accounts', payload: { name, type } })).account.id as number;
    ids = { brokerage: await acct('Brokerage', 'brokerage'), roth: await acct('Roth IRA', 'roth_ira') };
    await ok({ method: 'POST', url: '/api/import/commit', payload: { accountId: ids.brokerage, filename: 'b.csv', text: fixture('fidelity-brokerage.csv') } });
    await ok({ method: 'POST', url: '/api/import/commit', payload: { accountId: ids.roth, filename: 'r.csv', text: fixture('fidelity-roth.csv') } });
  });
  afterEach(async () => {
    await t.app.close();
  });

  it('preview: suggests accounts, shows each price and date, compares shares, and saves nothing', async () => {
    const before = priceCount();
    const p = await preview();
    expect(p.priceDate).toBe('2026-11-10');
    expect(p.priceDateReason).toMatch(/evening/);
    expect(p.accounts).toEqual([
      { name: 'Individual', accountId: ids.brokerage, remembered: false },
      { name: 'ROTH IRA', accountId: ids.roth, remembered: false },
    ]);
    expect(p.prices.map((x: { symbol: string; priceE4: number }) => [x.symbol, x.priceE4])).toEqual([
      ['FSKAX', 1_524_000],
      ['FTIHX', 153_100],
      ['FXAIX', 2_011_200],
    ]);
    const bySym = Object.fromEntries((p.funds as { symbol: string }[]).map((f) => [f.symbol, f]));
    expect(bySym.FSKAX).toMatchObject({ fidelitySharesMicro: 8_000_000, arc40SharesMicro: 8_000_000, matches: true });
    expect(bySym.FTIHX).toMatchObject({ fidelitySharesMicro: 19_700_000, arc40SharesMicro: 19_672_000, differenceMicro: 28_000, matches: false });
    expect(bySym.FXAIX).toMatchObject({ arc40SharesMicro: 1_300_500, matches: true }); // 1.3005 shown by Fidelity as 1.301
    expect(priceCount()).toBe(before);
  });

  it('save: prices for that date, remembered account names, the Investments page uses the new prices', async () => {
    const r = await commit({ mapping: mapping() });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().saved).toBe(3);
    expect(r.json().priceDateReason).toMatch(/evening/); // the file's own date, not "you picked"
    const pts = t.store.current().prepare("SELECT symbol, as_of, price_e4 FROM price_points WHERE source = 'positions' ORDER BY symbol").all();
    expect(pts).toEqual([
      { symbol: 'FSKAX', as_of: '2026-11-10', price_e4: 1_524_000 },
      { symbol: 'FTIHX', as_of: '2026-11-10', price_e4: 153_100 },
      { symbol: 'FXAIX', as_of: '2026-11-10', price_e4: 2_011_200 },
    ]);
    const inv = await ok({ method: 'GET', url: '/api/investments' });
    expect(inv.holdings.find((h: { symbol: string }) => h.symbol === 'FSKAX')).toMatchObject({ priceE4: 1_524_000, priceDate: '2026-11-10', priceSource: 'positions' });
    // Next time the names are remembered (no suggestion needed).
    const again = await preview();
    expect(again.accounts.every((a: { remembered: boolean }) => a.remembered)).toBe(true);
  });

  it('Fix shares records the signed adjustment, and the difference is gone', async () => {
    await commit({ mapping: mapping() });
    const fix = await ok({ method: 'POST', url: '/api/investments/shares', payload: { accountId: ids.brokerage, symbol: 'FTIHX', shares: '19.700', asOf: '2026-11-10' } });
    expect(fix).toMatchObject({ sharesMicro: 19_700_000, adjustedMicro: 28_000 });
    const p = await preview();
    expect(p.funds.find((f: { symbol: string }) => f.symbol === 'FTIHX')).toMatchObject({ matches: true, differenceMicro: 0 });
    const adj = t.store.current().prepare("SELECT date, kind, quantity_micro, source FROM investment_activity WHERE source = 'manual'").all();
    expect(adj).toEqual([{ date: '2026-11-10', kind: 'other', quantity_micro: 28_000, source: 'manual' }]);
  });

  it('an account not in Arc40 can be skipped; an unanswered one blocks saving', async () => {
    const r = await commit({ mapping: [{ name: 'Individual', accountId: ids.brokerage }] }); // Roth suggested, so it is mapped
    expect(r.statusCode).toBe(200);
    // A name Arc40 cannot suggest anything for:
    const odd = FILE.replace(/ROTH IRA/g, 'Health Savings');
    const r2 = await call({ method: 'POST', url: '/api/investments/positions/commit', payload: { text: odd, priceDate: '2026-11-10', mapping: [] } });
    expect(r2.statusCode).toBe(400);
    expect(r2.json().error).toBe('Pick an Arc40 account for "Health Savings" (or "Not in Arc40").');
    const r3 = await call({
      method: 'POST',
      url: '/api/investments/positions/commit',
      payload: { text: odd, priceDate: '2026-11-10', mapping: [{ name: 'Health Savings', accountId: null }] },
    });
    expect(r3.statusCode, r3.body).toBe(200);
    expect(r3.json().funds.find((f: { accountName: string }) => f.accountName === 'Health Savings')).toMatchObject({ accountId: null, arc40SharesMicro: null });
  });

  it('a typed price never beats a file price on the same day; removing a typed price brings the file price back', async () => {
    await commit({ mapping: mapping() });
    await ok({ method: 'PUT', url: '/api/prices', payload: { asOf: '2026-11-10', prices: [{ symbol: 'FSKAX', price: '1.00' }] } });
    const h = async () => (await ok({ method: 'GET', url: '/api/investments' })).holdings.find((x: { symbol: string }) => x.symbol === 'FSKAX');
    expect(await h()).toMatchObject({ priceE4: 1_524_000, priceSource: 'positions' });
    // On a day no file covers, the typed price is used (the emergency edit).
    await ok({ method: 'PUT', url: '/api/prices', payload: { asOf: '2026-11-11', prices: [{ symbol: 'FSKAX', price: '160.00' }] } });
    expect(await h()).toMatchObject({ priceE4: 1_600_000, priceSource: 'manual', priceIsManual: true });
    await ok({ method: 'DELETE', url: '/api/prices/FSKAX/2026-11-11' });
    expect(await h()).toMatchObject({ priceE4: 1_524_000, priceSource: 'positions' });
    // A price history file (Milestone 6b) beats the positions file.
    t.store.current().prepare("INSERT INTO price_points (symbol, as_of, source, price_e4) VALUES ('FSKAX', '2026-11-10', 'history', 1523000)").run();
    expect(await h()).toMatchObject({ priceE4: 1_523_000, priceSource: 'history' });
  });

  it('a Fidelity history import never overwrites a positions price', async () => {
    await commit({ mapping: mapping() });
    const hist = fixture('fidelity-brokerage.csv').replace('09/29/2026', '11/10/2026').replace('09/30/2026', '11/12/2026');
    await ok({ method: 'POST', url: '/api/import/commit', payload: { accountId: ids.brokerage, filename: 'b2.csv', text: hist } });
    const h = (await ok({ method: 'GET', url: '/api/investments' })).holdings.find((x: { symbol: string }) => x.symbol === 'FTIHX');
    expect(h).toMatchObject({ priceSource: 'positions', priceE4: 153_100 });
  });

  it('account numbers are never stored or returned', async () => {
    await preview();
    await commit({ mapping: mapping() });
    await ok({ method: 'GET', url: '/api/investments' });
    for (const body of responses) for (const n of FAKE_NUMBERS) expect(body).not.toContain(n);
    const db = t.store.current();
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);
    for (const table of tables) {
      const dump = JSON.stringify(db.prepare(`SELECT * FROM "${table}"`).all());
      for (const n of FAKE_NUMBERS) expect(dump, table).not.toContain(n);
    }
  });

  it('untrusted files: wrong file, oversized, future dates and bad input are refused', async () => {
    const bad = async (payload: object, msg: RegExp) => {
      const r = await call({ method: 'POST', url: '/api/investments/positions/preview', payload });
      expect(r.statusCode, JSON.stringify(payload).slice(0, 60)).toBe(400);
      expect(r.json().error).toMatch(msg);
    };
    await bad({ text: fixture('wpcu-checking.csv') }, /does not look like a Fidelity positions file/);
    await bad({ text: FILE, priceDate: '2026-12-01' }, /not in the future/);
    await bad({ text: 'x'.repeat(10 * 1024 * 1024 + 1) }, /positions file/);
    await bad({ text: `${HEADER}\nZ1,A,B\u0000,C,1,$1,,,,,,,,,,,` }, /./);
    await bad({ text: 42 }, /positions file/);
    await bad({ text: FILE, mapping: Array.from({ length: 21 }, () => ({ name: 'x', accountId: 1 })) }, /positions file/);
  });
});

describe('positions import and demo mode', () => {
  beforeEach(async () => {
    t = await testApp();
    auth = await setupAndLogin(t);
    responses.length = 0;
  });
  afterEach(async () => {
    await t.app.close();
  });

  it('real files are refused in demo mode; the built-in fake sample works there and never in real mode', async () => {
    expect((await call({ method: 'POST', url: '/api/investments/positions/sample-preview', payload: {} })).statusCode).toBe(403);
    const enter = await call({ method: 'POST', url: '/api/demo/enter' });
    auth = { cookie: cookieFrom(enter), csrf: enter.json().csrfToken };
    const real = await call({ method: 'POST', url: '/api/investments/positions/preview', payload: { text: FILE } });
    expect(real.statusCode).toBe(403);
    expect(real.json().error).toMatch(/Import is turned off in demo mode/);

    const s = await ok({ method: 'POST', url: '/api/investments/positions/sample-preview', payload: {} });
    expect(s.sample).toBe(true);
    expect(s.accounts.every((a: { accountId: number | null }) => a.accountId !== null)).toBe(true);
    const off = (s.funds as { matches: boolean; differenceMicro: number }[]).filter((f) => !f.matches);
    expect(off).toHaveLength(1);
    expect(Math.abs(off[0]!.differenceMicro - 125_000)).toBeLessThanOrEqual(500); // 0.125 shares, plus the file's 3-decimal rounding
    const c = await ok({
      method: 'POST',
      url: '/api/investments/positions/sample-commit',
      payload: { priceDate: s.priceDate, mapping: s.accounts.map((a: { name: string; accountId: number }) => ({ name: a.name, accountId: a.accountId })) },
    });
    expect(c.saved).toBeGreaterThan(0);
    for (const body of responses) expect(body).not.toMatch(/Z0000000\d/);
  });
});
