/**
 * Trophy Case, Round 2 (Milestone 3): the 17 Refereeing trophies. Fake numbers only; every example is small enough to
 * check by hand in the comments. D = one dollar in cents.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TROPHIES } from '../../shared/trophies.js';
import {
  refCoversSpending,
  refGear10x,
  refLifetime,
  refMonth,
  refMonthStreak,
  refRecordMonth,
  refRecordYear,
  refUpYear,
  type RefFacts,
} from '../../server/src/lib/trophies/refereeingRules.js';
import { TrophyData } from '../../server/src/lib/trophies/data.js';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';

const D = 100;
const A = (today = '2026-11-11', from: string | null = null) => ({ today, from, year: null });
const rows = (list: [string, number][]) => list.map(([date, d]) => ({ date, cents: Math.round(d * D) }));
function facts(p: Partial<RefFacts> = {}): RefFacts {
  return { hasCategory: true, income: [], costs: [], spendingInMonth: () => 0, firstDataDate: '2024-01-02', ...p };
}

describe('catalog', () => {
  it('has the 17 Refereeing trophies; only Ref pay covered all spending starts from today', () => {
    const r = TROPHIES.filter((t) => t.group === 'refereeing');
    expect(r.map((t) => [t.id, t.rank, t.shape, t.defaultMode])).toEqual([
      ['ref.lifetime.1k', 'bronze', 'coin', 'history'],
      ['ref.lifetime.5k', 'silver', 'coin', 'history'],
      ['ref.lifetime.10k', 'gold', 'coin', 'history'],
      ['ref.lifetime.25k', 'platinum', 'coin', 'history'],
      ['ref.lifetime.50k', 'obsidian', 'coin', 'history'],
      ['ref.lifetime.100k', 'diamond', 'coin', 'history'],
      ['ref.month.1k', 'silver', 'coin', 'history'],
      ['ref.month.2k', 'gold', 'coin', 'history'],
      ['ref.month.3k', 'platinum', 'coin', 'history'],
      ['ref.streak.6', 'silver', 'cup', 'history'],
      ['ref.streak.12', 'gold', 'cup', 'history'],
      ['ref.streak.24', 'platinum', 'cup', 'history'],
      ['ref.record-month', 'rose_gold', 'plaque', 'history'],
      ['ref.record-year', 'obsidian', 'plaque', 'history'],
      ['ref.up-year', 'bronze', 'statuette', 'history'],
      ['ref.gear-10x', 'gold', 'statuette', 'history'],
      ['ref.covers-spending', 'emerald', 'statuette', 'today'],
    ]);
    expect(TROPHIES.filter((t) => ['net_worth', 'investing', 'roth', 'refereeing'].includes(t.group))).toHaveLength(88); // Rounds 1 and 2
  });

  it('every rule is blocked (not guessed) when no category has the Refereeing role', () => {
    const o = refLifetime(facts({ hasCategory: false }), 1_000 * D, A());
    expect(o.earned).toBeNull();
    expect(o.blocked).toBe('There is no Refereeing category. Give one category the Refereeing role first.');
  });
});

describe('lifetime and one-month totals', () => {
  it('lifetime $1,000: $600 + $400 reaches it exactly on the second game day; one cent short does not', () => {
    const f = facts({ income: rows([['2026-03-01', 600], ['2026-04-02', 400]]) });
    expect(refLifetime(f, 1_000 * D, A()).earned).toMatchObject({ date: '2026-04-02', sentence: 'Your refereeing pay added up to $1,000 on Apr 2, 2026.' });
    const short = facts({ income: rows([['2026-03-01', 600], ['2026-04-02', 399.99]]) });
    expect(refLifetime(short, 1_000 * D, A()).progress.text).toBe('$999.99 of $1,000');
  });

  it('a refund in the Refereeing category (a -$50 clawback) lowers the total', () => {
    const f = facts({ income: rows([['2026-03-01', 600], ['2026-03-05', -50], ['2026-04-02', 400]]) });
    expect(refLifetime(f, 1_000 * D, A()).earned).toBeNull();
    expect(refLifetime(f, 1_000 * D, A()).progress.text).toBe('$950 of $1,000');
  });

  it('Start from today: only pay from the turn-on day counts', () => {
    const f = facts({ income: rows([['2026-03-01', 600], ['2026-04-02', 400], ['2026-05-02', 600]]) });
    expect(refLifetime(f, 1_000 * D, A('2026-11-11', '2026-04-01')).earned!.date).toBe('2026-05-02'); // $400 + $600
  });

  it('one month $1,000: the CURRENT month counts the day it reaches the line', () => {
    // Today Nov 11: $700 on Nov 2 and $300 on Nov 9 -> $1,000 on Nov 9, before November is over.
    const f = facts({ income: rows([['2026-10-30', 900], ['2026-11-02', 700], ['2026-11-09', 300]]) });
    expect(refMonth(f, 1_000 * D, A()).earned).toMatchObject({ date: '2026-11-09', sentence: 'Your refereeing pay in November 2026 reached $1,000 on Nov 9, 2026.' });
    // October's $900 + November's $700 never add up across months.
    expect(refMonth(facts({ income: rows([['2026-10-30', 900], ['2026-11-02', 700]]) }), 1_000 * D, A()).earned).toBeNull();
  });
});

describe('every month in a row', () => {
  const sixMonths = rows([
    ['2026-01-10', 60],
    ['2026-02-10', 60],
    ['2026-03-10', 60],
    ['2026-04-10', 60],
    ['2026-05-10', 60],
    ['2026-06-10', 60],
  ]);
  it('6 months in a row earns on the 6th month\'s first pay; a skipped month breaks it', () => {
    expect(refMonthStreak(facts({ income: sixMonths }), 6, A()).earned).toMatchObject({
      date: '2026-06-10',
      sentence: 'You had refereeing pay every month for 6 months in a row, January 2026 to June 2026.',
    });
    expect(refMonthStreak(facts({ income: sixMonths.filter((r) => !r.date.startsWith('2026-04')) }), 6, A()).earned).toBeNull();
  });
  it('a month whose only ref income was refunded away ($60 then -$60) breaks it', () => {
    const net0 = [...sixMonths, { date: '2026-03-20', cents: -60 * D }].sort((a, b) => (a.date < b.date ? -1 : 1));
    expect(refMonthStreak(facts({ income: net0 }), 6, A()).earned).toBeNull();
  });
  it('the current month with no pay yet neither counts nor breaks', () => {
    const o = refMonthStreak(facts({ income: sixMonths.slice(0, 5) }), 6, A('2026-06-05'));
    expect(o.progress).toMatchObject({ text: '5 of 6 months in a row', need: 'Ref pay this month keeps the run going' });
  });
});

describe('record month and record year (plaques)', () => {
  it('a record month needs 3 earlier months with pay; it is dated the month end; later records are kept', () => {
    // Jan $100, Feb $300, Mar $200, Apr $250 (not above Feb), May $400 (record 1), Jun $0, Jul $500 (record 2).
    const f = facts({ income: rows([['2026-01-05', 100], ['2026-02-05', 300], ['2026-03-05', 200], ['2026-04-05', 250], ['2026-05-05', 400], ['2026-07-05', 500]]) });
    const o = refRecordMonth(f, A('2026-08-15'));
    expect(o.earned).toMatchObject({ date: '2026-05-31', sentence: 'You earned $400 refereeing in May 2026, more than in any month before it.' });
    expect(o.records).toEqual([
      { period: '2026-05', amountCents: 400 * D, setOn: '2026-05-31' },
      { period: '2026-07', amountCents: 500 * D, setOn: '2026-07-31' },
    ]);
    // Feb is above Jan but only 1 earlier month had pay: not a record.
    expect(refRecordMonth(facts({ income: f.income.slice(0, 2) }), A('2026-08-15')).earned).toBeNull();
  });

  it('the current month is never a record before it ends', () => {
    const f = facts({ income: rows([['2026-01-05', 100], ['2026-02-05', 100], ['2026-03-05', 100], ['2026-04-05', 900]]) });
    expect(refRecordMonth(f, A('2026-04-20')).earned).toBeNull();
    expect(refRecordMonth(f, A('2026-05-01')).earned!.date).toBe('2026-04-30');
  });

  it('a record year only counts years with data from January (a part first year never sets it up)', () => {
    // Data starts Jun 1, 2024: 2024 ($500) is a part year. 2025 $3,000, 2026 not over.
    const part = facts({ firstDataDate: '2024-06-01', income: rows([['2024-09-01', 500], ['2025-09-01', 3_000]]) });
    expect(refRecordYear(part, A('2026-03-01')).earned).toBeNull(); // 2025 has nothing full to beat
    // Data from Jan 2, 2024: 2024 $500 is a full year, 2025 $3,000 beats it (Dec 31, 2025).
    const full = facts({ firstDataDate: '2024-01-02', income: part.income });
    expect(refRecordYear(full, A('2026-03-01')).earned).toMatchObject({ date: '2025-12-31', sentence: 'You earned $3,000 refereeing in 2025, more than in any full year before it.' });
  });

  it('Ref pay up vs last year: equal is not up; one cent more is', () => {
    const eq = facts({ income: rows([['2024-05-01', 1_000], ['2025-05-01', 1_000]]) });
    expect(refUpYear(eq, A('2026-02-01')).earned).toBeNull();
    const up = facts({ income: rows([['2024-05-01', 1_000], ['2025-05-01', 1_000.01]]) });
    expect(refUpYear(up, A('2026-02-01')).earned).toMatchObject({ date: '2025-12-31', sentence: 'You earned $1,000.01 refereeing in 2025, up from $1,000 in 2024.' });
  });
});

describe('Gear paid off 10x', () => {
  it('pay exactly 10 x costs counts; one cent under does not; refunded gear lowers costs', () => {
    // 2025: costs $100 (gear $120, a $20 refund), pay $1,000 -> exactly 10x.
    const costs = rows([['2025-03-01', 120], ['2025-03-10', -20]]);
    expect(refGear10x(facts({ costs, income: rows([['2025-05-01', 1_000]]) }), A('2026-01-05')).earned).toMatchObject({
      date: '2025-12-31',
      sentence: 'In 2025 you earned $1,000 refereeing on $100 of ref gear and fees, at least 10 times as much.',
    });
    expect(refGear10x(facts({ costs, income: rows([['2025-05-01', 999.99]]) }), A('2026-01-05')).earned).toBeNull();
  });
  it('ref costs of $0 never count, however much you earned', () => {
    expect(refGear10x(facts({ income: rows([['2025-05-01', 5_000]]) }), A('2026-01-05')).earned).toBeNull();
  });
  it('the current year waits until Dec 31 has passed', () => {
    const f = facts({ costs: rows([['2026-03-01', 50]]), income: rows([['2026-05-01', 1_000]]) });
    expect(refGear10x(f, A('2026-12-31')).earned).toBeNull();
    expect(refGear10x(f, A('2027-01-01')).earned!.date).toBe('2026-12-31');
  });
});

describe('Ref pay covered all spending (Start from today suggested)', () => {
  // March 2026: ref pay $800, spending $800 (exactly covered). April: pay $500, spending $500.01.
  const spend: Record<string, number> = { '2026-03': 800 * D, '2026-04': 500 * D + 1, '2026-05': 0 };
  const f = facts({ income: rows([['2026-03-14', 800], ['2026-04-14', 500]]), spendingInMonth: (m) => spend[m] ?? 0 });

  it('pay equal to spending covers it (dated the month end); one cent short does not', () => {
    expect(refCoversSpending(f, A('2026-06-01')).earned).toMatchObject({
      date: '2026-03-31',
      sentence: 'In March 2026 you earned $800 refereeing, enough to cover the $800 you spent.',
    });
    expect(refCoversSpending(facts({ ...f, income: f.income.slice(1) }), A('2026-06-01')).earned).toBeNull();
  });

  it('a month with no spending and no ref pay does not count', () => {
    expect(refCoversSpending(facts({ income: [], spendingInMonth: () => 0 }), A('2026-06-01')).earned).toBeNull();
  });

  it('Count my history finds March; Start from today turned on Mar 10 waits for a month that starts after it', () => {
    expect(refCoversSpending(f, A('2026-06-01', null)).earned!.date).toBe('2026-03-31');
    expect(refCoversSpending(f, A('2026-06-01', '2026-03-10')).earned).toBeNull(); // March started before; April falls short
    const may = facts({ ...f, income: [...f.income, { date: '2026-05-03', cents: 10 * D }] });
    expect(refCoversSpending(may, A('2026-06-01', '2026-03-10')).earned!.date).toBe('2026-05-31'); // $10 vs $0 spent
  });

  it('the current month waits until it ends', () => {
    expect(refCoversSpending(f, A('2026-03-31')).earned).toBeNull();
  });
});

// ------------------------------------------------------------------- through the app

describe('Refereeing trophies in the app', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let auth: { cookie: string; csrf: string };
  let checking: number;
  let cat: (name: string) => number;
  const call = (o: { method: 'GET' | 'POST' | 'PUT' | 'PATCH'; url: string; payload?: unknown }) =>
    t.app.inject({ ...o, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf } } as never);
  const add = (date: string, amount: string, direction: 'in' | 'out', type: string, categoryId: number | null, extra: object = {}) =>
    call({ method: 'POST', url: '/api/transactions', payload: { accountId: checking, date, amount, direction, type, categoryId, description: 'x', ...extra } });

  beforeEach(async () => {
    t = await testApp(); // today = 2026-11-11
    auth = await setupAndLogin(t);
    checking = (await call({ method: 'POST', url: '/api/accounts', payload: { name: 'Fake Checking', institution: 'Test', type: 'checking' } })).json().account.id;
    const cats = (await call({ method: 'GET', url: '/api/categories' })).json().categories as { id: number; name: string }[];
    cat = (n) => cats.find((c) => c.name === n)!.id;
  });
  afterEach(async () => t.app.close());

  it('finds the category by ROLE: renaming Refereeing changes nothing; a split piece counts at its amount', async () => {
    await add('2026-02-03', '600', 'in', 'income', cat('Refereeing'));
    const check = (await add('2026-03-03', '500', 'in', 'income', cat('Refereeing'))).json().transaction.id;
    await call({
      method: 'PUT',
      url: `/api/transactions/${check}/split`,
      payload: { pieces: [{ categoryId: cat('Refereeing'), amount: '400' }, { categoryId: cat('Other Income'), amount: '100' }] },
    });
    const renamed = await call({ method: 'PATCH', url: `/api/categories/${cat('Refereeing')}`, payload: { name: 'Whistle money' } });
    expect(renamed.statusCode, renamed.body).toBe(200);
    const r = (await call({ method: 'POST', url: '/api/trophies/ref.lifetime.1k/on', payload: { mode: 'history' } })).json();
    expect(r.earned).toEqual([{ key: 'ref.lifetime.1k', name: '$1k refereeing', rankLabel: 'Bronze · Rank 3', earnedOn: '2026-03-03' }]);
  });

  it('turning on the whole Refereeing shelf uses each suggested mode; GETs never write', async () => {
    await add('2026-10-02', '1200', 'in', 'income', cat('Refereeing'));
    await add('2026-10-05', '30', 'out', 'expense', cat('Ref Gear & Fees'));
    const r = (await call({ method: 'POST', url: '/api/trophies/groups/refereeing/on' })).json();
    expect(r.turnedOn).toBe(17);
    expect(r.earned.map((e: { key: string }) => e.key).sort()).toEqual(['ref.lifetime.1k', 'ref.month.1k']);
    const mode = t.db.prepare("SELECT mode FROM trophy_states WHERE trophy_key = 'ref.covers-spending'").get() as { mode: string };
    expect(mode.mode).toBe('today');
    const dump = () => JSON.stringify(t.db.prepare('SELECT * FROM trophy_states ORDER BY trophy_key').all());
    const before = dump();
    await call({ method: 'GET', url: '/api/trophies' });
    await call({ method: 'GET', url: '/api/trophies/ref.gear-10x' });
    expect(dump()).toBe(before);
    expect(new TrophyData(t.db, '2026-11-11').refereeing.costs).toEqual([{ date: '2026-10-05', cents: 3000 }]);
  });
});
