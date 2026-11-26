/**
 * Fund price history import and the rebuilt investment value history (V2 Phase 2). Fake data only.
 * Fixtures (values invented, layouts in the style of two common finance websites):
 *   price-history-close-adj.csv   Date,Open,High,Low,Close,Adj Close,Volume (ISO dates, newest first)
 *                                 FSKAX-like: $150.00 + $0.25 per weekday, Sep 28 - Nov 2 2026, no rows Oct 12-23
 *   price-history-close-last.csv  Date,Close/Last,Volume,Open,High,Low ($ prices, MM/DD/YYYY, newest first)
 *                                 FTIHX-like: $15.25 + $0.01 per weekday, Sep 28 - Nov 6 2026
 */
import fs from 'node:fs';
import path from 'node:path';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_HEADER, cookieFrom, setupAndLogin, testApp } from './helpers.js';
import { parseCsv } from '../../server/src/lib/csv.js';
import { findHistoryHeader, parseHistory, parseHistoryDate, suggestColumns, toFourDecimals } from '../../server/src/lib/priceHistory.js';
import { PriceLine, valueAccountDaily } from '../../server/src/lib/valuation.js';
import type { Activity } from '../../server/src/lib/investments.js';

const fixture = (n: string) => fs.readFileSync(path.resolve('tests/fixtures/csv', n), 'utf8');
const ADJ = fixture('price-history-close-adj.csv');
const LAST = fixture('price-history-close-last.csv');

describe('reading price history files', () => {
  it('recognizes common column names and never uses Adj Close', () => {
    expect(suggestColumns(['Date', 'Open', 'High', 'Low', 'Close', 'Adj Close', 'Volume'])).toEqual({ dateColumn: 'Date', priceColumn: 'Close' });
    expect(suggestColumns(['Date', 'Close/Last', 'Volume', 'Open', 'High', 'Low'])).toEqual({ dateColumn: 'Date', priceColumn: 'Close/Last' });
    expect(suggestColumns(['Date', 'Open', 'Close*', 'Adj Close**'])).toEqual({ dateColumn: 'Date', priceColumn: 'Close*' });
    expect(suggestColumns(['Date', 'Adj Close'])).toEqual({ dateColumn: 'Date', priceColumn: null });
    expect(suggestColumns(['Day', 'Value'])).toEqual({ dateColumn: null, priceColumn: null });
  });

  it('reads ISO, US and written-out dates; rejects anything else', () => {
    expect(['2026-11-02', '11/02/2026', '1/2/2026', 'Nov 2, 2026', 'November 2 2026'].map(parseHistoryDate)).toEqual([
      '2026-11-02',
      '2026-11-02',
      '2026-01-02',
      '2026-11-02',
      '2026-11-02',
    ]);
    expect(['02.11.2026', '2026-02-30', 'Dividend', ''].map(parseHistoryDate)).toEqual([null, null, null, null]);
  });

  it('rounds long decimals to 4 places with integer math', () => {
    expect(toFourDecimals('258.700012')).toBe('258.7000');
    expect(toFourDecimals('258.700050')).toBe('258.7001');
    expect(toFourDecimals('1,234.99995')).toBe('1235.0000');
    expect(toFourDecimals('15.25')).toBe('15.25');
  });

  it('parses both fixtures and reports bad rows instead of guessing', () => {
    const rows = parseCsv(LAST);
    const p = parseHistory(rows, findHistoryHeader(rows)!, { dateColumn: 'Date', priceColumn: 'Close/Last' }, '2026-11-11');
    expect(p.prices).toHaveLength(30);
    expect(p.prices[0]).toEqual({ date: '2026-09-28', priceE4: 152_500 });
    expect(p.prices.at(-1)).toEqual({ date: '2026-11-06', priceE4: 155_400 });
    const messy = [
      'Date,Close',
      '2026-11-03,100',
      '2026-11-03,101',
      '"Nov 1, 2026",0.25 Dividend',
      '2026-11-20,99',
      '2026-11-04,0',
      'not a date,5',
      '2026-11-05,"1,000.50"',
    ].join('\n');
    const m = parseCsv(messy);
    const q = parseHistory(m, 0, { dateColumn: 'Date', priceColumn: 'Close' }, '2026-11-11');
    expect(q.prices).toEqual([
      { date: '2026-11-03', priceE4: 1_000_000 },
      { date: '2026-11-05', priceE4: 10_005_000 },
    ]);
    expect(q.skipped.map((s) => s.reason)).toEqual([
      '2026-11-03 appears more than once (the first one is used)',
      '"0.25 Dividend" is not a price (for 2026-11-01)',
      '2026-11-20 is in the future',
      'The price for 2026-11-04 is not above $0',
      '"not a date" is not a date',
    ]);
  });
});

describe('price states (pure)', () => {
  const line = new PriceLine([
    { symbol: 'X', asOf: '2026-10-02', priceE4: 1_000_000 }, // Fri
    { symbol: 'X', asOf: '2026-10-05', priceE4: 1_010_000 }, // Mon
    { symbol: 'X', asOf: '2026-10-22', priceE4: 1_027_000 }, // 17 days later
  ]);
  it('known on the day and over a weekend; estimated in a longer gap; stale after; unavailable before', () => {
    expect(line.at('2026-10-02')).toEqual({ priceE4: 1_000_000, state: 'known', ageDays: 0 });
    expect(line.at('2026-10-04')).toEqual({ priceE4: 1_000_000, state: 'known', ageDays: 0 }); // Sunday: Friday's close
    expect(line.at('2026-10-12')).toEqual({ priceE4: 1_017_000, state: 'estimated', ageDays: 0 }); // from Oct 5: 7/17 of 17,000 = 7,000
    expect(line.at('2026-10-06').priceE4).toBe(1_011_000);
    expect(line.at('2026-10-25')).toEqual({ priceE4: 1_027_000, state: 'known', ageDays: 3 });
    expect(line.at('2026-10-31')).toEqual({ priceE4: 1_027_000, state: 'stale', ageDays: 9 }); // never projected
    expect(line.at('2026-10-01')).toEqual({ priceE4: null, state: 'unavailable', ageDays: 0 });
  });
  it('estimated prices round half away from zero, in whole ten-thousandths', () => {
    const l = new PriceLine([
      { symbol: 'X', asOf: '2026-10-01', priceE4: 100 },
      { symbol: 'X', asOf: '2026-10-08', priceE4: 101 },
    ]);
    expect([1, 3, 4, 6].map((n) => l.at(`2026-10-0${1 + n}`).priceE4)).toEqual([100, 100, 101, 101]);
  });
  it('account value = shares x price summed with BigInt and rounded once, + cash; the worst fund state wins', () => {
    const acts: Activity[] = [
      { accountId: 1, date: '2026-10-02', kind: 'transfer_in', symbol: '', quantityMicro: 0, amountCents: 1000, taxYear: null },
      { accountId: 1, date: '2026-10-02', kind: 'buy', symbol: 'X', quantityMicro: 333_333, amountCents: -333, taxYear: null },
      { accountId: 1, date: '2026-10-02', kind: 'buy', symbol: 'Y', quantityMicro: 333_333, amountCents: -333, taxYear: null },
    ];
    const lines = new Map([
      ['X', line],
      ['Y', new PriceLine([{ symbol: 'Y', asOf: '2026-10-02', priceE4: 15 }])],
    ]);
    const days = valueAccountDaily(acts, lines, '2026-10-02', '2026-10-12');
    // X: 0.333333 x $100 = 33.3333; Y: 0.333333 x $0.0015 = 0.0005: rounded once = 33.33 + cash 3.34
    expect(days[0]).toMatchObject({ date: '2026-10-02', valueCents: 3333 + 334, state: 'known' });
    expect(days.at(-1)).toMatchObject({ date: '2026-10-12', state: 'stale', stale: ['Y'], estimated: ['X'], staleDays: 10 });
  });
});

// ---------------------------------------------------------------- API

let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };
const call = (opts: InjectOptions) =>
  t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });
const ok = async (opts: InjectOptions) => {
  const r = await call(opts);
  expect(r.statusCode, r.body).toBeLessThan(300);
  return r.json();
};
let brokerage = 0;
const preview = (symbol: string, text: string, extra: object = {}) =>
  call({ method: 'POST', url: '/api/investments/price-history/preview', payload: { symbol, text, ...extra } });
const commit = (symbol: string, text: string, extra: object = {}) =>
  ok({ method: 'POST', url: '/api/investments/price-history/commit', payload: { symbol, text, ...extra } });
type Point = { date: string; valueCents: number; priceState: string | null; staleDays: number; estimated: string[]; stale: string[]; missing: string[] };
const seriesOn = async (date: string) => ((await ok({ method: 'GET', url: '/api/investments' })).series as Point[]).find((p) => p.date === date)!;

describe('price history API and rebuilt values', () => {
  beforeEach(async () => {
    t = await testApp(); // today = 2026-11-11
    auth = await setupAndLogin(t);
    brokerage = (await ok({ method: 'POST', url: '/api/accounts', payload: { name: 'Brokerage', type: 'brokerage' } })).account.id;
    // Sep 29: $1,500 in, 8 FSKAX @ $150.00 and 19.672 FTIHX @ $15.25
    await ok({ method: 'POST', url: '/api/import/commit', payload: { accountId: brokerage, filename: 'b.csv', text: fixture('fidelity-brokerage.csv') } });
  });
  afterEach(async () => {
    await t.app.close();
  });

  it('preview shows the fund it was started from, the range, the count and skipped rows, and saves nothing', async () => {
    const r = await preview('FSKAX', ADJ);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      symbol: 'FSKAX',
      name: 'FIDELITY TOTAL MARKET INDEX FUND',
      needsColumns: false,
      columns: { dateColumn: 'Date', priceColumn: 'Close' },
      columnsSource: 'recognized',
      count: 16,
      first: '2026-09-28',
      last: '2026-11-02',
      skippedCount: 0,
      adjustedWarning: false,
      mismatch: null,
      existing: null,
    });
    expect(t.store.current().prepare("SELECT COUNT(*) AS n FROM price_points WHERE source = 'history'").get()).toEqual({ n: 0 });
  });

  it('the file is saved only to the fund it was started from; a file that looks like another fund is flagged, not redirected', async () => {
    // The FSKAX-like file imported from the FTIHX row: prices ~10x apart from FTIHX's Fidelity price.
    const p = (await preview('FTIHX', ADJ)).json();
    expect(p.mismatch).toMatchObject({ comparedDays: 1 });
    expect(p.mismatch.typicalDiffBp).toBeGreaterThan(1000);
    await commit('FSKAX', ADJ);
    const syms = t.store.current().prepare("SELECT DISTINCT symbol FROM price_points WHERE source = 'history'").all();
    expect(syms).toEqual([{ symbol: 'FSKAX' }]);
    expect((await preview('NOPE', ADJ)).json().error).toMatch(/does not know a fund called NOPE/);
    expect((await preview('fs kax', ADJ)).statusCode).toBe(400);
  });

  it('unrecognized columns are picked once and remembered per fund', async () => {
    const odd = LAST.replace('Date,Close/Last', 'Day,Last Sale');
    const p = (await preview('FTIHX', odd)).json();
    expect(p).toMatchObject({ needsColumns: true, columns: null, headers: ['Day', 'Last Sale', 'Volume', 'Open', 'High', 'Low'] });
    expect((await call({ method: 'POST', url: '/api/investments/price-history/commit', payload: { symbol: 'FTIHX', text: odd } })).statusCode).toBe(400);
    const bad = await preview('FTIHX', odd, { columns: { dateColumn: 'Day', priceColumn: 'Day' } });
    expect(bad.json().error).toMatch(/different columns/);
    expect((await commit('FTIHX', odd, { columns: { dateColumn: 'Day', priceColumn: 'Last Sale' } })).saved).toBe(30);
    expect((await preview('FTIHX', odd)).json()).toMatchObject({ columnsSource: 'saved', count: 30 });
  });

  it('values are rebuilt from shares on each day x that day\'s close, rounded to the cent once', async () => {
    await commit('FSKAX', ADJ);
    await commit('FTIHX', LAST);
    // Sep 29: history closes beat Fidelity's purchase prices. 8 x 150.25 + 19.672 x 15.26 = 1502.19472
    expect(await seriesOn('2026-09-29')).toMatchObject({ valueCents: 150219, priceState: 'known' });
    // Saturday Oct 31: Friday's closes (156.00, 15.49), market closed, not an estimate
    expect(await seriesOn('2026-10-31')).toMatchObject({ valueCents: 124800 + 30472, priceState: 'known' });
  });

  it('days inside a gap are straight-line estimates and labeled; after the last close the price is stale, never extrapolated', async () => {
    await commit('FSKAX', ADJ);
    await commit('FTIHX', LAST);
    // Oct 16: FSKAX between 152.25 (Oct 9) and 155.00 (Oct 26): 153.3824; FTIHX 15.39 known
    expect(await seriesOn('2026-10-16')).toMatchObject({ valueCents: 152981, priceState: 'estimated', estimated: ['FSKAX'] });
    // Today Nov 11: last FSKAX close Nov 2 (9 days), FTIHX Nov 6 (5 days): stale, last prices as they were
    expect(await seriesOn('2026-11-11')).toMatchObject({ valueCents: 125000 + 30570, priceState: 'stale', staleDays: 9, stale: ['FSKAX', 'FTIHX'] });
    const inv = await ok({ method: 'GET', url: '/api/investments' });
    expect(inv.holdings.find((h: { symbol: string }) => h.symbol === 'FSKAX')).toMatchObject({
      priceState: 'stale',
      priceAgeDays: 9,
      history: { count: 16, first: '2026-09-28', last: '2026-11-02' },
    });
  });

  it('a fund with no price at all is unavailable: no value is invented, the account keeps its last value', async () => {
    await commit('FSKAX', ADJ);
    await commit('FTIHX', LAST);
    // Two shares of a fund Arc40 has never seen a price for, as of Oct 1.
    await ok({ method: 'POST', url: '/api/investments/shares', payload: { accountId: brokerage, symbol: 'FXAIX', shares: '2', asOf: '2026-10-01' } });
    const sep30 = await seriesOn('2026-09-30');
    const oct5 = await seriesOn('2026-10-05');
    expect(oct5).toMatchObject({ priceState: 'unavailable', missing: ['FXAIX'] });
    expect(oct5.valueCents).toBe(sep30.valueCents); // no money moved: the last value stands
  });

  it('every screen agrees: net worth, Investments, account card and account history all end at the same value', async () => {
    await commit('FSKAX', ADJ);
    await commit('FTIHX', LAST);
    const inv = await ok({ method: 'GET', url: '/api/investments' });
    const nw = await ok({ method: 'GET', url: '/api/networth?range=all' });
    const card = (await ok({ method: 'GET', url: '/api/accounts' })).accounts.find((a: { id: number }) => a.id === brokerage);
    const detail = await ok({ method: 'GET', url: `/api/accounts/${brokerage}` });
    expect(inv.totals.valueCents).toBe(155570);
    expect(nw.current.totalCents).toBe(155570);
    expect(card.balanceCents).toBe(155570);
    expect(detail.history.at(-1)).toMatchObject({ date: '2026-11-11', cents: 155570, state: 'stale', staleDays: 9 });
    expect(nw.series.find((p: { date: string }) => p.date === '2026-10-16')).toMatchObject({ priceState: 'estimated' });
    // Money put in is never touched by prices; growth = value - put in.
    expect(inv.totals).toMatchObject({ putInCents: 150000, growthCents: 5570 });
  });

  it('removing a fund\'s price history falls back to the other sources', async () => {
    await commit('FSKAX', ADJ);
    expect((await ok({ method: 'DELETE', url: '/api/investments/price-history/FSKAX' })).removed).toBe(16);
    expect(await seriesOn('2026-09-29')).toMatchObject({ valueCents: 150000 });
  });

  it('untrusted files: limits, NUL bytes and junk are refused with plain messages', async () => {
    expect((await preview('FSKAX', 'x'.repeat(10 * 1024 * 1024 + 1))).statusCode).toBe(400);
    expect((await preview('FSKAX', 'Date,Close\n2026-11-02,1\u0000')).statusCode).toBe(400);
    expect((await preview('FSKAX', 'Date,Close\nfoo,bar\n')).json().error).toMatch(/No usable prices/);
    expect((await preview('FSKAX', '')).json().error).toBeTruthy();
    expect((await call({ method: 'POST', url: '/api/investments/price-history/preview', payload: { text: ADJ } })).json().error).toBe('Pick a fund.');
  });
});

describe('price history and demo mode', () => {
  beforeEach(async () => {
    t = await testApp();
    auth = await setupAndLogin(t);
  });
  afterEach(async () => {
    await t.app.close();
  });

  it('real files are refused in demo mode; the fake sample (with an Adj Close column) works there only', async () => {
    expect((await call({ method: 'POST', url: '/api/investments/price-history/sample-preview', payload: { symbol: 'FXAIX' } })).statusCode).toBe(403);
    const enter = await call({ method: 'POST', url: '/api/demo/enter' });
    auth = { cookie: cookieFrom(enter), csrf: enter.json().csrfToken };
    expect((await preview('FXAIX', ADJ)).statusCode).toBe(403);
    const s = await ok({ method: 'POST', url: '/api/investments/price-history/sample-preview', payload: { symbol: 'FXAIX' } });
    expect(s).toMatchObject({ sample: true, symbol: 'FXAIX', columns: { priceColumn: 'Close' } });
    expect(s.count).toBeGreaterThan(100);
    const c = await ok({ method: 'POST', url: '/api/investments/price-history/sample-commit', payload: { symbol: 'FXAIX' } });
    expect(c.saved).toBe(s.count);
    // The demo data itself shows every state on its investment chart.
    const states = new Set(((await ok({ method: 'GET', url: '/api/investments' })).series as Point[]).map((p) => p.priceState));
    for (const st of ['known', 'estimated', 'unavailable']) expect(states.has(st), st).toBe(true);
  });
});
