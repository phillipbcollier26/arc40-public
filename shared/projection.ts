/**
 * THE projection engine (V2 Phase 3). Pure, deterministic, no floats for money.
 * Used by the Roth pace planner, the What if page, the FI number and the future-you time machine,
 * on the server (server/src/lib/projection.ts re-exports this file) and in the browser.
 *
 * Today's dollars: the yearly return is a REAL rate (after inflation), so every future number is in
 * today's buying power. Income and spending are held flat in today's dollars (no raises assumed).
 *
 * Compounding: monthly. The monthly growth factor is the exact 12th root of (1 + yearly rate),
 * found with whole-number math (BigInt, 18 decimal places, rounded down). So 12 months at 7% grow
 * $1,000.00 to exactly $1,070.00: "7% a year" means what it says.
 *
 * Rounding: balances are carried in MILLIONTHS of a cent inside the engine (BigInt). Growth on them
 * is rounded half away from zero at that tiny unit. A balance becomes whole cents (half away from
 * zero) only when it LEAVES the engine. Contributions are whole cents and are added exactly.
 *
 * Order inside one month: growth on the balance at the start of the month first, then that
 * month's money is added at the end of the month (so a deposit earns from the next month on).
 */
import type { Cents } from './money.js';
import type { IsoDate } from './dates.js';
import { addMonths, startOfMonth } from './dates.js';

/** Fixed-point scale of growth factors: 1.0 = 10^18. */
export const FACTOR_SCALE = 10n ** 18n;
/** Engine balances are in millionths of a cent. */
const MICRO = 1_000_000n;
/** Longest projection (100 years) and the allowed yearly rate range (basis points). */
export const MAX_MONTHS = 1200;
export const MIN_RATE_BP = -9_000;
export const MAX_RATE_BP = 3_000;

function assertRate(bp: number): void {
  if (!Number.isInteger(bp) || bp < MIN_RATE_BP || bp > MAX_RATE_BP) throw new RangeError(`yearly rate out of range: ${bp}`);
}
function assertMonths(m: number): void {
  if (!Number.isInteger(m) || m < 0 || m > MAX_MONTHS) throw new RangeError(`months out of range: ${m}`);
}

/** a / b rounded half away from zero (b > 0). */
export function divRound(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  if (r === 0n) return q;
  const twice = (r < 0n ? -r : r) * 2n;
  if (twice >= b) return a < 0n ? q - 1n : q + 1n;
  return q;
}

/** Monthly factor = 12th root of (1 + yearlyBp / 10,000), scaled by 10^18, rounded down. */
export function monthlyFactor(yearlyBp: number): bigint {
  assertRate(yearlyBp);
  if (yearlyBp === 0) return FACTOR_SCALE;
  const target = (BigInt(10_000 + yearlyBp) * FACTOR_SCALE ** 12n) / 10_000n; // (1 + r) at scale^12
  // Newton's method for x^12 = target, starting above the root so it falls monotonically.
  let x = FACTOR_SCALE * 2n;
  for (;;) {
    const next = (11n * x + target / x ** 11n) / 12n;
    if (next >= x) break;
    x = next;
  }
  while (x ** 12n > target) x -= 1n;
  while ((x + 1n) ** 12n <= target) x += 1n;
  return x;
}

/** factor^months at FACTOR_SCALE (squaring, rounded half away from zero at each step). */
export function factorPow(factor: bigint, months: number): bigint {
  assertMonths(months);
  let result = FACTOR_SCALE;
  let base = factor;
  let n = months;
  while (n > 0) {
    if (n & 1) result = divRound(result * base, FACTOR_SCALE);
    base = divRound(base * base, FACTOR_SCALE);
    n >>= 1;
  }
  return result;
}

const toMicro = (c: Cents): bigint => BigInt(c) * MICRO;
/** Engine unit -> whole cents (half away from zero). The ONE place balances are rounded. */
const toCents = (m: bigint): Cents => Number(divRound(m, MICRO));
const grow = (m: bigint, factor: bigint): bigint => divRound(m * factor, FACTOR_SCALE);

/**
 * What `amountCents` invested today is worth after `months` at `yearlyBp` (today's dollars).
 * The future-you numbers ("This $50 could be $221 at age 40").
 */
export function growLump(amountCents: Cents, yearlyBp: number, months: number): Cents {
  if (!Number.isInteger(amountCents)) throw new RangeError('amount must be whole cents');
  assertMonths(months);
  const f = factorPow(monthlyFactor(yearlyBp), months);
  return toCents(grow(toMicro(amountCents), f));
}

// ---------------------------------------------------------------------------------------------
// Two-pool simulation (the accounting model)
// ---------------------------------------------------------------------------------------------

/**
 * One month of money, in whole cents.
 *   savingsCents: NEW money that month = income - spending (can be negative). Transfers and gifts
 *     are never part of it.
 *   toInvestedCents: money MOVED from cash to invested assets that month (Roth contributions,
 *     savings -> brokerage). A move, not new money: it is never added to savings a second time.
 */
export interface MonthMoney {
  savingsCents: Cents;
  toInvestedCents: Cents;
}

export interface SimInput {
  months: number;
  yearlyReturnBp: number;
  /** Checking, savings, cash, other: earns NO investment return. */
  startCashCents: Cents;
  /** Roth IRA, traditional IRA, brokerage, 401(k): grows at the return rate. */
  startInvestedCents: Cents;
  /** Debts and anything else held flat (subtracted from net worth as is). */
  fixedCents?: Cents;
  /** Money for month m (1-based). */
  money: (month: number) => MonthMoney;
}

export interface SimPoint {
  month: number;
  cashCents: Cents;
  investedCents: Cents;
  netWorthCents: Cents;
  /** Cumulative investment growth so far (invested - start - money moved in). */
  growthCents: Cents;
  /** True once cash ran out and a shortfall was taken from investments this month or earlier. */
  drewFromInvestments: boolean;
}

/**
 * Month by month: invested grows, then the month's savings land in cash and the move to invested
 * happens. If cash would go below $0, the shortfall comes out of invested assets (so money is never
 * created or lost: net worth changes only by savings + growth). Point 0 is today.
 */
export function simulate(input: SimInput): SimPoint[] {
  assertMonths(input.months);
  const factor = monthlyFactor(input.yearlyReturnBp);
  let cash = toMicro(input.startCashCents);
  let invested = toMicro(input.startInvestedCents);
  const fixed = input.fixedCents ?? 0;
  let movedIn = 0n;
  let drew = false;
  const point = (month: number): SimPoint => {
    const c = toCents(cash);
    const i = toCents(invested);
    return {
      month,
      cashCents: c,
      investedCents: i,
      netWorthCents: c + i + fixed,
      growthCents: toCents(invested - toMicro(input.startInvestedCents) - movedIn),
      drewFromInvestments: drew,
    };
  };
  const out: SimPoint[] = [point(0)];
  for (let m = 1; m <= input.months; m++) {
    invested = grow(invested, factor);
    const { savingsCents, toInvestedCents } = input.money(m);
    if (!Number.isInteger(savingsCents) || !Number.isInteger(toInvestedCents)) throw new RangeError('money must be whole cents');
    cash += toMicro(savingsCents) - toMicro(toInvestedCents);
    invested += toMicro(toInvestedCents);
    movedIn += toMicro(toInvestedCents);
    if (cash < 0n) {
      // Not enough cash: the rest comes out of investments (it is spending or a move with no cash).
      invested += cash;
      movedIn += cash;
      cash = 0n;
      drew = true;
    }
    out.push(point(m));
  }
  return out;
}

/** First month (0 = today) whose invested balance reaches `targetCents`, or null if never in range. */
export function firstMonthReaching(points: readonly SimPoint[], targetCents: Cents, pick: (p: SimPoint) => Cents = (p) => p.investedCents): number | null {
  for (const p of points) if (pick(p) >= targetCents) return p.month;
  return null;
}

/**
 * Splits `savingsCents` the way the baseline does: the same share goes to investments.
 * The share is a ratio of two whole-cent numbers (no rounding until here), rounded half away from
 * zero to the cent. Negative or zero savings invest nothing.
 */
export function investedPart(savingsCents: Cents, share: { num: Cents; den: Cents } | null): Cents {
  if (!share || share.den <= 0 || savingsCents <= 0) return 0;
  return Number(divRound(BigInt(savingsCents) * BigInt(share.num), BigInt(share.den)));
}

// ---------------------------------------------------------------------------------------------
// Ages (birth month and year only; no day is ever stored)
// ---------------------------------------------------------------------------------------------

export interface BirthMonth {
  year: number;
  /** 1-12 */
  month: number;
}

function monthNumber(d: IsoDate): number {
  return Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
}

/** Whole years of age on `today` (a birthday counts from the first day of the birth month). */
export function ageOn(birth: BirthMonth, today: IsoDate): number {
  return Math.floor((monthNumber(today) - (birth.year * 12 + birth.month - 1)) / 12);
}

/**
 * Months from this month until the month the user turns `age` (0 = this is that month).
 * Negative = that age is already past.
 */
export function monthsUntilAge(birth: BirthMonth, today: IsoDate, age: number): number {
  return (birth.year + age) * 12 + birth.month - 1 - monthNumber(today);
}

/** Age (whole years) at month `m` of a projection that starts this month. */
export function ageAtMonth(birth: BirthMonth, today: IsoDate, m: number): number {
  return Math.floor((monthNumber(today) + m - (birth.year * 12 + birth.month - 1)) / 12);
}

/** The first day of the month `m` months from this one (month 0 = this month). */
export function monthDate(today: IsoDate, m: number): IsoDate {
  return addMonths(startOfMonth(today), m);
}

// ---------------------------------------------------------------------------------------------
// Future you (the time machine card and the expense line)
// ---------------------------------------------------------------------------------------------

export interface FutureYou {
  /** The age it is worth this much at. */
  age: number;
  /** Months of growth from this month to the month of that birthday. */
  months: number;
  valueCents: Cents;
}

/**
 * What `amountCents` invested now would be worth at an age, in today's dollars, at `yearlyBp` after inflation.
 * Without `age`: at 40, or at 65 once 40 has passed; null once 65 has passed (nothing to show).
 * With `age`: at that age (an age already reached means this month, no growth).
 */
export function futureYou(amountCents: Cents, birth: BirthMonth, today: IsoDate, yearlyBp: number, age?: number): FutureYou | null {
  let target = age;
  if (target === undefined) {
    if (monthsUntilAge(birth, today, 40) > 0) target = 40;
    else if (monthsUntilAge(birth, today, 65) > 0) target = 65;
    else return null;
  }
  const months = Math.max(0, monthsUntilAge(birth, today, target));
  return { age: target, months, valueCents: growLump(amountCents, yearlyBp, months) };
}

/** "$221" for the expense line: whole dollars, rounded DOWN so it never says more than the estimate. */
export function wholeDollarsDown(cents: Cents): string {
  return `$${Math.floor(cents / 100).toLocaleString('en-US')}`;
}
