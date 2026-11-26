/**
 * Trophy Case, Round 2 (Milestone 2): the 28 Investing trophies. Fake numbers only; every example is small enough to
 * check by hand in the comments. D = one dollar in cents.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '../../shared/dates.js';
import { TROPHIES } from '../../shared/trophies.js';
import { dailySeries, TrophyData } from '../../server/src/lib/trophies/data.js';
import type { Day } from '../../server/src/lib/trophies/hold.js';
import {
  dailyGains,
  invBestDay,
  invDownMonth,
  invFirstShare,
  invFunds,
  invGrowthBeatsPutIn,
  invGrowthBeatsSpending,
  invGrowthHold,
  invMonthStreak,
  invPassCash,
  invWorthHold,
  isMoneyMarket,
  monthStreak,
  monthTotals,
  previousWeekday,
  type InvestFacts,
} from '../../server/src/lib/trophies/investingRules.js';
import type { PriceState } from '../../server/src/lib/valuation.js';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';

const D = 100;
const A = (today = '2026-11-11', from: string | null = null) => ({ today, from, year: null });

/** One Day per calendar day from start through end, value from fn (dollars, or null). */
function fill(start: string, end: string, fn: (date: string, i: number) => number | null): Day[] {
  const out: Day[] = [];
  for (let d = start, i = 0; d <= end; d = addDays(d, 1), i++) {
    const v = fn(d, i);
    out.push({ date: d, cents: v === null ? null : Math.round(v * D) });
  }
  return out;
}
function facts(p: Partial<InvestFacts> = {}): InvestFacts {
  const empty = dailySeries([]);
  return {
    worth: empty,
    cash: empty,
    growth: empty,
    putIn: empty,
    moneyIn: [],
    funds: [],
    heldOn: () => ['FXAIX'],
    realClose: () => true,
    priceState: () => 'known',
    yearSpending: () => 0,
    ...p,
  };
}

describe('catalog', () => {
  it('has the 28 Investing trophies with the right ranks and shapes; only Growth beat a year of spending starts from today', () => {
    const inv = TROPHIES.filter((t) => t.group === 'investing');
    expect(inv).toHaveLength(28);
    const row = (id: string) => inv.filter((t) => t.id.startsWith(id)).map((t) => [t.subtitle.split(', held')[0], t.rank, t.stars ?? 0, t.shape]);
    expect(row('inv.worth.')).toEqual([
      ['$10,000', 'bronze', 0, 'coin'],
      ['$25,000', 'silver', 0, 'coin'],
      ['$50,000', 'gold', 0, 'coin'],
      ['$100,000', 'platinum', 0, 'coin'],
      ['$250,000', 'obsidian', 0, 'coin'],
      ['$500,000', 'emerald', 0, 'coin'],
      ['$1,000,000', 'diamond', 0, 'coin'],
      ['$2,000,000', 'arc40', 0, 'coin'],
      ['$5,000,000', 'arc40', 1, 'coin'],
    ]);
    expect(inv.filter((t) => t.id.startsWith('inv.growth.')).map((t) => [t.name, t.rank])).toEqual([
      ['Growth $1k', 'copper'],
      ['Growth $10k', 'silver'],
      ['Growth $50k', 'gold'],
      ['Growth $100k', 'platinum'],
      ['Growth $250k', 'emerald'],
      ['Growth $500k', 'ruby'],
      ['Growth $1M', 'diamond'],
    ]);
    expect(inv.filter((t) => t.id.startsWith('inv.streak.')).map((t) => [t.id, t.rank, t.shape])).toEqual([
      ['inv.streak.6', 'silver', 'cup'],
      ['inv.streak.12', 'gold', 'cup'],
      ['inv.streak.24', 'platinum', 'cup'],
      ['inv.streak.36', 'obsidian', 'cup'],
      ['inv.streak.60', 'diamond', 'cup'],
    ]);
    const single = Object.fromEntries(inv.filter((t) => !t.ladder).map((t) => [t.id, [t.rank, t.shape, t.defaultMode]]));
    expect(single).toEqual({
      'inv.first-share': ['iron', 'statuette', 'history'],
      'inv.pass-cash': ['gold', 'statuette', 'history'],
      'inv.growth-beats-put-in': ['ruby', 'statuette', 'history'],
      'inv.growth-beats-spending': ['ruby', 'statuette', 'today'],
      'inv.down-month': ['gold', 'statuette', 'history'],
      'inv.funds.3': ['bronze', 'statuette', 'history'],
      'inv.best-day': ['silver', 'plaque', 'history'],
    });
  });
});

describe('balance holds (30-day rule)', () => {
  it('Investments worth: exactly $10,000 for 30 days earns on day 30; day 29 is not enough', () => {
    // Jan 1 .. Jan 30 = 30 days at exactly $10,000.00 -> earned Jan 30.
    const f = facts({ worth: dailySeries(fill('2026-01-01', '2026-01-30', () => 10_000)) });
    expect(invWorthHold(f, 10_000 * D, A()).earned).toMatchObject({
      date: '2026-01-30',
      sentence: 'Your investments stayed at or above $10,000 for 30 days in a row, from Jan 1 to Jan 30, 2026.',
    });
    // Only 29 days (Jan 1 .. Jan 29): held 29 of 30.
    const f29 = facts({ worth: dailySeries(fill('2026-01-01', '2026-01-29', () => 10_000)) });
    const o = invWorthHold(f29, 10_000 * D, A());
    expect(o.earned).toBeNull();
    expect(o.progress.text).toBe('Held 29 of 30 days');
  });

  it('one cent under on day 15 restarts the count (earned on Feb 14, day 30 of the new run)', () => {
    const f = facts({ worth: dailySeries(fill('2026-01-01', '2026-03-01', (d) => (d === '2026-01-15' ? 9_999.99 : 10_000))) });
    expect(invWorthHold(f, 10_000 * D, A()).earned!.date).toBe('2026-02-14'); // Jan 16..31 = 16 days + Feb 1..14 = 30
  });

  it('Growth: growth (value - money put in) at or above $1,000 for 30 days; Start from today counts only from the turn-on day', () => {
    const f = facts({ growth: dailySeries(fill('2026-01-01', '2026-03-31', () => 1_000)) });
    expect(invGrowthHold(f, 1_000 * D, A()).earned!.date).toBe('2026-01-30');
    expect(invGrowthHold(f, 1_000 * D, A('2026-11-11', '2026-03-01')).earned!.date).toBe('2026-03-30');
    expect(invGrowthHold(f, 1_000 * D + 1, A()).earned).toBeNull(); // $1,000.00 is one cent under $1,000.01
  });

  it('Investments pass cash: investments must be MORE than all cash (equal does not count) and above $0', () => {
    // Investments $5,000; cash $5,000 for the first 10 days (equal), then $4,999.99.
    const worth = dailySeries(fill('2026-01-01', '2026-02-28', () => 5_000));
    const cash = dailySeries(fill('2026-01-01', '2026-02-28', (_d, i) => (i < 10 ? 5_000 : 4_999.99)));
    expect(invPassCash(facts({ worth, cash }), A()).earned!.date).toBe('2026-02-09'); // Jan 11 + 29 days
    // No investments and no cash: $0 > $0 is false, never earned.
    const zero = dailySeries(fill('2026-01-01', '2026-02-28', () => 0));
    expect(invPassCash(facts({ worth: zero, cash: zero }), A()).earned).toBeNull();
  });

  it('Growth beats money put in: growth $2,000.01 vs $2,000 put in counts; equal does not; $0 put in never', () => {
    const putIn = dailySeries(fill('2026-01-01', '2026-02-28', () => 2_000));
    const equal = facts({ putIn, growth: dailySeries(fill('2026-01-01', '2026-02-28', () => 2_000)) });
    expect(invGrowthBeatsPutIn(equal, A()).earned).toBeNull();
    const more = facts({ putIn, growth: dailySeries(fill('2026-01-01', '2026-02-28', () => 2_000.01)) });
    expect(invGrowthBeatsPutIn(more, A()).earned!.date).toBe('2026-01-30');
    const none = facts({ putIn: dailySeries(fill('2026-01-01', '2026-02-28', () => 0)), growth: dailySeries(fill('2026-01-01', '2026-02-28', () => 5)) });
    expect(invGrowthBeatsPutIn(none, A()).earned).toBeNull();
  });
});

describe('Invested every month in a row', () => {
  const rows = (list: [string, number][]) => list.map(([date, d]) => ({ date, cents: Math.round(d * D) }));
  // $100 on the 10th of every month Jan..Jun 2026.
  const sixMonths = rows([
    ['2026-01-10', 100],
    ['2026-02-10', 100],
    ['2026-03-10', 100],
    ['2026-04-10', 100],
    ['2026-05-10', 100],
    ['2026-06-10', 100],
  ]);

  it('6 months in a row earns on the day the 6th month went above $0', () => {
    const o = invMonthStreak(facts({ moneyIn: sixMonths }), 6, A('2026-11-11'));
    expect(o.earned).toMatchObject({ date: '2026-06-10', sentence: 'You put money into your investments every month for 6 months in a row, January 2026 to June 2026.' });
  });

  it('a skipped month breaks the run', () => {
    const skip = sixMonths.filter((r) => !r.date.startsWith('2026-03'));
    expect(invMonthStreak(facts({ moneyIn: skip }), 6, A('2026-11-11')).earned).toBeNull();
  });

  it('a month whose money in nets to $0 or less (a $100 transfer out) breaks the run too', () => {
    const net0 = [...sixMonths, { date: '2026-03-20', cents: -100 * D }].sort((a, b) => (a.date < b.date ? -1 : 1));
    expect(invMonthStreak(facts({ moneyIn: net0 }), 6, A('2026-11-11')).earned).toBeNull();
  });

  it('the current month: counts once money has gone in, otherwise neither counts nor breaks', () => {
    // Jan..May finished (5 months), today Jun 5 with nothing in yet: run 5, not broken.
    const five = sixMonths.slice(0, 5);
    const waiting = invMonthStreak(facts({ moneyIn: five }), 6, A('2026-06-05'));
    expect(waiting.earned).toBeNull();
    expect(waiting.progress).toMatchObject({ text: '5 of 6 months in a row', need: 'Put money in this month to keep the run going' });
    // Money goes in on Jun 3: June counts right away (earned Jun 3, before June ends).
    const inNow = [...five, { date: '2026-06-03', cents: 50 * D }];
    expect(invMonthStreak(facts({ moneyIn: inNow }), 6, A('2026-06-05')).earned!.date).toBe('2026-06-03');
    // Today Jul 2 and June stayed empty: June is finished at $0 and breaks the run.
    expect(invMonthStreak(facts({ moneyIn: five }), 6, A('2026-07-02')).progress.text).toBe('0 of 6 months in a row');
  });

  it('the earned day is the day the month last rose above $0 (in $50, out $80, in $40 -> Jun 25)', () => {
    const t = monthTotals(rows([['2026-06-01', 50], ['2026-06-10', -80], ['2026-06-25', 40]]), null);
    expect(t.get('2026-06')).toEqual({ month: '2026-06', total: 10 * D, upOn: '2026-06-25' });
    expect(monthStreak(t, '2026-06', '2026-07-01', 1).earned).toEqual({ month: '2026-06', date: '2026-06-25', startMonth: '2026-06' });
  });
});

describe('funds', () => {
  it('money market and core positions are cash, not funds', () => {
    expect(isMoneyMarket('SPAXX', '')).toBe(true);
    expect(isMoneyMarket('SPAXX**', 'HELD IN MONEY MARKET')).toBe(true);
    expect(isMoneyMarket('FAKEX', 'Fake Government Money Market Fund')).toBe(true);
    expect(isMoneyMarket('FXAIX', 'Fidelity 500 Index Fund')).toBe(false);
  });

  it('First share: the first day a fund is held; Start from today only from the turn-on day', () => {
    const funds = [
      { date: '2026-01-01', symbols: [] },
      { date: '2026-01-02', symbols: ['FXAIX'] },
      { date: '2026-01-03', symbols: ['FXAIX'] },
    ];
    expect(invFirstShare(facts({ funds }), A()).earned).toMatchObject({ date: '2026-01-02', sentence: 'You first held shares on Jan 2, 2026: FXAIX.' });
    expect(invFirstShare(facts({ funds }), A('2026-11-11', '2026-01-03')).earned!.date).toBe('2026-01-03');
  });

  it('Own 3+ funds: three different funds on the SAME day (2 then 3)', () => {
    const funds = [
      { date: '2026-01-01', symbols: ['FSKAX', 'FXAIX'] },
      { date: '2026-01-02', symbols: ['FSKAX', 'FTIHX', 'FXAIX'] },
    ];
    expect(invFunds(facts({ funds }), 3, A()).earned).toMatchObject({ date: '2026-01-02', sentence: 'On Jan 2, 2026 you held 3 different funds at once: FSKAX, FTIHX, FXAIX.' });
    expect(invFunds(facts({ funds: funds.slice(0, 1) }), 3, A()).progress.text).toBe('2 of 3 funds (FSKAX, FXAIX)');
  });
});

describe('Kept investing in a down month', () => {
  // Value at the end of Jan 31 = $10,000 (all money put in, growth $0). In February $100 more goes in and the market
  // takes `loss` dollars: growth on Feb 28 = -loss, put in = $10,100.
  const month = (loss: number, putInFeb = 100, today = '2026-03-10', state: (d: string) => PriceState = () => 'known') =>
    facts({
      growth: dailySeries(fill('2026-01-31', '2026-03-10', (d) => (d < '2026-02-01' ? 0 : -loss))),
      putIn: dailySeries(fill('2026-01-31', '2026-03-10', (d) => (d < '2026-02-01' ? 10_000 : 10_000 + putInFeb))),
      priceState: state,
      ...(today ? {} : {}),
    });

  it('exactly 5% ($500 of $10,000) counts; 4.99% ($499) does not', () => {
    expect(invDownMonth(month(500), A('2026-03-10')).earned).toMatchObject({
      date: '2026-02-28',
      sentence: 'In February 2026 the market took 5.0% ($500) off your investments, and you still put in $100.',
    });
    const o = invDownMonth(month(499), A('2026-03-10'));
    expect(o.earned).toBeNull();
    expect(o.progress.text).toBe('Worst month so far: down 4.9% (February 2026)');
  });

  it('no money put in that month does not count; a month not finished yet does not count', () => {
    expect(invDownMonth(month(800, 0), A('2026-03-10')).earned).toBeNull();
    expect(invDownMonth(month(800), A('2026-02-28')).earned).toBeNull(); // Feb 28 is today: not over yet
  });

  it('a month whose first or last day has no price data is skipped', () => {
    expect(invDownMonth(month(800, 100, '2026-03-10', (d) => (d === '2026-02-28' ? 'unavailable' : 'known')), A('2026-03-10')).earned).toBeNull();
  });
});

describe('Growth beat a year of spending (Start from today suggested)', () => {
  // Growth on Dec 31, 2024 = $1,000; on Dec 31, 2025 = $6,000 -> 2025 growth $5,000.
  const f = (spent: number) =>
    facts({
      growth: dailySeries(fill('2024-12-31', '2026-03-01', (d) => (d < '2025-12-31' ? 1_000 : 6_000))),
      yearSpending: (y) => (y === 2025 ? Math.round(spent * D) : 0),
    });

  it('$5,000 growth vs $4,999.99 spent counts (dated Dec 31); equal does not; $0 spending does not', () => {
    expect(invGrowthBeatsSpending(f(4_999.99), A('2026-03-01')).earned).toMatchObject({
      date: '2025-12-31',
      sentence: 'In 2025 your investments grew $5,000 from the market, more than the $4,999.99 you spent that year.',
    });
    expect(invGrowthBeatsSpending(f(5_000), A('2026-03-01')).earned).toBeNull();
    expect(invGrowthBeatsSpending(f(0), A('2026-03-01')).earned).toBeNull();
  });

  it('Count my history finds 2025; Start from today turned on in 2026 waits for a year that ends after that day', () => {
    expect(invGrowthBeatsSpending(f(4_000), A('2026-03-01', null)).earned!.date).toBe('2025-12-31');
    expect(invGrowthBeatsSpending(f(4_000), A('2026-03-01', '2026-01-15')).earned).toBeNull();
    expect(invGrowthBeatsSpending(f(4_000), A('2026-03-01', '2025-06-01')).earned!.date).toBe('2025-12-31'); // turned on before 2025 ended
  });

  it('the current year never counts before it ends', () => {
    expect(invGrowthBeatsSpending(f(4_000), A('2025-12-31')).earned).toBeNull();
  });
});

describe('Best day ever (record plaque)', () => {
  // History starts Thu Jan 1, 2026 with growth $0; 3 months later = Apr 1. Gains (growth change from the weekday before):
  //   Mon Feb 2 +$50 (before Apr 1: sets the bar, not a record)  Mon Apr 6 +$40 (below $50)  Tue Apr 7 +$60 (FIRST RECORD)
  //   Fri Apr 10 +$500 on an ESTIMATED price day (not counted), back down on Mon Apr 13 (its Friday is not real: skipped)
  //   Mon Apr 20 +$70 vs Fri Apr 17 (a weekend in between: record 2)
  const jumps: Record<string, number> = { '2026-02-02': 50, '2026-04-06': 40, '2026-04-07': 60, '2026-04-20': 70 };
  const weekend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());
  const growth = fill('2026-01-01', '2026-05-01', (d) => {
    let g = 0;
    for (const [k, v] of Object.entries(jumps)) if (d >= k) g += v;
    if (d === '2026-04-10') g += 500;
    return g;
  });
  const f = facts({
    growth: dailySeries(growth),
    realClose: (_s, d) => !weekend(d),
    priceState: (d) => (d === '2026-04-10' ? 'estimated' : 'known'),
  });

  it('weekday pairs only: Monday compares with Friday', () => {
    expect(previousWeekday('2026-04-20')).toBe('2026-04-17');
    expect(previousWeekday('2026-04-07')).toBe('2026-04-06');
    const gains = Object.fromEntries(dailyGains(f).filter((g) => g.cents !== 0).map((g) => [g.date, g.cents]));
    expect(gains).toEqual({ '2026-02-02': 50 * D, '2026-04-06': 40 * D, '2026-04-07': 60 * D, '2026-04-20': 70 * D });
  });

  it('earned on the first record after 3 months; every later record is kept; the estimated day never counts', () => {
    const o = invBestDay(f, A('2026-05-01'));
    expect(o.earned).toMatchObject({ date: '2026-04-07', sentence: 'Your investments gained $60 from the market on Apr 7, 2026, your best day yet.' });
    expect(o.records).toEqual([
      { period: '2026-04-07', amountCents: 60 * D, setOn: '2026-04-07' },
      { period: '2026-04-20', amountCents: 70 * D, setOn: '2026-04-20' },
    ]);
  });

  it('a day missing one fund\'s real close does not count (FTIHX has no close on Apr 7)', () => {
    const g = invBestDay(facts({ ...f, heldOn: () => ['FTIHX', 'FXAIX'], realClose: (s, d) => !weekend(d) && !(s === 'FTIHX' && d === '2026-04-07') }), A('2026-05-01'));
    expect(g.earned!.date).toBe('2026-04-20');
  });

  it('Start from today: only records on or after the turn-on day', () => {
    expect(invBestDay(f, A('2026-05-01', '2026-04-08')).earned!.date).toBe('2026-04-20');
  });
});

// ------------------------------------------------------------------- through the app

describe('Investing trophies in the app', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let auth: { cookie: string; csrf: string };
  let brokerage: number;
  let savings: number;
  const call = (o: { method: 'GET' | 'POST'; url: string; payload?: unknown }) =>
    t.app.inject({ ...o, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf } } as never);
  const act = (date: string, kind: string, symbol: string, qtyMicro: number, cents: number) =>
    t.db
      .prepare('INSERT INTO investment_activity (account_id, date, kind, symbol, quantity_micro, amount_cents, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
      .run(brokerage, date, kind, symbol, qtyMicro, cents, 'manual');
  const price = (symbol: string, date: string, dollars: number) => {
    t.db.prepare('INSERT OR IGNORE INTO securities (symbol, name) VALUES (?, ?)').run(symbol, symbol === 'SPAXX' ? 'Government Money Market' : `${symbol} fake fund`);
    t.db.prepare("INSERT INTO price_points (symbol, as_of, source, price_e4) VALUES (?, ?, 'history', ?)").run(symbol, date, Math.round(dollars * 10_000));
  };

  beforeEach(async () => {
    t = await testApp(); // today = 2026-11-11
    auth = await setupAndLogin(t);
    brokerage = (await call({ method: 'POST', url: '/api/accounts', payload: { name: 'Fake Brokerage', institution: 'Test', type: 'brokerage' } })).json().account.id;
    savings = (
      await call({ method: 'POST', url: '/api/accounts', payload: { name: 'Fake Savings', institution: 'Test', type: 'savings', openingBalance: '3000', openingDate: '2026-01-01' } })
    ).json().account.id;
    // Jan 2: put in $12,000 and buy 100 shares of FAKEA at $100 and 10 of FAKEB at $100; SPAXX money market 500 shares.
    act('2026-01-02', 'contribution', '', 0, 1_200_000);
    act('2026-01-02', 'buy', 'FAKEA', 100_000_000, -1_000_000);
    act('2026-01-02', 'buy', 'FAKEB', 10_000_000, -100_000);
    act('2026-01-02', 'buy', 'SPAXX', 500_000_000, -50_000);
    for (let d = '2026-01-02'; d <= '2026-11-11'; d = addDays(d, 1)) {
      price('FAKEA', d, 100);
      price('FAKEB', d, 100);
      price('SPAXX', d, 1);
    }
  });
  afterEach(async () => t.app.close());

  it('worth $10k is earned on day 30; investments are $12,000 every day (shares x price + cash)', async () => {
    const data = new TrophyData(t.db, '2026-11-11');
    expect(data.investing.worth.on('2026-02-01')).toBe(1_200_000);
    expect(data.investing.growth.on('2026-02-01')).toBe(0);
    expect(data.investing.funds.at(-1)!.symbols).toEqual(['FAKEA', 'FAKEB']); // SPAXX is cash
    const on = (await call({ method: 'POST', url: '/api/trophies/inv.worth.10k/on', payload: { mode: 'history' } })).json();
    expect(on.earned).toEqual([{ key: 'inv.worth.10k', name: 'Investments worth $10k', rankLabel: 'Bronze · Rank 3', earnedOn: '2026-01-31' }]);
    // Pass cash: $12,000 vs $3,000 savings from Jan 2 -> day 30 = Jan 31.
    expect((await call({ method: 'POST', url: '/api/trophies/inv.pass-cash/on', payload: { mode: 'history' } })).json().earned[0].earnedOn).toBe('2026-01-31');
    // Only 2 funds: Own 3+ funds stays On with "2 of 3 funds".
    await call({ method: 'POST', url: '/api/trophies/inv.funds.3/on', payload: { mode: 'history' } });
    const v = (await call({ method: 'GET', url: '/api/trophies/inv.funds.3' })).json();
    expect([v.state, v.progress.text]).toEqual(['on', '2 of 3 funds (FAKEA, FAKEB)']);
  });

  it('a 6% market drop in a month you put money in earns Kept investing in a down month', async () => {
    // March: FAKEA falls from $100 to $93.40 at the end of March (-$660 on 100 shares); FAKEB unchanged. $200 put in.
    // Value Feb 28 = $12,000. Move = -$660 = 5.5% of $12,000 -> earned Mar 31.
    t.db.prepare("UPDATE price_points SET price_e4 = 934000 WHERE symbol = 'FAKEA' AND as_of >= '2026-03-31'").run();
    act('2026-03-15', 'contribution', '', 0, 20_000);
    const r = (await call({ method: 'POST', url: '/api/trophies/inv.down-month/on', payload: { mode: 'history' } })).json();
    expect(r.earned).toMatchObject([{ key: 'inv.down-month', earnedOn: '2026-03-31' }]);
    const v = (await call({ method: 'GET', url: '/api/trophies/inv.down-month' })).json();
    expect(v.sentence).toBe('In March 2026 the market took 5.5% ($660) off your investments, and you still put in $200.');
  });

  it('turning on the whole Investing shelf awards what qualifies and GETs still never write', async () => {
    const r = (await call({ method: 'POST', url: '/api/trophies/groups/investing/on' })).json();
    expect(r.turnedOn).toBe(28);
    expect(r.earned.map((e: { key: string }) => e.key).sort()).toEqual(['inv.first-share', 'inv.pass-cash', 'inv.worth.10k']);
    const dump = () => JSON.stringify(t.db.prepare('SELECT * FROM trophy_states ORDER BY trophy_key').all());
    const before = dump();
    await call({ method: 'GET', url: '/api/trophies' });
    await call({ method: 'GET', url: '/api/trophies/inv.best-day' });
    expect(dump()).toBe(before);
    // Growth beat a year of spending was turned on with its suggested Start from today.
    const s = t.db.prepare("SELECT mode FROM trophy_states WHERE trophy_key = 'inv.growth-beats-spending'").get() as { mode: string };
    expect(s.mode).toBe('today');
    void savings;
  });
});
