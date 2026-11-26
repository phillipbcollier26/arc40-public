/**
 * Trophy Case, Round 3 (Milestone 3): the 25 Spending habits trophies. Fake numbers only; every example is small
 * enough to check by hand in the comments. D = one dollar in cents.
 *
 * Pure examples build SpendFacts from month rows written as ['YYYY-MM', income $, spending $].
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TROPHIES } from '../../shared/trophies.js';
import { savingsRateBp, type MonthRow } from '../../server/src/lib/cashflow.js';
import { effectiveLimits } from '../../server/src/lib/budgets.js';
import {
  spBudgetStreak,
  spCategoryTamed,
  spCheaperMonth,
  spEarnStreak,
  spRateMonth,
  spRateYear,
  spSubsCheaper,
  spSubsCut,
  underBudget,
  type SpendFacts,
} from '../../server/src/lib/trophies/spendingRules.js';
import { TrophyData } from '../../server/src/lib/trophies/data.js';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';

const D = 100;
const A = (today: string, from: string | null = null) => ({ today, from, year: null });
const c = (d: number) => Math.round(d * D);

function rows(list: [string, number, number][]): MonthRow[] {
  return list.map(([m, inc, sp]) => ({
    month: `${m}-01`,
    incomeCents: c(inc),
    spendingCents: c(sp),
    giftCents: 0,
    savingsRateBp: savingsRateBp(c(inc), c(sp)),
  }));
}
/** Every month from a to b with the same income and spending. */
function flat(a: string, b: string, inc: number, sp: number): [string, number, number][] {
  const out: [string, number, number][] = [];
  for (let y = Number(a.slice(0, 4)), m = Number(a.slice(5, 7)); `${y}-${String(m).padStart(2, '0')}` <= b; m === 12 ? ((m = 1), y++) : m++)
    out.push([`${y}-${String(m).padStart(2, '0')}`, inc, sp]);
  return out;
}

function facts(list: [string, number, number][], p: Partial<SpendFacts> & { cats?: Record<string, Record<number, number>>; subs?: Record<string, number> } = {}): SpendFacts {
  const ms = rows(list);
  const cats = p.cats ?? {};
  const subs = p.subs ?? {};
  return {
    firstDataDate: ms[0]?.month ?? null,
    months: ms,
    byCategory: (m) => new Map(Object.entries(cats[m.slice(0, 7)] ?? {}).map(([k, v]) => [Number(k), c(v)])),
    limits: () => new Map(),
    categoryName: (id) => ({ 1: 'Food', 2: 'Shopping', 3: 'Housing' })[id] ?? null,
    cancellations: [],
    subscriptionCharges: (m) => c(subs[m.slice(0, 7)] ?? 0),
    ...p,
  };
}

describe('catalog', () => {
  it('has the 25 Spending habits trophies, all suggesting Start from today; 132 trophies in all', () => {
    const s = TROPHIES.filter((t) => t.group === 'spending');
    expect(s.map((t) => [t.id, t.rank, t.shape])).toEqual([
      ['sp.earn.3', 'bronze', 'cup'],
      ['sp.earn.6', 'silver', 'cup'],
      ['sp.earn.12', 'gold', 'cup'],
      ['sp.earn.24', 'obsidian', 'cup'],
      ['sp.earn.36', 'emerald', 'cup'],
      ['sp.earn.60', 'diamond', 'cup'],
      ['sp.rate-month.20', 'copper', 'coin'],
      ['sp.rate-month.30', 'silver', 'coin'],
      ['sp.rate-month.50', 'gold', 'coin'],
      ['sp.rate-month.70', 'platinum', 'coin'],
      ['sp.rate-year.25', 'platinum', 'coin'],
      ['sp.rate-year.40', 'emerald', 'coin'],
      ['sp.rate-year.50', 'diamond', 'coin'],
      ['sp.budget.1', 'silver', 'cup'],
      ['sp.budget.3', 'gold', 'cup'],
      ['sp.budget.6', 'platinum', 'cup'],
      ['sp.budget.12', 'emerald', 'cup'],
      ['sp.budget.24', 'diamond', 'cup'],
      ['sp.cut.1', 'copper', 'coin'],
      ['sp.cut.3', 'silver', 'coin'],
      ['sp.cut.5', 'gold', 'coin'],
      ['sp.cut.10', 'platinum', 'coin'],
      ['sp.cheaper-month', 'bronze', 'statuette'],
      ['sp.subs-cheaper', 'bronze', 'statuette'],
      ['sp.category-tamed', 'silver', 'statuette'],
    ]);
    expect(s.every((t) => t.defaultMode === 'today')).toBe(true);
    // Rounds 1 to 3 hold 132; Round 4 adds its shelves after them (trophiesTidy.test.ts, trophiesLongGame.test.ts).
    expect(TROPHIES.filter((t) => !['tidy', 'long_game', 'the_arc'].includes(t.group))).toHaveLength(132);
  });
});

describe('spent less than you earned (months in a row)', () => {
  it('Jan, Feb and Mar with $2,000 in and $1,500 out = 3 in a row, dated Mar 31', () => {
    const f = facts(flat('2026-01', '2026-04', 2000, 1500));
    expect(spEarnStreak(f, 3, A('2026-04-10')).earned).toMatchObject({
      date: '2026-03-31',
      sentence: 'You spent less than you earned for 3 months in a row, January 2026 through March 2026.',
    });
  });
  it('income exactly equal to spending does not count (February breaks the run)', () => {
    const f = facts([['2026-01', 2000, 1500], ['2026-02', 1500, 1500], ['2026-03', 2000, 1500], ['2026-04', 0, 0]]);
    const o = spEarnStreak(f, 3, A('2026-04-10'));
    expect(o.earned).toBeNull();
    expect(o.progress.text).toBe('1 of 3 months');
  });
  it('a month with no income breaks the streak, even with almost no spending', () => {
    const f = facts([['2026-01', 2000, 1500], ['2026-02', 0, 10], ['2026-03', 2000, 1500], ['2026-04', 0, 0]]);
    expect(spEarnStreak(f, 2, A('2026-04-10')).earned).toBeNull();
  });
  it('the current month never counts, even on its last day', () => {
    const f = facts(flat('2026-01', '2026-03', 2000, 1500));
    expect(spEarnStreak(f, 3, A('2026-03-31')).earned).toBeNull();
    expect(spEarnStreak(f, 3, A('2026-04-01')).earned!.date).toBe('2026-03-31');
  });
  it('Start from today: turned on Nov 17, November never counts and December does', () => {
    const f = facts(flat('2025-11', '2026-02', 2000, 1500));
    expect(spEarnStreak(f, 2, A('2026-02-10', '2025-11-17')).earned!.date).toBe('2026-01-31'); // Dec + Jan
    expect(spEarnStreak(f, 3, A('2026-02-10', '2025-11-17')).earned).toBeNull();
    expect(spEarnStreak(f, 3, A('2026-02-10', '2025-11-01')).earned!.date).toBe('2026-01-31'); // on Nov 1: Nov counts
    // Before December has ended, it is waiting for its first full month.
    expect(spEarnStreak(f, 3, A('2025-12-20', '2025-11-17')).progress.need).toBe('Counts from the first full month after you turned it on.');
  });
});

describe('savings rate in a month and in a year', () => {
  it('exactly 20.00% counts; 19.99% does not ($100 in: $80 vs $80.01 spent)', () => {
    expect(spRateMonth(facts([['2026-01', 100, 80], ['2026-02', 0, 0]]), 2000, A('2026-02-05')).earned).toMatchObject({
      date: '2026-01-31',
      sentence: 'You saved 20% of what you earned in January 2026: $100 in, $80 spent.',
    });
    const short = spRateMonth(facts([['2026-01', 100, 80.01], ['2026-02', 0, 0]]), 2000, A('2026-02-05'));
    expect(short.earned).toBeNull();
    expect(short.progress.text).toBe('Last month: 19.99% of 20%'); // January is the last complete month
  });
  it('a month with no income has no savings rate and never counts', () => {
    expect(spRateMonth(facts([['2026-01', 0, 0], ['2026-02', 0, 0]]), 2000, A('2026-03-05')).earned).toBeNull();
  });
  it('the year rate comes from the year totals, never an average of monthly rates', () => {
    // 2025: January $1,000 in, $0 out (100%); February $9,000 in, $9,000 out (0%); nothing else.
    // Average of the two months = 50%, but the year's totals = ($10,000 - $9,000) / $10,000 = 10%.
    const f = facts([['2025-01', 1000, 0], ['2025-02', 9000, 9000], ...flat('2025-03', '2026-01', 0, 0)]);
    const o = spRateYear(f, 2500, A('2026-01-05'));
    expect(o.earned).toBeNull();
    expect(spRateYear(f, 1000, A('2026-01-05')).earned).toMatchObject({ date: '2025-12-31', sentence: 'You saved 10% of what you earned in 2025: $10,000 in, $9,000 spent.' });
  });
  it('a year counts once it has ended; a part first year (data from March) never counts', () => {
    const f = facts(flat('2025-01', '2026-01', 4000, 3000)); // 25% every month
    expect(spRateYear(f, 2500, A('2025-12-31')).earned).toBeNull(); // Dec 31 is not over yet
    expect(spRateYear(f, 2500, A('2026-01-01')).earned!.date).toBe('2025-12-31');
    const part = facts(flat('2025-03', '2026-01', 4000, 3000));
    expect(spRateYear(part, 2500, A('2026-01-05')).earned).toBeNull();
  });
  it('Start from today: turned on Nov 17, 2025, the year 2025 never counts; 2026 is the first', () => {
    const f = facts(flat('2025-01', '2027-01', 4000, 3000));
    expect(spRateYear(f, 2500, A('2026-01-05', '2025-11-17')).earned).toBeNull();
    expect(spRateYear(f, 2500, A('2025-12-01', '2025-11-17')).progress.need).toBe('Counts from 2026, the first full year after you turned it on.');
    expect(spRateYear(f, 2500, A('2027-01-05', '2025-11-17')).earned!.date).toBe('2026-12-31');
    expect(spRateYear(f, 2500, A('2026-01-05', '2025-01-01')).earned!.date).toBe('2025-12-31');
  });
});

describe('under budget in every category (months in a row)', () => {
  // Food (1) has $300 every month.
  const budget = (extra: { categoryId: number; month: string; limitCents: number }[] = []) => (m: string) =>
    effectiveLimits([{ categoryId: 1, month: '*', limitCents: 300 * D }, ...extra], m);
  it('exactly at the limit counts; one cent over breaks the month', () => {
    const list = flat('2026-01', '2026-03', 2000, 300);
    const ok = facts(list, { limits: budget(), cats: { '2026-01': { 1: 300 }, '2026-02': { 1: 300 } } });
    expect(spBudgetStreak(ok, 2, A('2026-03-05')).earned).toMatchObject({ date: '2026-02-28' });
    const over = facts(list, { limits: budget(), cats: { '2026-01': { 1: 300 }, '2026-02': { 1: 300.01 } } });
    expect(spBudgetStreak(over, 2, A('2026-03-05')).earned).toBeNull();
    expect(spBudgetStreak(over, 2, A('2026-03-05')).progress.need).toMatch(/^February 2026: Food went over its limit/);
  });
  it('a category with a $0 budget is ignored (Housing is paid by someone else)', () => {
    const f = facts(flat('2026-01', '2026-02', 2000, 900), {
      limits: budget([{ categoryId: 3, month: '*', limitCents: 0 }]),
      cats: { '2026-01': { 1: 250, 3: 650 } },
    });
    expect(underBudget(f, '2026-01-01')).toEqual({ ok: true, over: null });
    expect(spBudgetStreak(f, 1, A('2026-02-05')).earned!.date).toBe('2026-01-31');
  });
  it('a month override is used: March allows $500', () => {
    const f = facts(flat('2026-03', '2026-04', 2000, 450), { limits: budget([{ categoryId: 1, month: '2026-03-01', limitCents: 500 * D }]), cats: { '2026-03': { 1: 450 } } });
    expect(spBudgetStreak(f, 1, A('2026-04-05')).earned!.date).toBe('2026-03-31');
  });
  it('a month with no budget above $0 does not count and breaks the streak', () => {
    const only0 = facts(flat('2026-01', '2026-02', 2000, 100), { limits: () => effectiveLimits([{ categoryId: 3, month: '*', limitCents: 0 }], '*') });
    expect(underBudget(only0, '2026-01-01')).toBeNull();
    expect(spBudgetStreak(only0, 1, A('2026-02-05')).earned).toBeNull();
    // January budgeted and fine, February no budget (override to $0), March fine: never 2 in a row.
    const gap = facts(flat('2026-01', '2026-04', 2000, 100), {
      limits: budget([{ categoryId: 1, month: '2026-02-01', limitCents: 0 }]),
      cats: { '2026-01': { 1: 100 }, '2026-02': { 1: 100 }, '2026-03': { 1: 100 } },
    });
    expect(spBudgetStreak(gap, 2, A('2026-04-05')).earned).toBeNull();
  });
});

describe('subscriptions cut', () => {
  const cuts = [
    { date: '2026-11-10', name: 'Streamly Video' },
    { date: '2026-11-20', name: 'MusicBox' },
  ];
  it('Count my history counts every cancellation; the 2nd one earns "Cut 2" style ladders', () => {
    expect(spSubsCut(facts([], { cancellations: cuts }), 1, A('2026-11-25')).earned).toMatchObject({ date: '2026-11-10', sentence: 'You cancelled Streamly Video on Nov 10, 2026.' });
    expect(spSubsCut(facts([], { cancellations: cuts }), 3, A('2026-11-25')).progress.text).toBe('2 of 3 cancelled');
  });
  it('Start from today: a cancellation before the turn-on day does not count', () => {
    const o = spSubsCut(facts([], { cancellations: cuts }), 1, A('2026-11-25', '2026-11-17'));
    expect(o.earned).toMatchObject({ date: '2026-11-20', sentence: 'You cancelled MusicBox on Nov 20, 2026.' });
    expect(spSubsCut(facts([], { cancellations: cuts }), 3, A('2026-11-25', '2026-11-17')).progress.text).toBe('1 of 3 cancelled');
  });
});

describe('cheaper than the same month last year', () => {
  it('December 2025 ($900) vs December 2024 ($1,000) counts even when turned on Nov 17, 2025', () => {
    const f = facts([['2024-12', 2000, 1000], ...flat('2025-01', '2025-11', 2000, 1200), ['2025-12', 2000, 900], ['2026-01', 0, 0]]);
    expect(spCheaperMonth(f, A('2026-01-05', '2025-11-17')).earned).toMatchObject({
      date: '2025-12-31',
      sentence: 'You spent $900 in December 2025, less than the $1,000 in December 2024.',
    });
  });
  it('no data a year ago means it cannot count (data starting Dec 5 does not cover December)', () => {
    const later = facts([...flat('2025-01', '2025-11', 2000, 1200), ['2025-12', 2000, 900], ['2026-01', 0, 0]]);
    expect(spCheaperMonth(later, A('2026-01-05')).earned).toBeNull();
    const half = facts([['2024-12', 2000, 1000], ...flat('2025-01', '2025-11', 2000, 1200), ['2025-12', 2000, 900], ['2026-01', 0, 0]], { firstDataDate: '2024-12-05' });
    expect(spCheaperMonth(half, A('2026-01-05')).earned).toBeNull();
  });
  it('equal spending is not cheaper; a month with no spending at all never counts', () => {
    const same = facts([['2024-12', 2000, 1000], ...flat('2025-01', '2025-11', 0, 0), ['2025-12', 2000, 1000], ['2026-01', 0, 0]]);
    expect(spCheaperMonth(same, A('2026-01-05')).earned).toBeNull();
    const empty = facts([['2024-12', 2000, 1000], ...flat('2025-01', '2025-11', 0, 0), ['2025-12', 0, 0], ['2026-01', 0, 0]]);
    expect(spCheaperMonth(empty, A('2026-01-05')).earned).toBeNull();
  });
});

describe('subscriptions cost less than a year ago (12 months vs the 12 before)', () => {
  // $10 a month of subscriptions in 2025, $9 a month in 2026.
  const subs: Record<string, number> = {};
  for (const [m] of flat('2025-01', '2025-12', 0, 0)) subs[m] = 10;
  for (const [m] of flat('2026-01', '2026-12', 0, 0)) subs[m] = 9;
  const list = flat('2025-01', '2027-01', 2000, 1000);
  it('$108 over 2026 vs $120 over 2025: earned Dec 31, 2026', () => {
    expect(spSubsCheaper(facts(list, { subs }), A('2027-01-05')).earned).toMatchObject({
      date: '2026-12-31',
      sentence: 'Your subscriptions cost $108 from January 2026 to December 2026, less than the $120 of the 12 months before.',
    });
  });
  it('equal totals do not count', () => {
    const same = Object.fromEntries(Object.keys(subs).map((m) => [m, 10]));
    expect(spSubsCheaper(facts(list, { subs: same }), A('2027-01-05')).earned).toBeNull();
  });
  it('needs 24 complete months of data: in mid December 2026 there are only 23', () => {
    const o = spSubsCheaper(facts(list, { subs }), A('2026-12-15'));
    expect(o.earned).toBeNull();
    expect(o.progress.need).toBe('It compares 12 full months with the 12 before. The first check is at the end of December 2026.');
  });
});

describe('category tamed (25% lower over 12 months, at least $300 before)', () => {
  const list = flat('2025-01', '2027-01', 3000, 1000);
  // Food (1): `before` a month in 2025, `after` a month in 2026.
  const cats = (before: number, after: number) => {
    const out: Record<string, Record<number, number>> = {};
    for (const [m] of flat('2025-01', '2025-12', 0, 0)) out[m] = { 1: before / 12 };
    for (const [m] of flat('2026-01', '2026-12', 0, 0)) out[m] = { 1: after / 12 };
    return out;
  };
  it('exactly 25% lower ($480 -> $360, $40 -> $30 a month) counts; $360.12 (24.975% lower) does not', () => {
    expect(spCategoryTamed(facts(list, { cats: cats(480, 360) }), A('2027-01-05')).earned).toMatchObject({
      date: '2026-12-31',
      sentence: 'You tamed Food: $360 from January 2026 to December 2026, down 25% from $480 the 12 months before.',
    });
    expect(spCategoryTamed(facts(list, { cats: cats(480, 360.12) }), A('2027-01-05')).earned).toBeNull();
  });
  it('an earlier 12 months of $299.04 is too small to count, even when it drops to $0', () => {
    expect(spCategoryTamed(facts(list, { cats: cats(299.04, 0) }), A('2027-01-05')).earned).toBeNull();
  });
  it('a deleted category (no name any more) is skipped safely', () => {
    expect(spCategoryTamed(facts(list, { cats: cats(400, 0), categoryName: () => null }), A('2027-01-05')).earned).toBeNull();
  });
  it('Start from today: the judged 12 months must start on or after the turn-on day; the 12 before may not', () => {
    expect(spCategoryTamed(facts(list, { cats: cats(480, 360) }), A('2027-01-05', '2026-01-01')).earned!.date).toBe('2026-12-31');
    expect(spCategoryTamed(facts(list, { cats: cats(480, 360) }), A('2027-01-05', '2026-01-02')).earned).toBeNull();
  });
});

describe('Spending habits trophies in the app', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let auth: { cookie: string; csrf: string };
  let checking: number;
  let savings: number;
  let cat: (name: string) => number;
  const call = (o: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string; payload?: unknown }) =>
    t.app.inject({ ...o, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf } } as never);
  const add = (accountId: number, date: string, amount: string, direction: 'in' | 'out', type: string, categoryId: number | null, description = 'x') =>
    call({ method: 'POST', url: '/api/transactions', payload: { accountId, date, amount, direction, type, categoryId, description } });

  beforeEach(async () => {
    t = await testApp(); // today = 2026-11-11
    auth = await setupAndLogin(t);
    const account = async (name: string, type: string) =>
      (await call({ method: 'POST', url: '/api/accounts', payload: { name, institution: 'Test', type } })).json().account.id as number;
    checking = await account('Fake Checking', 'checking');
    savings = await account('Fake Savings', 'savings');
    const cats = (await call({ method: 'GET', url: '/api/categories' })).json().categories as { id: number; name: string }[];
    cat = (n) => cats.find((x) => x.name === n)!.id;
  });
  afterEach(async () => t.app.close());

  it('a refund lowers spending; a transfer or a gift never counts (October: $1,000 in, $1,000 out, $1 refunded)', async () => {
    await add(checking, '2026-10-01', '1000', 'in', 'income', cat('Refereeing'));
    await add(checking, '2026-10-05', '1000', 'out', 'expense', cat('Food'));
    await call({ method: 'POST', url: '/api/trophies/sp.earn.3/on', payload: { mode: 'history' } });
    expect((await call({ method: 'GET', url: '/api/trophies/sp.earn.3' })).json().progress.text).toBe('0 of 3 months'); // equal
    // A transfer out and a gift in change nothing; a $1 refund (money in on an expense) lowers spending to $999.
    await add(checking, '2026-10-06', '500', 'out', 'transfer', null);
    await add(savings, '2026-10-06', '500', 'in', 'gift', null);
    expect((await call({ method: 'GET', url: '/api/trophies/sp.earn.3' })).json().progress.text).toBe('0 of 3 months');
    await add(checking, '2026-10-07', '1', 'in', 'expense', cat('Food'));
    expect((await call({ method: 'GET', url: '/api/trophies/sp.earn.3' })).json().progress.text).toBe('1 of 3 months');
    const m = new TrophyData(t.db, '2026-11-11').spending.months.find((r) => r.month === '2026-10-01')!;
    expect([m.incomeCents, m.spendingCents]).toEqual([100_000, 99_900]);
  });

  it('un-cancelling an item takes it out of the count while On; an earned trophy stays earned', async () => {
    const item = (await call({ method: 'POST', url: '/api/recurring', payload: { name: 'Fake Stream', amount: '9.99', schedule: 'monthly', nextDue: '2026-11-20', categoryId: null } })).json();
    const id = (item.item ?? item).id as number;
    expect((await call({ method: 'POST', url: `/api/recurring/${id}/cancel` })).statusCode).toBe(200);
    const one = (await call({ method: 'POST', url: '/api/trophies/sp.cut.1/on', payload: { mode: 'history' } })).json();
    expect(one.earned.map((e: { key: string }) => e.key)).toEqual(['sp.cut.1']);
    await call({ method: 'POST', url: '/api/trophies/sp.cut.3/on', payload: { mode: 'history' } });
    expect((await call({ method: 'GET', url: '/api/trophies/sp.cut.3' })).json().progress.text).toBe('1 of 3 cancelled');
    expect((await call({ method: 'POST', url: `/api/recurring/${id}/restore` })).statusCode).toBe(200);
    expect((await call({ method: 'GET', url: '/api/trophies/sp.cut.3' })).json().progress.text).toBe('0 of 3 cancelled');
    await call({ method: 'POST', url: '/api/trophies/evaluate' });
    expect((await call({ method: 'GET', url: '/api/trophies/sp.cut.1' })).json().state).toBe('earned');
    // Start from today: cancelled again today counts (on or after the turn-on day).
    await call({ method: 'POST', url: '/api/trophies/sp.cut.3/off' });
    await call({ method: 'POST', url: '/api/trophies/sp.cut.3/on', payload: { mode: 'today' } });
    await call({ method: 'POST', url: `/api/recurring/${id}/cancel` });
    expect((await call({ method: 'GET', url: '/api/trophies/sp.cut.3' })).json().progress.text).toBe('1 of 3 cancelled');
  });

  it('category tamed works by category id: a renamed category still counts and is named in the sentence', async () => {
    // $50 of Shopping a month from Nov 2024 to Oct 2025, then $30 a month to Oct 2026: $600 -> $360, 40% lower.
    await add(checking, '2024-11-01', '5000', 'in', 'income', cat('Refereeing')); // data from Nov 1, 2024
    for (let i = 0; i < 24; i++) {
      const y = 2024 + Math.floor((10 + i) / 12);
      const m = ((10 + i) % 12) + 1;
      await add(checking, `${y}-${String(m).padStart(2, '0')}-15`, i < 12 ? '50' : '30', 'out', 'expense', cat('Shopping'));
    }
    const renamed = await call({ method: 'PATCH', url: `/api/categories/${cat('Shopping')}`, payload: { name: 'Stuff' } });
    expect(renamed.statusCode, renamed.body).toBe(200);
    const r = (await call({ method: 'POST', url: '/api/trophies/sp.category-tamed/on', payload: { mode: 'history' } })).json();
    expect(r.earned).toEqual([{ key: 'sp.category-tamed', name: 'Category tamed', rankLabel: 'Silver · Rank 4', earnedOn: '2026-10-31' }]);
    expect((await call({ method: 'GET', url: '/api/trophies/sp.category-tamed' })).json().sentence).toBe(
      'You tamed Stuff: $360 from November 2025 to October 2026, down 40% from $600 the 12 months before.',
    );
  });

  it('turning on the whole Spending habits shelf: 25 trophies, all Start from today, nothing earned at once; GETs never write', async () => {
    await add(checking, '2025-01-02', '3000', 'in', 'income', cat('Refereeing'));
    await add(checking, '2025-01-05', '100', 'out', 'expense', cat('Food'));
    const r = (await call({ method: 'POST', url: '/api/trophies/groups/spending/on' })).json();
    expect(r.turnedOn).toBe(25);
    expect(r.earned).toEqual([]); // January 2025 had a 96.7% savings rate, but it is before the turn-on day
    const modes = t.db.prepare("SELECT DISTINCT mode FROM trophy_states WHERE trophy_key LIKE 'sp.%'").all() as { mode: string }[];
    expect(modes).toEqual([{ mode: 'today' }]);
    const dump = () => JSON.stringify(t.db.prepare('SELECT * FROM trophy_states ORDER BY trophy_key').all());
    const before = dump();
    await call({ method: 'GET', url: '/api/trophies' });
    await call({ method: 'GET', url: '/api/trophies/sp.subs-cheaper' });
    expect(dump()).toBe(before);
    expect((await call({ method: 'GET', url: '/api/trophies/sp.rate-month.20' })).json().progress.need).toBe('Counts from the first full month after you turned it on.');
  });
});
