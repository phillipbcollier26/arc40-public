/**
 * Trophy Case, Round 3 (Milestone 2): the 19 Emergency fund and savings trophies. Fake numbers only; every example is
 * small enough to check by hand in the comments. D = one dollar in cents.
 *
 * Most pure examples use a fixed monthly amount of $1,000 ("need"), so months covered = savings / $1,000:
 * $6,000 = exactly 6.00 months, $5,999.99 = 5.99 (just under).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TROPHIES } from '../../shared/trophies.js';
import { everyDay, type Day } from '../../server/src/lib/trophies/hold.js';
import { dailySeries, TrophyData } from '../../server/src/lib/trophies/data.js';
import {
  covers,
  emFundedStreak,
  emInterest,
  emMonthsHold,
  emRefill,
  emSavingsHold,
  monthsCovered,
  type EmergencyFacts,
} from '../../server/src/lib/trophies/emergencyRules.js';
import { averageSpending } from '../../server/src/lib/emergency.js';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';

const D = 100;
const A = (today = '2026-11-11', from: string | null = null) => ({ today, from, year: null });

/** Savings days from `start`, one value (dollars) per day; null = no data yet. */
function days(start: string, values: (number | null)[]): Day[] {
  const dates = everyDay(start, '2099-12-31').slice(0, values.length);
  return values.map((v, i) => ({ date: dates[i]!, cents: v === null ? null : Math.round(v * D) }));
}
/** `n` days of the same dollar value. */
const same = (n: number, v: number | null) => Array.from({ length: n }, () => v);

function facts(savings: Day[], p: Partial<EmergencyFacts> & { needDollars?: number | ((date: string) => number | null) } = {}): EmergencyFacts {
  const nd = p.needDollars ?? 1000;
  return {
    hasSavingsAccount: true,
    savings: dailySeries(savings),
    need: (date) => {
      const v = typeof nd === 'function' ? nd(date) : nd;
      return v === null ? null : Math.round(v * D);
    },
    hasInterestCategory: true,
    interest: [],
    ...p,
  };
}

describe('catalog', () => {
  it('has the 19 Emergency fund and savings trophies; only savings balance and interest suggest Count my history', () => {
    const e = TROPHIES.filter((t) => t.group === 'emergency');
    expect(e.map((t) => [t.id, t.rank, t.shape, t.defaultMode])).toEqual([
      ['em.months.1', 'bronze', 'coin', 'today'],
      ['em.months.3', 'silver', 'coin', 'today'],
      ['em.months.6', 'gold', 'coin', 'today'],
      ['em.months.9', 'rose_gold', 'coin', 'today'],
      ['em.months.12', 'platinum', 'coin', 'today'],
      ['em.funded.12', 'platinum', 'cup', 'today'],
      ['em.funded.24', 'obsidian', 'cup', 'today'],
      ['em.funded.36', 'emerald', 'cup', 'today'],
      ['em.savings.5k', 'copper', 'coin', 'history'],
      ['em.savings.10k', 'bronze', 'coin', 'history'],
      ['em.savings.25k', 'silver', 'coin', 'history'],
      ['em.savings.50k', 'gold', 'coin', 'history'],
      ['em.savings.100k', 'platinum', 'coin', 'history'],
      ['em.interest.100', 'iron', 'coin', 'history'],
      ['em.interest.1k', 'silver', 'coin', 'history'],
      ['em.interest.5k', 'gold', 'coin', 'history'],
      ['em.interest.10k', 'platinum', 'coin', 'history'],
      ['em.interest.25k', 'emerald', 'coin', 'history'],
      ['em.refill', 'rose_gold', 'statuette', 'today'],
    ]);
    expect(TROPHIES.find((t) => t.id === 'em.interest.100')!.name).toBe('$100 of interest');
  });
});

describe('months covered (30-day rule)', () => {
  it('exactly 6.00 months counts; one cent under (5.99) does not', () => {
    // need $1,000: $6,000 for 30 days from Mar 1 -> earned Mar 30.
    const ok = emMonthsHold(facts(days('2026-03-01', same(30, 6000))), 6, A('2026-03-30'));
    expect(ok.earned).toMatchObject({
      date: '2026-03-30',
      sentence: 'Your savings covered 6 months of spending for 30 days in a row, from Mar 1 to Mar 30, 2026.',
    });
    const short = emMonthsHold(facts(days('2026-03-01', same(30, 5999.99))), 6, A('2026-03-30'));
    expect(short.earned).toBeNull();
    expect(short.progress.text).toBe('5.99 of 6 months covered');
    expect(short.progress.need).toBe('$0.01 more in savings, then 30 days in a row');
    expect(monthsCovered(600_000, 100_000)).toBe('6.00');
  });

  it('day 29 is not enough; day 30 earns it', () => {
    const f29 = facts(days('2026-03-01', same(29, 6000)));
    expect(emMonthsHold(f29, 6, A('2026-03-29')).earned).toBeNull();
    expect(emMonthsHold(f29, 6, A('2026-03-29')).progress.text).toBe('Held 29 of 30 days');
    expect(emMonthsHold(facts(days('2026-03-01', same(30, 6000))), 6, A('2026-03-30')).earned!.date).toBe('2026-03-30');
  });

  it('a bigger monthly amount (the essentials setting or a big spending month) lowers months covered', () => {
    // $6,000 in savings. March is measured against $1,000 (6.00 covered), April against $1,500 (4.00): the hold that
    // started Mar 15 breaks on Apr 1, after 17 days.
    const f = facts(days('2026-03-15', same(47, 6000)), { needDollars: (d) => (d < '2026-04-01' ? 1000 : 1500) });
    const o = emMonthsHold(f, 6, A('2026-04-30'));
    expect(o.earned).toBeNull();
    expect(o.progress.text).toBe('4.00 of 6 months covered');
    expect(emMonthsHold(f, 4, A('2026-04-30')).earned!.date).toBe('2026-04-13'); // 4 months: Mar 15 + 29 days
  });

  it('a day with nothing to measure against never counts (no complete month of spending yet)', () => {
    const o = emMonthsHold(facts(days('2026-03-01', same(40, 9000)), { needDollars: () => null }), 1, A('2026-04-09'));
    expect(o.earned).toBeNull();
    expect(o.progress.text).toBe('No complete month of spending yet');
  });

  it('Start from today: the hold can only start on the turn-on day', () => {
    const f = facts(days('2026-03-01', same(60, 6000)));
    expect(emMonthsHold(f, 6, A('2026-04-29', '2026-03-20')).earned!.date).toBe('2026-04-18'); // Mar 20 + 29 days
  });

  it('no savings account: nothing to show, never an error', () => {
    const o = emMonthsHold(facts([], { hasSavingsAccount: false }), 1, A());
    expect(o.progress.text).toBe('No savings account yet');
  });
});

describe('stayed fully funded (complete months in a row)', () => {
  it('6 months covered on every day of Jan, Feb and Mar = 3 in a row, dated Mar 31', () => {
    const f = facts(days('2026-01-01', same(120, 6000)));
    expect(emFundedStreak(f, 3, A('2026-04-15')).earned).toMatchObject({
      date: '2026-03-31',
      sentence: 'Your emergency fund covered 6 months of spending on every day for 3 months in a row, January 2026 through March 2026.',
    });
  });

  it('one day under 6 in the middle of February breaks February (only March is left in the run)', () => {
    const v = same(120, 6000);
    v[44] = 5999.99; // Feb 14
    const o = emFundedStreak(facts(days('2026-01-01', v)), 3, A('2026-04-15'));
    expect(o.earned).toBeNull();
    expect(o.progress.text).toBe('1 of 3 months');
  });

  it('the current month never counts, even on its last day', () => {
    // Today Mar 31: March is not over, so only Jan and Feb count.
    expect(emFundedStreak(facts(days('2026-01-01', same(90, 6000))), 3, A('2026-03-31')).earned).toBeNull();
    expect(emFundedStreak(facts(days('2026-01-01', same(91, 6000))), 3, A('2026-04-01')).earned!.date).toBe('2026-03-31');
  });

  it('Start from today: turned on Nov 17, November never counts and December does', () => {
    const f = facts(days('2025-11-01', same(110, 6000))); // Nov 1, 2025 .. Feb 18, 2026, always full
    expect(emFundedStreak(f, 2, A('2026-02-10', '2025-11-17')).earned!.date).toBe('2026-01-31'); // Dec + Jan
    expect(emFundedStreak(f, 3, A('2026-02-10', '2025-11-17')).earned).toBeNull(); // Nov does not count
    expect(emFundedStreak(f, 3, A('2026-02-10', '2025-11-01')).earned!.date).toBe('2026-01-31'); // turned on Nov 1: Nov counts
    expect(emFundedStreak(f, 3, A('2026-02-10')).earned!.date).toBe('2026-01-31'); // Count my history
  });

  it('a month before the savings data starts is not full', () => {
    // Data starts Jan 2: January has a day without a value.
    const o = emFundedStreak(facts(days('2026-01-02', same(100, 6000))), 2, A('2026-04-15'));
    expect(o.earned!.date).toBe('2026-03-31'); // Feb + Mar
  });
});

describe('savings balance (30-day rule): Count my history vs Start from today on the same data', () => {
  // $5,000 from Jan 1 to Mar 2 (61 days).
  const f = facts(days('2026-01-01', same(61, 5000)));
  it('Count my history: earned Jan 30 (the 30th day)', () => {
    expect(emSavingsHold(f, 5000 * D, A('2026-03-02')).earned).toMatchObject({
      date: '2026-01-30',
      sentence: 'Your savings stayed at or above $5,000 for 30 days in a row, from Jan 1 to Jan 30, 2026.',
    });
  });
  it('Start from today turned on Feb 1: earned Mar 2', () => {
    expect(emSavingsHold(f, 5000 * D, A('2026-03-02', '2026-02-01')).earned!.date).toBe('2026-03-02');
  });
  it('one cent under the line never counts', () => {
    expect(emSavingsHold(facts(days('2026-01-01', same(61, 4999.99))), 5000 * D, A('2026-03-02')).earned).toBeNull();
  });
});

describe('lifetime interest', () => {
  const rows = (list: [string, number][]) => list.map(([date, d]) => ({ date, cents: Math.round(d * D) }));
  it('$60 + $40 = $100 on the second payment; a $5 reversal lowers the total', () => {
    expect(emInterest(facts([], { interest: rows([['2026-01-31', 60], ['2026-02-28', 40]]) }), 100 * D, A()).earned).toMatchObject({
      date: '2026-02-28',
      sentence: 'The interest you have earned added up to $100 on Feb 28, 2026.',
    });
    const rev = emInterest(facts([], { interest: rows([['2026-01-31', 60], ['2026-02-10', -5], ['2026-02-28', 40]]) }), 100 * D, A());
    expect(rev.earned).toBeNull();
    expect(rev.progress.text).toBe('$95 of $100');
  });
  it('Count my history vs Start from today on the same data', () => {
    const f = facts([], { interest: rows([['2026-01-31', 60], ['2026-02-28', 40], ['2026-03-31', 50], ['2026-04-30', 50]]) });
    expect(emInterest(f, 100 * D, A()).earned!.date).toBe('2026-02-28');
    expect(emInterest(f, 100 * D, A('2026-11-11', '2026-03-01')).earned!.date).toBe('2026-04-30'); // $50 + $50
  });
  it('no Interest category: blocked, never guessed', () => {
    const o = emInterest(facts([], { hasInterestCategory: false }), 100 * D, A());
    expect(o.earned).toBeNull();
    expect(o.blocked).toMatch(/There is no Interest category/);
  });
});

describe('refilled after using it', () => {
  // need $1,000: full = $6,000+, below 3 months = under $3,000.
  const story = (fullDays: number, low: number, refillDays: number) => days('2026-01-01', [...same(fullDays, 6000), low, ...same(refillDays, 6000)]);
  it('full 30 days, used (below 3 months), back to 6 for 30 days: earned on that 30th day', () => {
    const o = emRefill(facts(story(30, 2000, 30)), A('2026-12-31'));
    // Jan 1..30 full, Jan 31 at $2,000, Feb 1..Mar 2 full again.
    expect(o.earned).toMatchObject({
      date: '2026-03-02',
      sentence: 'Your emergency fund was full, you used it (below 3 months on Jan 31, 2026), and you built it back to 6 months for 30 days in a row, from Feb 1 to Mar 2, 2026.',
    });
  });
  it('full for only 29 days before the drop does not count', () => {
    // The later 30 full days become the FIRST full stretch; nothing has dropped after it.
    const o = emRefill(facts(story(29, 2000, 30)), A('2026-12-31'));
    expect(o.earned).toBeNull();
    expect(o.progress.text).toBe('Your fund was full');
  });
  it('dropping to exactly 3.00 months is not "below 3"; 2.99 is', () => {
    expect(emRefill(facts(story(30, 3000, 30)), A('2026-12-31')).earned).toBeNull();
    expect(emRefill(facts(story(30, 2999.99, 30)), A('2026-12-31')).earned).not.toBeNull();
  });
  it('the refill hold: 29 days is not enough, 30 is', () => {
    const o = emRefill(facts(story(30, 2000, 29)), A('2026-12-31'));
    expect(o.earned).toBeNull();
    expect(o.progress.text).toBe('Refilling: held 29 of 30 days');
    expect(emRefill(facts(story(30, 2000, 30)), A('2026-12-31')).earned).not.toBeNull();
  });
  it('Start from today: a full stretch before the turn-on day does not count', () => {
    expect(emRefill(facts(story(30, 2000, 30)), A('2026-12-31', '2026-01-15')).earned).toBeNull();
  });
  it('covers() compares whole cents', () => {
    const f = facts([]);
    expect(covers(f, { date: '2026-01-01', cents: 600_000 }, 6)).toBe(true);
    expect(covers(f, { date: '2026-01-01', cents: 599_999 }, 6)).toBe(false);
    expect(covers(f, { date: '2026-01-01', cents: null }, 1)).toBe(false);
  });
});

describe('the Goals average, shared (lib/emergency.ts)', () => {
  it('6 complete months before the month; months before the first transaction are left out; rounded once', () => {
    const spent = new Map([['2026-01', -100_00], ['2026-02', -200_00], ['2026-03', -100_01]]);
    const by = (m: string) => spent.get(m.slice(0, 7)) ?? 0;
    // First data Jan 15, measuring April: Jan, Feb, Mar count -> ($100 + $200 + $100.01) / 3 = $133.336.. -> $133.34
    expect(averageSpending(by, '2026-01-15', '2026-04-01')).toEqual({ avgCents: 13_334, monthsUsed: 3 });
    expect(averageSpending(by, '2026-01-15', '2026-01-01')).toEqual({ avgCents: null, monthsUsed: 0 });
    expect(averageSpending(by, null, '2026-04-01')).toEqual({ avgCents: null, monthsUsed: 0 });
  });
});

describe('Emergency fund and savings trophies in the app', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let auth: { cookie: string; csrf: string };
  let checking: number;
  let savings: number;
  let cat: (name: string) => number;
  const call = (o: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string; payload?: unknown }) =>
    t.app.inject({ ...o, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf } } as never);
  const add = (accountId: number, date: string, amount: string, direction: 'in' | 'out', type: string, categoryId: number | null) =>
    call({ method: 'POST', url: '/api/transactions', payload: { accountId, date, amount, direction, type, categoryId, description: 'x' } });

  beforeEach(async () => {
    t = await testApp(); // today = 2026-11-11
    auth = await setupAndLogin(t);
    const account = async (name: string, type: string, extra: object = {}) =>
      (await call({ method: 'POST', url: '/api/accounts', payload: { name, institution: 'Test', type, ...extra } })).json().account.id as number;
    checking = await account('Fake Checking', 'checking');
    savings = await account('Fake Savings', 'savings', { openingBalance: '6000', openingDate: '2026-04-01' });
    const cats = (await call({ method: 'GET', url: '/api/categories' })).json().categories as { id: number; name: string }[];
    cat = (n) => cats.find((c) => c.name === n)!.id;
    // $1,000 of groceries every month, May to October (6 complete months before November).
    for (const m of ['05', '06', '07', '08', '09', '10']) await add(checking, `2026-${m}-10`, '1000', 'out', 'expense', cat('Food'));
  });
  afterEach(async () => t.app.close());

  it('months covered uses the Goals numbers: $6,000 / $1,000 = 6.00; essentials and a big month lower it', async () => {
    const goals = async () => (await call({ method: 'GET', url: '/api/goals' })).json().emergency;
    const data = () => new TrophyData(t.db, '2026-11-11').emergency;
    expect((await goals()).targetCents).toBe(600_000);
    expect(data().need('2026-11-11')).toBe(100_000);
    expect(data().savings.on('2026-11-11')).toBe((await goals()).savingsCents);
    // The essentials setting ($250 a month) raises the monthly amount to $1,250: 4.80 months.
    await call({ method: 'PUT', url: '/api/settings/emergency', payload: { essentials: '250' } });
    expect(6 * data().need('2026-11-11')!).toBe((await goals()).targetCents);
    await call({ method: 'PUT', url: '/api/settings/emergency', payload: { essentials: '0' } });
    // A big $3,000 month in October: (5 x $1,000 + $4,000) / 6 = $1,500 -> 4.00 months.
    await add(checking, '2026-10-20', '3000', 'out', 'expense', cat('Shopping'));
    expect(data().need('2026-11-11')).toBe(150_000);
    expect(6 * data().need('2026-11-11')!).toBe((await goals()).targetCents);
  });

  it('migration 017 marks Interest; renaming it changes nothing; deleting it blocks the trophy (never guessed by name)', async () => {
    await add(savings, '2026-05-31', '60', 'in', 'income', cat('Interest'));
    await add(savings, '2026-06-30', '40', 'in', 'income', cat('Interest'));
    const renamed = await call({ method: 'PATCH', url: `/api/categories/${cat('Interest')}`, payload: { name: 'Savings dividends' } });
    expect(renamed.statusCode, renamed.body).toBe(200);
    const r = (await call({ method: 'POST', url: '/api/trophies/em.interest.100/on', payload: { mode: 'history' } })).json();
    expect(r.earned).toEqual([{ key: 'em.interest.100', name: '$100 of interest', rankLabel: 'Iron · Rank 1', earnedOn: '2026-06-30' }]);
    // Another category NAMED Interest is not the interest category.
    const del = await call({ method: 'DELETE', url: `/api/categories/${cat('Interest')}` });
    expect(del.statusCode, del.body).toBe(200);
    const again = await call({ method: 'POST', url: '/api/categories', payload: { name: 'Interest', kind: 'income', group: 'Income', color: 'sage' } });
    expect(again.statusCode, again.body).toBe(201);
    await call({ method: 'POST', url: '/api/trophies/em.interest.1k/on', payload: { mode: 'history' } });
    const v = (await call({ method: 'GET', url: '/api/trophies/em.interest.1k' })).json();
    expect(v.blocked).toMatch(/There is no Interest category/);
    // Earned stays earned.
    expect((await call({ method: 'GET', url: '/api/trophies/em.interest.100' })).json().state).toBe('earned');
  });

  it('turning on the whole shelf uses each suggestion; balances and interest count history; GETs never write', async () => {
    const r = (await call({ method: 'POST', url: '/api/trophies/groups/emergency/on' })).json();
    expect(r.turnedOn).toBe(19);
    // $6,000 since Apr 1 (200+ days): Savings $5k by history (Apr 30).
    expect(r.earned.map((e: { key: string }) => e.key)).toEqual(['em.savings.5k']);
    const modes = Object.fromEntries(
      (t.db.prepare("SELECT trophy_key, mode FROM trophy_states WHERE trophy_key LIKE 'em.%'").all() as { trophy_key: string; mode: string }[]).map((x) => [
        x.trophy_key,
        x.mode,
      ]),
    );
    expect(modes['em.savings.5k']).toBe('history');
    expect(modes['em.interest.100']).toBe('history');
    expect(modes['em.months.6']).toBe('today');
    expect(modes['em.funded.12']).toBe('today');
    expect(modes['em.refill']).toBe('today');
    const dump = () => JSON.stringify(t.db.prepare('SELECT * FROM trophy_states ORDER BY trophy_key').all());
    const before = dump();
    await call({ method: 'GET', url: '/api/trophies' });
    await call({ method: 'GET', url: '/api/trophies/em.months.6' });
    expect(dump()).toBe(before);
    // Start from today (Nov 11): covered 6.00 today, so the hold is on its first day.
    const six = (await call({ method: 'GET', url: '/api/trophies/em.months.6' })).json();
    expect(six.progress.text).toBe('Held 1 of 30 days');
  });
});
