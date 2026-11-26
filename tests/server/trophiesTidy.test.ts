/**
 * Trophy Case, Round 4 (Milestone 2): the 23 Keeping things tidy trophies. Fake numbers only; every example is small
 * enough to check by hand in the comments. The test clock starts at 2026-11-11.
 *
 * Pure examples build TidyFacts by hand: months as ['YYYY-MM', income/expense lines, uncategorized, transfers,
 * unlinked].
 */
import fs from 'node:fs';
import path from 'node:path';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TROPHIES } from '../../shared/trophies.js';
import {
  firstFullMonth,
  tdBackupStreak,
  tdCleanStreak,
  tdFidelityClean,
  tdFirstBackup,
  tdFirstSplit,
  tdImportStreak,
  tdRuleSorted,
  tdRulesMade,
  tdTracked,
  tdTransfersLinked,
  type TidyFacts,
} from '../../server/src/lib/trophies/tidyRules.js';
import { TrophyData } from '../../server/src/lib/trophies/data.js';
import { logBackup, logPositionsImport } from '../../server/src/lib/activityLog.js';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';

const A = (today: string, from: string | null = null) => ({ today, from, year: null });

function facts(p: Partial<TidyFacts> & { m?: [string, number, number, number?, number?][] } = {}): TidyFacts {
  const months = (p.m ?? []).map(([m, ie, unc, tr = 0, un = 0]) => ({ month: `${m}-01`, incomeExpense: ie, uncategorized: unc, transfers: tr, unlinked: un }));
  return {
    firstDataDate: months[0]?.month ?? null,
    logSince: '2026-11-20',
    months,
    lineDates: [],
    imports: [],
    userRules: [],
    ruleSorts: [],
    splits: [],
    backups: [],
    backupFiles: [],
    positions: [],
    ...p,
  };
}
/** The 1st of every month from a to b ('YYYY-MM'), as event dates on day `day`. */
function monthly(a: string, b: string, day = '15'): string[] {
  const out: string[] = [];
  for (let y = Number(a.slice(0, 4)), m = Number(a.slice(5, 7)); `${y}-${String(m).padStart(2, '0')}` <= b; m === 12 ? ((m = 1), y++) : m++)
    out.push(`${y}-${String(m).padStart(2, '0')}-${day}`);
  return out;
}
const dates = (n: number, start = '2025-01-01') => Array.from({ length: n }, (_, i) => new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10));

describe('catalog', () => {
  it('has the 23 Keeping things tidy trophies with the ranks and shapes asked for, all Count my history', () => {
    const t = TROPHIES.filter((x) => x.group === 'tidy');
    expect(t.map((x) => [x.id, x.rank, x.shape])).toEqual([
      ['td.clean.1', 'iron', 'cup'],
      ['td.clean.6', 'silver', 'cup'],
      ['td.clean.12', 'gold', 'cup'],
      ['td.clean.24', 'platinum', 'cup'],
      ['td.import.12', 'gold', 'cup'],
      ['td.import.24', 'platinum', 'cup'],
      ['td.import.36', 'obsidian', 'cup'],
      ['td.tracked.1k', 'bronze', 'coin'],
      ['td.tracked.5k', 'silver', 'coin'],
      ['td.tracked.10k', 'gold', 'coin'],
      ['td.tracked.25k', 'platinum', 'coin'],
      ['td.rules.10', 'copper', 'coin'],
      ['td.rules.25', 'silver', 'coin'],
      ['td.rules.50', 'gold', 'coin'],
      ['td.sorted.100', 'silver', 'coin'],
      ['td.sorted.500', 'gold', 'coin'],
      ['td.sorted.1000', 'platinum', 'coin'],
      ['td.backup.6', 'silver', 'cup'],
      ['td.backup.12', 'gold', 'cup'],
      ['td.first-split', 'iron', 'statuette'],
      ['td.transfers-linked', 'bronze', 'statuette'],
      ['td.first-backup', 'iron', 'statuette'],
      ['td.fidelity-clean', 'bronze', 'statuette'],
    ]);
    expect(t.every((x) => x.defaultMode === 'history')).toBe(true);
  });
});

describe('Clean books', () => {
  // Aug, Sep, Oct 2026 all clean; today Nov 11 (November is not complete).
  it('counts complete months with nothing uncategorized; earned on the last month end', () => {
    const f = facts({ m: [['2026-08', 5, 0], ['2026-09', 3, 0], ['2026-10', 4, 0], ['2026-11', 2, 0]] });
    expect(tdCleanStreak(f, 1, A('2026-11-11')).earned?.date).toBe('2026-08-31');
    expect(tdCleanStreak(f, 3, A('2026-11-11')).earned?.date).toBe('2026-10-31');
    expect(tdCleanStreak(f, 4, A('2026-11-11')).earned).toBeNull(); // November has not ended
  });

  it('one uncategorized expense breaks a month', () => {
    // Sep has 1 uncategorized row out of 3: the run is Aug (1), then Oct (1).
    const f = facts({ m: [['2026-08', 5, 0], ['2026-09', 3, 1], ['2026-10', 4, 0]] });
    expect(tdCleanStreak(f, 2, A('2026-11-11')).earned).toBeNull();
    expect(tdCleanStreak(f, 2, A('2026-11-11')).progress.text).toBe('1 of 2 months');
  });

  it('a month with no income or expense does not count and breaks the run; a month before the data from its 1st does not count', () => {
    const empty = facts({ m: [['2026-08', 5, 0], ['2026-09', 0, 0], ['2026-10', 4, 0]] });
    expect(tdCleanStreak(empty, 2, A('2026-11-11')).earned).toBeNull();
    // Data starts Aug 12: August is not counted, Sep + Oct make 2.
    const late = { ...facts({ m: [['2026-08', 5, 0], ['2026-09', 3, 0], ['2026-10', 4, 0]] }), firstDataDate: '2026-08-12' };
    expect(tdCleanStreak(late, 3, A('2026-11-11')).earned).toBeNull();
    expect(tdCleanStreak(late, 2, A('2026-11-11')).earned?.date).toBe('2026-10-31');
  });

  it('Start from today: only months that start on or after the turn-on day', () => {
    const f = facts({ m: [['2026-08', 5, 0], ['2026-09', 3, 0], ['2026-10', 4, 0], ['2026-11', 2, 0]] });
    // Turned on Sep 3: October is the first month that counts.
    expect(tdCleanStreak(f, 2, A('2026-11-11', '2026-09-03')).earned).toBeNull();
    expect(tdCleanStreak(f, 1, A('2026-11-11', '2026-09-03')).earned?.date).toBe('2026-10-31');
    // Turned on Sep 1: September counts.
    expect(tdCleanStreak(f, 2, A('2026-11-11', '2026-09-01')).earned?.date).toBe('2026-10-31');
  });
});

describe('Every transfer linked', () => {
  it('a month with transfers all linked counts; one unlinked transfer breaks it; a month with none does not count', () => {
    const f = facts({ m: [['2026-08', 5, 0, 0, 0], ['2026-09', 3, 0, 2, 1], ['2026-10', 4, 0, 3, 0]] });
    expect(tdTransfersLinked(f, A('2026-11-11')).earned?.date).toBe('2026-10-31'); // Aug: none, Sep: 1 unlinked
    const noneOk = facts({ m: [['2026-08', 5, 0, 0, 0], ['2026-09', 3, 0, 2, 1]] });
    expect(tdTransfersLinked(noneOk, A('2026-11-11')).earned).toBeNull();
  });
});

describe('Imported every month', () => {
  // Imports on the 15th of every month Dec 2025 .. Nov 2026: 12 months, November counts as soon as it has one.
  it('12 months in a row with an import, the current month counting once it has one', () => {
    const f = facts({ imports: monthly('2025-12', '2026-11') });
    expect(tdImportStreak(f, 12, A('2026-11-16')).earned?.date).toBe('2026-11-15');
    expect(tdImportStreak(f, 12, A('2026-11-14')).earned).toBeNull(); // Nov's import is not here yet: 11 of 12
    expect(tdImportStreak(f, 12, A('2026-11-14')).progress.text).toBe('11 of 12 months in a row');
  });

  it('a month without one breaks the run', () => {
    const f = facts({ imports: monthly('2025-12', '2026-11').filter((d) => !d.startsWith('2026-05')) });
    expect(tdImportStreak(f, 12, A('2026-11-30')).earned).toBeNull();
    expect(tdImportStreak(f, 12, A('2026-11-30')).progress.text).toBe('6 of 12 months in a row'); // Jun..Nov
  });

  it('Start from today: imports in the turn-on month do not count unless it was turned on the 1st', () => {
    expect(firstFullMonth('2026-03-14')).toBe('2026-04-01');
    expect(firstFullMonth('2026-03-01')).toBe('2026-03-01');
    const f = facts({ imports: monthly('2026-03', '2026-11') });
    expect(tdImportStreak(f, 12, A('2026-11-30', '2026-03-14')).progress.text).toBe('8 of 12 months in a row'); // Apr..Nov
    expect(tdImportStreak(f, 12, A('2026-11-30', '2026-03-01')).progress.text).toBe('9 of 12 months in a row');
  });
});

describe('Backed up every month', () => {
  it('any backup counts, the safety backup before an update too; the close-up says when tracking started', () => {
    const f = facts({ backups: monthly('2026-06', '2026-11') });
    expect(tdBackupStreak(f, 6, A('2026-11-20')).earned?.date).toBe('2026-11-15');
    const none = tdBackupStreak(facts(), 6, A('2026-11-20'));
    expect(none.progress.need).toContain('Arc40 started keeping track of backups on Nov 20, 2026.');
  });
});

describe('counts', () => {
  it('Transactions tracked: earned on the date of the 1,000th row', () => {
    const d = dates(1000);
    expect(tdTracked(facts({ lineDates: d }), 1000, A('2027-12-31')).earned?.date).toBe(d[999]);
    expect(tdTracked(facts({ lineDates: d.slice(0, 999) }), 1000, A('2027-12-31')).earned).toBeNull();
    expect(tdTracked(facts({ lineDates: d.slice(0, 999) }), 1000, A('2027-12-31')).progress.text).toBe('999 of 1,000 transactions');
    // Start from today: only rows dated on or after the turn-on day.
    expect(tdTracked(facts({ lineDates: d }), 1000, A('2027-12-31', d[1]!)).earned).toBeNull();
  });

  it('Rules made: earned on the day the 10th was made', () => {
    const rules = dates(10, '2026-01-01').map((date, i) => ({ date, label: `"contains SHOP ${i}"` }));
    const o = tdRulesMade(facts({ userRules: rules }), 10, A('2026-11-11'));
    expect(o.earned).toMatchObject({ date: '2026-01-10', sentence: 'You made your 10th rule, "contains SHOP 9", on Jan 10, 2026.' });
    expect(tdRulesMade(facts({ userRules: rules.slice(1) }), 10, A('2026-11-11')).earned).toBeNull();
  });

  it('One rule has sorted: exactly 100 counts, 99 does not; the busiest rule is named', () => {
    const d = dates(100);
    const a = { label: '"contains FAKE MART"', dates: d };
    const b = { label: '"is FAKE CAFE"', dates: d.slice(0, 40) };
    expect(tdRuleSorted(facts({ ruleSorts: [b, a] }), 100, A('2026-11-11')).earned).toMatchObject({ date: d[99] });
    const short = tdRuleSorted(facts({ ruleSorts: [b, { ...a, dates: d.slice(0, 99) }] }), 100, A('2026-11-11'));
    expect(short.earned).toBeNull();
    expect(short.progress).toMatchObject({ text: '99 of 100 transactions', need: 'Your busiest rule: "contains FAKE MART".' });
  });
});

describe('firsts', () => {
  it('First split, First backup (log or a file already in the folder), Fidelity check clean', () => {
    expect(tdFirstSplit(facts({ splits: [{ date: '2026-04-02', description: 'Fake Market', pieces: 3 }] }), A('2026-11-11')).earned).toMatchObject({
      date: '2026-04-02',
      sentence: 'Your first split: Fake Market on Apr 2, 2026, in 3 pieces.',
    });
    // The oldest backup file (Aug 2) is older than the first logged backup (Nov 20): the file counts.
    const fb = tdFirstBackup(facts({ backups: ['2026-11-20'], backupFiles: ['2026-08-02', '2026-09-30'] }), A('2026-11-25'));
    expect(fb.earned).toMatchObject({ date: '2026-08-02', sentence: 'Your oldest Arc40 backup in the backups folder is from Aug 2, 2026.' });
    expect(tdFirstBackup(facts({ backups: ['2026-11-20'] }), A('2026-11-25')).earned).toMatchObject({ date: '2026-11-20', sentence: 'Arc40 made your first backup on Nov 20, 2026.' });
    // Start from today (turned on Oct 1): the Aug file is too early, Sep 30 too; the logged Nov 20 one counts.
    expect(tdFirstBackup(facts({ backups: ['2026-11-20'], backupFiles: ['2026-08-02', '2026-09-30'] }), A('2026-11-25', '2026-10-01')).earned?.date).toBe('2026-11-20');
    const fc = facts({ positions: [{ date: '2026-11-21', allMatched: false }, { date: '2026-11-24', allMatched: true }] });
    expect(tdFidelityClean(fc, A('2026-11-25')).earned?.date).toBe('2026-11-24');
    expect(tdFidelityClean(facts({ positions: [{ date: '2026-11-21', allMatched: false }] }), A('2026-11-25')).progress).toMatchObject({
      text: '1 positions file saved, none fully matched yet',
    });
  });
});

// ------------------------------------------------------------------ through the API, with Arc40's own numbers

let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };
const call = (opts: InjectOptions) =>
  t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });
const ok = async (opts: InjectOptions) => {
  const r = await call(opts);
  if (r.statusCode < 200 || r.statusCode > 299) throw new Error(`${opts.method} ${opts.url} -> ${r.statusCode} ${r.body}`);
  return r.json();
};
const tidy = () => new TrophyData(t.store.current(), '2026-11-11').tidy;
let acct: { checking: number; savings: number };
let cat: Record<string, number>;
const tx = async (accountId: number, date: string, amount: string, direction: 'in' | 'out', type: string, extra: Record<string, unknown> = {}) =>
  (await ok({ method: 'POST', url: '/api/transactions', payload: { accountId, date, amount, direction, description: 'Fake', type, ...extra } })).transaction.id as number;
const on = (key: string, mode: 'history' | 'today' = 'history') => ok({ method: 'POST', url: `/api/trophies/${key}/on`, payload: { mode } });
const view = async (key: string) => ok({ method: 'GET', url: `/api/trophies/${key}` });

describe('through the API', () => {
  beforeEach(async () => {
    t = await testApp(); // today = 2026-11-11
    auth = await setupAndLogin(t);
    const mk = async (name: string, type: string) => (await ok({ method: 'POST', url: '/api/accounts', payload: { name, type } })).account.id as number;
    acct = { checking: await mk('Fake Checking', 'checking'), savings: await mk('Fake Savings', 'savings') };
    cat = Object.fromEntries(((await ok({ method: 'GET', url: '/api/categories' })).categories as { id: number; name: string }[]).map((c) => [c.name, c.id]));
  });
  afterEach(async () => {
    await t.app.close();
  });

  it('transfers and gifts never count as uncategorized; one uncategorized expense does; fixing it later completes the month', async () => {
    // October 2026, data from Oct 1: pay (categorized), a gift and a transfer pair (no categories by design).
    await tx(acct.checking, '2026-10-01', '500', 'in', 'income', { categoryId: cat.Refereeing });
    await tx(acct.savings, '2026-10-03', '100', 'in', 'gift', { giftFrom: 'Fake Aunt' });
    await tx(acct.checking, '2026-10-05', '50', 'out', 'transfer');
    await tx(acct.savings, '2026-10-05', '50', 'in', 'transfer');
    const stray = await tx(acct.checking, '2026-10-20', '12.34', 'out', 'expense'); // no category
    expect(tidy().months.find((m) => m.month === '2026-10-01')).toEqual({ month: '2026-10-01', incomeExpense: 2, uncategorized: 1, transfers: 2, unlinked: 2 });
    expect((await on('td.clean.1')).earned).toEqual([]);
    // Cleaning up the old month today completes it, dated the month's end (the data as it is now).
    await ok({ method: 'PATCH', url: `/api/transactions/${stray}`, payload: { categoryId: cat.Food } });
    const e = (await ok({ method: 'POST', url: '/api/trophies/evaluate' })).earned;
    expect(e).toEqual([{ key: 'td.clean.1', name: 'Clean books for a month', rankLabel: 'Iron · Rank 1', earnedOn: '2026-10-31' }]);
  });

  it('a split piece with no category counts as uncategorized (as the Transactions page filter shows it)', async () => {
    const id = await tx(acct.checking, '2026-10-01', '30', 'out', 'expense', { categoryId: cat.Food });
    await ok({ method: 'PUT', url: `/api/transactions/${id}/split`, payload: { pieces: [{ categoryId: cat.Food, amount: '10' }, { categoryId: cat.Shopping, amount: '20' }] } });
    await ok({ method: 'DELETE', url: `/api/categories/${cat.Shopping}` }); // the piece is left uncategorized
    expect(tidy().months.find((m) => m.month === '2026-10-01')).toMatchObject({ incomeExpense: 2, uncategorized: 1 });
    const page = await ok({ method: 'GET', url: '/api/transactions?categoryId=none' });
    expect(page.total).toBe(1);
    // First split, dated by the transaction.
    expect((await on('td.first-split')).earned[0]).toMatchObject({ key: 'td.first-split', earnedOn: '2026-10-01' });
  });

  it('every transfer linked: one unlinked transfer breaks the month; linking it completes it', async () => {
    await tx(acct.checking, '2026-10-01', '500', 'in', 'income', { categoryId: cat.Refereeing });
    const out = await tx(acct.checking, '2026-10-05', '50', 'out', 'transfer');
    const inn = await tx(acct.savings, '2026-10-05', '50', 'in', 'transfer');
    expect((await on('td.transfers-linked')).earned).toEqual([]);
    await ok({ method: 'POST', url: `/api/transactions/${out}/link`, payload: { otherId: inn } });
    expect((await ok({ method: 'POST', url: '/api/trophies/evaluate' })).earned[0]).toMatchObject({ key: 'td.transfers-linked', earnedOn: '2026-10-31' });
  });

  it("an import counts by the import's date, not its transactions' dates; an undone import does not count", async () => {
    const text = fs.readFileSync(path.resolve('tests/fixtures/csv/wpcu-checking.csv'), 'utf8'); // rows from Aug to Oct 2026
    const r = await ok({ method: 'POST', url: '/api/import/commit', payload: { accountId: acct.checking, filename: 'w.csv', text } });
    expect(tidy().imports).toEqual(['2026-11-11']);
    await ok({ method: 'DELETE', url: `/api/import/batches/${r.batchId ?? r.batch.id}` });
    expect(tidy().imports).toEqual([]);
  });

  it('built-in rules never count; a rule of yours counts only the transactions it sorted the way it says', async () => {
    const t0 = tidy();
    expect(t0.userRules).toEqual([]);
    expect(t0.ruleSorts).toEqual([]);
    await ok({ method: 'POST', url: '/api/rules', payload: { matchType: 'contains', pattern: 'FAKE MART', setCategoryId: cat.Food } });
    const mart = (d: string, extra: Record<string, unknown>) =>
      ok({ method: 'POST', url: '/api/transactions', payload: { accountId: acct.checking, date: d, amount: '9', direction: 'out', description: 'FAKE MART 12', type: 'expense', ...extra } });
    await mart('2026-10-02', { categoryId: cat.Food }); // sorted as the rule says
    await mart('2026-10-03', { categoryId: cat.Shopping }); // changed by hand: not the rule's work
    await mart('2026-10-04', {}); // uncategorized: not sorted
    // A built-in rule's work (an INTEREST row) never counts.
    await ok({ method: 'POST', url: '/api/transactions', payload: { accountId: acct.savings, date: '2026-10-05', amount: '1', direction: 'in', description: 'INTEREST PAID', type: 'income', categoryId: cat.Interest } });
    const f = tidy();
    expect(f.userRules).toEqual([{ date: '2026-11-11', label: '"contains FAKE MART"' }]);
    expect(f.ruleSorts).toEqual([{ label: '"contains FAKE MART"', dates: ['2026-10-02'] }]);
  });

  it('First backup counts a backup file already in the folder, and the log once a backup is made', async () => {
    fs.writeFileSync(path.join(t.config.backupDir, 'arc40-backup-2026-07-04-101500.db'), 'x');
    expect((await on('td.first-backup')).earned[0]).toMatchObject({ key: 'td.first-backup', earnedOn: '2026-07-04' });
    // A month with only the safety backup before an update counts for Backed up every month.
    logBackup(t.store.current(), 'before_update', t.clock.now());
    expect(tidy().backups).toEqual(['2026-11-11']);
    expect((await view('td.backup.6')).preview.text).toBe('1 of 6 months in a row');
  });

  it('Fidelity check clean comes from the log only; the close-up says when tracking started', async () => {
    const v = await view('td.fidelity-clean');
    expect(v.preview.need).toContain('Arc40 started keeping track of positions imports on Nov 11, 2026.');
    logPositionsImport(t.store.current(), false, t.clock.now());
    expect((await on('td.fidelity-clean')).earned).toEqual([]);
    logPositionsImport(t.store.current(), true, t.clock.now());
    expect((await ok({ method: 'POST', url: '/api/trophies/evaluate' })).earned[0]).toMatchObject({ key: 'td.fidelity-clean', earnedOn: '2026-11-11' });
  });

  it('turning on the whole shelf uses Count my history for all 23; GETs never write', async () => {
    const tables = (t.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name <> 'sessions' ORDER BY name").all() as { name: string }[]).map((x) => x.name);
    const dump = () => tables.map((n) => JSON.stringify(t.db.prepare(`SELECT * FROM "${n}"`).all())).join('\n');
    const before = dump();
    await ok({ method: 'GET', url: '/api/trophies' });
    await view('td.clean.6');
    await ok({ method: 'GET', url: '/api/trophies/shelf' });
    expect(dump()).toBe(before);
    const r = await ok({ method: 'POST', url: '/api/trophies/groups/tidy/on' });
    expect(r.turnedOn).toBe(23);
    const modes = t.db.prepare("SELECT DISTINCT mode FROM trophy_states WHERE trophy_key LIKE 'td.%'").all() as { mode: string }[];
    expect(modes).toEqual([{ mode: 'history' }]);
  });
});
