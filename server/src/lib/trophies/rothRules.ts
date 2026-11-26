/**
 * Roth trophies (pure). Same rules as the Goals page: contributions with tax_year Y in Roth IRA accounts, compared with
 * the saved `ira_limits[Y]`. Contributions keep their REAL sign (a reversal lowers every total, audit F-03), never
 * Math.abs. A limit or deadline is never guessed: without one the trophy says what to enter first.
 *
 *   roth_maxed      year Y: the running total for Y reaches the limit on or before the deadline. Earned on the day of the
 *                   contribution that got there.
 *   roth_by_june    year Y: the same, on or before June 30 of Y (needs only the limit).
 *   roth_on_pace    year Y: at every month end from Jan 31 of Y through the last month end before the deadline, the Roth
 *                   pace status (lib/rothPace.ts) was on pace, ahead or maxed ("behind by a little" counts as behind),
 *                   and the year got maxed. Earned the day it is maxed (month ends after that are maxed already).
 *   roth_years_maxed  how many tax years were maxed (by their deadline), counted from the data whatever the banners say;
 *                   `inARow` = that many consecutive tax years. Earned the day the count (or run) is first reached.
 *   roth_total      every Roth contribution, all tax years, signed, added up by date; earned the day the total first
 *                   reaches the line.
 *   roth_worth_hold the Roth IRA accounts' balance (the same daily balances as Accounts) at or above the line for 30 days.
 *   roth_first      the first contribution above $0.
 *
 * Start from today (`from`): a yearly trophy still counts the whole year's contributions (the limit is about the whole
 * year) but the day it gets maxed must be on or after `from`; years maxed / first contribution: the event must be on or
 * after `from`; the lifetime total only adds contributions dated on or after `from`; Roth worth holds only count days on
 * or after `from`.
 */
import { addDays, endOfMonth, type IsoDate } from '../../../../shared/dates.js';
import { rothPace } from '../rothPace.js';
import type { DailySeries } from './data.js';
import { clamp01, fromTo, longDate, money, monthName } from './format.js';
import { firstHold, HOLD_DAYS, thin } from './hold.js';
import { holdProgress } from './netWorthRules.js';
import type { Progress, RuleArgs, RuleOutcome, Story } from './types.js';

export interface RothContribution {
  date: IsoDate;
  taxYear: number | null;
  amountCents: number;
}

export interface RothFacts {
  /** Contribution rows in Roth IRA accounts, oldest first. */
  contributions: readonly RothContribution[];
  limits: Readonly<Record<string, { limitCents: number; deadline: string | null }>>;
  worth: DailySeries;
}

/** Running total by date (same-day rows added together first). */
export function runningTotal(rows: readonly { date: IsoDate; amountCents: number }[]): { date: IsoDate; cents: number }[] {
  const out: { date: IsoDate; cents: number }[] = [];
  let run = 0;
  for (const r of [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    run += r.amountCents;
    const last = out[out.length - 1];
    if (last && last.date === r.date) last.cents = run;
    else out.push({ date: r.date, cents: run });
  }
  return out;
}

/** Days the running total goes from below the line to at or above it. */
export function crossings(total: readonly { date: IsoDate; cents: number }[], lineCents: number): IsoDate[] {
  const out: IsoDate[] = [];
  let prev = 0;
  for (const p of total) {
    if (prev < lineCents && p.cents >= lineCents) out.push(p.date);
    prev = p.cents;
  }
  return out;
}

const forYear = (f: RothFacts, y: number) => f.contributions.filter((c) => c.taxYear === y);
const upTo = (rows: readonly RothContribution[], d: IsoDate) => rows.filter((c) => c.date <= d).reduce((s, c) => s + c.amountCents, 0);
const blockedOutcome = (text: string): RuleOutcome => ({
  earned: null,
  blocked: text,
  progress: { fraction: 0, score: 0, text, need: 'Add it on the Goals page (Roth IRA card).' },
  story: null,
});

function yearStory(rows: readonly RothContribution[], y: number, limitCents: number, until: IsoDate): Story {
  return {
    label: `Contributions for ${y}, added up`,
    lineCents: limitCents,
    points: [{ date: `${y}-01-01`, cents: 0 }, ...runningTotal(rows.filter((r) => r.date <= until))],
  };
}

/** The day year Y was maxed by `by` (first time the total reached the limit), or null. */
export function maxedOn(f: RothFacts, y: number, by: IsoDate, today: IsoDate, from: IsoDate | null): IsoDate | null {
  const limit = f.limits[String(y)];
  if (!limit) return null;
  const end = by < today ? by : today;
  return crossings(runningTotal(forYear(f, y)), limit.limitCents).find((d) => d <= end && (!from || d >= from)) ?? null;
}

function yearProgress(rows: readonly RothContribution[], limitCents: number, by: IsoDate, byLabel: string, today: IsoDate): Progress {
  const total = upTo(rows, today);
  const f = clamp01(total / limitCents);
  if (today > by)
    return { fraction: clamp01(upTo(rows, by) / limitCents), score: 0, text: `${money(upTo(rows, by))} of ${money(limitCents)} by ${byLabel}`, need: `${byLabel} has passed.` };
  return { fraction: f, score: f, text: `${money(total)} of ${money(limitCents)}`, need: `${money(Math.max(0, limitCents - total))} more by ${byLabel}` };
}

export function rothMaxed(f: RothFacts, a: RuleArgs): RuleOutcome {
  const y = a.year!;
  const limit = f.limits[String(y)];
  if (!limit) return blockedOutcome(`Enter the limit for ${y} first.`);
  if (!limit.deadline) return blockedOutcome(`Enter the deadline for ${y} first.`);
  const rows = forYear(f, y);
  const d = maxedOn(f, y, limit.deadline, a.today, a.from);
  return {
    earned: d
      ? {
          date: d,
          sentence: `You put the full ${money(limit.limitCents)} into your Roth for ${y} by ${longDate(d)}, before the ${longDate(limit.deadline)} deadline.`,
          story: yearStory(rows, y, limit.limitCents, d),
        }
      : null,
    blocked: null,
    progress: yearProgress(rows, limit.limitCents, limit.deadline, longDate(limit.deadline), a.today),
    story: yearStory(rows, y, limit.limitCents, a.today),
  };
}

export function rothByJune(f: RothFacts, a: RuleArgs): RuleOutcome {
  const y = a.year!;
  const limit = f.limits[String(y)];
  if (!limit) return blockedOutcome(`Enter the limit for ${y} first.`);
  const june = `${y}-06-30`;
  const rows = forYear(f, y);
  const d = maxedOn(f, y, june, a.today, a.from);
  return {
    earned: d
      ? {
          date: d,
          sentence: `You put the full ${money(limit.limitCents)} into your Roth for ${y} by ${longDate(d)}, before June 30.`,
          story: yearStory(rows, y, limit.limitCents, d),
        }
      : null,
    blocked: null,
    progress: yearProgress(rows, limit.limitCents, june, `June 30, ${y}`, a.today),
    story: yearStory(rows, y, limit.limitCents, a.today < june ? a.today : june),
  };
}

/** Month ends checked for "on pace all year": Jan 31 of Y through the last month end before the deadline. */
export function paceMonthEnds(y: number, deadline: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = `${y}-01-31`; d < deadline; d = endOfMonth(addDays(d, 1))) out.push(d);
  return out;
}

export function rothOnPace(f: RothFacts, a: RuleArgs): RuleOutcome {
  const y = a.year!;
  const limit = f.limits[String(y)];
  if (!limit) return blockedOutcome(`Enter the limit for ${y} first.`);
  if (!limit.deadline) return blockedOutcome(`Enter the deadline for ${y} first.`);
  const rows = forYear(f, y);
  const contributions = rows.map((r) => ({ date: r.date, amountCents: r.amountCents }));
  const maxed = maxedOn(f, y, limit.deadline, a.today, null);
  // Month ends that have ended (before today), up to the day it was maxed (from then on the status is maxed).
  const lastChecked = maxed ?? a.today;
  const ends = paceMonthEnds(y, limit.deadline).filter((m) => m < lastChecked);
  const statusOn = (m: IsoDate) => rothPace({ year: y, limitCents: limit.limitCents, deadline: limit.deadline!, today: m, contributions, earnedCents: 0 }).status;
  const behind = ends.find((m) => !['on_pace', 'ahead', 'maxed'].includes(statusOn(m)));
  const okMaxed = maxed && (!a.from || maxed >= a.from) ? maxed : null;
  const earned =
    okMaxed && !behind
      ? {
          date: okMaxed,
          sentence: `You stayed on pace for ${y} at every month end${ends.length ? ` (${ends.length} checked)` : ''} and put in the full ${money(limit.limitCents)} by ${longDate(okMaxed)}.`,
          story: yearStory(rows, y, limit.limitCents, okMaxed),
        }
      : null;
  const total = upTo(rows, a.today);
  let progress: Progress;
  if (behind)
    progress = { fraction: 0, score: 0, text: `Behind at the end of ${monthName(behind)}`, need: `${y} can no longer earn this one.` };
  else if (a.today > limit.deadline)
    progress = { fraction: clamp01(total / limit.limitCents), score: 0, text: `${money(total)} of ${money(limit.limitCents)}`, need: 'The deadline has passed.' };
  else {
    const fr = clamp01(total / limit.limitCents);
    progress = {
      fraction: fr,
      score: fr,
      text: `On pace at ${ends.length} of ${paceMonthEnds(y, limit.deadline).length} month ends so far`,
      need: `${money(Math.max(0, limit.limitCents - total))} more by ${longDate(limit.deadline)}, never behind at a month end`,
    };
  }
  return { earned, blocked: null, progress, story: yearStory(rows, y, limit.limitCents, a.today) };
}

/** Every tax year that was maxed by its deadline, in the order they were maxed. */
export function yearsMaxed(f: RothFacts, today: IsoDate): { year: number; date: IsoDate }[] {
  const years = [...new Set(f.contributions.map((c) => c.taxYear).filter((y): y is number => y !== null))];
  const out: { year: number; date: IsoDate }[] = [];
  for (const y of years) {
    const deadline = f.limits[String(y)]?.deadline;
    if (!deadline) continue;
    const d = maxedOn(f, y, deadline, today, null);
    if (d) out.push({ year: y, date: d });
  }
  return out.sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : p.year - q.year));
}

/** Longest run of consecutive tax years in a set. */
function longestRun(years: ReadonlySet<number>): number {
  let best = 0;
  for (const y of years) {
    if (years.has(y - 1)) continue;
    let n = 1;
    while (years.has(y + n)) n++;
    best = Math.max(best, n);
  }
  return best;
}

export function rothYearsMaxed(f: RothFacts, count: number, inARow: boolean, a: RuleArgs): RuleOutcome {
  const events = yearsMaxed(f, a.today).filter((e) => !a.from || e.date >= a.from);
  const done = new Set<number>();
  let earnedOn: { date: IsoDate; years: number[] } | null = null;
  for (const e of events) {
    done.add(e.year);
    const n = inARow ? longestRun(done) : done.size;
    if (n >= count) {
      earnedOn = { date: e.date, years: [...done].sort() };
      break;
    }
  }
  const have = inARow ? longestRun(new Set(events.map((e) => e.year))) : events.length;
  const unit = inARow ? 'years in a row' : 'years maxed';
  const story: Story = {
    label: 'Total put in for each tax year',
    lineCents: null,
    points: [...new Set(f.contributions.map((c) => c.taxYear).filter((y): y is number => y !== null))]
      .sort()
      .map((y) => ({ date: `${y}-12-31`, cents: forYear(f, y).reduce((s, c) => s + c.amountCents, 0) })),
  };
  return {
    earned: earnedOn
      ? {
          date: earnedOn.date,
          sentence: inARow
            ? `You maxed your Roth ${count} tax years in a row; the last one was done on ${longDate(earnedOn.date)}.`
            : `You have now maxed your Roth for ${count} tax years (${earnedOn.years.join(', ')}); number ${count} was done on ${longDate(earnedOn.date)}.`,
          story,
        }
      : null,
    blocked: null,
    progress: {
      fraction: clamp01(have / count),
      score: clamp01(have / count),
      text: `${Math.min(have, count)} of ${count} ${unit}`,
      need: have >= count ? 'Ready: it is earned at the next check.' : `${count - have} more ${count - have === 1 ? 'year' : 'years'}${inARow ? ' in a row' : ''}`,
    },
    story,
  };
}

export function rothTotal(f: RothFacts, lineCents: number, a: RuleArgs): RuleOutcome {
  const rows = f.contributions.filter((c) => c.date <= a.today && (!a.from || c.date >= a.from));
  const total = runningTotal(rows);
  const d = crossings(total, lineCents)[0] ?? null;
  const now = total.length ? total[total.length - 1]!.cents : 0;
  const fr = clamp01(now / lineCents);
  const story = (until: IsoDate): Story => ({ label: 'Everything you have put into your Roth, added up', lineCents, points: thin(total.filter((p) => p.date <= until)) });
  return {
    earned: d ? { date: d, sentence: `Everything you have put into your Roth added up to ${money(lineCents)} on ${longDate(d)}.`, story: story(d) } : null,
    blocked: null,
    progress: { fraction: fr, score: fr, text: `${money(now)} of ${money(lineCents)}`, need: `${money(Math.max(0, lineCents - now))} more in contributions` },
    story: story(a.today),
  };
}

export function rothWorth(f: RothFacts, lineCents: number, a: RuleArgs): RuleOutcome {
  const days = f.worth.days;
  const h = firstHold(days, (d) => d.cents! >= lineCents, { from: a.from });
  const pts = (from: number, to: number) => thin(days.slice(from, to + 1).filter((d) => d.cents !== null).map((d) => ({ date: d.date, cents: d.cents! })));
  const now = days.length ? days[days.length - 1]!.cents : null;
  return {
    earned: h.earned
      ? {
          date: h.earned.end,
          sentence: `Your Roth IRA stayed at or above ${money(lineCents)} for ${HOLD_DAYS} days in a row, ${fromTo(h.earned.start, h.earned.end)}.`,
          story: { label: 'Roth IRA balance each day of the hold', lineCents, points: pts(h.earned.startIndex, h.earned.endIndex) },
        }
      : null,
    blocked: null,
    progress: now === null ? { fraction: 0, score: 0, text: 'No Roth IRA balance yet', need: 'Add a Roth IRA account or import its history.' } : holdProgress(now, lineCents, h.current, 'in your Roth'),
    story: days.length ? { label: 'Roth IRA balance, last 60 days', lineCents, points: pts(Math.max(0, days.length - 60), days.length - 1) } : null,
  };
}

export function rothFirst(f: RothFacts, a: RuleArgs): RuleOutcome {
  const first = f.contributions.find((c) => c.amountCents > 0 && c.date <= a.today && (!a.from || c.date >= a.from));
  return {
    earned: first
      ? {
          date: first.date,
          sentence: `Your first Roth contribution: ${money(first.amountCents)} on ${longDate(first.date)}${first.taxYear ? `, for ${first.taxYear}` : ''}.`,
          story: null,
        }
      : null,
    blocked: null,
    progress: { fraction: 0, score: 0, text: 'No Roth contributions yet', need: 'Any contribution to a Roth IRA earns it.' },
    story: null,
  };
}
