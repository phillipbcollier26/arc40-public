/**
 * The 30-day rule (pure). A balance trophy is earned only after its value stays at or above the line for
 * 30 days in a row; the earned date is the 30th day.
 *
 * Input is one entry per calendar day, with no gaps (see data.ts). A day with no value (before any data)
 * never counts. Days with no new transactions carry the last known balance, because that is how the net
 * worth series works (latest balance + transactions since), so they count like any other day.
 *
 * Example (line $1,000): values 1000, 1000, ..., 1000 for 30 days -> earned on day 30 (exactly at the line
 * counts). 999.99 on day 15 restarts the count: day 16 is day 1 again.
 */
import type { IsoDate } from '../../../../shared/dates.js';

export const HOLD_DAYS = 30;

export interface Day {
  date: IsoDate;
  /** Value at the end of the day; null = no data yet. */
  cents: number | null;
}

export interface HoldResult {
  /** The FIRST run that reached `need` days. */
  earned: { start: IsoDate; end: IsoDate; startIndex: number; endIndex: number } | null;
  /** Length of the run that ends on the last day (0 when the last day fails). */
  current: number;
}

export interface HoldOptions {
  /** Days before this date never count (Start from today). */
  from?: IsoDate | null;
  need?: number;
  /** Start a new count on this day even if the day before passed (e.g. Jan 1 for "up in a year"). */
  resetOn?: (day: Day, index: number) => boolean;
}

export function firstHold(days: readonly Day[], ok: (day: Day, index: number) => boolean, opts: HoldOptions = {}): HoldResult {
  const need = opts.need ?? HOLD_DAYS;
  let run = 0;
  let earned: HoldResult['earned'] = null;
  days.forEach((d, i) => {
    if (opts.resetOn?.(d, i)) run = 0;
    const pass = d.cents !== null && (!opts.from || d.date >= opts.from) && ok(d, i);
    run = pass ? run + 1 : 0;
    if (!earned && run === need) earned = { start: days[i - need + 1]!.date, end: d.date, startIndex: i - need + 1, endIndex: i };
  });
  return { earned, current: run };
}

/** Every calendar day from `from` through `to`, both included. */
export function everyDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  const start = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const end = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  for (let t = start; t <= end; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** At most `max` points, always keeping the first and last (for small close-up charts). */
export function thin<T>(xs: readonly T[], max = 120): T[] {
  if (xs.length <= max) return [...xs];
  const step = (xs.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => xs[Math.round(i * step)]!);
}
