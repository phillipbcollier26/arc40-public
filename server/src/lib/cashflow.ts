/**
 * Income, spending and savings rate. Pure functions over transactions.
 *
 *   income   = sum of type 'income' (refereeing pay, interest, other income)
 *   spending = -(sum of type 'expense')  (refunds are positive expenses, so they lower it)
 *   transfers and gifts are excluded from BOTH sides
 *   savings rate = (income - spending) / income, in basis points
 *   no income -> null ("No income this month"), never 0% and never a division by zero
 *   YTD rate comes from YTD totals, not an average of monthly rates
 */
import { addMonths, startOfMonth, type IsoDate } from '../../../shared/dates.js';
import type { TxType } from '../../../shared/transactions.js';
import type { Cents } from './money.js';

export interface CashTx {
  date: IsoDate;
  amountCents: Cents;
  type: TxType;
  categoryId: number | null;
}

export interface Totals {
  incomeCents: Cents;
  spendingCents: Cents;
  giftCents: Cents;
}

export function totals(txs: readonly CashTx[]): Totals {
  let income = 0;
  let expense = 0;
  let gift = 0;
  for (const t of txs) {
    if (t.type === 'income') income += t.amountCents;
    else if (t.type === 'expense') expense += t.amountCents;
    else if (t.type === 'gift') gift += t.amountCents;
  }
  return { incomeCents: income, spendingCents: -expense, giftCents: gift };
}

/** (income - spending) / income in basis points, rounded half away from zero. null when income <= 0. */
export function savingsRateBp(incomeCents: Cents, spendingCents: Cents): number | null {
  if (incomeCents <= 0) return null;
  const num = (incomeCents - spendingCents) * 10_000;
  return Math.sign(num) * Math.round(Math.abs(num) / incomeCents);
}

/** Spending per category (null = uncategorized). Only expense-type transactions. */
export function spendingByCategory(txs: readonly CashTx[]): Map<number | null, Cents> {
  const out = new Map<number | null, Cents>();
  for (const t of txs) {
    if (t.type !== 'expense') continue;
    out.set(t.categoryId, (out.get(t.categoryId) ?? 0) - t.amountCents);
  }
  return out;
}

export const monthKey = (d: IsoDate) => startOfMonth(d);

export interface MonthRow extends Totals {
  month: IsoDate; // YYYY-MM-01
  savingsRateBp: number | null;
}

/** One row per month from `firstMonth` through `lastMonth` (inclusive), empty months included. */
export function monthlyRows(txs: readonly CashTx[], firstMonth: IsoDate, lastMonth: IsoDate): MonthRow[] {
  const buckets = new Map<IsoDate, CashTx[]>();
  for (const t of txs) {
    const k = monthKey(t.date);
    if (k < firstMonth || k > lastMonth) continue;
    buckets.set(k, [...(buckets.get(k) ?? []), t]);
  }
  const rows: MonthRow[] = [];
  for (let m = firstMonth; m <= lastMonth; m = addMonths(m, 1)) {
    const t = totals(buckets.get(m) ?? []);
    rows.push({ month: m, ...t, savingsRateBp: savingsRateBp(t.incomeCents, t.spendingCents) });
  }
  return rows;
}

/**
 * Average monthly income over the last `n` COMPLETE months before `currentMonth`.
 * Only months on or after the first month with any transaction count, so a new
 * user is not averaged against empty months. Returns null when there is no history.
 * The average is rounded to the nearest cent.
 */
export function incomeAverage(
  txs: readonly CashTx[],
  currentMonth: IsoDate,
  n: number,
): { avgCents: Cents | null; monthsUsed: number } {
  const earliest = txs.reduce<IsoDate | null>((m, t) => (m === null || t.date < m ? t.date : m), null);
  if (!earliest) return { avgCents: null, monthsUsed: 0 };
  const firstAllowed = monthKey(earliest);
  const months: IsoDate[] = [];
  for (let i = 1; i <= n; i++) {
    const m = addMonths(currentMonth, -i);
    if (m >= firstAllowed) months.push(m);
  }
  if (!months.length) return { avgCents: null, monthsUsed: 0 };
  const set = new Set(months);
  const sum = txs.filter((t) => t.type === 'income' && set.has(monthKey(t.date))).reduce((s, t) => s + t.amountCents, 0);
  return { avgCents: Math.round(sum / months.length), monthsUsed: months.length };
}

/**
 * Optional tax set-aside ESTIMATE for gig pay. Not tax advice: it is simply
 * the percentage the user chose, applied to refereeing pay (optionally minus
 * refereeing costs). Never negative.
 */
export function setAsideCents(payCents: Cents, costsCents: Cents, bp: number, onNet: boolean): Cents {
  if (bp <= 0) return 0;
  const base = Math.max(0, onNet ? payCents - costsCents : payCents);
  return Math.round((base * bp) / 10_000);
}
