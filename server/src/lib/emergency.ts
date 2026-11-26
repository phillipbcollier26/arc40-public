/**
 * The emergency fund numbers (Goals card, Dashboard ring, Trophies Round 3). ONE place, so every screen agrees:
 *   average monthly spending = spending over the last 6 COMPLETE months before `currentMonth` (months before the first
 *     money line are not counted), divided by the months used, rounded once (Math.round)
 *   target = 6 x (average + the optional essentials setting, "costs someone else covers")
 *   savings = the balances of savings-type accounts that are not archived
 * Spending comes from lib/totals.ts (expense money lines: split pieces included, refunds lower it).
 */
import type { DB } from '../db/database.js';
import { addDays, addMonths, startOfMonth, type IsoDate } from '../../../shared/dates.js';
import { firstLineDate, loadMoneyLines } from './totals.js';

export const EMERGENCY_MONTHS = 6;
export const AVERAGE_MONTHS = 6;

/**
 * Pure: the average from per-month expense sums. `expenseByMonth('YYYY-MM-01')` = the SIGNED sum of that month's
 * expense lines (money out is negative). Same arithmetic as the Goals card has always used.
 */
export function averageSpending(
  expenseByMonth: (month: IsoDate) => number,
  first: IsoDate | null,
  currentMonth: IsoDate,
): { avgCents: number | null; monthsUsed: number } {
  if (!first) return { avgCents: null, monthsUsed: 0 };
  const months: IsoDate[] = [];
  for (let i = 1; i <= AVERAGE_MONTHS; i++) {
    const m = addMonths(currentMonth, -i);
    if (m >= startOfMonth(first)) months.push(m);
  }
  if (!months.length) return { avgCents: null, monthsUsed: 0 };
  const s = months.reduce((t, m) => t + expenseByMonth(m), 0);
  return { avgCents: Math.round(-s / months.length), monthsUsed: months.length };
}

/** The Goals card's average monthly spending for `currentMonth` ('YYYY-MM-01'). */
export function avgMonthlySpending(db: DB, currentMonth: IsoDate): { avgCents: number | null; monthsUsed: number } {
  const first = firstLineDate(db);
  if (!first) return { avgCents: null, monthsUsed: 0 };
  const from = addMonths(currentMonth, -AVERAGE_MONTHS);
  const lines = loadMoneyLines(db, { from, to: addDays(currentMonth, -1) });
  const byMonth = new Map<string, number>();
  for (const l of lines) if (l.type === 'expense') byMonth.set(l.date.slice(0, 7), (byMonth.get(l.date.slice(0, 7)) ?? 0) + l.amountCents);
  return averageSpending((m) => byMonth.get(m.slice(0, 7)) ?? 0, first, currentMonth);
}

/** Monthly amount the fund is measured against: average + essentials. null when there is nothing to measure. */
export function monthlyNeed(avgCents: number | null, essentialsCents: number): number | null {
  if (avgCents === null && essentialsCents === 0) return null;
  return (avgCents ?? 0) + essentialsCents;
}
