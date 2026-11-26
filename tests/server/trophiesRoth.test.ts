/**
 * Trophy Case, Round 1 (Milestone 2b): the 20 Roth trophies and yearly trophies. Fake numbers only.
 * Limits used below: 2025 = $7,000 by Apr 15, 2026; 2026 = $7,500 by Apr 15, 2027.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '../../shared/dates.js';
import { TROPHIES } from '../../shared/trophies.js';
import { dailySeries } from '../../server/src/lib/trophies/data.js';
import type { Day } from '../../server/src/lib/trophies/hold.js';
import {
  paceMonthEnds,
  rothByJune,
  rothFirst,
  rothMaxed,
  rothOnPace,
  rothTotal,
  rothWorth,
  rothYearsMaxed,
  type RothContribution,
  type RothFacts,
} from '../../server/src/lib/trophies/rothRules.js';
import { evaluateTrophies, trophyViews, turnOnTrophy } from '../../server/src/lib/trophies/engine.js';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';

const $ = (d: number) => Math.round(d * 100);
const LIMITS = {
  '2023': { limitCents: $(6500), deadline: '2024-04-15' },
  '2024': { limitCents: $(7000), deadline: '2025-04-15' },
  '2025': { limitCents: $(7000), deadline: '2026-04-15' },
  '2026': { limitCents: $(7500), deadline: '2027-04-15' },
};
const c = (date: string, dollars: number, taxYear = Number(date.slice(0, 4))): RothContribution => ({ date, taxYear, amountCents: $(dollars) });
function facts(contributions: RothContribution[], limits: RothFacts['limits'] = LIMITS, worth: Day[] = []): RothFacts {
  return { contributions: [...contributions].sort((a, b) => (a.date < b.date ? -1 : 1)), limits, worth: dailySeries(worth) };
}
const args = (year: number | null, today = '2027-05-01', from: string | null = null) => ({ today, from, year });

describe('catalog', () => {
  it('has the 20 Roth trophies: 3 yearly banners, 1 streak cup, 4 + 5 + 6 coins, 1 statuette; 43 in all', () => {
    const r = TROPHIES.filter((t) => t.group === 'roth');
    expect(r).toHaveLength(20);
    expect(TROPHIES.filter((t) => t.group === 'net_worth' || t.group === 'roth')).toHaveLength(43); // Round 1
    expect(r.filter((t) => t.yearly).map((t) => [t.id, t.rank, t.shape])).toEqual([
      ['roth.maxed', 'gold', 'banner'],
      ['roth.on-pace', 'silver', 'banner'],
      ['roth.june', 'platinum', 'banner'],
    ]);
    expect(r.filter((t) => t.shape === 'cup').map((t) => t.rank)).toEqual(['rose_gold']);
    expect(r.filter((t) => t.ladder === 'roth-years').map((t) => t.rank)).toEqual(['obsidian', 'emerald', 'diamond', 'arc40']);
    expect(r.filter((t) => t.ladder === 'roth-total').map((t) => t.rank)).toEqual(['silver', 'gold', 'platinum', 'emerald', 'diamond']);
    expect(r.filter((t) => t.ladder === 'roth-worth').map((t) => t.rank)).toEqual(['bronze', 'gold', 'platinum', 'emerald', 'diamond', 'arc40']);
    expect(r.every((t) => t.defaultMode === 'history')).toBe(true);
  });
});

describe('Maxed the tax year (yearly)', () => {
  it('reaching the limit exactly on the deadline counts; one cent short or one day late does not', () => {
    // 2026: $5,000 + $2,499.99 = $7,499.99, then $0.01 on Apr 15, 2027 = $7,500.00 exactly.
    const base = [c('2026-02-01', 5000), c('2026-03-01', 2499.99)];
    expect(rothMaxed(facts(base), args(2026)).earned).toBeNull();
    const onTime = rothMaxed(facts([...base, c('2027-04-15', 0.01, 2026)]), args(2026));
    expect(onTime.earned?.date).toBe('2027-04-15');
    expect(onTime.earned?.sentence).toBe('You put the full $7,500 into your Roth for 2026 by Apr 15, 2027, before the Apr 15, 2027 deadline.');
    expect(rothMaxed(facts([...base, c('2027-04-16', 0.01, 2026)]), args(2026)).earned).toBeNull();
  });

  it('a negative contribution lowers the total (signed, never Math.abs)', () => {
    // $7,000, then a $500 reversal, then $500 = $7,000 total. With Math.abs it would wrongly be $8,000.
    const f = facts([c('2026-01-10', 7000), c('2026-02-10', -500), c('2026-03-10', 500)]);
    const o = rothMaxed(f, args(2026, '2026-06-01'));
    expect(o.earned).toBeNull();
    expect(o.progress.text).toBe('$7,000 of $7,500');
  });

  it('counts contributions by TAX year, not by calendar year', () => {
    // $7,000 dated Mar 2026 but for tax year 2025 maxes 2025, not 2026.
    const f = facts([c('2026-03-01', 7000, 2025)]);
    expect(rothMaxed(f, args(2025)).earned?.date).toBe('2026-03-01');
    expect(rothMaxed(f, args(2026)).earned).toBeNull();
  });

  it('a year with no saved limit or deadline is never guessed', () => {
    const f = facts([c('2027-01-05', 99999, 2027)]);
    const o = rothMaxed(f, args(2027));
    expect(o).toMatchObject({ earned: null, blocked: 'Enter the limit for 2027 first.' });
    const noDeadline = rothMaxed(facts([c('2026-01-05', 7500)], { '2026': { limitCents: $(7500), deadline: null } }), args(2026));
    expect(noDeadline.blocked).toBe('Enter the deadline for 2026 first.');
  });

  it('Start from today: the whole year still counts, but it must get maxed on or after the day', () => {
    const f = facts([c('2026-02-01', 5000), c('2026-09-01', 2500)]);
    expect(rothMaxed(f, args(2026, '2026-12-01', '2026-08-01')).earned?.date).toBe('2026-09-01'); // $5,000 before still counts
    expect(rothMaxed(f, args(2026, '2026-12-01', '2026-10-01')).earned).toBeNull(); // already maxed before the day
  });
});

describe('Maxed by June 30 (yearly)', () => {
  it('June 30 counts, July 1 does not; needs only the limit', () => {
    expect(rothByJune(facts([c('2026-06-30', 7500)]), args(2026)).earned?.date).toBe('2026-06-30');
    expect(rothByJune(facts([c('2026-07-01', 7500)]), args(2026)).earned).toBeNull();
    const noDeadline = facts([c('2026-05-01', 7500)], { '2026': { limitCents: $(7500), deadline: null } });
    expect(rothByJune(noDeadline, args(2026)).earned?.date).toBe('2026-05-01');
  });
});

describe('On pace all year (yearly)', () => {
  // 2026: $7,500 by Apr 15, 2027 = 16 months, a month of pace = $468.75; on pace = within half a month ($234.38) of the
  // even line. Jan 31: the line is $7,500 x 30 / 469 days = $479.74.
  const monthly = (skip?: string) => {
    const rows: RothContribution[] = [];
    for (let i = 0; i < 15; i++) {
      const d = `${2026 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`;
      if (d !== skip) rows.push(c(d, 500, 2026));
    }
    return rows;
  };

  it('checks Jan 31 of Y through Mar 31 of Y+1 (the last month end before Apr 15)', () => {
    const ends = paceMonthEnds(2026, '2027-04-15');
    expect(ends[0]).toBe('2026-01-31');
    expect(ends.at(-1)).toBe('2027-03-31');
    expect(ends).toHaveLength(15);
  });

  it('$500 on the 1st of every month stays ahead and maxes on Mar 1, 2027 -> earned that day', () => {
    const o = rothOnPace(facts(monthly()), args(2026));
    expect(o.earned?.date).toBe('2027-03-01'); // the 15th $500
    expect(o.earned?.sentence).toContain('at every month end (14 checked)'); // Jan 31, 2026 .. Feb 28, 2027
  });

  it('skipping February is behind at Feb 28, so the year can no longer earn it', () => {
    // Skip Feb 1: Feb 28 has $500 (Jan only) + nothing; line at Feb 28 = 7500 x 58 / 469 = $927.51 -> $427.51 behind
    // = 0.91 months of pace: "behind by a little" -> it can no longer be earned, even though the year still gets maxed later.
    const rows = [...monthly('2026-02-01'), c('2027-03-02', 500, 2026)];
    const o = rothOnPace(facts(rows), args(2026));
    expect(o.earned).toBeNull();
    expect(o.progress).toMatchObject({ text: 'Behind at the end of February 2026', need: '2026 can no longer earn this one.' });
  });
});

describe('Years maxed', () => {
  const maxedYears = (years: number[]) => years.map((y) => c(`${y}-03-01`, y >= 2026 ? 7500 : y >= 2024 ? 7000 : 6500, y));

  it('2 in a row: 2024 and 2025 -> earned when 2025 was maxed', () => {
    const o = rothYearsMaxed(facts(maxedYears([2024, 2025])), 2, true, args(null));
    expect(o.earned?.date).toBe('2025-03-01');
    expect(o.earned?.sentence).toBe('You maxed your Roth 2 tax years in a row; the last one was done on Mar 1, 2025.');
  });

  it('2023 and 2025 are 2 years maxed but not in a row', () => {
    const f = facts(maxedYears([2023, 2025]));
    expect(rothYearsMaxed(f, 2, true, args(null)).earned).toBeNull();
    expect(rothYearsMaxed(f, 2, true, args(null)).progress.text).toBe('1 of 2 years in a row');
    expect(rothYearsMaxed(f, 2, false, args(null)).earned?.date).toBe('2025-03-01');
  });

  it('a year with no saved limit never counts; 5 total needs 5 maxed years', () => {
    // 2022 has no limit saved, so only 2023..2026 count: 4 of 5.
    const o = rothYearsMaxed(facts([c('2022-03-01', 6000), ...maxedYears([2023, 2024, 2025, 2026])]), 5, false, args(null));
    expect(o.earned).toBeNull();
    expect(o.progress.text).toBe('4 of 5 years maxed');
  });
});

describe('Total contributions (signed)', () => {
  it('$4,000 + $4,000 - $500 reversal + $2,500 = exactly $10,000 on the 4th date', () => {
    const rows = [c('2025-01-05', 4000), c('2025-06-05', 4000), c('2025-07-05', -500), c('2026-01-05', 2500)];
    const o = rothTotal(facts(rows), $(10000), args(null));
    expect(o.earned?.date).toBe('2026-01-05');
    expect(o.progress.text).toBe('$10,000 of $10,000');
    const short = rothTotal(facts([...rows.slice(0, 3), c('2026-01-05', 2499.99)]), $(10000), args(null));
    expect(short.earned).toBeNull();
    expect(short.progress.text).toBe('$9,999.99 of $10,000');
  });

  it('Start from today only adds contributions from that day on', () => {
    const rows = [c('2025-01-05', 9000), c('2026-02-01', 9000), c('2026-03-01', 1000)];
    expect(rothTotal(facts(rows), $(10000), args(null)).earned?.date).toBe('2026-02-01');
    expect(rothTotal(facts(rows), $(10000), args(null, '2027-05-01', '2026-01-01')).earned?.date).toBe('2026-03-01');
  });
});

describe('Roth worth (30-day rule) and first contribution', () => {
  it('Roth balance at or above $10,000 for 30 days', () => {
    const days: Day[] = Array.from({ length: 40 }, (_, i) => ({ date: addDays('2026-01-01', i), cents: i < 5 ? $(9999.99) : $(10000) }));
    const o = rothWorth(facts([], LIMITS, days), $(10000), args(null, '2026-02-09'));
    expect(o.earned?.date).toBe('2026-02-04'); // Jan 6 .. Jan 31 = 26 days, + Feb 1..4 = 30
    expect(o.earned?.sentence).toBe('Your Roth IRA stayed at or above $10,000 for 30 days in a row, from Jan 6 to Feb 4, 2026.');
  });

  it('first contribution above $0 (a reversal first does not count)', () => {
    const o = rothFirst(facts([c('2025-02-01', -100), c('2025-03-01', 250)]), args(null));
    expect(o.earned).toMatchObject({ date: '2025-03-01', sentence: 'Your first Roth contribution: $250 on Mar 1, 2025, for 2025.' });
    expect(rothFirst(facts([]), args(null)).earned).toBeNull();
  });
});

// ------------------------------------------------------------------- yearly trophies through the API

describe('yearly trophies in the app', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let auth: { cookie: string; csrf: string };
  let roth: number;
  const call = (o: { method: 'GET' | 'POST' | 'PUT'; url: string; payload?: unknown }) =>
    t.app.inject({ ...o, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf } } as never);
  const contribute = (date: string, cents: number, taxYear: number) =>
    t.db
      .prepare("INSERT INTO investment_activity (account_id, date, kind, amount_cents, tax_year, source, created_at) VALUES (?, ?, 'contribution', ?, ?, 'manual', 1)")
      .run(roth, date, cents, taxYear);

  beforeEach(async () => {
    t = await testApp(); // today = 2026-11-11; 2026 limit $7,500 by Apr 15, 2027 is the default setting
    auth = await setupAndLogin(t);
    roth = (await call({ method: 'POST', url: '/api/accounts', payload: { name: 'Test Roth', institution: 'Test', type: 'roth_ira' } })).json().account.id;
    await call({ method: 'PUT', url: '/api/settings/ira', payload: { year: 2025, limit: '7000', deadline: '2026-04-15' } });
    contribute('2025-02-01', 700000, 2025);
    contribute('2026-01-15', 300000, 2026);
  });
  afterEach(async () => t.app.close());

  it('one banner per year from the first Roth year; a year with no limit says so', async () => {
    contribute('2024-05-01', 10000, 2024);
    const list = (await call({ method: 'GET', url: '/api/trophies' })).json();
    const banners = list.trophies.filter((v: { id: string }) => v.id === 'roth.maxed').map((v: { key: string }) => v.key);
    expect(banners.sort()).toEqual(['roth.maxed:2024', 'roth.maxed:2025', 'roth.maxed:2026']);
    expect(list.counts.total).toBe(TROPHIES.length + 2 * 3); // two extra years of the 3 yearly trophies
    await call({ method: 'POST', url: '/api/trophies/roth.maxed:2024/on', payload: { mode: 'history' } });
    const v = (await call({ method: 'GET', url: '/api/trophies/roth.maxed:2024' })).json();
    expect(v).toMatchObject({ state: 'on', name: 'Maxed the Roth 2024', blocked: 'Enter the limit for 2024 first.' });
    expect(v.engraving).toBe('MAXED · 2024');
    expect((await call({ method: 'GET', url: '/api/trophies/roth.maxed:2030' })).statusCode).toBe(404);
  });

  it('progress equals the Goals page for the same year', async () => {
    await call({ method: 'POST', url: '/api/trophies/roth.maxed:2026/on', payload: { mode: 'history' } });
    const goals = (await call({ method: 'GET', url: '/api/goals?year=2026' })).json();
    const v = (await call({ method: 'GET', url: '/api/trophies/roth.maxed:2026' })).json();
    expect(v.progress.text).toBe(`$${(goals.roth.contributedCents / 100).toLocaleString('en-US')} of $7,500`);
  });

  it('a new year inherits On from last year (same mode); it is saved at the next check; Off stays Off', () => {
    turnOnTrophy(t.db, 'roth.maxed:2025', 'history', '2026-11-11', 1); // earned (Feb 1, 2025)
    turnOnTrophy(t.db, 'roth.maxed:2026', 'today', '2026-11-11', 1);
    // Jan 2027: the 2027 banner appears. Its parent (2026) is On in "today" mode -> 2027 is On too.
    const v = trophyViews(t.db, '2027-01-02').trophies;
    expect(v.find((x) => x.key === 'roth.maxed:2027')).toMatchObject({ state: 'on', mode: 'today', since: '2026-11-11' });
    expect(v.find((x) => x.key === 'roth.june:2027')?.state).toBe('off'); // its 2026 banner was Off
    expect(t.db.prepare("SELECT 1 FROM trophy_states WHERE trophy_key = 'roth.maxed:2027'").get()).toBeUndefined(); // GET did not write
    evaluateTrophies(t.db, '2027-01-02', 2);
    expect(t.db.prepare("SELECT state, mode FROM trophy_states WHERE trophy_key = 'roth.maxed:2027'").get()).toEqual({ state: 'on', mode: 'today' });
  });

  it('turning off an inherited yearly trophy keeps it Off', async () => {
    turnOnTrophy(t.db, 'roth.june:2025', 'history', '2026-11-11', 1);
    turnOnTrophy(t.db, 'roth.june:2026', 'history', '2026-11-11', 1);
    t.db.prepare("DELETE FROM trophy_states WHERE trophy_key = 'roth.june:2026'").run(); // as if 2026 had just appeared
    expect(trophyViews(t.db, '2026-11-11').trophies.find((x) => x.key === 'roth.june:2026')?.state).toBe('on');
    expect((await call({ method: 'POST', url: '/api/trophies/roth.june:2026/off' })).statusCode).toBe(200);
    expect(trophyViews(t.db, '2026-11-11').trophies.find((x) => x.key === 'roth.june:2026')?.state).toBe('off');
  });

  it('whole Roth shelf: each with its own suggested mode; earns what the history already shows', async () => {
    const r = (await call({ method: 'POST', url: '/api/trophies/groups/roth/on' })).json();
    expect(r.turnedOn).toBe(20 + 3); // 2025 and 2026 banners
    // $7,000 (2025) + $3,000 (2026) = $10,000 in contributions on Jan 15, 2026, and the Roth has held $10,000 since then.
    expect(r.earned.map((e: { key: string; earnedOn: string }) => [e.key, e.earnedOn]).sort()).toEqual([
      ['roth.first', '2025-02-01'],
      ['roth.june:2025', '2025-02-01'],
      ['roth.maxed:2025', '2025-02-01'],
      ['roth.total.10k', '2026-01-15'],
      ['roth.worth.10k', '2026-02-13'],
    ]);
    // On pace 2025 is not earned: at Jan 31, 2025 nothing was in yet ($0 vs a line of $447.76)... it was put in on Feb 1.
    const pace = (await call({ method: 'GET', url: '/api/trophies/roth.on-pace:2025' })).json();
    expect(pace.progress.text).toBe('Behind at the end of January 2025');
  });

  it('earned yearly trophies stay earned when a reversal later lowers the year', async () => {
    await call({ method: 'POST', url: '/api/trophies/roth.maxed:2025/on', payload: { mode: 'history' } });
    contribute('2025-03-01', -100000, 2025);
    await call({ method: 'POST', url: '/api/trophies/evaluate' });
    expect((await call({ method: 'GET', url: '/api/trophies/roth.maxed:2025' })).json()).toMatchObject({ state: 'earned', earnedOn: '2025-02-01' });
  });
});
