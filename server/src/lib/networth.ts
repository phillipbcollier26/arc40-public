import type { AccountClass } from '../../../shared/accounts.js';
import { addDays, addMonths, type IsoDate } from '../../../shared/dates.js';
import { assertCents, type Cents } from './money.js';

/**
 * Net worth math. Pure functions, no database.
 *
 * Balance of an account on date D (see CLAUDE.md "Net worth"):
 *  - On or after its first balance snapshot: the latest snapshot on or before D,
 *    plus the transactions dated after that snapshot up to D.
 *  - Before its first snapshot, but after its earliest transaction:
 *      bank/cash accounts: worked BACKWARD from the first snapshot through the
 *        transactions in between (so imported history fills in the chart);
 *      investment accounts: the money put in so far (cost basis), because
 *        market value needs fund prices (Milestone 5).
 *  - No snapshot at all: the running total of its transactions.
 *  - Before the earliest snapshot or transaction: nothing (no data yet).
 * This keeps transfers continuous: money leaving one account shows up in the
 * other on the same day instead of looking like a loss.
 * Liabilities subtract.
 */

export interface NwAccount {
  id: number;
  class: AccountClass;
  isInvestment?: boolean;
}

export interface NwSnapshot {
  accountId: number;
  asOf: IsoDate;
  balanceCents: Cents;
}

/** A transaction's effect on its account's balance (signed cents). */
export interface NwFlow {
  accountId: number;
  date: IsoDate;
  amountCents: Cents;
}

export interface NwPoint {
  date: IsoDate;
  totalCents: Cents;
  assetsCents: Cents;
  liabilitiesCents: Cents;
  /** Signed contribution of each account (liabilities negative). Missing = no data yet. */
  byAccount: Record<number, Cents>;
}

/** Index of the last element with key <= d, or -1. */
function lastAtOrBefore<T>(xs: readonly T[], d: IsoDate, key: (x: T) => IsoDate): number {
  let lo = 0;
  let hi = xs.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(xs[mid]!) <= d) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Balance of one account on each date, or undefined where there is no data yet. */
function accountBalances(
  isInvestment: boolean,
  snaps: readonly NwSnapshot[],
  flows: readonly NwFlow[],
  dates: readonly IsoDate[],
): (Cents | undefined)[] {
  // cum[i] = sum of flows[0..i]
  const cum: number[] = [];
  let run = 0;
  for (const f of flows) cum.push((run += assertCents(f.amountCents)));
  const cumAt = (d: IsoDate) => {
    const i = lastAtOrBefore(flows, d, (f) => f.date);
    return i < 0 ? 0 : cum[i]!;
  };
  const firstSnap = snaps[0];
  const firstFlow = flows[0];
  const start = [firstSnap?.asOf, firstFlow?.date].filter((x): x is string => !!x).sort()[0];

  return dates.map((d) => {
    if (!start || d < start) return undefined;
    const si = lastAtOrBefore(snaps, d, (s) => s.asOf);
    if (si >= 0) {
      const s = snaps[si]!;
      return assertCents(s.balanceCents) + cumAt(d) - cumAt(s.asOf);
    }
    if (firstSnap && !isInvestment) return assertCents(firstSnap.balanceCents) - (cumAt(firstSnap.asOf) - cumAt(d));
    return cumAt(d);
  });
}

/** Net worth at each requested date (sorted, unique in the output). */
export function netWorthSeries(
  accounts: readonly NwAccount[],
  snapshots: readonly NwSnapshot[],
  dates: readonly IsoDate[],
  flows: readonly NwFlow[] = [],
): NwPoint[] {
  const sortedDates = [...new Set(dates)].sort();
  const byDate = <T extends { accountId: number }>(xs: readonly T[], key: (x: T) => IsoDate, id: number) =>
    xs.filter((x) => x.accountId === id).sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

  const perAccount = accounts.map((a) => ({
    a,
    values: accountBalances(
      !!a.isInvestment,
      byDate(snapshots, (s) => s.asOf, a.id),
      byDate(flows, (f) => f.date, a.id),
      sortedDates,
    ),
  }));

  return sortedDates.map((date, di) => {
    let assets = 0;
    let liabilities = 0;
    const byAccount: Record<number, Cents> = {};
    for (const { a, values } of perAccount) {
      const bal = values[di];
      if (bal === undefined) continue;
      if (a.class === 'liability') {
        liabilities += bal;
        byAccount[a.id] = -bal;
      } else {
        assets += bal;
        byAccount[a.id] = bal;
      }
    }
    return {
      date,
      assetsCents: assets,
      liabilitiesCents: liabilities,
      totalCents: assertCents(assets - liabilities),
      byAccount,
    };
  });
}

export function netWorthOn(
  accounts: readonly NwAccount[],
  snapshots: readonly NwSnapshot[],
  date: IsoDate,
  flows: readonly NwFlow[] = [],
): NwPoint {
  return netWorthSeries(accounts, snapshots, [date], flows)[0]!;
}

export type Range = '1m' | '3m' | '6m' | '1y' | 'all';
export const RANGES: readonly Range[] = ['1m', '3m', '6m', '1y', 'all'];

/** First date shown for a range. 'all' starts at the earliest snapshot. */
export function rangeStart(range: Range, today: IsoDate, earliest: IsoDate | null): IsoDate {
  switch (range) {
    case '1m':
      return addMonths(today, -1);
    case '3m':
      return addMonths(today, -3);
    case '6m':
      return addMonths(today, -6);
    case '1y':
      return addMonths(today, -12);
    case 'all':
      return earliest && earliest < today ? earliest : addDays(today, -30);
  }
}

/**
 * Dates to plot: the range start, every date a balance or transaction changed
 * inside the range, and today. Charts draw straight lines between these points.
 */
export function chartDates(changeDates: readonly IsoDate[], from: IsoDate, to: IsoDate): IsoDate[] {
  const set = new Set<IsoDate>([from, to]);
  for (const d of changeDates) if (d > from && d < to) set.add(d);
  return [...set].sort();
}

/**
 * Percentage change in basis points (1% = 100), or null when the starting
 * value is zero (a percent change from nothing is meaningless).
 */
export function changeBasisPoints(fromCents: Cents, toCents: Cents): number | null {
  if (fromCents === 0) return null;
  return Math.round(((toCents - fromCents) * 10_000) / Math.abs(fromCents));
}
