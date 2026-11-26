/**
 * Roth pace planner (V2 Phase 3). Pure functions, integer cents.
 *
 * For one tax year Y with a saved limit and deadline:
 *   window     Jan 1 of Y through the deadline (usually April 15 of Y + 1)
 *   ideal line straight from $0 on Jan 1 to the limit on the deadline, by days, rounded half away from
 *              zero to the cent (the IRS window opens on Jan 1, so that is where the pace starts)
 *   month of pace  limit / (calendar months from January of Y through the deadline's month, both counted);
 *              2026 with an April 15, 2027 deadline = 16 months, $7,500 / 16 = $468.75
 *   status     gap = ideal today - contributed so far, measured in months of pace:
 *                within half a month either way      -> on_pace        (gold)
 *                more than half a month ahead        -> ahead          (gold)
 *                half a month to 2 months behind     -> behind_slightly (bronze)
 *                more than 2 months behind           -> behind_well    (garnet)
 *              the limit reached = maxed (gold); after the deadline = closed (final result, no pace)
 *   needed per month  what is left / months from this month through the deadline's month (both counted),
 *              rounded UP to the cent so following it always gets there
 *   two targets  the IRS limit, and the lower of the limit and earned income so far (the IRS caps
 *              contributions at what you earned from work). Earned income uses the existing rule.
 */
import type { IsoDate } from '../../../shared/dates.js';
import type { Cents } from './money.js';

export type PaceStatus = 'maxed' | 'ahead' | 'on_pace' | 'behind_slightly' | 'behind_well' | 'closed' | 'not_started';

export interface PaceInput {
  year: number;
  limitCents: Cents;
  deadline: IsoDate;
  today: IsoDate;
  /** Contributions counted toward this tax year (any date), whole cents, positive. */
  contributions: readonly { date: IsoDate; amountCents: Cents }[];
  earnedCents: Cents;
}

export interface PaceTarget {
  targetCents: Cents;
  leftCents: Cents;
  /** Per month from now through the deadline month; null once the window is closed. */
  neededPerMonthCents: Cents | null;
}

export interface RothPace {
  status: PaceStatus;
  start: IsoDate;
  deadline: IsoDate;
  contributedCents: Cents;
  idealTodayCents: Cents;
  /** ideal today - contributed (positive = behind). */
  gapCents: Cents;
  monthOfPaceCents: Cents;
  totalMonths: number;
  monthsLeft: number;
  limit: PaceTarget;
  /** min(limit, earned so far). */
  earned: PaceTarget;
  /** Over the earned-income cap so far (contributed > earned). */
  overEarned: boolean;
  /** Cumulative contributions: one point at Jan 1, one per contribution date, one at today (or the deadline). */
  actual: { date: IsoDate; cents: Cents }[];
  ideal: { date: IsoDate; cents: Cents }[];
}

const dayNum = (d: IsoDate) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000;
const monthNum = (d: IsoDate) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;

/** a / b rounded half away from zero (b > 0), integers only. */
function divRound(a: number, b: number): number {
  const q = Math.trunc(a / b);
  const r = a - q * b;
  if (Math.abs(r) * 2 >= b) return a < 0 ? q - 1 : q + 1;
  return q;
}
const ceilDiv = (a: number, b: number) => (a <= 0 ? 0 : Math.floor((a + b - 1) / b));

/** The ideal line's value on `date`: $0 on Jan 1, the limit on the deadline, straight by days. */
export function idealOn(limitCents: Cents, start: IsoDate, deadline: IsoDate, date: IsoDate): Cents {
  const total = dayNum(deadline) - dayNum(start);
  const done = Math.min(Math.max(dayNum(date) - dayNum(start), 0), total);
  if (total <= 0) return limitCents;
  return divRound(limitCents * done, total);
}

/** Months from this month through the deadline's month, both counted (0 once the deadline has passed). */
export function monthsLeft(today: IsoDate, deadline: IsoDate): number {
  if (today > deadline) return 0;
  return monthNum(deadline) - monthNum(today) + 1;
}

/** Which status a gap (ideal - contributed, cents) gets, comparing in months of pace without rounding. */
export function paceStatus(gapCents: Cents, limitCents: Cents, totalMonths: number): Exclude<PaceStatus, 'maxed' | 'closed' | 'not_started'> {
  // gap / (limit / totalMonths) compared with 1/2 and 2  ->  gap * totalMonths * 2 compared with limit and 4 * limit
  const scaled = gapCents * totalMonths * 2;
  if (scaled < -limitCents) return 'ahead';
  if (scaled <= limitCents) return 'on_pace';
  if (scaled <= 4 * limitCents) return 'behind_slightly';
  return 'behind_well';
}

export function rothPace(input: PaceInput): RothPace {
  const { year, limitCents, deadline, today, earnedCents } = input;
  if (!Number.isInteger(limitCents) || limitCents <= 0) throw new RangeError('limit must be positive whole cents');
  const start = `${year}-01-01`;
  const totalMonths = monthNum(deadline) - monthNum(start) + 1;
  const contributions = [...input.contributions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const contributed = contributions.filter((c) => c.date <= today).reduce((s, c) => s + c.amountCents, 0);
  const left = monthsLeft(today, deadline);
  const closed = today > deadline;
  const ideal = idealOn(limitCents, start, deadline, today);
  const gap = ideal - contributed;
  const earnedTarget = Math.min(limitCents, Math.max(earnedCents, 0));

  const target = (t: Cents): PaceTarget => {
    const leftCents = Math.max(0, t - contributed);
    return { targetCents: t, leftCents, neededPerMonthCents: closed ? null : left > 0 ? ceilDiv(leftCents, left) : 0 };
  };

  let status: PaceStatus;
  if (contributed >= limitCents) status = 'maxed';
  else if (closed) status = 'closed';
  else if (today < start) status = 'not_started';
  else status = paceStatus(gap, limitCents, totalMonths);

  // Chart points: cumulative contributions (a step at each date), clipped to the window and today.
  const end = closed ? deadline : today < start ? start : today;
  const actual: { date: IsoDate; cents: Cents }[] = [{ date: start, cents: 0 }];
  let run = 0;
  for (const c of contributions) {
    if (c.date > end) break;
    run += c.amountCents;
    const d = c.date < start ? start : c.date;
    const last = actual[actual.length - 1]!;
    if (last.date === d) last.cents = run;
    else actual.push({ date: d, cents: run });
  }
  if (actual[actual.length - 1]!.date !== end) actual.push({ date: end, cents: run });

  return {
    status,
    start,
    deadline,
    contributedCents: contributed,
    idealTodayCents: ideal,
    gapCents: gap,
    monthOfPaceCents: divRound(limitCents, totalMonths),
    totalMonths,
    monthsLeft: left,
    limit: target(limitCents),
    earned: target(earnedTarget),
    overEarned: contributed > earnedTarget && earnedTarget < limitCents,
    actual,
    ideal: [
      { date: start, cents: 0 },
      { date: deadline, cents: limitCents },
    ],
  };
}
