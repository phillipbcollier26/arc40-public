/**
 * The long game, Collector and The Arc (Trophies Round 4), pure. Input: LongFacts and CollectorFacts (data.ts).
 *
 *   lg_years           years since the first day Arc40 has money data for (the earliest transaction, balance or
 *                      investment activity). Earned on that day N years later (a Feb 29 start -> Feb 28)
 *   lg_goal_set        the first goal made (its created day). Saved goal marks keep it after the goal is deleted
 *   lg_goals_done      goals whose progress (the Goals page: the linked account's balance) was at or above the target
 *                      for 30 days in a row (THE 30-day rule, hold.ts), counting from the day the goal was set. Earned on
 *                      the day the Nth goal was done. A done
 *                      goal is saved (trophy_goal_marks), so deleting it later never lowers the count
 *   lg_perfect_months  complete months (data from the 1st) where all four are true, with the Round 2 and 3 rules
 *                      exactly: income above $0 and above spending; every budget above $0 at or under its limit (a
 *                      month with no budget above $0 fails); clean books (at least one income or expense line, none
 *                      uncategorized); net money put into investments above $0. Counted in total, not in a row.
 *                      Earned on the Nth perfect month's last day
 *   lg_perfect_year    12 perfect months in a row
 *   lg_wrapped         different years of Arc40 Wrapped watched to the last slide (activity log; watching a year twice
 *                      counts once; a past year watched today counts). Earned the day the Nth year was first watched
 *   lg_anniversary     one banner per year: the day Arc40 was set up, N years later (Feb 29 -> Feb 28)
 *   lg_collector       trophies currently earned, each yearly trophy counting on its own; Collector trophies never
 *                      count. Earned on the Nth earned date. A taken-back trophy is Off, so it does not count
 *   lg_collector_all   every trophy in the catalog (except Collector) earned at least once (a yearly kind: one year);
 *                      earned on the day the last of them was earned
 *   the_arc            the 1st of the month the user turns 40 (birth month and year from Settings > Planning), as long as
 *                      Arc40's history started before then. No birth month: blocked, never guessed
 *
 * Start from today (turn-on day `from`): months must START on or after it; days, firsts and events must be on or after
 * it; years of history count from the later of the first data day and the turn-on day.
 */
import { endOfMonth, type IsoDate } from '../../../../shared/dates.js';
import type { BirthMonth } from '../../../../shared/projection.js';
import { clamp01, longDate, monthName } from './format.js';
import { trackingNote } from './tidyRules.js';
import type { Progress, RuleArgs, RuleOutcome } from './types.js';

export interface PerfectMonth {
  /** 'YYYY-MM-01' */
  month: IsoDate;
  earned: boolean;
  budget: boolean;
  clean: boolean;
  invested: boolean;
}
export const isPerfect = (m: PerfectMonth) => m.earned && m.budget && m.clean && m.invested;

export interface LongFacts {
  /** The earliest transaction, balance or investment activity day (null = no data). */
  firstDataDate: IsoDate | null;
  /** The day Arc40 was set up (the password was first made). */
  setupDate: IsoDate | null;
  /** Every goal ever made (saved marks + goals that exist), with the day it was first done. */
  goals: { id: number; setOn: IsoDate; doneOn: IsoDate | null }[];
  /** Complete months with data from their 1st, oldest first. */
  perfect: PerfectMonth[];
  /** Wrapped watched to the last slide (activity log), oldest first. */
  wrapped: { date: IsoDate; year: number }[];
  birth: BirthMonth | null;
  logSince: IsoDate | null;
}

export interface CollectorFacts {
  /** Every earned trophy except Collector ones: catalog id and earned date. */
  earned: { id: string; date: IsoDate }[];
  /** Every catalog id except Collector ones. */
  ids: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const yrs = (n: number) => plural(n, 'year');

/** The same day N years later; Feb 29 -> Feb 28 in a year that is not a leap year. */
export function yearsLater(d: IsoDate, n: number): IsoDate {
  const y = Number(d.slice(0, 4)) + n;
  const md = d.slice(5);
  if (md === '02-29' && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) return `${y}-02-28`;
  return `${y}-${md}`;
}

/** Whole months between two days (a to b), counting a month once its day of month is reached. */
function monthsBetween(a: IsoDate, b: IsoDate): number {
  const m = (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
  return b.slice(8) >= a.slice(8) ? m : m - 1;
}
/** "21 years, 4 months", "3 months", "less than a month". */
export function yearsMonths(months: number): string {
  if (months <= 0) return 'less than a month';
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? plural(y, 'year') : '', m ? plural(m, 'month') : ''].filter(Boolean).join(', ');
}

function count(dates: readonly IsoDate[], need: number, unit: string, w: { sentence: (d: IsoDate) => string; need: string }, units = `${unit}s`): RuleOutcome {
  const nth = dates[need - 1] ?? null;
  const fr = clamp01(dates.length / need);
  return {
    earned: nth ? { date: nth, sentence: w.sentence(nth), story: null } : null,
    blocked: null,
    progress: { fraction: fr, score: fr, text: `${dates.length} of ${plural(need, unit, units)}`, need: w.need },
    story: null,
  };
}
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

// ------------------------------------------------------------------ years of history

export function lgYears(f: LongFacts, years: number, a: RuleArgs): RuleOutcome {
  if (!f.firstDataDate) return { earned: null, blocked: null, progress: { fraction: 0, score: 0, text: 'No history yet', need: 'Add an account or import a file.' }, story: null };
  const start = a.from && a.from > f.firstDataDate ? a.from : f.firstDataDate;
  const due = yearsLater(start, years);
  const got = monthsBetween(start, a.today);
  const fr = clamp01(got / (years * 12));
  return {
    earned: due <= a.today ? { date: due, sentence: `Arc40 has ${yrs(years)} of your history, since ${longDate(start)}.`, story: null } : null,
    blocked: null,
    progress: { fraction: fr, score: fr, text: `${yearsMonths(got)} of ${yrs(years)}`, need: `Counts on ${longDate(due)}.` },
    story: null,
  };
}

// ------------------------------------------------------------------ goals

export function lgGoalSet(f: LongFacts, a: RuleArgs): RuleOutcome {
  const set = f.goals.map((g) => g.setOn).filter((d) => d <= a.today && (!a.from || d >= a.from)).sort();
  return count(set, 1, 'goal', {
    sentence: (d) => `You set your first goal on ${longDate(d)}.`,
    need: 'Make a goal on the Goals page.',
  });
}

export function lgGoalsDone(f: LongFacts, need: number, a: RuleArgs): RuleOutcome {
  const done = f.goals
    .map((g) => g.doneOn)
    .filter((d): d is IsoDate => d !== null && d <= a.today && (!a.from || d >= a.from))
    .sort();
  return count(done, need, 'goal', {
    sentence: (d) => (need === 1 ? `Your first goal was done on ${longDate(d)}: at or above its target for 30 days.` : `Your ${ordinal(need)} goal was done on ${longDate(d)}.`),
    need: 'A goal is done when its account stays at or above the target for 30 days in a row.',
  });
}

// ------------------------------------------------------------------ perfect months

const missing = (m: PerfectMonth) =>
  [!m.earned && 'income above spending', !m.budget && 'under budget', !m.clean && 'clean books', !m.invested && 'money invested'].filter(Boolean).join(', ');

function perfectRows(f: LongFacts, a: RuleArgs) {
  return f.perfect.filter((m) => endOfMonth(m.month) < a.today && (!a.from || m.month >= a.from));
}

function lastMonthNote(rows: readonly PerfectMonth[]): string | null {
  const last = rows.at(-1);
  if (!last) return null;
  return isPerfect(last) ? `More perfect months (${monthName(last.month)} was one).` : `A perfect month (${monthName(last.month)} missed: ${missing(last)}).`;
}

export function lgPerfectMonths(f: LongFacts, need: number, a: RuleArgs): RuleOutcome {
  const rows = perfectRows(f, a);
  const hits = rows.filter(isPerfect);
  const nth = hits[need - 1] ?? null;
  const fr = clamp01(hits.length / need);
  const progress: Progress = rows.length
    ? { fraction: fr, score: fr, text: `${hits.length} of ${plural(need, 'perfect month')}`, need: lastMonthNote(rows) }
    : { fraction: 0, score: 0, text: `0 of ${plural(need, 'perfect month')}`, need: a.from ? 'Counts from the first full month after you turned it on.' : 'Counts once a full month of your data has ended.' };
  return {
    earned: nth
      ? {
          date: endOfMonth(nth.month),
          sentence:
            need === 1
              ? `${monthName(nth.month)} was a perfect month: you earned more than you spent, stayed under budget, kept clean books and invested.`
              : `${monthName(nth.month)} was your ${ordinal(need)} perfect month.`,
          story: null,
        }
      : null,
    blocked: null,
    progress,
    story: null,
  };
}

export function lgPerfectYear(f: LongFacts, a: RuleArgs): RuleOutcome {
  const rows = perfectRows(f, a);
  let n = 0;
  let earned: PerfectMonth | null = null;
  let start: PerfectMonth | null = null;
  rows.forEach((m, i) => {
    n = isPerfect(m) ? n + 1 : 0;
    if (!earned && n === 12) {
      earned = m;
      start = rows[i - 11]!;
    }
  });
  const e = earned as PerfectMonth | null;
  const s = start as PerfectMonth | null;
  return {
    earned: e && s ? { date: endOfMonth(e.month), sentence: `Twelve perfect months in a row, ${monthName(s.month)} through ${monthName(e.month)}.`, story: null } : null,
    blocked: null,
    progress: { fraction: clamp01(n / 12), score: clamp01(n / 12), text: `${n} of 12 months in a row`, need: lastMonthNote(rows) ?? 'Counts once a full month of your data has ended.' },
    story: null,
  };
}

// ------------------------------------------------------------------ Wrapped watched

export function lgWrapped(f: LongFacts, need: number, a: RuleArgs): RuleOutcome {
  const firsts = new Map<number, IsoDate>();
  for (const w of f.wrapped) if (w.date <= a.today && (!a.from || w.date >= a.from) && !firsts.has(w.year)) firsts.set(w.year, w.date);
  const dates = [...firsts.values()].sort();
  const years = [...firsts.entries()].sort((x, y) => (x[1] < y[1] ? -1 : 1)).map(([y]) => y);
  const o = count(dates, need, 'year', {
    sentence: (d) =>
      need === 1 ? `You watched Arc40 Wrapped ${years[0]} to the end on ${longDate(d)}.` : `You have watched ${need} different years of Arc40 Wrapped to the end (the ${ordinal(need)} on ${longDate(d)}).`,
    need: 'Watch a year of Arc40 Wrapped (Dashboard) to its last slide.',
  });
  const note = trackingNote(f, 'Wrapped');
  return note ? { ...o, progress: { ...o.progress, need: `${o.progress.need} ${note}` } } : o;
}

// ------------------------------------------------------------------ anniversary

export function lgAnniversary(f: LongFacts, a: RuleArgs): RuleOutcome {
  if (!f.setupDate || a.year === null) return { earned: null, blocked: null, progress: { fraction: 0, score: 0, text: 'Not set up yet', need: null }, story: null };
  const n = a.year - Number(f.setupDate.slice(0, 4));
  const due = yearsLater(f.setupDate, n);
  const before = yearsLater(f.setupDate, n - 1);
  const ok = n >= 1 && due <= a.today && (!a.from || due >= a.from);
  const total = Math.max(1, dayNumber(due) - dayNumber(before));
  const fr = clamp01((dayNumber(a.today) - dayNumber(before)) / total);
  const left = dayNumber(due) - dayNumber(a.today);
  return {
    earned: ok ? { date: due, sentence: `${plural(n, 'year')} with Arc40: you set it up on ${longDate(f.setupDate)}.`, story: null } : null,
    blocked: null,
    progress: { fraction: fr, score: fr, text: left > 0 ? `${plural(left, 'day')} to go` : 'Today', need: `Your Arc40 anniversary is ${longDate(due)}.` },
    story: null,
  };
}
const dayNumber = (d: IsoDate) => Math.round(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000);

// ------------------------------------------------------------------ Collector

export function lgCollector(f: CollectorFacts, need: number, a: RuleArgs): RuleOutcome {
  const dates = f.earned.map((e) => e.date).filter((d) => d <= a.today && (!a.from || d >= a.from)).sort();
  return count(
    dates,
    need,
    'trophy',
    {
      sentence: (d) => `You have ${need} trophies in the case; the ${ordinal(need)} was earned on ${longDate(d)}.`,
      need: 'Every trophy you earn counts, each yearly trophy on its own.',
    },
    'trophies',
  );
}

export function lgCollectorAll(f: CollectorFacts, a: RuleArgs): RuleOutcome {
  const first = new Map<string, IsoDate>();
  for (const e of f.earned) {
    if (e.date > a.today || (a.from && e.date < a.from)) continue;
    const cur = first.get(e.id);
    if (!cur || e.date < cur) first.set(e.id, e.date);
  }
  const have = f.ids.filter((id) => first.has(id));
  const done = have.length === f.ids.length && f.ids.length > 0;
  const last = done ? [...first.values()].sort().at(-1)! : null;
  const fr = clamp01(have.length / Math.max(1, f.ids.length));
  return {
    earned: last ? { date: last, sentence: `Every trophy in the case is yours: all ${f.ids.length}, the last one earned on ${longDate(last)}.`, story: null } : null,
    blocked: null,
    progress: { fraction: fr, score: fr, text: `${have.length} of ${f.ids.length} trophies`, need: `${plural(f.ids.length - have.length, 'trophy', 'trophies')} still to earn at least once.` },
    story: null,
  };
}

// ------------------------------------------------------------------ The Arc

export const ARC_NO_BIRTH = 'Set your birth month in Settings to watch The Arc.';

/** The 1st of the month the user turns 40. */
export const arcDay = (b: BirthMonth): IsoDate => `${b.year + 40}-${String(b.month).padStart(2, '0')}-01`;

export function theArc(f: LongFacts, a: RuleArgs): RuleOutcome {
  if (!f.birth) return { earned: null, blocked: ARC_NO_BIRTH, progress: { fraction: 0, score: 0, text: 'No birth month saved', need: ARC_NO_BIRTH }, story: null };
  const day = arcDay(f.birth);
  const start = f.firstDataDate;
  const ok = !!start && start < day && day <= a.today && (!a.from || day >= a.from);
  const left = monthsBetween(`${a.today.slice(0, 7)}-01`, day);
  let progress: Progress;
  if (!start) progress = { fraction: 0, score: 0, text: `${yearsMonths(left)} to go`, need: 'The Arc measures from the first day of your history in Arc40.' };
  else {
    const total = Math.max(1, monthsBetween(`${start.slice(0, 7)}-01`, day));
    const fr = clamp01(1 - left / total);
    progress = { fraction: fr, score: fr, text: left > 0 ? `${yearsMonths(left)} to go` : 'This month', need: `The month you turn 40, ${monthName(day)} (counting from ${longDate(start)}).` };
  }
  return {
    earned: ok ? { date: day, sentence: `You turned 40 with Arc40 at your side since ${longDate(start!)}.`, story: null } : null,
    blocked: start && start >= day ? 'Arc40 started after you turned 40.' : null,
    progress,
    story: null,
  };
}
