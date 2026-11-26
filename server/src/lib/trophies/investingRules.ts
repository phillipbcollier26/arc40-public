/**
 * Investing trophies (Trophies Round 2), pure. Input: InvestFacts (data.ts), built only from what the screens use:
 *   worth    every investment account's balance each day (the net worth series: Accounts, Dashboard)
 *   growth   value - money put in (moneyIn) of the accounts WITH Fidelity history, each day (the Investments page)
 *   putIn    money put in so far, same accounts
 *   cash     the Dashboard's Cash group (checking, savings, cash, other) added with its real sign
 *   moneyIn  net money put in, row by row (Fidelity rows; for accounts without history, their transfers)
 *   funds    funds held at the end of each day, money market / core positions left out, 0.001 shares or more
 *
 *   inv_worth_hold            investments at or above the line, 30 days in a row; earned on day 30
 *   inv_growth_hold           growth at or above the line, 30 days in a row
 *   inv_pass_cash             investments above $0 AND above all cash together, 30 days in a row
 *   inv_growth_beats_put_in   growth above all money put in (put in above $0), 30 days in a row
 *   inv_month_streak          calendar months in a row with net money put in above $0. A finished month with $0 or
 *                             less breaks the run. The current month counts once money has gone in; until then it
 *                             neither counts nor breaks. Earned on the day the Nth month's total last rose above $0.
 *   inv_first_share           the first day a fund is held
 *   inv_funds                 the first day `count` different funds are held at the same time
 *   inv_down_month            a FINISHED month where market moves (growth at the month end - growth at the end of the
 *                             month before) lost at least 5% of the value at the end of the month before (above $0),
 *                             and net money put in that month was above $0. Earned on that month end. Whole cents:
 *                             -move x 100 >= 5 x start, so 4.99% fails and 5.00% passes. A month whose first or last
 *                             day has no price data at all is skipped.
 *   inv_growth_beats_spending a FINISHED calendar year where growth (growth on Dec 31 - growth on the Dec 31 before)
 *                             was above that year's spending (above $0). Earned on Dec 31. Start from today: the year
 *                             must end on or after the turn-on day.
 *   inv_best_day              record plaque: market gain (growth change) from the weekday before (Friday for a
 *                             Monday) to the day. Both days must have a price dated that exact day for every fund
 *                             held (never estimated or carried) and no estimated or stale state. A record
 *                             beats every earlier gain and is above $0; earned on the first record at least 3 months
 *                             after the first day of investment history.
 * Start from today (holds, events): only days, months and records on or after the turn-on day count.
 */
import { addDays, addMonths, endOfMonth, type IsoDate } from '../../../../shared/dates.js';
import type { PriceState } from '../valuation.js';
import type { DailySeries } from './data.js';
import { clamp01, fromTo, longDate, money, monthName } from './format.js';
import { firstHold, HOLD_DAYS, thin, type Day } from './hold.js';
import { holdProgress } from './netWorthRules.js';
import type { Progress, RecordEntry, RuleArgs, RuleOutcome, Story } from './types.js';

export interface InvestFacts {
  worth: DailySeries;
  cash: DailySeries;
  growth: DailySeries;
  putIn: DailySeries;
  moneyIn: { date: IsoDate; cents: number }[];
  /** Every day from the first Fidelity row to today: funds held (money market left out). */
  funds: { date: IsoDate; symbols: string[] }[];
  /** Every symbol with shares at the end of a day (money market included). */
  heldOn(date: IsoDate): string[];
  /** A price dated exactly that day (from a file or a trade). */
  realClose(symbol: string, date: IsoDate): boolean;
  /** Price state of the accounts with history that day (null = nothing valued). */
  priceState(date: IsoDate): PriceState | null;
  yearSpending(year: number): number;
}

/** Fidelity core positions and money market funds: cash, not a fund. */
export const CORE_SYMBOLS: ReadonlySet<string> = new Set(['SPAXX', 'FDRXX', 'FZFXX', 'SPRXX', 'FZDXX', 'FCASH', 'CORE']);
export function isMoneyMarket(symbol: string, name: string): boolean {
  const s = symbol.toUpperCase().trim();
  return s.endsWith('**') || CORE_SYMBOLS.has(s.replace(/\*+$/, '')) || /MONEY MARKET/i.test(name);
}

const NOTHING: Progress = { fraction: 0, score: 0, text: 'No investments yet', need: 'Add an investment account or import its Fidelity history.' };

function lastValue(days: readonly Day[]): number | null {
  for (let i = days.length - 1; i >= 0; i--) if (days[i]!.cents !== null) return days[i]!.cents;
  return null;
}
function storyOf(days: readonly Day[], label: string, lineCents: number | null): Story {
  return { label, lineCents, points: thin(days.filter((d) => d.cents !== null).map((d) => ({ date: d.date, cents: d.cents! }))) };
}
/** "6.2%" from basis points (integer math). */
function pct(bp: number): string {
  return `${Math.floor(bp / 100)}.${Math.floor((bp % 100) / 10)}%`;
}

function holdRule(
  series: DailySeries,
  lineCents: number,
  a: RuleArgs,
  what: { sentence: string; label: string; need: string },
): RuleOutcome {
  const days = series.days;
  const h = firstHold(days, (d) => d.cents! >= lineCents, { from: a.from });
  const now = lastValue(days);
  return {
    earned: h.earned
      ? {
          date: h.earned.end,
          sentence: `${what.sentence} stayed at or above ${money(lineCents)} for ${HOLD_DAYS} days in a row, ${fromTo(h.earned.start, h.earned.end)}.`,
          story: storyOf(days.slice(h.earned.startIndex, h.earned.endIndex + 1), `${what.label} each day of the hold`, lineCents),
        }
      : null,
    blocked: null,
    progress: now === null ? NOTHING : holdProgress(now, lineCents, h.current, what.need),
    story: days.length ? storyOf(days.slice(-60), `${what.label}, last 60 days`, lineCents) : null,
  };
}

export function invWorthHold(f: InvestFacts, lineCents: number, a: RuleArgs): RuleOutcome {
  return holdRule(f.worth, lineCents, a, { sentence: 'Your investments', label: 'Investments', need: 'in investments' });
}

export function invGrowthHold(f: InvestFacts, lineCents: number, a: RuleArgs): RuleOutcome {
  return holdRule(f.growth, lineCents, a, { sentence: 'Your investment growth (value minus money put in)', label: 'Growth', need: 'growth' });
}

/** A 30-day hold of "a beats b" (both values each day). */
function beatsRule(
  days: readonly Day[],
  other: (date: IsoDate) => number | null,
  ok: (mine: number, theirs: number) => boolean,
  a: RuleArgs,
  w: { sentence: (start: IsoDate, end: IsoDate) => string; label: string; mine: string; theirs: string; need: string },
): RuleOutcome {
  const h = firstHold(days, (d) => {
    const o = other(d.date);
    return o !== null && ok(d.cents!, o);
  }, { from: a.from });
  const lastDay = [...days].reverse().find((d) => d.cents !== null);
  let progress: Progress;
  if (!lastDay) progress = NOTHING;
  else {
    const mine = lastDay.cents!;
    const theirs = other(lastDay.date) ?? 0;
    if (h.current > 0)
      progress = {
        fraction: clamp01(h.current / HOLD_DAYS),
        score: 1 + h.current / HOLD_DAYS,
        text: `Held ${h.current} of ${HOLD_DAYS} days`,
        need: h.current >= HOLD_DAYS ? 'Ready: it is earned at the next check.' : `${HOLD_DAYS - h.current} more days ${w.need}`,
      };
    else {
      const fr = theirs > 0 ? clamp01(mine / theirs) : 0;
      progress = { fraction: fr, score: fr, text: `${w.mine} ${money(mine)}, ${w.theirs} ${money(theirs)}`, need: `Then ${HOLD_DAYS} days in a row ${w.need}` };
    }
  }
  return {
    earned: h.earned ? { date: h.earned.end, sentence: w.sentence(h.earned.start, h.earned.end), story: storyOf(days.slice(h.earned.startIndex, h.earned.endIndex + 1), w.label, null) } : null,
    blocked: null,
    progress,
    story: storyOf(days.slice(-60), `${w.label}, last 60 days`, null),
  };
}

export function invPassCash(f: InvestFacts, a: RuleArgs): RuleOutcome {
  return beatsRule(f.worth.days, (d) => f.cash.on(d), (inv, cash) => inv > 0 && inv > cash, a, {
    sentence: (s, e) => `Your investments were worth more than all your cash together for ${HOLD_DAYS} days in a row, ${fromTo(s, e)}.`,
    label: 'Investments',
    mine: 'Investments',
    theirs: 'cash',
    need: 'with investments above all your cash',
  });
}

export function invGrowthBeatsPutIn(f: InvestFacts, a: RuleArgs): RuleOutcome {
  return beatsRule(f.growth.days, (d) => f.putIn.on(d), (g, p) => p > 0 && g > p, a, {
    sentence: (s, e) => `Your investment growth was bigger than all the money you had put in for ${HOLD_DAYS} days in a row, ${fromTo(s, e)}.`,
    label: 'Growth',
    mine: 'Growth',
    theirs: 'put in',
    need: 'with growth above the money put in',
  });
}

export interface MonthTotal {
  month: string;
  total: number;
  /** The day the month's running total last rose above $0. */
  upOn: IsoDate | null;
}

export function monthTotals(rows: readonly { date: IsoDate; cents: number }[], from: IsoDate | null): Map<string, MonthTotal> {
  const out = new Map<string, MonthTotal>();
  for (const r of rows) {
    if (from && r.date < from) continue;
    const m = r.date.slice(0, 7);
    const cur = out.get(m) ?? { month: m, total: 0, upOn: null };
    const before = cur.total;
    cur.total += r.cents;
    if (before <= 0 && cur.total > 0) cur.upOn = r.date;
    out.set(m, cur);
  }
  return out;
}

/** Every 'YYYY-MM' from a to b, both included. */
export function monthsBetween(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = `${a}-01`; d.slice(0, 7) <= b; d = addMonths(d, 1)) out.push(d.slice(0, 7));
  return out;
}

/**
 * Months in a row where a monthly total is above $0. Finished months with $0 or less break the run; the current
 * month counts once its total is above $0 and otherwise is skipped. Returns the first time the run reached `need`
 * (the day that month's total last rose above $0) and the current run.
 */
export function monthStreak(
  totals: ReadonlyMap<string, MonthTotal>,
  first: string | null,
  today: IsoDate,
  need: number,
): { earned: { month: string; date: IsoDate; startMonth: string } | null; current: number; thisMonthCounted: boolean } {
  const thisMonth = today.slice(0, 7);
  let run = 0;
  let earned: { month: string; date: IsoDate; startMonth: string } | null = null;
  let counted = false;
  if (!first) return { earned, current: 0, thisMonthCounted: false };
  const months = monthsBetween(first, thisMonth);
  months.forEach((m, i) => {
    const t = totals.get(m);
    const ok = !!t && t.total > 0;
    if (m === thisMonth && !ok) return; // not over yet: neither counts nor breaks
    run = ok ? run + 1 : 0;
    if (m === thisMonth) counted = ok;
    if (!earned && run === need) earned = { month: m, date: t!.upOn!, startMonth: months[i - need + 1]! };
  });
  return { earned, current: run, thisMonthCounted: counted };
}

function monthEnd(m: string, today: IsoDate): IsoDate {
  const e = endOfMonth(`${m}-01`);
  return e < today ? e : today;
}

export function invMonthStreak(f: InvestFacts, need: number, a: RuleArgs): RuleOutcome {
  const totals = monthTotals(f.moneyIn.filter((r) => r.date <= a.today), a.from);
  const first = [...totals.keys()].sort()[0] ?? null;
  const s = monthStreak(totals, first, a.today, need);
  const story = (until: string): Story => ({
    label: 'Net money put in each month',
    lineCents: null,
    points: (first ? monthsBetween(first, until) : []).slice(-24).map((m) => ({ date: monthEnd(m, a.today), cents: totals.get(m)?.total ?? 0 })),
  });
  const left = need - s.current;
  return {
    earned: s.earned
      ? {
          date: s.earned.date,
          sentence: `You put money into your investments every month for ${need} months in a row, ${monthName(s.earned.startMonth)} to ${monthName(s.earned.month)}.`,
          story: story(s.earned.month),
        }
      : null,
    blocked: null,
    progress: first
      ? {
          fraction: clamp01(s.current / need),
          score: clamp01(s.current / need),
          text: `${s.current} of ${need} months in a row`,
          need: s.thisMonthCounted ? `${left} more ${left === 1 ? 'month' : 'months'} in a row` : 'Put money in this month to keep the run going',
        }
      : { fraction: 0, score: 0, text: 'Nothing put in yet', need: `Put money into your investments ${need} months in a row` },
    story: first ? story(a.today.slice(0, 7)) : null,
  };
}

export function invFirstShare(f: InvestFacts, a: RuleArgs): RuleOutcome {
  const d = f.funds.find((x) => x.symbols.length > 0 && (!a.from || x.date >= a.from));
  return {
    earned: d ? { date: d.date, sentence: `You first held shares on ${longDate(d.date)}: ${d.symbols.join(', ')}.`, story: null } : null,
    blocked: null,
    progress: { fraction: 0, score: 0, text: 'No shares yet', need: 'Buy any fund (money market cash does not count).' },
    story: null,
  };
}

export function invFunds(f: InvestFacts, count: number, a: RuleArgs): RuleOutcome {
  const d = f.funds.find((x) => x.symbols.length >= count && (!a.from || x.date >= a.from));
  const now = f.funds.length ? f.funds[f.funds.length - 1]!.symbols : [];
  const fr = clamp01(now.length / count);
  return {
    earned: d ? { date: d.date, sentence: `On ${longDate(d.date)} you held ${d.symbols.length} different funds at once: ${d.symbols.join(', ')}.`, story: null } : null,
    blocked: null,
    progress: {
      fraction: fr,
      score: fr,
      text: `${now.length} of ${count} funds${now.length ? ` (${now.join(', ')})` : ''}`,
      need: now.length >= count ? 'Ready: it is earned at the next check.' : `${count - now.length} more ${count - now.length === 1 ? 'fund' : 'funds'} held at the same time`,
    },
    story: null,
  };
}

/** Growth on a date; before the first Fidelity row there is nothing invested, so growth is $0. */
function growthOn(f: InvestFacts, date: IsoDate): number | null {
  const v = f.growth.on(date);
  if (v !== null) return v;
  const first = f.growth.days.find((d) => d.cents !== null)?.date;
  return first && date < first ? 0 : null;
}
const valueOn = (f: InvestFacts, date: IsoDate): number | null => {
  const g = f.growth.on(date);
  const p = f.putIn.on(date);
  return g === null || p === null ? null : g + p;
};

export function invDownMonth(f: InvestFacts, a: RuleArgs): RuleOutcome {
  const firstDay = f.growth.days.find((d) => d.cents !== null)?.date;
  let earned: RuleOutcome['earned'] = null;
  let worst: { month: string; bp: number } | null = null;
  const pts: { date: IsoDate; cents: number }[] = [];
  if (firstDay) {
    for (const m of monthsBetween(firstDay.slice(0, 7), a.today.slice(0, 7))) {
      const end = endOfMonth(`${m}-01`);
      if (end >= a.today) break; // only finished months
      const start = addDays(`${m}-01`, -1);
      const sv = valueOn(f, start);
      const ev = valueOn(f, end);
      if (sv === null || ev === null || sv <= 0) continue;
      if (f.priceState(start) === 'unavailable' || f.priceState(end) === 'unavailable') continue;
      const move = growthOn(f, end)! - growthOn(f, start)!;
      const netIn = f.putIn.on(end)! - f.putIn.on(start)!;
      const bp = Math.trunc((-move * 10_000) / sv);
      pts.push({ date: end, cents: move });
      if (!worst || bp > worst.bp) worst = { month: m, bp };
      if (!earned && -move * 100 >= 5 * sv && netIn > 0 && (!a.from || end >= a.from))
        earned = {
          date: end,
          sentence: `In ${monthName(end)} the market took ${pct(bp)} (${money(-move)}) off your investments, and you still put in ${money(netIn)}.`,
          story: { label: 'Market moves each month', lineCents: null, points: pts.slice(-24) },
        };
    }
  }
  return {
    earned,
    blocked: null,
    progress: {
      fraction: 0,
      score: 0,
      text: worst && worst.bp > 0 ? `Worst month so far: down ${pct(worst.bp)} (${monthName(`${worst.month}-01`)})` : 'No month down 5% yet',
      need: 'A month where the market drops your investments 5% or more, and you still put money in.',
    },
    story: pts.length ? { label: 'Market moves each month', lineCents: null, points: pts.slice(-24) } : null,
  };
}

export function invGrowthBeatsSpending(f: InvestFacts, a: RuleArgs): RuleOutcome {
  const firstDay = f.growth.days.find((d) => d.cents !== null)?.date;
  let earned: RuleOutcome['earned'] = null;
  const pts: { date: IsoDate; cents: number }[] = [];
  const ok = (d: IsoDate) => f.priceState(d) !== 'unavailable';
  if (firstDay) {
    for (let y = Number(firstDay.slice(0, 4)); `${y}-12-31` < a.today; y++) {
      const s = growthOn(f, `${y - 1}-12-31`);
      const e = growthOn(f, `${y}-12-31`);
      if (s === null || e === null || !ok(`${y - 1}-12-31`) || !ok(`${y}-12-31`)) continue;
      const g = e - s;
      const spent = f.yearSpending(y);
      pts.push({ date: `${y}-12-31`, cents: g });
      if (!earned && spent > 0 && g > spent && (!a.from || `${y}-12-31` >= a.from))
        earned = {
          date: `${y}-12-31`,
          sentence: `In ${y} your investments grew ${money(g)} from the market, more than the ${money(spent)} you spent that year.`,
          story: { label: 'Growth in each full year', lineCents: spent, points: [...pts] },
        };
    }
  }
  const y = Number(a.today.slice(0, 4));
  const s = growthOn(f, `${y - 1}-12-31`);
  const now = lastValue(f.growth.days);
  const soFar = s !== null && now !== null ? now - s : null;
  const spent = f.yearSpending(y);
  const fr = soFar !== null && spent > 0 ? clamp01(soFar / spent) : 0;
  return {
    earned,
    blocked: null,
    progress:
      soFar === null
        ? NOTHING
        : {
            fraction: fr,
            score: fr,
            text:
              spent > 0 && soFar > spent
                ? `${y} so far: growth ${money(soFar)} is above spending ${money(spent)}. Counts on Dec 31 if it stays there.`
                : `${y} so far: growth ${money(soFar)}, spending ${money(spent)}`,
            need: a.from && `${y}-12-31` < a.from ? null : `Growth above spending when ${y} ends`,
          },
    story: pts.length ? { label: 'Growth in each full year', lineCents: null, points: pts } : null,
  };
}

/** Days with a real close for every fund held (and no estimated or stale price at all). */
function realDay(f: InvestFacts, date: IsoDate): boolean {
  const held = f.heldOn(date);
  return f.priceState(date) === 'known' && held.length > 0 && held.every((s) => f.realClose(s, date));
}

/** The weekday before a date (Monday -> Friday). */
export function previousWeekday(date: IsoDate): IsoDate {
  let d = addDays(date, -1);
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, -1);
  return d;
}

/**
 * Market gain on each day with a real close, compared with the weekday before it (Friday for a Monday), which must
 * have a real close too. A holiday or a missing close skips the pair, so a two-day gain is never counted as one day.
 */
export function dailyGains(f: InvestFacts): { date: IsoDate; cents: number }[] {
  const out: { date: IsoDate; cents: number }[] = [];
  let prev: { date: IsoDate; g: number } | null = null;
  for (const d of f.growth.days) {
    if (d.cents === null || !realDay(f, d.date)) continue;
    if (prev && prev.date === previousWeekday(d.date)) out.push({ date: d.date, cents: d.cents - prev.g });
    prev = { date: d.date, g: d.cents };
  }
  return out;
}

export function invBestDay(f: InvestFacts, a: RuleArgs): RuleOutcome {
  const firstDay = f.growth.days.find((d) => d.cents !== null)?.date ?? null;
  const gains = dailyGains(f);
  const ready = firstDay ? addMonths(firstDay, 3) : null;
  const recs: RecordEntry[] = [];
  let best = 0;
  for (const g of gains) {
    if (g.cents > best && ready && g.date >= ready && (!a.from || g.date >= a.from)) recs.push({ period: g.date, amountCents: g.cents, setOn: g.date });
    best = Math.max(best, g.cents);
  }
  const first = recs[0];
  const story = (until: IsoDate): Story => ({ label: 'Market gain each trading day', lineCents: null, points: thin(gains.filter((g) => g.date <= until).slice(-90)) });
  return {
    earned: first ? { date: first.setOn, sentence: `Your investments gained ${money(first.amountCents)} from the market on ${longDate(first.setOn)}, your best day yet.`, story: story(first.setOn) } : null,
    blocked: null,
    records: recs,
    progress: !firstDay
      ? NOTHING
      : ready && a.today < ready
        ? { fraction: 0, score: 0, text: `Best day so far ${money(best)}`, need: `Needs 3 months of history (from ${longDate(ready)}), then a day better than every one before.` }
        : { fraction: 0, score: 0, text: `Best day so far ${money(best)}`, need: `A day that beats ${money(best)}` },
    story: gains.length ? story(a.today) : null,
  };
}
