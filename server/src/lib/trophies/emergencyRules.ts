/**
 * Emergency fund and savings trophies (Trophies Round 3), pure. Input: EmergencyFacts (data.ts), built only from what
 * the screens already use:
 *   savings   the savings-type accounts that are not archived, added up each day (the Goals card and the Dashboard
 *             emergency ring use the same accounts; balances from the net worth series, valued day by day)
 *   need(d)   the monthly amount the fund is measured against on day d: the average spending of the 6 complete months
 *             before d's month + the essentials setting (lib/emergency.ts, the Goals card's numbers). null = nothing to
 *             measure yet (no complete month and no essentials), or $0 or less
 *   interest  income lines in the category with the interest mark (migration 017), signed (a reversal lowers it)
 *
 * "Months covered" on a day = savings / need. It is compared in whole cents (savings >= months x need), so exactly
 * 6.00 counts and one cent under does not. A day with no savings value or no need never counts.
 *
 *   em_months_hold     months covered at or above `months` for 30 days in a row; earned on day 30
 *   em_funded_streak   COMPLETE calendar months in a row where months covered was 6 or more on EVERY day of the month.
 *                      One day under 6 breaks that month. The current month never counts. Earned on the last month's
 *                      last day
 *   em_savings_hold    the savings balance at or above the line for 30 days in a row
 *   em_interest        all interest added up (signed) reaches the line; earned the day it does
 *   em_refill          the fund was full (6 months or more) for 30 days in a row, THEN dropped below 3 months (exactly
 *                      3.00 is not below), THEN was at 6 or more again for 30 days in a row; earned on that 30th day
 *
 * Start from today (turn-on day `from`):
 *   holds (months covered, savings balance)   only days on or after it count
 *   em_funded_streak                         only months that START on or after it count (turned on Nov 17: December
 *                                            is the first; turned on Dec 1: December counts, the whole month is watched)
 *   em_interest                              only interest from that day on counts
 *   em_refill                                the whole story (full, the drop, the refill) happens on or after it
 */
import { endOfMonth, type IsoDate } from '../../../../shared/dates.js';
import type { DailySeries } from './data.js';
import { clamp01, fromTo, longDate, money, monthName } from './format.js';
import { firstHold, HOLD_DAYS, thin, type Day } from './hold.js';
import { holdProgress } from './netWorthRules.js';
import { monthsBetween } from './investingRules.js';
import type { Progress, RuleArgs, RuleOutcome, Story } from './types.js';

export const FULL_MONTHS = 6;
export const REFILL_LOW_MONTHS = 3;

export interface EmergencyFacts {
  /** False when there is no savings-type account (not archived). */
  hasSavingsAccount: boolean;
  savings: DailySeries;
  need(date: IsoDate): number | null;
  /** False when no category has the interest mark. */
  hasInterestCategory: boolean;
  interest: { date: IsoDate; cents: number }[];
}

const NO_SAVINGS: Progress = { fraction: 0, score: 0, text: 'No savings account yet', need: 'Accounts with the Savings type count.' };
const NO_NEED: Progress = {
  fraction: 0,
  score: 0,
  text: 'No complete month of spending yet',
  need: 'Months covered starts once a month of spending has ended (or set the costs someone else covers on Goals).',
};

/** Does day d cover `months` months? Whole cents, no division. */
export function covers(f: EmergencyFacts, d: Day, months: number): boolean {
  if (d.cents === null) return false;
  const n = f.need(d.date);
  return n !== null && d.cents >= months * n;
}

/** Months covered rounded DOWN to hundredths ("4.25"); integer math. */
export function monthsCovered(cents: number, need: number): string {
  const h = Math.max(0, Math.floor((cents * 100) / need));
  return `${Math.floor(h / 100)}.${String(h % 100).padStart(2, '0')}`;
}

function last(days: readonly Day[]): Day | null {
  for (let i = days.length - 1; i >= 0; i--) if (days[i]!.cents !== null) return days[i]!;
  return null;
}
function storyOf(days: readonly Day[], label: string, lineCents: number | null): Story {
  return { label, lineCents, points: thin(days.filter((d) => d.cents !== null).map((d) => ({ date: d.date, cents: d.cents! }))) };
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ------------------------------------------------------------------ months covered (30-day rule)

export function emMonthsHold(f: EmergencyFacts, months: number, a: RuleArgs): RuleOutcome {
  const days = f.savings.days;
  const h = firstHold(days, (d) => covers(f, d, months), { from: a.from });
  const now = last(days);
  const needToday = f.need(a.today);
  let progress: Progress;
  if (!f.hasSavingsAccount || !now) progress = NO_SAVINGS;
  else if (needToday === null) progress = NO_NEED;
  else if (h.current > 0) progress = holdProgress(now.cents, months * needToday, h.current, 'in savings');
  else {
    const fr = clamp01((now.cents! / needToday) / months);
    progress = {
      fraction: fr,
      score: fr,
      text: `${monthsCovered(now.cents!, needToday)} of ${months} ${months === 1 ? 'month' : 'months'} covered`,
      need: `${money(Math.max(0, months * needToday - now.cents!))} more in savings, then ${HOLD_DAYS} days in a row`,
    };
  }
  const lineToday = needToday === null ? null : months * needToday;
  return {
    earned: h.earned
      ? {
          date: h.earned.end,
          sentence: `Your savings covered ${plural(months, 'month')} of spending for ${HOLD_DAYS} days in a row, ${fromTo(h.earned.start, h.earned.end)}.`,
          story: storyOf(days.slice(h.earned.startIndex, h.earned.endIndex + 1), 'Savings each day of the hold', null),
        }
      : null,
    blocked: null,
    progress,
    story: days.length ? storyOf(days.slice(-60), 'Savings, last 60 days', lineToday) : null,
  };
}

// ------------------------------------------------------------------ stayed fully funded (streak of complete months)

/** Complete months (oldest first) and whether months covered was 6+ on every day of each. */
export function fundedMonths(f: EmergencyFacts, today: IsoDate): { month: string; full: boolean; firstMiss: IsoDate | null }[] {
  const first = f.savings.days.find((d) => d.cents !== null)?.date;
  if (!first) return [];
  const out: { month: string; full: boolean; firstMiss: IsoDate | null }[] = [];
  for (const m of monthsBetween(first.slice(0, 7), today.slice(0, 7))) {
    const end = endOfMonth(`${m}-01`);
    if (end >= today) break; // not over yet
    let miss: IsoDate | null = null;
    for (let d = `${m}-01`; d <= end && !miss; d = nextDay(d)) {
      const v = f.savings.on(d);
      if (!covers(f, { date: d, cents: v }, FULL_MONTHS)) miss = d;
    }
    out.push({ month: m, full: miss === null, firstMiss: miss });
  }
  return out;
}

function nextDay(d: IsoDate): IsoDate {
  const t = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) + 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function emFundedStreak(f: EmergencyFacts, need: number, a: RuleArgs): RuleOutcome {
  const allMonths = fundedMonths(f, a.today);
  const months = allMonths.filter((m) => !a.from || `${m.month}-01` >= a.from);
  let run = 0;
  let earned: { month: string; start: string } | null = null;
  months.forEach((m, i) => {
    run = m.full ? run + 1 : 0;
    if (!earned && run === need) earned = { month: m.month, start: months[i - need + 1]!.month };
  });
  // The chart shows the last 24 complete months for context, even before the turn-on day.
  const story: Story | null = allMonths.length
    ? {
        label: 'Savings at each month end',
        lineCents: null,
        points: allMonths.slice(-24).map((m) => ({ date: endOfMonth(`${m.month}-01`), cents: f.savings.on(endOfMonth(`${m.month}-01`)) ?? 0 })),
      }
    : null;
  let progress: Progress;
  if (!f.hasSavingsAccount || !last(f.savings.days)) progress = NO_SAVINGS;
  else if (!months.length && a.from)
    progress = { fraction: 0, score: 0, text: `0 of ${need} months`, need: 'Counts from the first full month after you turned it on.' };
  else {
    const fr = clamp01(run / need);
    progress = {
      fraction: fr,
      score: fr,
      text: `${run} of ${need} months`,
      need: `${plural(need - run, 'more full month')}: 6 months of spending covered on every day of each month`,
    };
  }
  const e = earned as { month: string; start: string } | null;
  return {
    earned: e
      ? {
          date: endOfMonth(`${e.month}-01`),
          sentence: `Your emergency fund covered 6 months of spending on every day for ${need} months in a row, ${monthName(`${e.start}-01`)} through ${monthName(`${e.month}-01`)}.`,
          story,
        }
      : null,
    blocked: null,
    progress,
    story,
  };
}

// ------------------------------------------------------------------ savings balance (30-day rule)

export function emSavingsHold(f: EmergencyFacts, lineCents: number, a: RuleArgs): RuleOutcome {
  const days = f.savings.days;
  const h = firstHold(days, (d) => d.cents! >= lineCents, { from: a.from });
  const now = last(days);
  return {
    earned: h.earned
      ? {
          date: h.earned.end,
          sentence: `Your savings stayed at or above ${money(lineCents)} for ${HOLD_DAYS} days in a row, ${fromTo(h.earned.start, h.earned.end)}.`,
          story: storyOf(days.slice(h.earned.startIndex, h.earned.endIndex + 1), 'Savings each day of the hold', lineCents),
        }
      : null,
    blocked: null,
    progress: !f.hasSavingsAccount || !now ? NO_SAVINGS : holdProgress(now.cents, lineCents, h.current, 'in savings'),
    story: days.length ? storyOf(days.slice(-60), 'Savings, last 60 days', lineCents) : null,
  };
}

// ------------------------------------------------------------------ lifetime interest

const NO_INTEREST_CATEGORY = 'There is no Interest category. Interest is found by that category, so these trophies wait until it is back.';

export function emInterest(f: EmergencyFacts, lineCents: number, a: RuleArgs): RuleOutcome {
  if (!f.hasInterestCategory)
    return { earned: null, blocked: NO_INTEREST_CATEGORY, progress: { fraction: 0, score: 0, text: NO_INTEREST_CATEGORY, need: null }, story: null };
  const rows = f.interest.filter((r) => r.date <= a.today && (!a.from || r.date >= a.from));
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
  const story = (until: IsoDate): Story => ({ label: 'Interest, added up', lineCents, points: thin(points.filter((p) => p.date <= until)) });
  const fr = clamp01(run / lineCents);
  return {
    earned: on ? { date: on, sentence: `The interest you have earned added up to ${money(lineCents)} on ${longDate(on)}.`, story: story(on) } : null,
    blocked: null,
    progress: rows.length
      ? { fraction: fr, score: fr, text: `${money(run)} of ${money(lineCents)}`, need: `${money(Math.max(0, lineCents - run))} more interest` }
      : { fraction: 0, score: 0, text: 'No interest yet', need: 'Income in the Interest category counts.' },
    story: points.length ? story(a.today) : null,
  };
}

// ------------------------------------------------------------------ refilled after using it

export function emRefill(f: EmergencyFacts, a: RuleArgs): RuleOutcome {
  const days = f.savings.days;
  // Phase 0: waiting for a full 30-day hold. 1: full, waiting for a drop below 3 months. 2: dropped, refilling.
  let phase = 0;
  let run = 0;
  let fullStart = -1;
  let dropDay: IsoDate | null = null;
  let earned: { startIndex: number; endIndex: number; refillStart: IsoDate } | null = null;
  for (let i = 0; i < days.length && !earned; i++) {
    const d = days[i]!;
    if (a.from && d.date < a.from) continue;
    const full = covers(f, d, FULL_MONTHS);
    if (phase === 0) {
      run = full ? run + 1 : 0;
      if (run === HOLD_DAYS) {
        phase = 1;
        fullStart = i - HOLD_DAYS + 1;
        run = 0;
      }
    } else if (phase === 1) {
      const n = f.need(d.date);
      if (d.cents !== null && n !== null && d.cents < REFILL_LOW_MONTHS * n) {
        phase = 2;
        dropDay = d.date;
        run = 0;
      }
    } else {
      run = full ? run + 1 : 0;
      if (run === HOLD_DAYS) earned = { startIndex: fullStart, endIndex: i, refillStart: days[i - HOLD_DAYS + 1]!.date };
    }
  }
  let progress: Progress;
  if (!f.hasSavingsAccount || !last(days)) progress = NO_SAVINGS;
  else if (phase === 0)
    progress = {
      fraction: clamp01(run / HOLD_DAYS) / 3,
      score: clamp01(run / HOLD_DAYS) / 3,
      text: run ? `Full for ${run} of ${HOLD_DAYS} days` : 'Not full yet',
      need: `First a full fund: 6 months of spending covered for ${HOLD_DAYS} days in a row`,
    };
  else if (phase === 1)
    progress = {
      fraction: 1 / 3,
      score: 1 / 3,
      text: 'Your fund was full',
      need: 'This one is for after you use the fund: it counts once savings drop below 3 months and you build them back to 6.',
    };
  else
    progress = {
      fraction: 2 / 3 + clamp01(run / HOLD_DAYS) / 3,
      score: 2 / 3 + clamp01(run / HOLD_DAYS) / 3,
      text: run ? `Refilling: held ${run} of ${HOLD_DAYS} days` : `Used it on ${longDate(dropDay!)}`,
      need: `Back to 6 months covered for ${HOLD_DAYS} days in a row`,
    };
  const e = earned as { startIndex: number; endIndex: number; refillStart: IsoDate } | null;
  return {
    earned: e
      ? {
          date: days[e.endIndex]!.date,
          sentence: `Your emergency fund was full, you used it (below 3 months on ${longDate(dropDay!)}), and you built it back to 6 months for ${HOLD_DAYS} days in a row, ${fromTo(e.refillStart, days[e.endIndex]!.date)}.`,
          story: storyOf(days.slice(e.startIndex, e.endIndex + 1), 'Savings from full, to used, to full again', null),
        }
      : null,
    blocked: null,
    progress,
    story: days.length ? storyOf(days.slice(-180), 'Savings, last 6 months', null) : null,
  };
}
