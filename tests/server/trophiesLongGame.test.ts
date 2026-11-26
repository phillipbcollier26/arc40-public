/**
 * Trophy Case, Round 4 (Milestone 3): The long game (23, Collector included) and The Arc. Fake numbers only; every
 * example is small enough to check by hand in the comments. The test clock starts at 2026-11-11 (Arc40 is "set up" then).
 * Birth months here are made up for the tests.
 */
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ARC_GROUP, TROPHIES, isCollector } from '../../shared/trophies.js';
import {
  ARC_NO_BIRTH,
  arcDay,
  isPerfect,
  lgAnniversary,
  lgCollector,
  lgCollectorAll,
  lgGoalSet,
  lgGoalsDone,
  lgPerfectMonths,
  lgPerfectYear,
  lgWrapped,
  lgYears,
  theArc,
  yearsLater,
  yearsMonths,
  type CollectorFacts,
  type LongFacts,
  type PerfectMonth,
} from '../../server/src/lib/trophies/longGameRules.js';
import { TrophyData } from '../../server/src/lib/trophies/data.js';
import { unlockOrder, type UnlockItem } from '../../server/src/lib/trophies/engine.js';
import { saveAward, turnOn } from '../../server/src/lib/trophies/store.js';
import { logWrappedWatched } from '../../server/src/lib/activityLog.js';
import { HOST_HEADER, cookieFrom, setupAndLogin, testApp } from './helpers.js';

const A = (today: string, from: string | null = null, year: number | null = null) => ({ today, from, year });
const DAY = 86_400_000;

function facts(p: Partial<LongFacts> = {}): LongFacts {
  return { firstDataDate: null, setupDate: null, goals: [], perfect: [], wrapped: [], birth: null, logSince: '2026-11-20', ...p };
}
/** Months 'YYYY-MM' with four letters: e = earned more than spent, b = under budget, c = clean books, i = invested. */
function months(list: [string, string][]): PerfectMonth[] {
  return list.map(([m, f]) => ({ month: `${m}-01`, earned: f.includes('e'), budget: f.includes('b'), clean: f.includes('c'), invested: f.includes('i') }));
}
function run(a: string, n: number, flags = 'ebci'): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0, y = Number(a.slice(0, 4)), m = Number(a.slice(5, 7)); i < n; i++, m === 12 ? ((m = 1), y++) : m++) out.push([`${y}-${String(m).padStart(2, '0')}`, flags]);
  return out;
}

describe('catalog', () => {
  it('has 23 long game trophies + The Arc (47 new, 179 in all) with the ranks, shapes and modes asked for', () => {
    const lg = TROPHIES.filter((t) => t.group === 'long_game');
    expect(lg.map((t) => [t.id, t.rank, t.shape, t.defaultMode])).toEqual([
      ['lg.years.1', 'bronze', 'coin', 'history'],
      ['lg.years.3', 'gold', 'coin', 'history'],
      ['lg.years.5', 'obsidian', 'coin', 'history'],
      ['lg.years.10', 'diamond', 'coin', 'history'],
      ['lg.years.20', 'arc40', 'coin', 'history'],
      ['lg.goal-set', 'iron', 'coin', 'history'],
      ['lg.goals.1', 'silver', 'coin', 'history'],
      ['lg.goals.5', 'platinum', 'coin', 'history'],
      ['lg.goals.10', 'obsidian', 'coin', 'history'],
      ['lg.goals.25', 'emerald', 'coin', 'history'],
      ['lg.perfect.1', 'gold', 'coin', 'today'],
      ['lg.perfect.3', 'platinum', 'coin', 'today'],
      ['lg.perfect.6', 'emerald', 'coin', 'today'],
      ['lg.perfect.12', 'ruby', 'coin', 'today'],
      ['lg.perfect-year', 'diamond', 'cup', 'today'],
      ['lg.wrapped.1', 'copper', 'coin', 'history'],
      ['lg.wrapped.5', 'gold', 'coin', 'history'],
      ['lg.wrapped.10', 'platinum', 'coin', 'history'],
      ['lg.anniversary', 'rose_gold', 'banner', 'history'],
      ['lg.collector.25', 'gold', 'coin', 'history'],
      ['lg.collector.50', 'platinum', 'coin', 'history'],
      ['lg.collector.100', 'diamond', 'coin', 'history'],
      ['lg.collector.all', 'arc40', 'coin', 'history'],
    ]);
    const arc = TROPHIES.filter((t) => t.group === 'the_arc');
    expect(arc.map((t) => [t.id, t.rank, t.shape, t.defaultMode])).toEqual([['the-arc', 'arc40', 'arc', 'history']]);
    expect(TROPHIES.filter((t) => t.group === 'tidy')).toHaveLength(23);
    expect(TROPHIES).toHaveLength(179);
    // Collector is evaluated last: the four Collector trophies are the last four in the catalog, The Arc right before.
    expect(TROPHIES.slice(-5).map((t) => t.id)).toEqual(['the-arc', 'lg.collector.25', 'lg.collector.50', 'lg.collector.100', 'lg.collector.all']);
  });
});

describe('Years of history', () => {
  it('a year from the first money day: the day before does not count, the day itself does; Feb 29 -> Feb 28', () => {
    const f = facts({ firstDataDate: '2025-11-12' });
    expect(lgYears(f, 1, A('2026-11-11')).earned).toBeNull();
    expect(lgYears(f, 1, A('2026-11-12')).earned).toMatchObject({ date: '2026-11-12' });
    expect(lgYears(f, 1, A('2026-11-11')).progress.text).toBe('11 months of 1 year');
    expect(yearsLater('2024-02-29', 1)).toBe('2025-02-28');
    expect(yearsLater('2024-02-29', 4)).toBe('2028-02-29');
    // Start from today: counts from the turn-on day when it is later.
    expect(lgYears(f, 1, A('2026-11-12', '2026-01-05')).earned).toBeNull();
  });
});

describe('Goals', () => {
  it('first set, then done in order of the day each goal was first done', () => {
    const f = facts({
      goals: [
        { id: 1, setOn: '2026-01-02', doneOn: '2026-05-10' },
        { id: 2, setOn: '2026-02-03', doneOn: null },
        { id: 3, setOn: '2026-03-04', doneOn: '2026-04-01' },
      ],
    });
    expect(lgGoalSet(f, A('2026-11-11')).earned?.date).toBe('2026-01-02');
    expect(lgGoalsDone(f, 1, A('2026-11-11')).earned?.date).toBe('2026-04-01');
    expect(lgGoalsDone(f, 5, A('2026-11-11')).progress.text).toBe('2 of 5 goals');
  });
});

describe('Perfect months', () => {
  const four = 'ebci';
  it('each of the four parts failing on its own breaks the month', () => {
    for (const miss of ['e', 'b', 'c', 'i']) {
      const flags = four.replace(miss, '');
      expect(isPerfect(months([['2026-01', flags]])[0]!), miss).toBe(false);
      const o = lgPerfectMonths(facts({ perfect: months([['2026-01', flags]]) }), 1, A('2026-11-11'));
      expect(o.earned, miss).toBeNull();
    }
    expect(lgPerfectMonths(facts({ perfect: months([['2026-01', four]]) }), 1, A('2026-11-11')).earned?.date).toBe('2026-01-31');
    // What the waiting text says about a month that missed.
    expect(lgPerfectMonths(facts({ perfect: months([['2026-10', 'eci']]) }), 1, A('2026-11-11')).progress.need).toBe('A perfect month (October 2026 missed: under budget).');
  });

  it('counted in total, not in a row; a month still running never counts', () => {
    const f = facts({ perfect: months([['2026-01', four], ['2026-02', 'ec'], ['2026-03', four], ['2026-04', four], ['2026-11', four]]) });
    expect(lgPerfectMonths(f, 3, A('2026-11-11')).earned?.date).toBe('2026-04-30');
    expect(lgPerfectMonths(f, 6, A('2026-11-11')).progress.text).toBe('3 of 6 perfect months'); // November has not ended
  });

  it('Start from today: only months that start on or after the turn-on day', () => {
    const f = facts({ perfect: months([['2026-09', four], ['2026-10', four]]) });
    expect(lgPerfectMonths(f, 1, A('2026-11-11', '2026-09-02')).earned?.date).toBe('2026-10-31');
    expect(lgPerfectMonths(f, 2, A('2026-11-11', '2026-09-01')).earned?.date).toBe('2026-10-31');
    expect(lgPerfectMonths(f, 2, A('2026-11-11', '2026-09-02')).earned).toBeNull();
  });

  it('A perfect year: 12 in a row; 11 and a broken month do not count', () => {
    expect(lgPerfectYear(facts({ perfect: months(run('2025-01', 12)) }), A('2026-11-11')).earned?.date).toBe('2025-12-31');
    const broken = months([...run('2025-01', 11), ['2025-12', 'ebc'], ...run('2026-01', 1)]);
    expect(lgPerfectYear(facts({ perfect: broken }), A('2026-11-11')).earned).toBeNull();
    expect(lgPerfectYear(facts({ perfect: broken }), A('2026-11-11')).progress.text).toBe('1 of 12 months in a row');
  });
});

describe('Wrapped watched', () => {
  it('two watches of the same year count once; a past year watched today counts', () => {
    const f = facts({ wrapped: [{ date: '2026-11-20', year: 2026 }, { date: '2026-11-21', year: 2026 }, { date: '2026-11-22', year: 2024 }] });
    expect(lgWrapped(f, 1, A('2026-11-30')).earned).toMatchObject({ date: '2026-11-20', sentence: 'You watched Arc40 Wrapped 2026 to the end on Nov 20, 2026.' });
    expect(lgWrapped(f, 5, A('2026-11-30')).progress.text).toBe('2 of 5 years');
    expect(lgWrapped(f, 5, A('2026-11-30')).progress.need).toContain('Arc40 started keeping track of Wrapped on Nov 20, 2026.');
  });
});

describe('Arc40 anniversary', () => {
  it('one day before vs on the anniversary; the first is one year after setup', () => {
    const f = facts({ setupDate: '2026-11-11' });
    expect(lgAnniversary(f, A('2027-11-10', null, 2027)).earned).toBeNull();
    expect(lgAnniversary(f, A('2027-11-10', null, 2027)).progress.text).toBe('1 day to go');
    expect(lgAnniversary(f, A('2027-11-11', null, 2027)).earned).toMatchObject({ date: '2027-11-11', sentence: '1 year with Arc40: you set it up on Nov 11, 2026.' });
    expect(lgAnniversary(f, A('2030-01-01', null, 2026)).earned).toBeNull(); // the setup year itself is no anniversary
    expect(lgAnniversary(facts({ setupDate: '2024-02-29' }), A('2025-02-28', null, 2025)).earned?.date).toBe('2025-02-28');
  });
});

describe('Collector', () => {
  const earned = (n: number, id = (i: number) => `t${i}`) => Array.from({ length: n }, (_, i) => ({ id: id(i), date: new Date(Date.UTC(2026, 0, 1) + i * DAY).toISOString().slice(0, 10) }));
  it('24 vs 25 earned; each yearly instance counts on its own', () => {
    const f = (e: CollectorFacts['earned']): CollectorFacts => ({ earned: e, ids: [] });
    expect(lgCollector(f(earned(24)), 25, A('2026-11-11')).earned).toBeNull();
    expect(lgCollector(f(earned(25)), 25, A('2026-11-11')).earned?.date).toBe('2026-01-25');
    expect(lgCollector(f(earned(24)), 25, A('2026-11-11')).progress.text).toBe('24 of 25 trophies');
    // 24 different trophies + the same yearly trophy for a second year = 25.
    const yearly = [...earned(23), { id: 'roth.maxed', date: '2026-05-01' }, { id: 'roth.maxed', date: '2027-04-01' }];
    expect(lgCollector(f(yearly), 25, A('2027-11-11')).earned?.date).toBe('2027-04-01');
  });

  it('every trophy: all catalog ids at least once (a yearly kind: one year); never counts Collector itself', () => {
    const ids = TROPHIES.filter((t) => !isCollector(t)).map((t) => t.id);
    expect(ids).toHaveLength(175);
    expect(ids.some((id) => id.startsWith('lg.collector'))).toBe(false);
    expect(ids).toContain('the-arc');
    const all = ids.map((id, i) => ({ id, date: new Date(Date.UTC(2026, 0, 1) + i * DAY).toISOString().slice(0, 10) }));
    expect(lgCollectorAll({ earned: all, ids }, A('2027-12-31')).earned?.date).toBe(all.at(-1)!.date);
    expect(lgCollectorAll({ earned: all.slice(1), ids }, A('2027-12-31')).earned).toBeNull();
    expect(lgCollectorAll({ earned: all.slice(1), ids }, A('2027-12-31')).progress.text).toBe('174 of 175 trophies');
  });
});

describe('The Arc', () => {
  const birth = { year: 2001, month: 7 }; // made up: turns 40 in July 2041
  it('the month before turning 40 vs the 1st of that month', () => {
    expect(arcDay(birth)).toBe('2041-07-01');
    const f = facts({ birth, firstDataDate: '2026-01-15' });
    expect(theArc(f, A('2041-06-30')).earned).toBeNull();
    expect(theArc(f, A('2041-07-01')).earned?.date).toBe('2041-07-01');
    expect(theArc(f, A('2041-07-01')).progress.text).toBe('This month');
  });

  it('progress is time: "N years, M months to go", from the first history day to that month', () => {
    const o = theArc(facts({ birth, firstDataDate: '2026-01-15' }), A('2026-11-11'));
    expect(o.progress.text).toBe('14 years, 8 months to go'); // Nov 2026 -> Jul 2041
    expect(o.progress.fraction).toBeCloseTo(10 / 186, 5); // Jan 2026 -> Jul 2041 is 186 months, 10 gone
    expect(yearsMonths(256)).toBe('21 years, 4 months');
    expect(yearsMonths(12)).toBe('1 year');
  });

  it('no birth month saved: blocked with a plain line, never a guessed age; history must start before 40', () => {
    expect(theArc(facts({ firstDataDate: '2026-01-15' }), A('2026-11-11'))).toMatchObject({ earned: null, blocked: ARC_NO_BIRTH });
    expect(ARC_NO_BIRTH).toBe('Set your birth month in Settings to watch The Arc.');
    const late = theArc(facts({ birth, firstDataDate: '2041-07-01' }), A('2041-08-01'));
    expect(late.earned).toBeNull();
    expect(late.blocked).toBe('Arc40 started after you turned 40.');
  });
});

describe('the pop-up queue: Collector after everything, The Arc always last', () => {
  const item = (key: string, id: string, rank: UnlockItem['rank'], group: UnlockItem['group'], earnedOn = '2026-11-11') =>
    ({ key, id, rank, stars: 0, group, earnedOn }) as UnlockItem;
  it('orders a Diamond trophy before a Gold Collector, and The Arc after an Arc40 Collector', () => {
    const q = [
      item('the-arc', 'the-arc', 'arc40', 'the_arc'),
      item('lg.collector.all', 'lg.collector.all', 'arc40', 'long_game'),
      item('lg.collector.25', 'lg.collector.25', 'gold', 'long_game'),
      item('nw.1m', 'nw.1m', 'diamond', 'net_worth'),
      item('nw.1k', 'nw.1k', 'iron', 'net_worth'),
    ].sort(unlockOrder);
    expect(q.map((x) => x.key)).toEqual(['nw.1k', 'nw.1m', 'lg.collector.25', 'lg.collector.all', 'the-arc']);
  });
});

// ------------------------------------------------------------------ through the API

let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };
const call = (opts: InjectOptions) =>
  t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });
const ok = async (opts: InjectOptions) => {
  const r = await call(opts);
  if (r.statusCode < 200 || r.statusCode > 299) throw new Error(`${opts.method} ${opts.url} -> ${r.statusCode} ${r.body}`);
  return r.json();
};
const on = (key: string, mode: 'history' | 'today' = 'history') => ok({ method: 'POST', url: `/api/trophies/${key}/on`, payload: { mode } });
const evaluate = async () => (await ok({ method: 'POST', url: '/api/trophies/evaluate' })).earned as { key: string; earnedOn: string }[];
const data = (today = '2026-11-11') => new TrophyData(t.store.current(), today);
const relogin = async () => {
  const r = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: HOST_HEADER, payload: { password: 'correct horse battery' } });
  auth = { cookie: cookieFrom(r), csrf: r.json().csrfToken as string };
};
const account = async (name: string, type: string, openingBalance?: string, openingDate?: string) =>
  (await ok({ method: 'POST', url: '/api/accounts', payload: { name, type, ...(openingBalance ? { openingBalance, openingDate } : {}) } })).account.id as number;
const goal = async (accountId: number, target: string) => (await ok({ method: 'POST', url: '/api/goals', payload: { name: 'Fake goal', target, accountId } })).id as number;

describe('through the API', () => {
  beforeEach(async () => {
    t = await testApp(); // today = 2026-11-11, Arc40 set up today
    auth = await setupAndLogin(t);
  });
  afterEach(async () => {
    await t.app.close();
  });

  it('a goal is done after 30 days at its target (day 29 vs day 30), and a done goal still counts after it is deleted', async () => {
    // $500 since Oct 13: Oct 13 .. Nov 11 = 30 days at the $500 target. Since Oct 14 = 29 days.
    const a30 = await account('Fake Savings A', 'savings', '500', '2026-10-13');
    const a29 = await account('Fake Savings B', 'savings', '500', '2026-10-14');
    const g30 = await goal(a30, '500');
    const g29 = await goal(a29, '500');
    // The 30 days count from the day a goal was set: say both were set in early October.
    const db = t.store.current();
    for (const id of [g30, g29]) db.prepare('UPDATE goals SET created_at = ? WHERE id = ?').run(Date.UTC(2026, 9, 1, 12), id);
    expect(data().goalMarks().map((g) => g.doneOn)).toEqual(['2026-11-11', null]);
    expect((await on('lg.goals.1')).earned).toEqual([expect.objectContaining({ key: 'lg.goals.1', earnedOn: '2026-11-11' })]);
    // Deleting the done goal (the delete saves its marks first) keeps it in the count for the next rung.
    await ok({ method: 'DELETE', url: `/api/goals/${g30}` });
    const d = data().long.goals;
    expect(d).toHaveLength(2);
    expect(d.filter((g) => g.doneOn)).toEqual([expect.objectContaining({ doneOn: '2026-11-11' })]);
    expect((await ok({ method: 'GET', url: '/api/trophies/lg.goals.5' })).preview.text).toBe('1 of 5 goals');
  });

  it('a goal already met when it is made is done 30 days after it was set, not before', async () => {
    const a = await account('Fake Savings', 'savings', '900', '2026-01-02');
    await goal(a, '500'); // set today, Nov 11
    expect(data().goalMarks()[0]!.doneOn).toBeNull();
    expect(data('2026-12-10').goalMarks()[0]!.doneOn).toBe('2026-12-10'); // Nov 11 .. Dec 10 = 30 days
  });

  it("a goal deleted before any check is remembered too; a new goal that gets the old id does not inherit 'done'", async () => {
    const a = await account('Fake Savings', 'savings', '500', '2026-10-13');
    const g = await goal(a, '500');
    t.store.current().prepare('UPDATE goals SET created_at = ? WHERE id = ?').run(Date.UTC(2026, 9, 1, 12), g); // set Oct 1
    expect(t.store.current().prepare('SELECT COUNT(*) AS n FROM trophy_goal_marks').get()).toEqual({ n: 0 });
    await ok({ method: 'DELETE', url: `/api/goals/${g}` });
    t.clock.advance(1000);
    const again = await goal(a, '99999'); // far above the balance: not done
    expect(again).toBe(g); // SQLite reused the id
    const marks = data().long.goals.sort((x, y) => (x.setOn < y.setOn ? -1 : 1));
    expect(marks.map((m) => m.doneOn).sort()).toEqual(['2026-11-11', null].sort());
  });

  it('a perfect month from Arc40\'s own numbers: income above spending, under budget, clean books, money invested', async () => {
    const checking = await account('Fake Checking', 'checking');
    const brokerage = await account('Fake Brokerage', 'brokerage');
    const cats = Object.fromEntries(((await ok({ method: 'GET', url: '/api/categories' })).categories as { id: number; name: string }[]).map((c) => [c.name, c.id]));
    const tx = (accountId: number, date: string, amount: string, direction: 'in' | 'out', type: string, extra = {}) =>
      ok({ method: 'POST', url: '/api/transactions', payload: { accountId, date, amount, direction, description: 'Fake', type, ...extra } });
    // October 2026, data from Oct 1: $1,000 pay, $100 food (budget $200), $50 moved into the brokerage.
    await tx(checking, '2026-10-01', '1000', 'in', 'income', { categoryId: cats.Refereeing });
    const food = (await tx(checking, '2026-10-05', '100', 'out', 'expense', { categoryId: cats.Food })).transaction.id;
    await tx(checking, '2026-10-07', '50', 'out', 'transfer');
    await tx(brokerage, '2026-10-07', '50', 'in', 'transfer');
    await ok({ method: 'PUT', url: '/api/budget', payload: { categoryId: cats.Food, month: null, limit: '200' } });
    expect(data().long.perfect.find((m) => m.month === '2026-10-01')).toEqual({ month: '2026-10-01', earned: true, budget: true, clean: true, invested: true });
    // Over budget by one cent: the month is no longer perfect.
    await ok({ method: 'PATCH', url: `/api/transactions/${food}`, payload: { amount: '200.01' } });
    expect(data().long.perfect.find((m) => m.month === '2026-10-01')).toMatchObject({ budget: false });
  });

  it('Wrapped watched comes from the log: the same year twice counts once', async () => {
    const db = t.store.current();
    logWrappedWatched(db, 2026, t.clock.now());
    logWrappedWatched(db, 2026, t.clock.now());
    expect((await on('lg.wrapped.1')).earned).toEqual([expect.objectContaining({ key: 'lg.wrapped.1', earnedOn: '2026-11-11' })]);
    expect((await ok({ method: 'GET', url: '/api/trophies/lg.wrapped.5' })).preview.text).toBe('1 of 5 years');
  });

  it('anniversary banners start the year after setup; a new year\'s banner inherits On', async () => {
    expect(data().setupDate()).toBe('2026-11-11');
    expect(data().anniversaryYears()).toEqual([2027]);
    await on('lg.anniversary:2027');
    t.clock.advance(365 * DAY); // 2027-11-11
    await relogin();
    expect(await evaluate()).toEqual([expect.objectContaining({ key: 'lg.anniversary:2027', earnedOn: '2027-11-11' })]);
    t.clock.advance(366 * DAY); // 2028-11-11 (2028 is a leap year)
    await relogin();
    const v = (await ok({ method: 'GET', url: '/api/trophies' })).trophies.find((x: { key: string }) => x.key === 'lg.anniversary:2028');
    expect(v.state).toBe('on'); // inherited from 2027
    expect(await evaluate()).toEqual([expect.objectContaining({ key: 'lg.anniversary:2028', earnedOn: '2028-11-11' })]);
  });

  it('Collector: the 25th trophy and Collector 25 in one check, Collector last; a taken-back trophy does not count', async () => {
    const db = t.store.current();
    const now = t.clock.now();
    // 24 earned trophies, set directly (the rules are tested elsewhere).
    const keys = TROPHIES.filter((d) => !d.yearly && !isCollector(d) && d.group !== 'tidy').slice(0, 24).map((d) => d.id);
    for (const k of keys) {
      turnOn(db, k, 'history', '2026-11-01', now);
      saveAward(db, k, { date: '2026-11-01', sentence: 'Fake award.', story: null }, undefined, now);
    }
    await on('lg.collector.25');
    expect(data().collector.earned).toHaveLength(24);
    // A 25th: First backup is watched but has no backup yet; then a backup lands, and ONE check earns First backup and
    // Collector 25 (Collector is evaluated after every other trophy, so it sees the 25th).
    expect((await on('td.first-backup', 'history')).earned).toEqual([]);
    db.prepare("INSERT INTO activity_log (kind, on_date, at, backup_kind) VALUES ('backup', '2026-11-11', ?, 'manual')").run(now);
    expect((await evaluate()).map((e) => e.key)).toEqual(['td.first-backup', 'lg.collector.25']);
    // Take one back: it is Off, so Collector's count drops (the earned Collector stays).
    await ok({ method: 'POST', url: `/api/trophies/${keys[0]}/take-back` });
    expect(data().collector.earned).toHaveLength(24);
    const unseen = (await ok({ method: 'GET', url: '/api/trophies/unseen' })).trophies as { key: string }[];
    expect(unseen.at(-1)!.key).toBe('lg.collector.25');
  });

  it('a new long game trophy and The Arc: in the pop-up queue exactly once (The Arc last), on the Dashboard shelf, in the close-up', async () => {
    // A made-up birth month that is already past 40, and money history from before then.
    await ok({ method: 'PUT', url: '/api/settings/planning', payload: { birth: { year: 1980, month: 1 } } });
    const checking = await account('Fake Checking', 'checking');
    await ok({ method: 'POST', url: '/api/transactions', payload: { accountId: checking, date: '2019-12-01', amount: '5', direction: 'in', description: 'Fake', type: 'income' } });
    await goal(checking, '1');
    expect((await on('lg.goal-set')).earned[0]).toMatchObject({ key: 'lg.goal-set', earnedOn: '2026-11-11' });
    expect((await on('the-arc')).earned[0]).toMatchObject({ key: 'the-arc', earnedOn: '2020-01-01' });
    const unseen = (await ok({ method: 'GET', url: '/api/trophies/unseen' })).trophies as { key: string; award: number; groupLabel: string }[];
    expect(unseen.map((u) => [u.key, u.groupLabel])).toEqual([
      ['lg.goal-set', 'The long game'],
      ['the-arc', ARC_GROUP.label],
    ]);
    const items = unseen.map((u) => ({ key: u.key, award: u.award }));
    expect((await ok({ method: 'POST', url: '/api/trophies/celebrate', payload: { items } })).claimed).toEqual(['lg.goal-set', 'the-arc']);
    expect((await ok({ method: 'POST', url: '/api/trophies/celebrate', payload: { items } })).claimed).toEqual([]);
    expect((await ok({ method: 'GET', url: '/api/trophies/unseen' })).trophies).toEqual([]);
    const shelf = await ok({ method: 'GET', url: '/api/trophies/shelf' });
    expect(shelf.recent.map((v: { key: string }) => v.key).sort()).toEqual(['lg.goal-set', 'the-arc']);
    const close = await ok({ method: 'GET', url: '/api/trophies/the-arc' });
    expect(close).toMatchObject({ state: 'earned', shape: 'arc', kindLabel: 'The one and only', sentence: 'You turned 40 with Arc40 at your side since Dec 1, 2019.' });
    // The Arc is in the list (after every shelf) but not a shelf of its own.
    const all = await ok({ method: 'GET', url: '/api/trophies' });
    expect(all.trophies.at(-1).key).toBe('the-arc');
    expect(all.groups.map((g: { id: string }) => g.id)).not.toContain('the_arc');
  });

  it('The Arc with no birth month: Off, blocked with the Settings line, never a guessed age', async () => {
    const v = await ok({ method: 'GET', url: '/api/trophies/the-arc' });
    expect(v.state).toBe('off');
    expect(v.preview).toMatchObject({ text: 'No birth month saved', need: ARC_NO_BIRTH });
    await on('the-arc');
    expect((await ok({ method: 'GET', url: '/api/trophies/the-arc' })).blocked).toBe(ARC_NO_BIRTH);
  });

  it('turning on the whole long game shelf uses each suggestion (Perfect months and Perfect year from today); GETs never write', async () => {
    const tables = (t.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name <> 'sessions' ORDER BY name").all() as { name: string }[]).map((x) => x.name);
    const dump = () => tables.map((n) => JSON.stringify(t.db.prepare(`SELECT * FROM "${n}"`).all())).join('\n');
    const before = dump();
    await ok({ method: 'GET', url: '/api/trophies' });
    await ok({ method: 'GET', url: '/api/trophies/lg.perfect.1' });
    await ok({ method: 'GET', url: '/api/trophies/the-arc' });
    expect(dump()).toBe(before);
    expect((await ok({ method: 'POST', url: '/api/trophies/groups/long_game/on' })).turnedOn).toBe(23);
    const today = (t.db.prepare("SELECT trophy_key FROM trophy_states WHERE mode = 'today' ORDER BY trophy_key").all() as { trophy_key: string }[]).map((r) => r.trophy_key);
    expect(today).toEqual(['lg.perfect-year', 'lg.perfect.1', 'lg.perfect.12', 'lg.perfect.3', 'lg.perfect.6']);
    expect((await call({ method: 'POST', url: '/api/trophies/groups/the_arc/on' })).statusCode).toBe(404); // not a shelf
  });
});
