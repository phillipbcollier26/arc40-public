/**
 * Spending habits trophies (Trophies Round 3), pure. Input: SpendFacts (data.ts), built only from what the screens use:
 *   months     monthlyRows (lib/cashflow.ts) over the money lines: income (type income), spending (expenses, refunds
 *              lower it), savings rate in basis points (null when income is $0 or less). Transfers and gifts never
 *              count. The same rows as Cash flow and the Dashboard
 *   byCategory spendingByCategory (lib/cashflow.ts) per month: the Budget page's "spent"
 *   limits     effectiveLimits (lib/budgets.ts): the Budget page's limits, month overrides included
 *   cancellations  saved recurring items marked cancelled on the Recurring page, with their cancelled date
 *   subscriptionCharges  charges matched to saved recurring items (itemCharges, as Wrapped), per month
 *
 * Only COMPLETE months count (the month has ended; the current month never counts: spending can still come in).
 * A month "has data" for a comparison when Arc40's data starts on or before its 1st.
 *
 *   sp_earn_streak     complete months in a row where income was above $0 AND more than spending. Equal does not
 *                      count; a month with no income breaks the run. Earned on the last month's last day
 *   sp_rate_month      one complete month with a savings rate at or above the line (the Dashboard's rounded basis
 *                      points: 20.00% counts, 19.99% does not)
 *   sp_rate_year       one complete calendar year whose rate from the YEAR'S TOTALS (never an average of months) is
 *                      at or above the line. Only years Arc40 has data for from January (first data on or before
 *                      Jan 31), so a part first year cannot look like a full one. Earned on Dec 31
 *   sp_budget_streak   complete months in a row where every category with a budget above $0 that month spent at or
 *                      under its limit. One cent over breaks the month; $0 budgets are ignored; a month with no budget
 *                      above $0 does not count and breaks the run
 *   sp_subs_cut        items marked cancelled on the Recurring page, counted; earned on the Nth cancelled date.
 *                      Restoring an item takes it out of the count (an earned trophy stays earned)
 *   sp_cheaper_month   a complete month whose spending was lower than the same month one year earlier, both months
 *                      with data and with some spending (a month with no spending at all looks like missing data)
 *   sp_subs_cheaper    at a complete month end: subscription charges over the last 12 complete months total less
 *                      than over the 12 before. Needs all 24 months with data. Earned on that month end
 *   sp_category_tamed  at a complete month end: one category's spending over the last 12 complete months is at least
 *                      25% lower than over the 12 before (later x 4 <= earlier x 3, whole cents: 25.00% counts,
 *                      24.99% does not), with at least $300 in the earlier 12. Uncategorized and deleted categories
 *                      are skipped. The biggest drop in dollars names the category
 *
 * Start from today (turn-on day `from`):
 *   months and years   only periods that START on or after it (turned on Nov 17: December first; turned on Dec 1:
 *                      December counts). Years: Jan 1 on or after it
 *   comparisons        the judged month (or the judged 12 months) must start on or after it; the earlier period it is
 *                      compared with may be before it
 *   subscriptions cut  only items cancelled on or after it
 */
import { addMonths, endOfMonth, type IsoDate } from '../../../../shared/dates.js';
import type { MonthRow } from '../cashflow.js';
import { clamp01, longDate, money, monthName } from './format.js';
import type { Progress, RuleArgs, RuleOutcome, Story } from './types.js';

export interface SpendFacts {
  /** The first transaction's date (null = no data). */
  firstDataDate: IsoDate | null;
  /** One row per month from the first data month through the current month, oldest first. */
  months: MonthRow[];
  /** Spent per expense category in a month ('YYYY-MM-01'); null key = uncategorized. */
  byCategory(month: IsoDate): ReadonlyMap<number | null, number>;
  /** The Budget page's limits for a month ('YYYY-MM-01'). */
  limits(month: IsoDate): ReadonlyMap<number, { limitCents: number }>;
  categoryName(id: number): string | null;
  cancellations: { date: IsoDate; name: string }[];
  /** Charges matched to saved recurring items, added up per month ('YYYY-MM-01'). */
  subscriptionCharges(month: IsoDate): number;
}

export const TAMED_MIN_CENTS = 30_000;

const NO_DATA: Progress = { fraction: 0, score: 0, text: 'No complete month yet', need: 'Counts once a month of your data has ended.' };
const WAIT_FROM: Progress = { fraction: 0, score: 0, text: 'Waiting for the first full month', need: 'Counts from the first full month after you turned it on.' };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A percent from basis points, exact to the hundredth with no trailing zeros: 2000 "20%", 1999 "19.99%", 2550 "25.5%". */
export function pct(bp: number): string {
  const sign = bp < 0 ? '-' : '';
  const a = Math.abs(bp);
  const frac = String(a % 100).padStart(2, '0').replace(/0+$/, '');
  return `${sign}${Math.floor(a / 100)}${frac ? `.${frac}` : ''}%`;
}

const monthEnded = (m: IsoDate, today: IsoDate) => endOfMonth(m) < today;
/** Complete months (oldest first) that start on or after the turn-on day. */
function completeMonths(f: SpendFacts, a: RuleArgs): MonthRow[] {
  return f.months.filter((r) => monthEnded(r.month, a.today) && (!a.from || r.month >= a.from));
}
/** Arc40 has this month's data from its 1st. */
export const hasData = (f: SpendFacts, month: IsoDate) => !!f.firstDataDate && f.firstDataDate <= month;
const row = (f: SpendFacts, month: IsoDate) => f.months.find((r) => r.month === month) ?? null;

function noneYet(f: SpendFacts, a: RuleArgs, need: number | null = null): Progress {
  if (!f.firstDataDate) return NO_DATA;
  if (a.from && !f.months.some((r) => r.month >= a.from! && monthEnded(r.month, a.today)))
    return need ? { ...WAIT_FROM, text: `0 of ${plural(need, 'month')}` } : WAIT_FROM;
  return need ? { fraction: 0, score: 0, text: `0 of ${plural(need, 'month')}`, need: null } : NO_DATA;
}

function monthStory(rows: readonly MonthRow[], label: string, pick: (r: MonthRow) => number, lineCents: number | null = null): Story | null {
  if (!rows.length) return null;
  return { label, lineCents, points: rows.slice(-24).map((r) => ({ date: endOfMonth(r.month), cents: pick(r) })) };
}

/** Months in a row that pass `ok`; the first run that reaches `need`. */
function run(rows: readonly MonthRow[], ok: (r: MonthRow) => boolean, need: number) {
  let n = 0;
  let earned: { end: MonthRow; start: MonthRow } | null = null;
  rows.forEach((r, i) => {
    n = ok(r) ? n + 1 : 0;
    if (!earned && n === need) earned = { end: r, start: rows[i - need + 1]! };
  });
  return { earned: earned as { end: MonthRow; start: MonthRow } | null, current: n };
}

function streakOutcome(
  f: SpendFacts,
  need: number,
  a: RuleArgs,
  ok: (r: MonthRow) => boolean,
  w: { sentence: (start: string, end: string) => string; needText: string; story: Story | null },
): RuleOutcome {
  const rows = completeMonths(f, a);
  const r = run(rows, ok, need);
  const progress: Progress = rows.length
    ? { fraction: clamp01(r.current / need), score: clamp01(r.current / need), text: `${r.current} of ${plural(need, 'month')}`, need: `${plural(need - r.current, 'more month')}: ${w.needText}` }
    : noneYet(f, a, need);
  return {
    earned: r.earned
      ? { date: endOfMonth(r.earned.end.month), sentence: w.sentence(monthName(r.earned.start.month), monthName(r.earned.end.month)), story: w.story }
      : null,
    blocked: null,
    progress,
    story: w.story,
  };
}

// ------------------------------------------------------------------ spent less than you earned

/** Every complete month (oldest first), for the "How you got there" chart, even before the turn-on day. */
const chartMonths = (f: SpendFacts, a: RuleArgs) => f.months.filter((r) => monthEnded(r.month, a.today));

export function spEarnStreak(f: SpendFacts, need: number, a: RuleArgs): RuleOutcome {
  const rows = chartMonths(f, a);
  return streakOutcome(f, need, a, (r) => r.incomeCents > 0 && r.incomeCents > r.spendingCents, {
    sentence: (s, e) => `You spent less than you earned for ${need} months in a row, ${s} through ${e}.`,
    needText: 'income above spending each month',
    story: monthStory(rows, 'Income minus spending each month', (r) => r.incomeCents - r.spendingCents),
  });
}

// ------------------------------------------------------------------ savings rate in a month / a year

export function spRateMonth(f: SpendFacts, lineBp: number, a: RuleArgs): RuleOutcome {
  const rows = completeMonths(f, a);
  const hit = rows.find((r) => r.savingsRateBp !== null && r.savingsRateBp >= lineBp) ?? null;
  const best = rows.reduce<MonthRow | null>((b, r) => (r.savingsRateBp !== null && (b === null || r.savingsRateBp > b.savingsRateBp!) ? r : b), null);
  const last = rows.at(-1) ?? null;
  let progress: Progress;
  if (!rows.length) progress = noneYet(f, a);
  else if (!last || last.savingsRateBp === null)
    progress = { fraction: 0, score: 0, text: `Last month: no income`, need: `A month with income and a savings rate of ${pct(lineBp)} or more` };
  else {
    const fr = clamp01(Math.max(0, last.savingsRateBp) / lineBp);
    progress = {
      fraction: fr,
      score: fr,
      text: `Last month: ${pct(last.savingsRateBp)} of ${pct(lineBp)}`,
      need: best && best.savingsRateBp! > last.savingsRateBp ? `Your best so far: ${pct(best.savingsRateBp!)} in ${monthName(best.month)}` : `A month with a savings rate of ${pct(lineBp)} or more`,
    };
  }
  const story = monthStory(chartMonths(f, a), 'Income minus spending each month', (r) => r.incomeCents - r.spendingCents);
  return {
    earned: hit
      ? {
          date: endOfMonth(hit.month),
          sentence: `You saved ${pct(hit.savingsRateBp!)} of what you earned in ${monthName(hit.month)}: ${money(hit.incomeCents)} in, ${money(hit.spendingCents)} spent.`,
          story,
        }
      : null,
    blocked: null,
    progress,
    story,
  };
}

export function spRateYear(f: SpendFacts, lineBp: number, a: RuleArgs): RuleOutcome {
  const years = new Map<number, { income: number; spending: number }>();
  for (const r of f.months) {
    const y = Number(r.month.slice(0, 4));
    const t = years.get(y) ?? { income: 0, spending: 0 };
    t.income += r.incomeCents;
    t.spending += r.spendingCents;
    years.set(y, t);
  }
  const rate = (t: { income: number; spending: number }) => {
    if (t.income <= 0) return null;
    const num = (t.income - t.spending) * 10_000;
    return Math.sign(num) * Math.round(Math.abs(num) / t.income); // savingsRateBp, the YTD rule
  };
  const eligible = [...years.entries()]
    .filter(([y]) => `${y}-12-31` < a.today && !!f.firstDataDate && f.firstDataDate <= `${y}-01-31` && (!a.from || `${y}-01-01` >= a.from))
    .sort(([x], [y]) => x - y);
  const hit = eligible.find(([, t]) => (rate(t) ?? -Infinity) >= lineBp) ?? null;
  const thisYear = Number(a.today.slice(0, 4));
  const cur = years.get(thisYear);
  const curRate = cur ? rate(cur) : null;
  let progress: Progress;
  if (!f.firstDataDate) progress = NO_DATA;
  else if (curRate === null)
    progress = { fraction: 0, score: 0, text: `${thisYear} so far: no income`, need: `A full year with a savings rate of ${pct(lineBp)} or more` };
  else {
    const fr = clamp01(Math.max(0, curRate) / lineBp);
    const waits = a.from && `${thisYear}-01-01` < a.from;
    progress = {
      fraction: waits ? 0 : fr,
      score: waits ? 0 : fr,
      text:
        !waits && curRate >= lineBp
          ? `${thisYear} so far: ${pct(curRate)}, at or above ${pct(lineBp)}. Counts on Dec 31 if the year ends there.`
          : `${thisYear} so far: ${pct(curRate)} of ${pct(lineBp)}`,
      need: waits ? `Counts from ${thisYear + 1}, the first full year after you turned it on.` : `The full year has to end at ${pct(lineBp)} or more`,
    };
  }
  const story: Story | null = eligible.length || cur
    ? { label: 'Income minus spending each year', lineCents: null, points: [...years.entries()].sort(([x], [y]) => x - y).map(([y, t]) => ({ date: `${y}-12-31`, cents: t.income - t.spending })) }
    : null;
  return {
    earned: hit
      ? {
          date: `${hit[0]}-12-31`,
          sentence: `You saved ${pct(rate(hit[1])!)} of what you earned in ${hit[0]}: ${money(hit[1].income)} in, ${money(hit[1].spending)} spent.`,
          story,
        }
      : null,
    blocked: null,
    progress,
    story,
  };
}

// ------------------------------------------------------------------ under budget in every category

/** null = no budget above $0 that month (does not count); else whether every budgeted category stayed at or under. */
export function underBudget(f: SpendFacts, month: IsoDate): { ok: boolean; over: string | null } | null {
  const limits = [...f.limits(month)].filter(([, l]) => l.limitCents > 0);
  if (!limits.length) return null;
  const spent = f.byCategory(month);
  for (const [id, l] of limits) if ((spent.get(id) ?? 0) > l.limitCents) return { ok: false, over: f.categoryName(id) };
  return { ok: true, over: null };
}

export function spBudgetStreak(f: SpendFacts, need: number, a: RuleArgs): RuleOutcome {
  const rows = completeMonths(f, a);
  const o = streakOutcome(f, need, a, (r) => underBudget(f, r.month)?.ok === true, {
    sentence: (s, e) => `Every category with a budget stayed at or under its limit for ${plural(need, 'month')} in a row, ${s} through ${e}.`,
    needText: 'every budgeted category at or under its limit',
    story: monthStory(chartMonths(f, a), 'Spending each month', (r) => r.spendingCents),
  });
  const last = rows.at(-1);
  if (!o.earned && last) {
    const u = underBudget(f, last.month);
    if (u === null) o.progress = { ...o.progress, need: `${monthName(last.month)} had no budget above $0. Set a budget on the Budget page.` };
    else if (!u.ok && u.over) o.progress = { ...o.progress, need: `${monthName(last.month)}: ${u.over} went over its limit. ${o.progress.need ?? ''}`.trim() };
  }
  return o;
}

// ------------------------------------------------------------------ subscriptions cut

export function spSubsCut(f: SpendFacts, need: number, a: RuleArgs): RuleOutcome {
  const cuts = f.cancellations.filter((c) => c.date <= a.today && (!a.from || c.date >= a.from));
  const nth = cuts[need - 1] ?? null;
  const fr = clamp01(cuts.length / need);
  return {
    earned: nth
      ? {
          date: nth.date,
          sentence: need === 1 ? `You cancelled ${nth.name} on ${longDate(nth.date)}.` : `You cancelled your ${ordinal(need)} subscription, ${nth.name}, on ${longDate(nth.date)}.`,
          story: null,
        }
      : null,
    blocked: null,
    progress: {
      fraction: fr,
      score: fr,
      text: `${cuts.length} of ${need} cancelled`,
      need: `Mark a subscription cancelled on the Recurring page${a.from ? ' (from the day you turned this on)' : ''}.`,
    },
    story: null,
  };
}
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

// ------------------------------------------------------------------ cheaper than the same month last year

export function spCheaperMonth(f: SpendFacts, a: RuleArgs): RuleOutcome {
  const rows = completeMonths(f, a);
  const pairs = rows
    .map((r) => ({ r, before: row(f, addMonths(r.month, -12)) }))
    .filter((p) => p.before && hasData(f, p.before.month) && p.r.spendingCents > 0 && p.before.spendingCents > 0) as { r: MonthRow; before: MonthRow }[];
  const hit = pairs.find((p) => p.r.spendingCents < p.before.spendingCents) ?? null;
  const last = pairs.at(-1) ?? null;
  let progress: Progress;
  if (!last) progress = rows.length ? { fraction: 0, score: 0, text: 'No month a year earlier to compare with yet', need: 'Needs a full month of your data from a year before.' } : noneYet(f, a);
  else {
    const fr = clamp01(last.before.spendingCents / Math.max(1, last.r.spendingCents));
    progress = {
      fraction: fr * 0.99,
      score: fr * 0.99,
      text: `${monthName(last.r.month)}: ${money(last.r.spendingCents)} vs ${money(last.before.spendingCents)} a year before`,
      need: 'A month that costs less than the same month last year',
    };
  }
  return {
    earned: hit
      ? {
          date: endOfMonth(hit.r.month),
          sentence: `You spent ${money(hit.r.spendingCents)} in ${monthName(hit.r.month)}, less than the ${money(hit.before.spendingCents)} in ${monthName(hit.before.month)}.`,
          story: {
            label: 'Spending, the two months',
            lineCents: null,
            points: [
              { date: endOfMonth(hit.before.month), cents: hit.before.spendingCents },
              { date: endOfMonth(hit.r.month), cents: hit.r.spendingCents },
            ],
          },
        }
      : null,
    blocked: null,
    progress,
    story: monthStory(rows, 'Spending each month', (r) => r.spendingCents),
  };
}

// ------------------------------------------------------------------ 12 months vs the 12 before (subscriptions, a category)

/** Month ends where both 12-month windows are complete, have data, and the judged one starts on/after `from`. */
function windows(f: SpendFacts, a: RuleArgs): { end: IsoDate; later: IsoDate[]; earlier: IsoDate[] }[] {
  const out: { end: IsoDate; later: IsoDate[]; earlier: IsoDate[] }[] = [];
  for (const r of f.months) {
    if (!monthEnded(r.month, a.today)) continue;
    const later = Array.from({ length: 12 }, (_, i) => addMonths(r.month, i - 11));
    const earlier = later.map((m) => addMonths(m, -12));
    if (!hasData(f, earlier[0]!)) continue;
    if (a.from && later[0]! < a.from) continue;
    out.push({ end: r.month, later, earlier });
  }
  return out;
}
/** The first 1st of a month on or after a date. */
const monthOnOrAfter = (d: IsoDate): IsoDate => (d.endsWith('-01') ? d : addMonths(`${d.slice(0, 7)}-01`, 1));
function waitWindows(f: SpendFacts, a: RuleArgs): Progress {
  if (!f.firstDataDate) return NO_DATA;
  // The earlier 12 months must start on a month Arc40 has from its 1st; with Start from today the judged 12 must
  // start on or after the turn-on day.
  let ready = addMonths(monthOnOrAfter(f.firstDataDate), 23);
  if (a.from) {
    const fromReady = addMonths(monthOnOrAfter(a.from), 11);
    if (fromReady > ready) ready = fromReady;
  }
  return {
    fraction: 0,
    score: 0,
    text: 'Needs more history',
    need: `It compares 12 full months with the 12 before. The first check is at the end of ${monthName(ready)}.`,
  };
}

export function spSubsCheaper(f: SpendFacts, a: RuleArgs): RuleOutcome {
  const sum = (ms: IsoDate[]) => ms.reduce((s, m) => s + f.subscriptionCharges(m), 0);
  const ws = windows(f, a).map((w) => ({ ...w, later$: sum(w.later), earlier$: sum(w.earlier) }));
  const hit = ws.find((w) => w.later$ < w.earlier$) ?? null;
  const last = ws.at(-1) ?? null;
  const story = (w: { later: IsoDate[]; earlier: IsoDate[] }): Story => ({
    label: 'Subscription charges each month',
    lineCents: null,
    points: [...w.earlier, ...w.later].map((m) => ({ date: endOfMonth(m), cents: f.subscriptionCharges(m) })),
  });
  let progress: Progress;
  if (!last) progress = waitWindows(f, a);
  else {
    const fr = clamp01(last.earlier$ / Math.max(1, last.later$));
    progress = {
      fraction: fr * 0.99,
      score: fr * 0.99,
      text: `Last 12 months: ${money(last.later$)} vs ${money(last.earlier$)} the 12 before`,
      need: 'Subscriptions costing less over 12 months than the 12 before (cancelling one helps)',
    };
  }
  return {
    earned: hit
      ? {
          date: endOfMonth(hit.end),
          sentence: `Your subscriptions cost ${money(hit.later$)} from ${monthName(hit.later[0]!)} to ${monthName(hit.end)}, less than the ${money(hit.earlier$)} of the 12 months before.`,
          story: story(hit),
        }
      : null,
    blocked: null,
    progress,
    story: last ? story(last) : null,
  };
}

export function spCategoryTamed(f: SpendFacts, a: RuleArgs): RuleOutcome {
  const sumFor = (ms: IsoDate[]) => {
    const out = new Map<number, number>();
    for (const m of ms) for (const [id, c] of f.byCategory(m)) if (id !== null) out.set(id, (out.get(id) ?? 0) + c);
    return out;
  };
  const ws = windows(f, a);
  let hit: { end: IsoDate; later: IsoDate[]; id: number; name: string; before: number; after: number } | null = null;
  for (const w of ws) {
    const later = sumFor(w.later);
    const earlier = sumFor(w.earlier);
    let best: { id: number; name: string; before: number; after: number } | null = null;
    for (const [id, before] of earlier) {
      const name = f.categoryName(id);
      if (name === null || before < TAMED_MIN_CENTS) continue;
      const after = later.get(id) ?? 0;
      const c = { id, name, before, after };
      if (after * 4 <= before * 3 && (!best || before - after > best.before - best.after)) best = c;
    }
    if (best) {
      hit = { end: w.end, later: w.later, ...best };
      break;
    }
  }
  // Progress: the latest window's category closest to 25% lower.
  let progress: Progress;
  const lastW = ws.at(-1);
  if (!lastW) progress = waitWindows(f, a);
  else {
    const later = sumFor(lastW.later);
    const earlier = sumFor(lastW.earlier);
    let c: { name: string; before: number; after: number } | null = null;
    for (const [id, before] of earlier) {
      const name = f.categoryName(id);
      if (name === null || before < TAMED_MIN_CENTS) continue;
      const after = later.get(id) ?? 0;
      if (!c || after * c.before < c.after * before) c = { name, before, after };
    }
    if (!c) progress = { fraction: 0, score: 0, text: 'No category with $300 or more in the 12 months before', need: 'A category with at least $300 of spending in the earlier 12 months' };
    else {
      const dropBp = Math.floor(((c.before - c.after) * 10_000) / c.before);
      const fr = clamp01(Math.max(0, dropBp) / 2500);
      progress = {
        fraction: fr * 0.99,
        score: fr * 0.99,
        text: `Closest: ${c.name}, ${dropBp >= 0 ? `down ${pct(dropBp)}` : `up ${pct(-dropBp)}`}`,
        need: 'One category 25% lower over 12 months than the 12 before',
      };
    }
  }
  return {
    earned: hit
      ? {
          date: endOfMonth(hit.end),
          sentence: `You tamed ${hit.name}: ${money(hit.after)} from ${monthName(hit.later[0]!)} to ${monthName(hit.end)}, down ${pct(Math.floor(((hit.before - hit.after) * 10_000) / hit.before))} from ${money(hit.before)} the 12 months before.`,
          story: {
            label: `${hit.name}, the 12 months before and after`,
            lineCents: null,
            points: [
              { date: endOfMonth(addMonths(hit.end, -12)), cents: hit.before },
              { date: endOfMonth(hit.end), cents: hit.after },
            ],
          },
        }
      : null,
    blocked: null,
    progress,
    story: null,
  };
}
