/**
 * Net worth trophies (pure). Input: the daily net worth series (one entry per day, data.ts).
 *
 *   nw_hold        net worth at or above the line for 30 days in a row; earned on day 30
 *   nw_year_gain   gain = net worth on the day - net worth on Dec 31 of the year before (the start of Jan 1,
 *                  same as Wrapped's net worth slide); at or above the line for 30 days in a row INSIDE that year
 *                  (the count restarts on Jan 1). A year with no value on Dec 31 before it never counts.
 *   nw_high        month ends only (a month counts once it has ended, i.e. its last day is before today). A month
 *                  end above EVERY earlier month end, with at least 3 earlier month ends, is a record. Earned on
 *                  the first record; later records are added to the plaque.
 *   nw_best_year   growth of a complete year Y = Dec 31 of Y - Dec 31 of Y-1 (both needed). A year that beats
 *                  every earlier complete year (at least one) is a record; earned on the first, dated Dec 31.
 *   nw_comeback    the high so far is the peak (above $0); net worth falls to 90% of the peak or less (a 10% dip),
 *                  then stays ABOVE that old high for 30 days in a row; earned on day 30.
 * Start from today: only days on or after the turn-on day count (holds, records and the comeback story).
 */
import { addDays, endOfMonth, type IsoDate } from '../../../../shared/dates.js';
import type { DailySeries } from './data.js';
import { clamp01, fromTo, longDate, money, monthName, monthOnly } from './format.js';
import { firstHold, HOLD_DAYS, thin, type Day } from './hold.js';
import type { Progress, RecordEntry, RuleArgs, RuleOutcome, Story } from './types.js';

const NO_DATA: Progress = { fraction: 0, score: 0, text: 'No balances yet', need: 'Add an account or import a file.' };

function last(days: readonly Day[]): Day | null {
  return days.length ? days[days.length - 1]! : null;
}

function storyOf(days: readonly Day[], label: string, lineCents: number | null): Story {
  return { label, lineCents, points: thin(days.filter((d) => d.cents !== null).map((d) => ({ date: d.date, cents: d.cents! }))) };
}

/** Progress of a hold: below the line -> amount of line; at/above -> days held. */
export function holdProgress(value: number | null, lineCents: number, held: number, what: string): Progress {
  if (value === null) return NO_DATA;
  if (held >= HOLD_DAYS)
    return { fraction: 1, score: 2, text: `Held ${HOLD_DAYS} of ${HOLD_DAYS} days`, need: 'Ready: it is earned at the next check.' };
  if (held > 0)
    return {
      fraction: clamp01(held / HOLD_DAYS),
      score: 1 + held / HOLD_DAYS,
      text: `Held ${held} of ${HOLD_DAYS} days`,
      need: `${HOLD_DAYS - held} more ${HOLD_DAYS - held === 1 ? 'day' : 'days'} at or above ${money(lineCents)}`,
    };
  const f = lineCents > 0 ? clamp01(value / lineCents) : 0;
  return {
    fraction: f,
    score: f,
    text: `${money(value)} of ${money(lineCents)}`,
    need: `${money(Math.max(0, lineCents - value))} more ${what}, then ${HOLD_DAYS} days in a row at or above ${money(lineCents)}`,
  };
}

export function nwHold(series: DailySeries, lineCents: number, a: RuleArgs): RuleOutcome {
  const days = series.days;
  const h = firstHold(days, (d) => d.cents! >= lineCents, { from: a.from });
  const now = last(days);
  const earned = h.earned
    ? {
        date: h.earned.end,
        sentence: `Your net worth stayed at or above ${money(lineCents)} for ${HOLD_DAYS} days in a row, ${fromTo(h.earned.start, h.earned.end)}.`,
        story: storyOf(days.slice(h.earned.startIndex, h.earned.endIndex + 1), 'Net worth each day of the hold', lineCents),
      }
    : null;
  return {
    earned,
    blocked: null,
    progress: holdProgress(now?.cents ?? null, lineCents, h.current, 'net worth'),
    story: storyOf(days.slice(-60), 'Net worth, last 60 days', lineCents),
  };
}

/** Net worth at the start of `year` (= end of Dec 31 before it). */
export function yearStart(series: DailySeries, year: number): number | null {
  return series.on(`${year - 1}-12-31`);
}

export function nwYearGain(series: DailySeries, lineCents: number, a: RuleArgs): RuleOutcome {
  const days = series.days;
  const starts = new Map<number, number | null>();
  const startOf = (y: number) => {
    if (!starts.has(y)) starts.set(y, yearStart(series, y));
    return starts.get(y)!;
  };
  const gain = (d: Day): number | null => {
    const s = startOf(Number(d.date.slice(0, 4)));
    return s === null || d.cents === null ? null : d.cents - s;
  };
  const h = firstHold(days, (d) => (gain(d) ?? -Infinity) >= lineCents, { from: a.from, resetOn: (d) => d.date.endsWith('-01-01') });
  const thisYear = Number(a.today.slice(0, 4));
  const now = last(days);
  const g = now && now.date.startsWith(String(thisYear)) ? gain(now) : null;
  const gainDays = (from: number, to: number): Day[] => days.slice(from, to + 1).map((d) => ({ date: d.date, cents: gain(d) }));

  let progress: Progress;
  if (!now) progress = NO_DATA;
  else if (g === null)
    progress = { fraction: 0, score: 0, text: `No balance for Dec 31, ${thisYear - 1}`, need: `This year cannot count. It starts again on Jan 1, ${thisYear + 1}.` };
  else progress = holdProgress(g, lineCents, h.current, `growth this year`);
  if (g !== null && h.current === 0) progress.text = `Up ${money(Math.max(0, g))} of ${money(lineCents)} this year`;

  const yearIdx = days.findIndex((d) => d.date === `${thisYear}-01-01`);
  return {
    earned: h.earned
      ? {
          date: h.earned.end,
          sentence: `Your net worth stayed at least ${money(lineCents)} above where ${h.earned.end.slice(0, 4)} started for ${HOLD_DAYS} days in a row, ${fromTo(h.earned.start, h.earned.end)}.`,
          story: storyOf(gainDays(h.earned.startIndex, h.earned.endIndex), 'Growth since Jan 1, each day of the hold', lineCents),
        }
      : null,
    blocked: null,
    progress,
    story: yearIdx >= 0 ? storyOf(gainDays(yearIdx, days.length - 1), `Growth since Jan 1, ${thisYear}`, lineCents) : null,
  };
}

/** Month ends that have ended (before today) and have a value, oldest first. */
export function monthEnds(series: DailySeries, today: IsoDate): { date: IsoDate; cents: number }[] {
  const out: { date: IsoDate; cents: number }[] = [];
  const days = series.days;
  if (!days.length) return out;
  for (let d = endOfMonth(days[0]!.date); d < today; d = endOfMonth(addDays(d, 1))) {
    const v = series.on(d);
    if (v !== null) out.push({ date: d, cents: v });
  }
  return out;
}

/** Records among `points`: a point above every earlier one, with at least `minEarlier` earlier points. */
function records(points: readonly { date: IsoDate; cents: number }[], minEarlier: number, from: IsoDate | null, period: (d: IsoDate) => string): RecordEntry[] {
  const out: RecordEntry[] = [];
  let best = -Infinity;
  points.forEach((p, i) => {
    const isRecord = i >= minEarlier && p.cents > best;
    if (isRecord && (!from || p.date >= from)) out.push({ period: period(p.date), amountCents: p.cents, setOn: p.date });
    best = Math.max(best, p.cents);
  });
  return out;
}

export function nwHigh(series: DailySeries, a: RuleArgs): RuleOutcome {
  const ends = monthEnds(series, a.today);
  const recs = records(ends, 3, a.from, (d) => d.slice(0, 7));
  const first = recs[0];
  const best = ends.reduce((m, p) => Math.max(m, p.cents), -Infinity);
  const now = last(series.days);
  let progress: Progress;
  if (!now || now.cents === null) progress = NO_DATA;
  else if (ends.length < 3)
    progress = { fraction: ends.length / 4, score: ends.length / 4, text: `${ends.length} of 3 month ends so far`, need: 'Needs 3 month ends of history, then a month end above all of them.' };
  else if (now.cents > best)
    progress = {
      fraction: 1,
      score: 1,
      text: `Today ${money(now.cents)}, above your best month end. Counts if ${monthOnly(a.today)} ends there.`,
      need: `Your best month end so far: ${money(best)}.`,
    };
  else
    progress = {
      fraction: best > 0 ? clamp01(now.cents / best) : 0,
      score: best > 0 ? clamp01(now.cents / best) : 0,
      text: `Today ${money(now.cents)}, best month end ${money(best)}`,
      need: `${money(best - now.cents + 1)} more by a month end`,
    };
  return {
    earned: first
      ? {
          date: first.setOn,
          sentence: `Your net worth ended ${monthName(first.setOn)} at ${money(first.amountCents)}, higher than any month end before it.`,
          story: { label: 'Net worth at each month end', lineCents: null, points: thin(ends.filter((p) => p.date <= first.setOn).slice(-24)) },
        }
      : null,
    blocked: null,
    records: recs,
    progress,
    story: { label: 'Net worth at each month end', lineCents: null, points: ends.slice(-24) },
  };
}

/** Growth of each complete year (Dec 31 of Y - Dec 31 of Y-1), oldest first. */
export function yearGrowths(series: DailySeries, today: IsoDate): { year: number; date: IsoDate; cents: number }[] {
  const days = series.days;
  if (!days.length) return [];
  const out: { year: number; date: IsoDate; cents: number }[] = [];
  for (let y = Number(days[0]!.date.slice(0, 4)); `${y}-12-31` < today; y++) {
    const s = series.on(`${y - 1}-12-31`);
    const e = series.on(`${y}-12-31`);
    if (s !== null && e !== null) out.push({ year: y, date: `${y}-12-31`, cents: e - s });
  }
  return out;
}

export function nwBestYear(series: DailySeries, a: RuleArgs): RuleOutcome {
  const ys = yearGrowths(series, a.today);
  const recs = records(
    ys.map((y) => ({ date: y.date, cents: y.cents })),
    1,
    a.from,
    (d) => d.slice(0, 4),
  );
  const first = recs[0];
  const best = ys.reduce((m, y) => Math.max(m, y.cents), -Infinity);
  const thisYear = Number(a.today.slice(0, 4));
  const start = yearStart(series, thisYear);
  const now = last(series.days);
  const soFar = start !== null && now?.cents != null ? now.cents - start : null;
  let progress: Progress;
  if (!now) progress = NO_DATA;
  else if (!ys.length)
    progress = { fraction: 0, score: 0, text: 'No full year yet', need: 'Needs a full year to compare with, then a full year that grows more.' };
  else
    progress = {
      fraction: soFar !== null && best > 0 ? clamp01(soFar / best) : 0,
      score: soFar !== null && best > 0 ? clamp01(soFar / best) : 0,
      text:
        soFar !== null && soFar > best
          ? `${thisYear} so far ${money(soFar)}, ahead of your best year. Counts on Dec 31 if it stays ahead.`
          : `${thisYear} so far ${soFar === null ? 'not counted' : money(soFar)}, best full year ${money(best)}`,
      need: soFar === null ? null : soFar > best ? `Your best full year: ${money(best)}.` : `${money(best - soFar + 1)} more growth by Dec 31`,
    };
  const pts = ys.map((y) => ({ date: y.date, cents: y.cents }));
  return {
    earned: first
      ? {
          date: first.setOn,
          sentence: `Your net worth grew ${money(first.amountCents)} in ${first.period}, more than in any full year before it.`,
          story: { label: 'Growth in each full year', lineCents: null, points: pts.filter((p) => p.date <= first.setOn) },
        }
      : null,
    blocked: null,
    records: recs,
    progress,
    story: { label: 'Growth in each full year', lineCents: null, points: pts },
  };
}

export function nwComeback(series: DailySeries, a: RuleArgs): RuleOutcome {
  const days = series.days;
  let peak: { cents: number; index: number } | null = null;
  let dip: { high: number; highIndex: number; low: number; lowDate: IsoDate } | null = null;
  let run = 0;
  let earned: RuleOutcome['earned'] = null;
  for (let i = 0; i < days.length && !earned; i++) {
    const d = days[i]!;
    if (d.cents === null || (a.from && d.date < a.from)) continue;
    const v = d.cents;
    if (!dip) {
      if (!peak || v > peak.cents) peak = { cents: v, index: i };
      else if (peak.cents > 0 && v * 10 <= peak.cents * 9) dip = { high: peak.cents, highIndex: peak.index, low: v, lowDate: d.date };
      continue;
    }
    if (v < dip.low) {
      dip.low = v;
      dip.lowDate = d.date;
    }
    run = v > dip.high ? run + 1 : 0;
    if (run === HOLD_DAYS)
      earned = {
        date: d.date,
        sentence: `Your net worth fell to ${money(dip.low)} on ${longDate(dip.lowDate)}, at least 10% below its high of ${money(dip.high)}, then stayed above that high for ${HOLD_DAYS} days in a row until ${longDate(d.date)}.`,
        story: storyOf(days.slice(dip.highIndex, i + 1), 'From the old high, through the dip, back above it', dip.high),
      };
  }
  const now = last(days);
  let progress: Progress;
  if (!now || now.cents === null) progress = NO_DATA;
  else if (!dip)
    progress = {
      fraction: 0,
      score: 0,
      text: peak ? `High so far ${money(peak.cents)}` : 'No high yet',
      need: 'Needs a dip of 10% or more below the high first, then a climb back above it.',
    };
  else if (run > 0)
    progress = {
      fraction: clamp01(run / HOLD_DAYS),
      score: 1 + run / HOLD_DAYS,
      text: `Back above ${money(dip.high)}: held ${run} of ${HOLD_DAYS} days`,
      need: `${HOLD_DAYS - run} more days above ${money(dip.high)}`,
    };
  else
    progress = {
      fraction: clamp01(now.cents / dip.high),
      score: clamp01(now.cents / dip.high),
      text: `${money(now.cents)} of ${money(dip.high)} (the old high)`,
      need: `${money(dip.high - now.cents + 1)} more to pass the old high, then ${HOLD_DAYS} days above it`,
    };
  return {
    earned,
    blocked: null,
    progress,
    story: dip ? storyOf(days.slice(dip.highIndex), 'Since the old high', dip.high) : storyOf(days.slice(-90), 'Net worth, last 90 days', null),
  };
}
