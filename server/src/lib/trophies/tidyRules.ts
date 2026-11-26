/**
 * Keeping things tidy trophies (Trophies Round 4), pure. Input: TidyFacts (data.ts), built only from what the screens
 * and the activity log already hold:
 *   months     per calendar month: income/expense money lines and how many have no category (the Transactions page's
 *              "Uncategorized" filter: a split piece is its own line), transfer transactions and how many are linked
 *   lineDates  the date of every row the Transactions page lists (split pieces count one each), oldest first
 *   imports    the day each import that still exists was saved (an undone import is deleted, so it never counts)
 *   userRules  rules the user made (never the built-in ones), with the day each was made
 *   ruleSorts  for each of the user's rules, the transactions it sorted: the FIRST of their rules that matches the transaction
 *              (the order the sorting itself uses) AND the transaction has the type, and the category if the rule sets
 *              one, that the rule sets. Arc40 does not record which rule sorted a transaction, so this is worked out by
 *              matching; split transactions never count (rules skip them)
 *   splits     every split transaction (its date, description, number of pieces)
 *   backups    days with a backup in the activity log; backupFiles = days of Arc40 backup files already in the folder
 *              (from their names; never read in demo mode)
 *   positions  saved positions imports from the log, with whether every share count matched
 *   logSince   the day Arc40 started keeping the activity log
 *
 *   td_clean_streak     complete months in a row with at least one income or expense line and none uncategorized
 *                       (transfers and gifts never need a category). Arc40 needs the month's data from its 1st. A
 *                       month with no income or expense breaks the run. Uses the data as it is now, so cleaning up an
 *                       old month later can complete a run. Earned on the last month's last day
 *   td_import_streak    months in a row with at least one import saved that month (the import's own date). The
 *                       current month counts as soon as it has one; until then it neither counts nor breaks
 *   td_tracked          the Transactions page's row count; earned on the date of the Nth row
 *   td_rules_made       rules the user made; earned on the day the Nth was made. Deleting one lowers the count
 *   td_rule_sorted      one of the user's rules sorted N transactions; earned on the date of that rule's Nth transaction
 *   td_backup_streak    months in a row with at least one logged backup (any kind, the safety backup before an
 *                       update too); the current month counts as soon as it has one
 *   td_first_split      the first split transaction (dated by the transaction: Arc40 does not record when it was split)
 *   td_transfers_linked a complete month with at least one transfer, every transfer that month linked to its other side
 *   td_first_backup     the first logged backup, or the oldest backup file already in the folder
 *   td_fidelity_clean   a saved positions import where every share count matched (from the log only)
 *
 * Start from today (turn-on day `from`): months must START on or after it; counts, firsts and events must be dated on
 * or after it.
 */
import { addMonths, endOfMonth, type IsoDate } from '../../../../shared/dates.js';
import { clamp01, longDate, monthName } from './format.js';
import { monthStreak, type MonthTotal } from './investingRules.js';
import type { Progress, RuleArgs, RuleOutcome } from './types.js';

export interface TidyMonth {
  /** 'YYYY-MM-01' */
  month: IsoDate;
  incomeExpense: number;
  uncategorized: number;
  transfers: number;
  unlinked: number;
}

export interface TidyFacts {
  firstDataDate: IsoDate | null;
  logSince: IsoDate | null;
  /** From the first data month through the current month, oldest first. */
  months: TidyMonth[];
  lineDates: IsoDate[];
  imports: IsoDate[];
  userRules: { date: IsoDate; label: string }[];
  ruleSorts: { label: string; dates: IsoDate[] }[];
  splits: { date: IsoDate; description: string; pieces: number }[];
  backups: IsoDate[];
  backupFiles: IsoDate[];
  positions: { date: IsoDate; allMatched: boolean }[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const ended = (m: IsoDate, today: IsoDate) => endOfMonth(m) < today;
/** The 1st of the first month that starts on or after `from`. */
export const firstFullMonth = (from: IsoDate) => (from.slice(8) === '01' ? from : addMonths(`${from.slice(0, 7)}-01`, 1));
const onOrAfter = (dates: readonly IsoDate[], a: RuleArgs) => dates.filter((d) => d <= a.today && (!a.from || d >= a.from));

/** "Arc40 started keeping track of backups on Nov 20, 2026." (null before the log exists). */
export function trackingNote(f: Pick<TidyFacts, 'logSince'>, what: string): string | null {
  return f.logSince ? `Arc40 started keeping track of ${what} on ${longDate(f.logSince)}.` : null;
}

function withNote(p: Progress, note: string | null): Progress {
  return note ? { ...p, need: p.need ? `${p.need} ${note}` : note } : p;
}

function count(dates: readonly IsoDate[], need: number, unit: string, w: { sentence: (date: IsoDate) => string; need: string }): RuleOutcome {
  const nth = dates[need - 1] ?? null;
  const fr = clamp01(dates.length / need);
  return {
    earned: nth ? { date: nth, sentence: w.sentence(nth), story: null } : null,
    blocked: null,
    progress: { fraction: fr, score: fr, text: `${dates.length.toLocaleString('en-US')} of ${plural(need, unit)}`, need: w.need },
    story: null,
  };
}

// ------------------------------------------------------------------ month runs

function monthRun(
  f: TidyFacts,
  need: number,
  a: RuleArgs,
  ok: (m: TidyMonth) => boolean,
  w: { sentence: (start: string, end: string) => string; needText: string },
): RuleOutcome {
  const rows = f.months.filter((m) => ended(m.month, a.today) && !!f.firstDataDate && f.firstDataDate <= m.month && (!a.from || m.month >= a.from));
  let n = 0;
  let earned: { start: TidyMonth; end: TidyMonth } | null = null;
  rows.forEach((m, i) => {
    n = ok(m) ? n + 1 : 0;
    if (!earned && n === need) earned = { start: rows[i - need + 1]!, end: m };
  });
  const e = earned as { start: TidyMonth; end: TidyMonth } | null;
  const progress: Progress = rows.length
    ? { fraction: clamp01(n / need), score: clamp01(n / need), text: `${n} of ${plural(need, 'month')}`, need: `${plural(need - n, 'more month')}: ${w.needText}` }
    : {
        fraction: 0,
        score: 0,
        text: `0 of ${plural(need, 'month')}`,
        need: a.from ? 'Counts from the first full month after you turned it on.' : 'Counts once a full month of your data has ended.',
      };
  return {
    earned: e ? { date: endOfMonth(e.end.month), sentence: w.sentence(monthName(e.start.month), monthName(e.end.month)), story: null } : null,
    blocked: null,
    progress,
    story: null,
  };
}

export function tdCleanStreak(f: TidyFacts, need: number, a: RuleArgs): RuleOutcome {
  const o = monthRun(f, need, a, (m) => m.incomeExpense > 0 && m.uncategorized === 0, {
    sentence: (s, e) =>
      need === 1 ? `Every income and expense in ${e} had a category.` : `Every income and expense had a category for ${need} months in a row, ${s} through ${e}.`,
    needText: 'nothing uncategorized each month',
  });
  const cur = f.months.find((m) => m.month === `${a.today.slice(0, 7)}-01`);
  if (!o.earned && cur && cur.uncategorized > 0)
    o.progress = { ...o.progress, need: `${o.progress.need}. This month has ${plural(cur.uncategorized, 'uncategorized row')} so far.` };
  return o;
}

export function tdTransfersLinked(f: TidyFacts, a: RuleArgs): RuleOutcome {
  return monthRun(f, 1, a, (m) => m.transfers > 0 && m.unlinked === 0, {
    sentence: (_s, e) => `Every transfer in ${e} was linked to its other side.`,
    needText: 'a month with transfers, every one of them linked',
  });
}

/** Months in a row with at least one dated event (the current month counts once it has one). */
function eventStreak(
  dates: readonly IsoDate[],
  need: number,
  a: RuleArgs,
  w: { sentence: (start: string, end: string) => string; keepGoing: string; note: string | null },
): RuleOutcome {
  const start = a.from ? firstFullMonth(a.from) : null;
  const totals = new Map<string, MonthTotal>();
  for (const d of dates) {
    if (d > a.today || (start && d < start)) continue;
    const m = d.slice(0, 7);
    const t = totals.get(m);
    if (t) t.total++;
    else totals.set(m, { month: m, total: 1, upOn: d });
  }
  const first = [...totals.keys()].sort()[0] ?? null;
  const s = monthStreak(totals, first, a.today, need);
  const left = need - s.current;
  const progress: Progress = {
    fraction: clamp01(s.current / need),
    score: clamp01(s.current / need),
    text: `${s.current} of ${plural(need, 'month')} in a row`,
    need: s.thisMonthCounted ? `${plural(left, 'more month')} in a row` : w.keepGoing,
  };
  return {
    earned: s.earned ? { date: s.earned.date, sentence: w.sentence(monthName(`${s.earned.startMonth}-01`), monthName(`${s.earned.month}-01`)), story: null } : null,
    blocked: null,
    progress: withNote(progress, w.note),
    story: null,
  };
}

export function tdImportStreak(f: TidyFacts, need: number, a: RuleArgs): RuleOutcome {
  return eventStreak(f.imports, need, a, {
    sentence: (s, e) => `You imported a file every month for ${need} months in a row, ${s} through ${e}.`,
    keepGoing: 'An import this month keeps the run going.',
    note: null,
  });
}

export function tdBackupStreak(f: TidyFacts, need: number, a: RuleArgs): RuleOutcome {
  return eventStreak(f.backups, need, a, {
    sentence: (s, e) => `Arc40 made a backup every month for ${need} months in a row, ${s} through ${e}.`,
    keepGoing: 'A backup this month keeps the run going.',
    note: trackingNote(f, 'backups'),
  });
}

// ------------------------------------------------------------------ counts

export function tdTracked(f: TidyFacts, need: number, a: RuleArgs): RuleOutcome {
  return count(onOrAfter(f.lineDates, a), need, 'transaction', {
    sentence: (d) => `Arc40 tracked your ${need.toLocaleString('en-US')}th transaction, dated ${longDate(d)}.`,
    need: a.from ? 'Import or add transactions dated from the day you turned this on.' : 'Import or add more transactions.',
  });
}

export function tdRulesMade(f: TidyFacts, need: number, a: RuleArgs): RuleOutcome {
  const rules = f.userRules.filter((r) => r.date <= a.today && (!a.from || r.date >= a.from));
  return count(
    rules.map((r) => r.date),
    need,
    'rule',
    {
      sentence: (d) => `You made your ${need}th rule, ${rules[need - 1]!.label}, on ${longDate(d)}.`,
      need: 'Make a rule on Categories & rules, or tick "Always do this" when you edit a transaction.',
    },
  );
}

export function tdRuleSorted(f: TidyFacts, need: number, a: RuleArgs): RuleOutcome {
  let best: { label: string; dates: IsoDate[] } | null = null;
  let hit: { label: string; date: IsoDate } | null = null;
  for (const r of f.ruleSorts) {
    const dates = onOrAfter(r.dates, a);
    if (!best || dates.length > best.dates.length) best = { label: r.label, dates };
    const nth = dates[need - 1];
    if (nth && (!hit || nth < hit.date)) hit = { label: r.label, date: nth };
  }
  const n = best?.dates.length ?? 0;
  const fr = clamp01(n / need);
  return {
    earned: hit ? { date: hit.date, sentence: `Your rule ${hit.label} sorted its ${need.toLocaleString('en-US')}th transaction, dated ${longDate(hit.date)}.`, story: null } : null,
    blocked: null,
    progress: {
      fraction: fr,
      score: fr,
      text: `${n.toLocaleString('en-US')} of ${plural(need, 'transaction')}`,
      need: best && n > 0 ? `Your busiest rule: ${best.label}.` : 'Make a rule; every transaction it sorts counts.',
    },
    story: null,
  };
}

// ------------------------------------------------------------------ firsts

export function tdFirstSplit(f: TidyFacts, a: RuleArgs): RuleOutcome {
  const s = f.splits.find((x) => x.date <= a.today && (!a.from || x.date >= a.from)) ?? null;
  return {
    earned: s ? { date: s.date, sentence: `Your first split: ${s.description} on ${longDate(s.date)}, in ${s.pieces} pieces.`, story: null } : null,
    blocked: null,
    progress: { fraction: 0, score: 0, text: 'No split yet', need: 'Open a transaction and click Split.' },
    story: null,
  };
}

export function tdFirstBackup(f: TidyFacts, a: RuleArgs): RuleOutcome {
  const logged = onOrAfter(f.backups, a)[0] ?? null;
  const file = onOrAfter(f.backupFiles, a)[0] ?? null;
  const d = logged && file ? (logged < file ? logged : file) : (logged ?? file);
  const fromFile = d !== null && d === file && (logged === null || file < logged);
  return {
    earned: d
      ? { date: d, sentence: fromFile ? `Your oldest Arc40 backup in the backups folder is from ${longDate(d)}.` : `Arc40 made your first backup on ${longDate(d)}.`, story: null }
      : null,
    blocked: null,
    progress: withNote({ fraction: 0, score: 0, text: 'No backup yet', need: 'Click Back up now in Settings.' }, trackingNote(f, 'backups')),
    story: null,
  };
}

export function tdFidelityClean(f: TidyFacts, a: RuleArgs): RuleOutcome {
  const all = f.positions.filter((p) => p.date <= a.today && (!a.from || p.date >= a.from));
  const p = all.find((x) => x.allMatched) ?? null;
  return {
    earned: p ? { date: p.date, sentence: `Every share count matched Fidelity in the positions file you saved on ${longDate(p.date)}.`, story: null } : null,
    blocked: null,
    progress: withNote(
      {
        fraction: 0,
        score: 0,
        text: all.length ? `${plural(all.length, 'positions file')} saved, none fully matched yet` : 'No positions file saved yet',
        need: 'Save a positions file on Investments (Update prices from file) where nothing is flagged.',
      },
      trackingNote(f, 'positions imports'),
    ),
    story: null,
  };
}
