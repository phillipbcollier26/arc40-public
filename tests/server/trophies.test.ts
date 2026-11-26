/**
 * Trophy Case, Round 1 (Milestone 2a): the 30-day rule, the Net worth trophies, states and evaluation.
 * All numbers are fake. Each example is small enough to check by hand in the comments.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '../../shared/dates.js';
import { TROPHIES, TROPHY_GROUPS, parseTrophyKey } from '../../shared/trophies.js';
import { dailySeries } from '../../server/src/lib/trophies/data.js';
import { everyDay, firstHold, type Day } from '../../server/src/lib/trophies/hold.js';
import { nwBestYear, nwComeback, nwHigh, nwHold, nwYearGain } from '../../server/src/lib/trophies/netWorthRules.js';
import { evaluateTrophies, trophyViews, turnOnTrophy } from '../../server/src/lib/trophies/engine.js';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';

const D = 100; // one dollar in cents

/** One value per day starting at `start` (dollars; null = no data). */
function days(start: string, dollars: (number | null)[]): Day[] {
  return dollars.map((v, i) => ({ date: addDays(start, i), cents: v === null ? null : Math.round(v * D) }));
}
const rep = (v: number | null, n: number) => Array<number | null>(n).fill(v);
const H = { today: '2026-11-11', from: null, year: null };

describe('catalog', () => {
  it('has the 23 Net worth trophies (43 with Roth) with unique ids, every one Off by default (history suggested)', () => {
    const nw = TROPHIES.filter((t) => t.group === 'net_worth');
    expect(nw).toHaveLength(23);
    expect(new Set(TROPHIES.map((t) => t.id)).size).toBe(TROPHIES.length);
    expect(nw.every((t) => t.defaultMode === 'history')).toBe(true);
    expect(TROPHY_GROUPS.map((g) => g.label)).toEqual([
      'Net worth',
      'Investing',
      'Roth',
      'Emergency fund and savings',
      'Refereeing',
      'Spending habits',
      'Keeping things tidy',
      'The long game',
    ]);
  });

  it('reads trophy keys strictly', () => {
    expect(parseTrophyKey('nw.50k')?.def.name).toBe('Net worth $50k');
    expect(parseTrophyKey('nw.1m')?.def.rank).toBe('diamond');
    expect(parseTrophyKey('nw.10m')?.def.stars).toBe(3);
    expect(parseTrophyKey('nw.50k:2026')).toBeNull(); // not a yearly trophy
    expect(parseTrophyKey('nope')).toBeNull();
    expect(parseTrophyKey('NW.50K')).toBeNull();
  });
});

describe('the 30-day rule (firstHold)', () => {
  const ok = (d: Day) => d.cents! >= 1000 * D;

  it('exactly at the line counts; earned on day 30, not day 29', () => {
    // $1,000.00 every day from Jan 1: day 30 is Jan 30.
    expect(firstHold(days('2026-01-01', rep(1000, 29)), ok).earned).toBeNull();
    const h = firstHold(days('2026-01-01', rep(1000, 30)), ok);
    expect(h.earned).toMatchObject({ start: '2026-01-01', end: '2026-01-30' });
    expect(h.current).toBe(30);
  });

  it('one cent under never counts', () => {
    expect(firstHold(days('2026-01-01', rep(999.99, 60)), ok).earned).toBeNull();
  });

  it('a dip on day 15 restarts the hold: day 16 is day 1 again, earned on day 45', () => {
    const v = [...rep(1000, 14), 999.99, ...rep(1000, 40)];
    const h = firstHold(days('2026-01-01', v), ok);
    // Jan 16 + 29 days = Feb 14 (day 45 of the series).
    expect(h.earned).toMatchObject({ start: '2026-01-16', end: '2026-02-14' });
  });

  it('days with no data never count; Start from today ignores earlier days', () => {
    expect(firstHold(days('2026-01-01', [...rep(null, 5), ...rep(1000, 29)]), ok).earned).toBeNull();
    const h = firstHold(days('2026-01-01', rep(1000, 60)), ok, { from: '2026-01-20' });
    expect(h.earned?.end).toBe('2026-02-18'); // Jan 20 + 29
  });

  it('everyDay covers month and leap-year edges with no gaps', () => {
    expect(everyDay('2028-02-27', '2028-03-01')).toEqual(['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01']);
  });
});

describe('Net worth ladder (nw_hold)', () => {
  it('earns on the 30th day at or above the line, with a plain sentence', () => {
    const s = dailySeries(days('2026-03-01', [...rep(400, 10), ...rep(1000, 30), ...rep(500, 5)]));
    const o = nwHold(s, 1000 * D, { ...H, today: '2026-04-14' });
    expect(o.earned?.date).toBe('2026-04-09'); // Mar 11 + 29
    expect(o.earned?.sentence).toBe('Your net worth stayed at or above $1,000 for 30 days in a row, from Mar 11 to Apr 9, 2026.');
    expect(o.earned?.story?.points).toHaveLength(30);
  });

  it('progress: below the line shows the amount, at the line shows days held', () => {
    const below = nwHold(dailySeries(days('2026-03-01', rep(431, 3))), 1000 * D, H);
    expect(below.progress).toMatchObject({ text: '$431 of $1,000', fraction: 0.431 });
    const holding = nwHold(dailySeries(days('2026-03-01', [...rep(10, 3), ...rep(1000, 12)])), 1000 * D, H);
    expect(holding.earned).toBeNull();
    expect(holding.progress).toMatchObject({ text: 'Held 12 of 30 days', fraction: 0.4 });
    expect(holding.progress.score).toBeGreaterThan(1); // ranks ahead of anything still below its line
  });
});

describe('Up in one calendar year (nw_year_gain)', () => {
  // Line $5,000. The year starts at the value on Dec 31 of the year before.
  it('gain = value - Dec 31 before; a hold that crosses Jan 1 restarts', () => {
    // Dec 31, 2025 = $10,000. From Dec 2 2025 the value is $16,000 (but 2025 started at $0 -> not a 2025 gain since
    // 2025 has no start value). Jan 1 2026 on: $15,000 = +$5,000 exactly -> earned Jan 30, 2026.
    const v = [...rep(10000, 30), ...rep(15000, 40)]; // Dec 2 .. Dec 31 = 30 days at $10k
    const s = dailySeries(days('2025-12-02', v));
    const o = nwYearGain(s, 5000 * D, { ...H, today: '2026-02-09' });
    expect(o.earned?.date).toBe('2026-01-30');
    expect(o.earned?.sentence).toContain('above where 2026 started');
  });

  it('one cent short of the gain never counts', () => {
    const s = dailySeries(days('2025-12-31', [10000, ...rep(14999.99, 60)]));
    expect(nwYearGain(s, 5000 * D, { ...H, today: '2026-03-01' }).earned).toBeNull();
  });

  it('a hold must finish inside one year: Dec 15 to Jan 13 does not count', () => {
    // 2025 starts at $0 (Dec 31, 2024), so from Dec 15, 2025 the gain is $6,000; 2026 starts at $6,000, so its gain is $0.
    const s = dailySeries(days('2024-12-31', [0, ...rep(0, 348), ...rep(6000, 60)]));
    expect(s.on('2025-12-15')).toBe(6000 * D);
    const o = nwYearGain(s, 5000 * D, { ...H, today: '2026-02-12' });
    expect(o.earned).toBeNull();
  });

  it('a year with no value on Dec 31 before it never counts', () => {
    const s = dailySeries(days('2026-01-01', rep(9000, 60))); // data starts Jan 1: no Dec 31
    const o = nwYearGain(s, 5000 * D, { ...H, today: '2026-03-01' });
    expect(o.earned).toBeNull();
    expect(o.progress.text).toBe('No balance for Dec 31, 2025');
  });
});

describe('New all-time high (nw_high)', () => {
  /** Month-end values (dollars) Jan..: builds a daily series that holds each value through its month. */
  function monthly(startMonth: string, values: number[]): Day[] {
    const out: Day[] = [];
    let d = startMonth;
    values.forEach((v) => {
      const m = d.slice(0, 7);
      while (d.slice(0, 7) === m) {
        out.push({ date: d, cents: v * D });
        d = addDays(d, 1);
      }
    });
    return out;
  }

  it('needs 3 earlier month ends; keeps every later record', () => {
    // Jan 100, Feb 300, Mar 200, Apr 250 (not above 300), May 400 (record, 4 earlier), Jun 350, Jul 500 (record).
    const s = dailySeries(monthly('2026-01-01', [100, 300, 200, 250, 400, 350, 500, 500]));
    const o = nwHigh(s, { ...H, today: '2026-08-15' });
    expect(o.earned?.date).toBe('2026-05-31');
    expect(o.earned?.sentence).toBe('Your net worth ended May 2026 at $400, higher than any month end before it.');
    expect(o.records?.map((r) => [r.period, r.amountCents])).toEqual([
      ['2026-05', 400 * D],
      ['2026-07', 500 * D],
    ]);
  });

  it('a month end only counts once the month has ended; Feb above Jan with only 1 earlier month is not a record', () => {
    const s = dailySeries(monthly('2026-01-01', [100, 200, 300, 400]));
    expect(nwHigh(s, { ...H, today: '2026-04-30' }).earned).toBeNull(); // Apr 30 is today: not ended
    expect(nwHigh(s, { ...H, today: '2026-05-01' }).earned?.date).toBe('2026-04-30');
  });

  it('Start from today: earlier month ends still set the bar', () => {
    const s = dailySeries(monthly('2026-01-01', [100, 200, 300, 900, 500, 950]));
    expect(nwHigh(s, { ...H, today: '2026-07-01', from: '2026-05-01' }).earned?.date).toBe('2026-06-30');
  });
});

describe('Biggest year ever (nw_best_year)', () => {
  it('Dec 31 vs Dec 31 before; earned on the first full year that beats an earlier one', () => {
    // Dec 31, 2023 $1,000; Dec 31, 2024 $3,000 (+2,000); Dec 31, 2025 $4,000 (+1,000); Dec 31, 2026 $7,000 (+3,000).
    const v: number[] = [];
    for (const d of everyDay('2023-12-31', '2027-01-05'))
      v.push(d <= '2023-12-31' ? 1000 : d <= '2024-12-31' ? 3000 : d <= '2025-12-31' ? 4000 : 7000);
    const s = dailySeries(days('2023-12-31', v));
    const o = nwBestYear(s, { ...H, today: '2027-01-05' });
    expect(o.earned?.date).toBe('2026-12-31');
    expect(o.earned?.sentence).toBe('Your net worth grew $3,000 in 2026, more than in any full year before it.');
    expect(nwBestYear(s, { ...H, today: '2026-12-31' }).earned).toBeNull(); // 2026 not complete until Dec 31 has passed
  });
});

describe('Comeback (nw_comeback)', () => {
  it('exactly 10% below the high is a dip; then 30 days above the old high', () => {
    // High $1,000, falls to $900 (exactly 90%), then $1,000.01 for 30 days.
    const s = dailySeries(days('2026-01-01', [1000, 900, ...rep(1000.01, 30)]));
    const o = nwComeback(s, { ...H, today: '2026-02-01' });
    expect(o.earned?.date).toBe('2026-02-01'); // Jan 3 + 29
    expect(o.earned?.sentence).toContain('fell to $900 on Jan 2, 2026, at least 10% below its high of $1,000');
  });

  it('a 9.99% dip is not a comeback; equal to the old high is not above it', () => {
    expect(nwComeback(dailySeries(days('2026-01-01', [1000, 900.01, ...rep(1100, 40)])), H).earned).toBeNull();
    expect(nwComeback(dailySeries(days('2026-01-01', [1000, 800, ...rep(1000, 40)])), H).earned).toBeNull();
  });

  it('falling back below the old high restarts the 30 days', () => {
    const s = dailySeries(days('2026-01-01', [1000, 800, ...rep(1001, 20), 999, ...rep(1001, 30)]));
    expect(nwComeback(s, H).earned?.date).toBe(addDays('2026-01-01', 52));
  });
});

// ------------------------------------------------------------------- states, evaluation and the API

describe('trophy states and the API', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let auth: { cookie: string; csrf: string };
  const call = (o: { method: 'GET' | 'POST' | 'PUT'; url: string; payload?: unknown }) =>
    t.app.inject({ ...o, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf } } as never);
  const states = () => t.db.prepare('SELECT trophy_key, state, mode, since, earned_on FROM trophy_states ORDER BY trophy_key').all();

  beforeEach(async () => {
    t = await testApp(); // today = 2026-11-11
    auth = await setupAndLogin(t);
    // Fake account: $1,500 from Sep 1, 2026 (71 days of history by Nov 10).
    const r = await call({ method: 'POST', url: '/api/accounts', payload: { name: 'Test Checking', institution: 'Test Bank', type: 'checking', openingBalance: '1500', openingDate: '2026-09-01' } });
    expect(r.statusCode, r.body).toBe(201);
  });
  afterEach(async () => t.app.close());

  it('every trophy is Off on a fresh install; GET never writes', async () => {
    const tables = (t.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name <> 'sessions' ORDER BY name").all() as { name: string }[]).map((x) => x.name);
    const dump = () => tables.map((n) => JSON.stringify(t.db.prepare(`SELECT * FROM "${n}"`).all())).join('\n');
    const before = dump();
    const res = (await call({ method: 'GET', url: '/api/trophies' })).json();
    await call({ method: 'GET', url: '/api/trophies/nw.1k' });
    expect(dump()).toBe(before);
    expect(res.counts).toEqual({ earned: 0, on: 0, off: TROPHIES.length, total: TROPHIES.length }); // no Roth data: this year's banners only
    expect(res.groups).toEqual([
      { id: 'net_worth', label: 'Net worth', earned: 0, off: 23, total: 23 },
      { id: 'investing', label: 'Investing', earned: 0, off: 28, total: 28 },
      { id: 'roth', label: 'Roth', earned: 0, off: 20, total: 20 },
      { id: 'emergency', label: 'Emergency fund and savings', earned: 0, off: 19, total: 19 },
      { id: 'refereeing', label: 'Refereeing', earned: 0, off: 17, total: 17 },
      { id: 'spending', label: 'Spending habits', earned: 0, off: 25, total: 25 },
      { id: 'tidy', label: 'Keeping things tidy', earned: 0, off: 23, total: 23 },
      { id: 'long_game', label: 'The long game', earned: 0, off: 23, total: 23 },
    ]); // no empty shelves; The Arc is not a shelf (its own spot), but it is counted
    expect(states()).toEqual([]);
  });

  it('Count my history vs Start from today: different results and the right earned dates', async () => {
    // History: $1,500 from Sep 1 -> held 30 days on Sep 30.
    const h = (await call({ method: 'POST', url: '/api/trophies/nw.1k/on', payload: { mode: 'history' } })).json();
    expect(h.earned).toEqual([{ key: 'nw.1k', name: 'Net worth $1k', rankLabel: 'Iron · Rank 1', earnedOn: '2026-09-30' }]);
    // Today: only Nov 11 on counts -> day 1 of 30 today.
    expect((await call({ method: 'POST', url: '/api/trophies/nw.5k/on', payload: { mode: 'today' } })).json().earned).toEqual([]);
    // The same $1k trophy in "today" mode (engine with later days): day 29 no, day 30 yes.
    await call({ method: 'POST', url: '/api/trophies/nw.1k/take-back' });
    turnOnTrophy(t.db, 'nw.1k', 'today', '2026-11-11', Date.now());
    expect(evaluateTrophies(t.db, '2026-12-09', Date.now())).toEqual([]); // day 29
    expect(evaluateTrophies(t.db, '2026-12-10', Date.now()).map((e) => [e.key, e.earnedOn])).toEqual([['nw.1k', '2026-12-10']]); // day 30

    const view = (await call({ method: 'GET', url: '/api/trophies/nw.1k' })).json();
    expect(view).toMatchObject({ state: 'earned', earnedOn: '2026-12-10', howCounted: 'From the day you turned it on, Nov 11, 2026' });
  });

  it('On trophies show progress; the close-up shows the next rung', async () => {
    await call({ method: 'POST', url: '/api/trophies/nw.5k/on', payload: { mode: 'history' } });
    const list = (await call({ method: 'GET', url: '/api/trophies' })).json();
    const v = list.trophies.find((x: { key: string }) => x.key === 'nw.5k');
    expect(v.progress).toMatchObject({ text: '$1,500 of $5,000', fraction: 0.3 });
    expect(list.closest).toEqual(['nw.5k']);
    const d = (await call({ method: 'GET', url: '/api/trophies/nw.1k' })).json();
    expect(d.state).toBe('off');
    expect(d.preview.text).toBe('Held 30 of 30 days'); // Sep 1..Nov 11 = 72 days, shown capped at 30
    expect(d.next).toMatchObject({ key: 'nw.5k', name: 'Net worth $5k', rankLabel: 'Copper', text: '$1,500 of $5,000' });
  });

  it('Take it back sends a trophy to Off; it is not re-awarded; turning it on again works', async () => {
    await call({ method: 'POST', url: '/api/trophies/nw.1k/on', payload: { mode: 'history' } });
    expect((await call({ method: 'POST', url: '/api/trophies/nw.1k/take-back' })).statusCode).toBe(200);
    expect(states()).toEqual([{ trophy_key: 'nw.1k', state: 'off', mode: 'history', since: '2026-11-11', earned_on: null }]);
    expect((await call({ method: 'POST', url: '/api/trophies/evaluate' })).json().earned).toEqual([]);
    expect((await call({ method: 'GET', url: '/api/trophies' })).json().counts.earned).toBe(0);
    // Nothing is deleted: the log still has the award and the take back.
    const log = t.db.prepare('SELECT action, on_date FROM trophy_log ORDER BY id').all();
    expect(log).toEqual([
      { action: 'turn_on', on_date: '2026-11-11' },
      { action: 'earned', on_date: '2026-09-30' },
      { action: 'take_back', on_date: '2026-09-30' },
    ]);
    const again = (await call({ method: 'POST', url: '/api/trophies/nw.1k/on', payload: { mode: 'history' } })).json();
    expect(again.earned[0].earnedOn).toBe('2026-09-30');
    expect(t.db.prepare("SELECT award FROM trophy_states WHERE trophy_key = 'nw.1k'").get()).toEqual({ award: 2 });
  });

  it('earned trophies stay earned when the data later drops', async () => {
    await call({ method: 'POST', url: '/api/trophies/nw.1k/on', payload: { mode: 'history' } });
    const acc = t.db.prepare('SELECT id FROM accounts').get() as { id: number };
    await call({ method: 'POST', url: `/api/accounts/${acc.id}/balances`, payload: { asOf: '2026-09-15', balance: '0' } });
    await call({ method: 'POST', url: '/api/trophies/evaluate' });
    expect(states()).toMatchObject([{ trophy_key: 'nw.1k', state: 'earned', earned_on: '2026-09-30' }]);
  });

  it('Turn on whole group turns on every Off trophy with its own suggested mode', async () => {
    await call({ method: 'POST', url: '/api/trophies/nw.5k/on', payload: { mode: 'today' } });
    const r = (await call({ method: 'POST', url: '/api/trophies/groups/net_worth/on' })).json();
    expect(r.turnedOn).toBe(22);
    expect(r.earned.map((e: { key: string }) => e.key)).toEqual(['nw.1k']);
    const rows = t.db.prepare('SELECT trophy_key, mode FROM trophy_states').all() as { trophy_key: string; mode: string }[];
    for (const row of rows) expect(row.mode).toBe(row.trophy_key === 'nw.5k' ? 'today' : parseTrophyKey(row.trophy_key)!.def.defaultMode);
    expect((await call({ method: 'POST', url: '/api/trophies/groups/nope/on' })).statusCode).toBe(404);
  });

  it('turning off, refusing bad requests', async () => {
    expect((await call({ method: 'POST', url: '/api/trophies/nw.5k/on', payload: { mode: 'later' } })).statusCode).toBe(400);
    expect((await call({ method: 'POST', url: '/api/trophies/nw.5k/on' })).statusCode).toBe(400);
    expect((await call({ method: 'POST', url: '/api/trophies/nope/on', payload: { mode: 'history' } })).statusCode).toBe(404);
    expect((await call({ method: 'GET', url: '/api/trophies/nope' })).statusCode).toBe(404);
    await call({ method: 'POST', url: '/api/trophies/nw.5k/on', payload: { mode: 'history' } });
    expect((await call({ method: 'POST', url: '/api/trophies/nw.5k/on', payload: { mode: 'history' } })).json().error).toBe('That trophy is already on.');
    expect((await call({ method: 'POST', url: '/api/trophies/nw.5k/take-back' })).json().error).toBe('That trophy is not earned.');
    expect((await call({ method: 'POST', url: '/api/trophies/nw.5k/off' })).statusCode).toBe(200);
    expect((await call({ method: 'POST', url: '/api/trophies/nw.5k/off' })).statusCode).toBe(400);
    expect(trophyViews(t.db, '2026-11-11').counts.on).toBe(0);
  });

  it('record plaques only ever add records after they are earned', async () => {
    // Month ends Sep, Oct = $1,500; raise to $2,000 in November -> no record yet (Nov not ended).
    turnOnTrophy(t.db, 'nw.high', 'history', '2026-11-11', 1);
    const acc = t.db.prepare('SELECT id FROM accounts').get() as { id: number };
    t.db.prepare("INSERT INTO balance_snapshots (account_id, as_of, balance_cents, source, created_at) VALUES (?, '2026-11-05', 200000, 'manual', 1)").run(acc.id);
    expect(evaluateTrophies(t.db, '2026-12-01', 2)).toEqual([]); // only 2 earlier month ends (Sep, Oct)
    t.db.prepare("INSERT INTO balance_snapshots (account_id, as_of, balance_cents, source, created_at) VALUES (?, '2026-12-20', 300000, 'manual', 1)").run(acc.id);
    expect(evaluateTrophies(t.db, '2027-01-01', 3).map((e) => e.earnedOn)).toEqual(['2026-12-31']); // Sep, Oct, Nov before Dec
    t.db.prepare("INSERT INTO balance_snapshots (account_id, as_of, balance_cents, source, created_at) VALUES (?, '2027-02-10', 400000, 'manual', 1)").run(acc.id);
    evaluateTrophies(t.db, '2027-03-01', 4);
    const v = trophyViews(t.db, '2027-03-01').trophies.find((x) => x.key === 'nw.high')!;
    expect(v.records.map((r) => [r.period, r.amountCents])).toEqual([
      ['2027-02', 400000],
      ['2026-12', 300000],
    ]);
    expect(v.isNew).toBe(true);
  });
});

describe('demo trophies (fake)', () => {
  it('show every shape earned, a gem and an Arc40 star level, all three states, a plaque with old records and two banners', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { generateDemoData } = await import('../../server/src/lib/demo/index.js');
    const { openDatabase } = await import('../../server/src/db/database.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-demo-trophies-'));
    await generateDemoData(dir, '2026-11-11', Date.UTC(2026, 10, 11, 12));
    const db = openDatabase(dir);
    try {
      const v = trophyViews(db, '2026-11-11');
      const earned = v.trophies.filter((t) => t.state === 'earned');
      expect(new Set(earned.map((t) => t.shape))).toEqual(new Set(['coin', 'cup', 'plaque', 'banner', 'statuette']));
      expect(earned.some((t) => ['obsidian', 'emerald', 'ruby', 'diamond'].includes(t.rank))).toBe(true);
      expect(earned.some((t) => t.rank === 'arc40' && t.stars > 0)).toBe(true);
      expect(v.counts.on).toBeGreaterThan(0);
      expect(v.counts.off).toBeGreaterThan(0);
      expect(v.trophies.find((t) => t.key === 'nw.high')!.records.length).toBeGreaterThan(1);
      expect(v.trophies.filter((t) => t.shape === 'banner' && t.state !== 'off').length).toBeGreaterThan(1);
      expect(v.trophies.filter((t) => t.isNew).map((t) => t.key)).toEqual(['nw.10k']);
      expect(v.trophies.some((t) => t.state === 'on' && t.mode === 'today')).toBe(true);
      // Showcase awards say plainly that the demo set them.
      expect(v.trophies.find((t) => t.key === 'nw.3m')!.sentence).toMatch(/^Demo showcase:/);
    } finally {
      db.close();
    }
  });
});
