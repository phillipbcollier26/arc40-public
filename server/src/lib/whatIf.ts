/**
 * What if (V2 Phase 3): the current path and up to 3 scenarios, all through ONE function (`projectPath`) and the
 * shared engine (lib/projection.ts), so the accounting rules are identical for every path and a scenario with no
 * changes IS the current path. Read-only: nothing here writes to the database.
 *
 * A path = the baseline (lib/planning.ts) with some changes:
 *   spending   +/- $X a month in one category. It changes savings 1:1 (income stays the same). Spending in a category
 *              can go down to $0 but not below (the cut is clamped and noted).
 *   roth       a monthly Roth IRA amount that REPLACES the recent one. The difference is moved between cash and
 *              invested (a move, never new money). Each calendar year's Roth money stops at that year's limit; the
 *              rest stays in cash. A year with no saved limit uses the newest saved limit (assumption, shown).
 *   return     the yearly return after inflation for this path only.
 * Savings split: invested = the baseline's share of savings (investedPart), then +/- the Roth difference; never
 * below $0. Cash takes the rest. Cash that would go below $0 is taken from investments (engine rule, noted).
 *
 * FI number = 25 x yearly spending = 300 x that path's monthly spending (its OWN spending). Only invested assets
 * count. Reached = the first month invested >= the FI number, searched up to the FI horizon (age 65, or 10 years
 * without a birth month, or the chosen range if longer); otherwise null ("not reached").
 *
 * Goal dates (a view; they never feed back into net worth): each custom goal follows its linked account: today's
 * balance + that account's recent monthly flow (+ the path's return if it is an investment account). The Roth goal:
 * this tax year's saved limit vs contributions so far + the path's monthly Roth amount, before the deadline. The
 * emergency fund: savings accounts (balance + flow) vs 6 x (path spending + the "costs someone else covers" setting).
 */
import type { DB } from '../db/database.js';
import { endOfMonth, type IsoDate } from '../../../shared/dates.js';
import { getSetting } from './settings.js';
import { listCategories } from './transactions.js';
import { loadActivity } from './activity.js';
import { contributionsForTaxYear } from './investments.js';
import { savingsRateBp } from './cashflow.js';
import { monthsLeft } from './rothPace.js';
import type { Baseline } from './planning.js';
import { ageAtMonth, firstMonthReaching, investedPart, monthDate, monthsUntilAge, simulate, type BirthMonth, type SimPoint } from './projection.js';
import type { Cents } from './money.js';

export const RANGES = ['1y', '5y', '10y', 'to40', 'to65'] as const;
export type RangeKey = (typeof RANGES)[number];
export const MAX_SCENARIOS = 3;
export const MAX_CHANGES = 10;
/** FI is 25 x yearly spending. */
export const FI_MULTIPLE = 25;

export type Change =
  | { kind: 'spending'; categoryId: number | null; deltaCents: Cents }
  | { kind: 'roth'; monthlyCents: Cents }
  | { kind: 'return'; rateBp: number };

export interface RothRules {
  /** Tax year of today and its saved limit (null = none saved). */
  year: number;
  limitCents: Cents | null;
  deadline: IsoDate | null;
  /** Already contributed for `year`. */
  contributedCents: Cents;
  /** Limit used for later years: the newest saved limit (null = none saved at all = no cap). */
  laterLimitCents: Cents | null;
}

export interface PathSpec {
  spendingCents: Cents;
  savingsCents: Cents;
  rateBp: number;
  /** null = keep the recent pattern (no Roth adjustment). */
  rothMonthlyCents: Cents | null;
  notes: string[];
}

/** Applies a scenario's changes to the baseline. No changes = the current path's spec. */
export function pathSpec(b: Baseline, defaultRateBp: number, changes: readonly Change[], categoryName: (id: number | null) => string): PathSpec {
  let spending = b.spendingCents;
  let rate = defaultRateBp;
  let roth: Cents | null = null;
  const notes: string[] = [];
  for (const c of changes) {
    if (c.kind === 'spending') {
      const avg = b.spendingByCategory[c.categoryId === null ? 'none' : String(c.categoryId)] ?? 0;
      let d = c.deltaCents;
      if (d < -Math.max(avg, 0)) {
        d = -Math.max(avg, 0);
        notes.push(`${categoryName(c.categoryId)} can only go down to $0 a month, so the cut stops there.`);
      }
      spending += d;
    } else if (c.kind === 'roth') roth = c.monthlyCents;
    else rate = c.rateBp;
  }
  return { spendingCents: spending, savingsCents: b.incomeCents - spending, rateBp: rate, rothMonthlyCents: roth, notes };
}

/** Month m (1-based) of a projection happens in this calendar month. */
const monthOf = (today: IsoDate, m: number) => monthDate(today, m - 1);

/**
 * THE projection for any path. Month by month: savings from the spec; invested part = the baseline's share of it;
 * with a Roth amount, the recent Roth amount is replaced by this one (capped at each year's limit).
 */
export function projectPath(b: Baseline, spec: PathSpec, months: number, roth: RothRules): { points: SimPoint[]; rothCapped: boolean } {
  const used = new Map<number, number>([[roth.year, roth.contributedCents]]);
  let capped = false;
  const points = simulate({
    months,
    yearlyReturnBp: spec.rateBp,
    startCashCents: b.cashCents,
    startInvestedCents: b.investedCents,
    fixedCents: b.fixedCents,
    money: (m) => {
      const base = investedPart(spec.savingsCents, b.share);
      if (spec.rothMonthlyCents === null) return { savingsCents: spec.savingsCents, toInvestedCents: base };
      const y = Number(monthOf(b.today, m).slice(0, 4));
      const limit = y === roth.year && roth.limitCents !== null ? roth.limitCents : roth.laterLimitCents;
      const room = limit === null ? Infinity : Math.max(0, limit - (used.get(y) ?? 0));
      const put = Math.min(spec.rothMonthlyCents, room);
      if (put < spec.rothMonthlyCents) capped = true;
      used.set(y, (used.get(y) ?? 0) + put);
      return { savingsCents: spec.savingsCents, toInvestedCents: Math.max(0, base - b.rothMonthlyCents + put) };
    },
  });
  return { points, rothCapped: capped };
}

/** First month a single account reaches `target` with a steady monthly flow (and growth if invested). */
export function accountReach(startCents: Cents, flowCents: Cents, invested: boolean, rateBp: number, target: Cents, horizon: number): number | null {
  if (startCents >= target) return 0;
  const pts = simulate({
    months: horizon,
    yearlyReturnBp: invested ? rateBp : 0,
    startCashCents: invested ? 0 : startCents,
    startInvestedCents: invested ? startCents : 0,
    money: () => ({ savingsCents: flowCents, toInvestedCents: invested ? flowCents : 0 }),
  });
  return firstMonthReaching(pts, target, (p) => p.netWorthCents);
}

export interface Reach {
  month: number | null;
  /** The month-end it happens by (today for month 0), or null. */
  date: IsoDate | null;
  age: number | null;
}

export function reachAt(today: IsoDate, birth: BirthMonth | null, month: number | null): Reach {
  if (month === null) return { month: null, date: null, age: null };
  return { month, date: month === 0 ? today : endOfMonth(monthOf(today, month)), age: birth ? ageAtMonth(birth, today, Math.max(month - 1, 0)) : null };
}

export function rangeMonths(range: RangeKey, today: IsoDate, birth: BirthMonth | null): number | string {
  if (range === '1y') return 12;
  if (range === '5y') return 60;
  if (range === '10y') return 120;
  const age = range === 'to40' ? 40 : 65;
  if (!birth) return 'Set your birth month and year in Settings to see "until age ' + age + '".';
  const m = monthsUntilAge(birth, today, age);
  if (m <= 0) return `You are already ${age} or older, so pick another range.`;
  return m;
}

/** How far years-until-FI and goal dates are searched: age 65 (or 10 years without a birth month), or the range. */
export function fiHorizon(today: IsoDate, birth: BirthMonth | null, rangeM: number): { months: number; label: string } {
  const to65 = birth ? monthsUntilAge(birth, today, 65) : -1;
  if (to65 > 0 && to65 >= rangeM) return { months: to65, label: 'age 65' };
  if (!birth && rangeM <= 120) return { months: 120, label: '10 years' };
  return { months: rangeM, label: 'the end of this range' };
}

export interface Scenario {
  name: string;
  changes: Change[];
}

export function whatIf(db: DB, b: Baseline, opts: { range: RangeKey; scenarios: readonly Scenario[]; birth: BirthMonth | null; defaultRateBp: number }) {
  const today = b.today;
  const rm = rangeMonths(opts.range, today, opts.birth);
  if (typeof rm === 'string') return { error: rm } as const;
  const horizon = fiHorizon(today, opts.birth, rm);
  const cats = listCategories(db);
  const catName = (id: number | null) => (id === null ? 'Uncategorized' : (cats.find((c) => c.id === id)?.name ?? 'That category'));

  // Roth rules: this tax year's saved limit and what is already in; later years use the newest saved limit.
  const limits = getSetting(db, 'ira_limits');
  const year = Number(today.slice(0, 4));
  const newestKey = Object.keys(limits).sort().at(-1);
  const rothIds = new Set(b.accounts.filter((a) => a.type === 'roth_ira').map((a) => a.id));
  const contributed = contributionsForTaxYear(loadActivity(db), year, rothIds);
  const roth: RothRules = {
    year,
    limitCents: limits[String(year)]?.limitCents ?? null,
    deadline: limits[String(year)]?.deadline ?? null,
    contributedCents: contributed,
    laterLimitCents: newestKey ? limits[newestKey]!.limitCents : null,
  };

  const goals = (
    db.prepare('SELECT id, name, target_cents, account_id FROM goals WHERE archived = 0 ORDER BY id').all() as {
      id: number;
      name: string;
      target_cents: number;
      account_id: number | null;
    }[]
  ).map((g) => ({ ...g, account: b.accounts.find((a) => a.id === g.account_id) ?? null }));
  const savingsAccts = b.accounts.filter((a) => a.type === 'savings');
  const savingsStart = savingsAccts.reduce((s, a) => s + a.balanceCents, 0);
  const savingsFlow = savingsAccts.reduce((s, a) => s + a.flowCents, 0);
  const essentials = getSetting(db, 'emergency_essentials_cents');

  const run = (name: string, changes: readonly Change[], baseRateBp: number | null) => {
    const spec = pathSpec(b, opts.defaultRateBp, changes, catName);
    const months = Math.max(rm, horizon.months);
    const { points, rothCapped } = projectPath(b, spec, months, roth);
    const shown = points.slice(0, rm + 1);
    const end = shown.at(-1)!;
    const fiNumber = spec.spendingCents > 0 ? FI_MULTIPLE * 12 * spec.spendingCents : null;
    const fiMonth = fiNumber === null ? null : firstMonthReaching(points.slice(0, horizon.months + 1), fiNumber);
    const rothMonthly = spec.rothMonthlyCents ?? b.rothMonthlyCents;
    const notes = [...spec.notes];
    if (rothCapped) notes.push('Roth money stops at each year’s limit; the rest stays in cash.');
    if (points.slice(0, rm + 1).some((p) => p.drewFromInvestments)) {
      notes.push(
        spec.savingsCents < 0
          ? 'Cash runs out on this path, so the extra spending comes out of investments.'
          : 'Cash runs out on this path; after that, only what you save each month can go to investments.',
      );
    }

    // Roth goal for this tax year (only with a saved limit and deadline: never guessed).
    let rothGoal: ({ year: number; limitCents: Cents; contributedCents: Cents; monthlyCents: Cents; beforeDeadline: boolean } & Reach) | null = null;
    if (roth.limitCents !== null && roth.deadline && rothIds.size) {
      const left = monthsLeft(today, roth.deadline);
      let m: number | null = null;
      if (contributed >= roth.limitCents) m = 0;
      else if (rothMonthly > 0) m = Math.ceil((roth.limitCents - contributed) / rothMonthly);
      const before = m !== null && m <= left;
      rothGoal = { year, limitCents: roth.limitCents, contributedCents: contributed, monthlyCents: rothMonthly, beforeDeadline: before, ...reachAt(today, opts.birth, before ? m : null) };
    }
    const emergencyTarget = 6 * (Math.max(spec.spendingCents, 0) + essentials);
    return {
      name,
      changes,
      incomeCents: b.incomeCents,
      spendingCents: spec.spendingCents,
      savingsCents: spec.savingsCents,
      savingsRateBp: savingsRateBp(b.incomeCents, spec.spendingCents),
      savingsRateChangeBp: (() => {
        const r = savingsRateBp(b.incomeCents, spec.spendingCents);
        return r === null || baseRateBp === null ? null : r - baseRateBp;
      })(),
      returnRateBp: spec.rateBp,
      rothMonthlyCents: rothMonthly,
      // Moved to investments in a normal month (before any yearly Roth cap).
      investedMonthlyCents:
        spec.rothMonthlyCents === null
          ? investedPart(spec.savingsCents, b.share)
          : Math.max(0, investedPart(spec.savingsCents, b.share) - b.rothMonthlyCents + spec.rothMonthlyCents),
      series: shown.map((p) => ({ month: p.month, date: monthDate(today, p.month), netWorthCents: p.netWorthCents, investedCents: p.investedCents, cashCents: p.cashCents })),
      end: { netWorthCents: end.netWorthCents, investedCents: end.investedCents, cashCents: end.cashCents },
      fi: { numberCents: fiNumber, ...reachAt(today, opts.birth, fiMonth) },
      goals: {
        custom: goals.map((g) => ({
          id: g.id,
          name: g.name,
          targetCents: g.target_cents,
          accountName: g.account?.name ?? null,
          currentCents: g.account?.balanceCents ?? 0,
          ...reachAt(
            today,
            opts.birth,
            g.account ? accountReach(g.account.balanceCents, g.account.flowCents, g.account.pool === 'invested', spec.rateBp, g.target_cents, horizon.months) : null,
          ),
        })),
        roth: rothGoal,
        emergency: emergencyTarget > 0 ? { targetCents: emergencyTarget, currentCents: savingsStart, ...reachAt(today, opts.birth, accountReach(savingsStart, savingsFlow, false, 0, emergencyTarget, horizon.months)) } : null,
      },
      notes,
    };
  };

  const baseRate = savingsRateBp(b.incomeCents, b.spendingCents);
  const currentPath = run('Current path', [], baseRate);
  const scenarios = opts.scenarios.map((s) => run(s.name, s.changes, baseRate));
  return {
    today,
    range: opts.range,
    rangeMonths: rm,
    fiHorizon: horizon,
    age: opts.birth ? ageAtMonth(opts.birth, today, 0) : null,
    defaultReturnRateBp: opts.defaultRateBp,
    rothRules: roth,
    current: currentPath,
    scenarios,
  };
}
