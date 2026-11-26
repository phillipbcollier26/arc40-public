/**
 * Refereeing trophies (Trophies Round 2), pure. Input: RefFacts (data.ts), from the money lines (lib/totals.ts, split
 * pieces included), found by category ROLE, never by name:
 *   income   income lines in the 'refereeing' category, with their real sign (a refund / clawback lowers it)
 *   costs    expense lines in the 'ref_costs' category, as costs (money out = +, a refund of gear lowers them)
 *   spending all expense lines of a month added up (the savings-rate number: refunds lower it)
 *   firstDataDate  the first money line of any kind
 *
 *   ref_lifetime        all ref income added up reaches the line; earned the day it does
 *   ref_month           one calendar month's ref income reaches the line; the current month counts the day it does
 *   ref_month_streak    months in a row with ref income above $0 (a finished month with $0 or less breaks it; the
 *                       current month counts once it has ref income, otherwise it neither counts nor breaks)
 *   ref_record_month    record plaque: a FINISHED month above every earlier month, with at least 3 earlier months that
 *                       had ref income; dated the month end; later records are added
 *   ref_record_year     record plaque: a FINISHED year above every earlier one; only years Arc40 has data for from
 *                       January (the first money line on or before Jan 31), so a part year never makes the next one
 *                       look like a record. Needs one earlier such year. Dated Dec 31.
 *   ref_up_year         the first finished year with more ref income than the year before (both with data from
 *                       January); dated Dec 31
 *   ref_gear_10x        a finished year where ref income >= 10 x ref costs and ref costs > $0; dated Dec 31
 *   ref_covers_spending a FINISHED month where ref income > $0 and >= all spending that month; dated the month end.
 *                       Start from today: the month must START on or after the turn-on day.
 * Start from today for the others: only ref income from the turn-on day counts (totals, months, streaks), and a
 * record / year must end on or after it.
 */
import { endOfMonth, type IsoDate } from '../../../../shared/dates.js';
import { clamp01, longDate, money, monthName, monthOnly } from './format.js';
import { monthStreak, monthTotals, monthsBetween } from './investingRules.js';
import { thin } from './hold.js';
import type { Progress, RecordEntry, RuleArgs, RuleOutcome, Story } from './types.js';

export interface RefRow {
  date: IsoDate;
  cents: number;
}

export interface RefFacts {
  /** False when no category has the Refereeing role. */
  hasCategory: boolean;
  income: RefRow[];
  costs: RefRow[];
  spendingInMonth(month: string): number;
  firstDataDate: IsoDate | null;
}

const NO_CATEGORY = 'There is no Refereeing category. Give one category the Refereeing role first.';
const NONE: Progress = { fraction: 0, score: 0, text: 'No refereeing pay yet', need: 'Income in the Refereeing category counts.' };

function blocked(text: string): RuleOutcome {
  return { earned: null, blocked: text, progress: { fraction: 0, score: 0, text, need: null }, story: null };
}

const inRange = (rows: readonly RefRow[], a: RuleArgs) => rows.filter((r) => r.date <= a.today && (!a.from || r.date >= a.from));
const ended = (m: string, today: IsoDate) => endOfMonth(`${m}-01`) < today;
const yearEnded = (y: number, today: IsoDate) => `${y}-12-31` < today;

function byMonth(rows: readonly RefRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.date.slice(0, 7), (out.get(r.date.slice(0, 7)) ?? 0) + r.cents);
  return out;
}
function byYear(rows: readonly RefRow[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of rows) out.set(Number(r.date.slice(0, 4)), (out.get(Number(r.date.slice(0, 4))) ?? 0) + r.cents);
  return out;
}
function monthStory(totals: Map<string, number>, first: string | null, until: string, label = 'Ref pay each month'): Story | null {
  if (!first) return null;
  return { label, lineCents: null, points: monthsBetween(first, until).slice(-24).map((m) => ({ date: endOfMonth(`${m}-01`), cents: totals.get(m) ?? 0 })) };
}
/** A year Arc40 has data for from January. */
const fullYear = (f: RefFacts, y: number) => !!f.firstDataDate && f.firstDataDate <= `${y}-01-31`;

export function refLifetime(f: RefFacts, lineCents: number, a: RuleArgs): RuleOutcome {
  if (!f.hasCategory) return blocked(NO_CATEGORY);
  const rows = inRange(f.income, a);
  let run = 0;
  let prev = 0;
  let on: IsoDate | null = null;
  const points: { date: IsoDate; cents: number }[] = [];
  for (const r of rows) {
    run += r.cents;
    if (points.length && points[points.length - 1]!.date === r.date) points[points.length - 1]!.cents = run;
    else points.push({ date: r.date, cents: run });
    if (!on && prev < lineCents && run >= lineCents) on = r.date;
    prev = run;
  }
  const story = (until: IsoDate): Story => ({ label: 'Ref pay, added up', lineCents, points: thin(points.filter((p) => p.date <= until)) });
  const fr = clamp01(run / lineCents);
  return {
    earned: on ? { date: on, sentence: `Your refereeing pay added up to ${money(lineCents)} on ${longDate(on)}.`, story: story(on) } : null,
    blocked: null,
    progress: rows.length ? { fraction: fr, score: fr, text: `${money(run)} of ${money(lineCents)}`, need: `${money(Math.max(0, lineCents - run))} more ref pay` } : NONE,
    story: points.length ? story(a.today) : null,
  };
}

export function refMonth(f: RefFacts, lineCents: number, a: RuleArgs): RuleOutcome {
  if (!f.hasCategory) return blocked(NO_CATEGORY);
  const rows = inRange(f.income, a);
  const run = new Map<string, number>();
  let on: { date: IsoDate; month: string } | null = null;
  for (const r of rows) {
    const m = r.date.slice(0, 7);
    const before = run.get(m) ?? 0;
    run.set(m, before + r.cents);
    if (!on && before < lineCents && before + r.cents >= lineCents) on = { date: r.date, month: m };
  }
  const thisMonth = a.today.slice(0, 7);
  const cur = run.get(thisMonth) ?? 0;
  const best = Math.max(0, ...run.values());
  const first = [...run.keys()].sort()[0] ?? null;
  const fr = clamp01(cur / lineCents);
  return {
    earned: on
      ? {
          date: on.date,
          sentence: `Your refereeing pay in ${monthName(`${on.month}-01`)} reached ${money(lineCents)} on ${longDate(on.date)}.`,
          story: monthStory(run, first, on.month),
        }
      : null,
    blocked: null,
    progress: rows.length
      ? { fraction: fr, score: fr, text: `This month ${money(cur)} of ${money(lineCents)}`, need: `Best month so far ${money(best)}` }
      : NONE,
    story: monthStory(run, first, thisMonth),
  };
}

export function refMonthStreak(f: RefFacts, need: number, a: RuleArgs): RuleOutcome {
  if (!f.hasCategory) return blocked(NO_CATEGORY);
  const totals = monthTotals(inRange(f.income, a), null);
  const first = [...totals.keys()].sort()[0] ?? null;
  const s = monthStreak(totals, first, a.today, need);
  const plain = new Map([...totals].map(([m, t]) => [m, t.total]));
  const left = need - s.current;
  return {
    earned: s.earned
      ? {
          date: s.earned.date,
          sentence: `You had refereeing pay every month for ${need} months in a row, ${monthName(`${s.earned.startMonth}-01`)} to ${monthName(`${s.earned.month}-01`)}.`,
          story: monthStory(plain, first, s.earned.month),
        }
      : null,
    blocked: null,
    progress: first
      ? {
          fraction: clamp01(s.current / need),
          score: clamp01(s.current / need),
          text: `${s.current} of ${need} months in a row`,
          need: s.thisMonthCounted ? `${left} more ${left === 1 ? 'month' : 'months'} in a row` : 'Ref pay this month keeps the run going',
        }
      : NONE,
    story: monthStory(plain, first, a.today.slice(0, 7)),
  };
}

export function refRecordMonth(f: RefFacts, a: RuleArgs): RuleOutcome {
  if (!f.hasCategory) return blocked(NO_CATEGORY);
  const totals = byMonth(f.income.filter((r) => r.date <= a.today));
  const first = [...totals.keys()].sort()[0] ?? null;
  const recs: RecordEntry[] = [];
  let best = 0;
  let withIncome = 0;
  for (const m of first ? monthsBetween(first, a.today.slice(0, 7)) : []) {
    if (!ended(m, a.today)) break;
    const v = totals.get(m) ?? 0;
    const end = endOfMonth(`${m}-01`);
    if (v > 0 && v > best && withIncome >= 3 && (!a.from || end >= a.from)) recs.push({ period: m, amountCents: v, setOn: end });
    best = Math.max(best, v);
    if (v > 0) withIncome++;
  }
  const r0 = recs[0];
  const cur = totals.get(a.today.slice(0, 7)) ?? 0;
  const fr = best > 0 ? clamp01(cur / best) : 0;
  return {
    earned: r0
      ? {
          date: r0.setOn,
          sentence: `You earned ${money(r0.amountCents)} refereeing in ${monthName(r0.setOn)}, more than in any month before it.`,
          story: monthStory(totals, first, r0.period),
        }
      : null,
    blocked: null,
    records: recs,
    progress: !first
      ? NONE
      : withIncome < 3
        ? { fraction: withIncome / 4, score: withIncome / 4, text: `${withIncome} of 3 months with ref pay so far`, need: 'Needs 3 finished months with ref pay, then a month above all of them.' }
        : cur > best
          ? { fraction: 1, score: 1, text: `This month ${money(cur)}, ahead of your best month. Counts when ${monthOnly(a.today)} ends.`, need: `Your best month: ${money(best)}.` }
          : { fraction: fr, score: fr, text: `This month ${money(cur)}, best month ${money(best)}`, need: `${money(Math.max(0, best - cur + 1))} more this month for a record` },
    story: monthStory(totals, first, a.today.slice(0, 7)),
  };
}

/** Finished years with data from January, with their ref income, oldest first. */
function fullYears(f: RefFacts, today: IsoDate): { year: number; cents: number }[] {
  if (!f.firstDataDate) return [];
  const totals = byYear(f.income);
  const out: { year: number; cents: number }[] = [];
  for (let y = Number(f.firstDataDate.slice(0, 4)); yearEnded(y, today); y++) if (fullYear(f, y)) out.push({ year: y, cents: totals.get(y) ?? 0 });
  return out;
}
const yearStory = (ys: { year: number; cents: number }[], label: string): Story | null =>
  ys.length ? { label, lineCents: null, points: ys.map((y) => ({ date: `${y.year}-12-31`, cents: y.cents })) } : null;

export function refRecordYear(f: RefFacts, a: RuleArgs): RuleOutcome {
  if (!f.hasCategory) return blocked(NO_CATEGORY);
  const ys = fullYears(f, a.today);
  const recs: RecordEntry[] = [];
  let best: number | null = null;
  for (const y of ys) {
    if (best !== null && y.cents > best && (!a.from || `${y.year}-12-31` >= a.from)) recs.push({ period: String(y.year), amountCents: y.cents, setOn: `${y.year}-12-31` });
    best = best === null ? y.cents : Math.max(best, y.cents);
  }
  const r0 = recs[0];
  const thisYear = Number(a.today.slice(0, 4));
  const soFar = byYear(f.income.filter((r) => r.date <= a.today)).get(thisYear) ?? 0;
  const fr = best && best > 0 ? clamp01(soFar / best) : 0;
  return {
    earned: r0
      ? {
          date: r0.setOn,
          sentence: `You earned ${money(r0.amountCents)} refereeing in ${r0.period}, more than in any full year before it.`,
          story: yearStory(ys.filter((y) => y.year <= Number(r0.period)), 'Ref pay in each full year'),
        }
      : null,
    blocked: null,
    records: recs,
    progress:
      best === null
        ? { fraction: 0, score: 0, text: 'No full year yet', need: 'Needs a full year (with your data from January) to compare with, then a year above it.' }
        : soFar > best
          ? { fraction: 1, score: 1, text: `${thisYear} so far ${money(soFar)}, ahead of your best year. Counts on Dec 31.`, need: `Your best full year: ${money(best)}.` }
          : { fraction: fr, score: fr, text: `${thisYear} so far ${money(soFar)}, best full year ${money(best)}`, need: `${money(best - soFar + 1)} more by Dec 31` },
    story: yearStory(ys, 'Ref pay in each full year'),
  };
}

export function refUpYear(f: RefFacts, a: RuleArgs): RuleOutcome {
  if (!f.hasCategory) return blocked(NO_CATEGORY);
  const ys = fullYears(f, a.today);
  let earned: RuleOutcome['earned'] = null;
  for (let i = 1; i < ys.length && !earned; i++) {
    const [p, y] = [ys[i - 1]!, ys[i]!];
    if (p.year === y.year - 1 && y.cents > p.cents && (!a.from || `${y.year}-12-31` >= a.from))
      earned = {
        date: `${y.year}-12-31`,
        sentence: `You earned ${money(y.cents)} refereeing in ${y.year}, up from ${money(p.cents)} in ${p.year}.`,
        story: yearStory(ys.slice(0, i + 1), 'Ref pay in each full year'),
      };
  }
  const thisYear = Number(a.today.slice(0, 4));
  const last = ys.find((y) => y.year === thisYear - 1);
  const soFar = byYear(f.income.filter((r) => r.date <= a.today)).get(thisYear) ?? 0;
  const fr = last && last.cents > 0 ? clamp01(soFar / last.cents) : 0;
  return {
    earned,
    blocked: null,
    progress: last
      ? soFar > last.cents
        ? { fraction: 1, score: 1, text: `${thisYear} so far ${money(soFar)}, ahead of ${last.year}. Counts on Dec 31.`, need: `${last.year}: ${money(last.cents)}.` }
        : { fraction: fr, score: fr, text: `${thisYear} so far ${money(soFar)}, ${last.year} ${money(last.cents)}`, need: `More than ${money(last.cents)} by Dec 31` }
      : { fraction: 0, score: 0, text: `No full year ${thisYear - 1} to compare with`, need: 'Needs two full years in a row (with your data from January).' },
    story: yearStory(ys, 'Ref pay in each full year'),
  };
}

export function refGear10x(f: RefFacts, a: RuleArgs): RuleOutcome {
  if (!f.hasCategory) return blocked(NO_CATEGORY);
  const pay = byYear(f.income.filter((r) => r.date <= a.today));
  const cost = byYear(f.costs.filter((r) => r.date <= a.today));
  const first = f.firstDataDate ? Number(f.firstDataDate.slice(0, 4)) : null;
  let earned: RuleOutcome['earned'] = null;
  for (let y = first ?? 0; first !== null && yearEnded(y, a.today) && !earned; y++) {
    const p = pay.get(y) ?? 0;
    const c = cost.get(y) ?? 0;
    if (c > 0 && p >= 10 * c && (!a.from || `${y}-12-31` >= a.from))
      earned = { date: `${y}-12-31`, sentence: `In ${y} you earned ${money(p)} refereeing on ${money(c)} of ref gear and fees, at least 10 times as much.`, story: null };
  }
  const y = Number(a.today.slice(0, 4));
  const p = pay.get(y) ?? 0;
  const c = cost.get(y) ?? 0;
  const fr = c > 0 ? clamp01(p / (10 * c)) : 0;
  const ahead = c > 0 && p >= 10 * c;
  return {
    earned,
    blocked: null,
    progress: ahead
      ? {
          fraction: 1,
          score: 1,
          text: `${y} so far: ref pay is ${Math.floor(p / c)}x your ref costs. Counts on Dec 31 if it stays at 10x or more.`,
          need: `Ref pay ${money(p)}, ref costs ${money(c)}.`,
        }
      : {
          fraction: fr,
          score: fr,
          text: `${y} so far: ref pay ${money(p)}, ref costs ${money(c)}`,
          need: c > 0 ? `Ref pay of at least ${money(10 * c)} (10 times your costs) by Dec 31` : 'Needs some ref costs (Ref Gear & Fees) in the year, and ref pay 10 times as big.',
        },
    story: null,
  };
}

export function refCoversSpending(f: RefFacts, a: RuleArgs): RuleOutcome {
  if (!f.hasCategory) return blocked(NO_CATEGORY);
  const pay = byMonth(f.income.filter((r) => r.date <= a.today));
  let earned: RuleOutcome['earned'] = null;
  const first = f.firstDataDate?.slice(0, 7) ?? null;
  for (const m of first ? monthsBetween(first, a.today.slice(0, 7)) : []) {
    if (!ended(m, a.today)) break;
    if (a.from && `${m}-01` < a.from) continue;
    const p = pay.get(m) ?? 0;
    const s = f.spendingInMonth(m);
    if (p > 0 && p >= s) {
      earned = {
        date: endOfMonth(`${m}-01`),
        sentence: `In ${monthName(`${m}-01`)} you earned ${money(p)} refereeing, enough to cover the ${money(Math.max(0, s))} you spent.`,
        story: null,
      };
      break;
    }
  }
  const m = a.today.slice(0, 7);
  const p = pay.get(m) ?? 0;
  const s = f.spendingInMonth(m);
  const fr = s > 0 ? clamp01(p / s) : p > 0 ? 1 : 0;
  return {
    earned,
    blocked: null,
    progress: {
      fraction: fr,
      score: fr,
      text:
        p > 0 && p >= s && !(a.from && `${m}-01` < a.from)
          ? `This month: ref pay ${money(p)} covers spending ${money(Math.max(0, s))}. Counts when ${monthOnly(a.today)} ends.`
          : `This month: ref pay ${money(p)}, spending ${money(Math.max(0, s))}`,
      need: a.from && `${m}-01` < a.from ? 'Counts from the first full month after you turned it on.' : 'Ref pay at least as big as your spending when the month ends',
    },
    story: null,
  };
}
