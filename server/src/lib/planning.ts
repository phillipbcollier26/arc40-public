/**
 * The "current path" (V2 Phase 3): what the projection engine (lib/projection.ts) starts from.
 * Read-only: it never writes to the database.
 *
 * Baseline months: the last N COMPLETE months before this month (N = 3, 6 or 12, like the Budget
 * page). Months before the first money line are not counted; quiet months count as $0.
 *
 *   income   = average monthly income   (lib/totals.ts: sum of income lines)
 *   spending = average monthly spending (lib/totals.ts: -(sum of expense lines); refunds lower it)
 *   savings  = income - spending        (transfers and gifts are never income or spending)
 * Averages are rounded half away from zero to the cent; savings is income - spending of those.
 *
 * How savings are split (the accounting model):
 *   recent investing = average "money put in" to investment accounts in the same months
 *     (contributions + transfers in - transfers out, from investment activity). These are MOVES
 *     of money the user already had, never new savings.
 *   toInvested = recent investing, but never below $0 and never more than savings. So a one-off
 *     big move (savings -> brokerage) cannot pretend the user invests more than they save.
 *   share = toInvested / savings (kept as a ratio of whole cents). A scenario that changes savings
 *     invests the same share of its new savings (lib/projection.ts investedPart).
 *   The rest of savings stays in cash, which earns no investment return.
 *
 * Starting balances today come from the net worth math (the same numbers as the Accounts page):
 * investment accounts -> invested, liabilities -> held flat, everything else -> cash.
 */
import type { DB } from '../db/database.js';
import { ACCOUNT_TYPES, type AccountType } from '../../../shared/accounts.js';
import { addDays, addMonths, startOfMonth, type IsoDate } from '../../../shared/dates.js';
import { listAccounts, listSnapshots, toNw } from './accounts.js';
import { loadActivity } from './activity.js';
import { moneyIn, signedContributions } from './investments.js';
import { netWorthOn } from './networth.js';
import { firstLineDate, loadMoneyLines, sumLines } from './totals.js';
import { getSetting } from './settings.js';
import { divRound, simulate, investedPart, type SimPoint, type BirthMonth } from './projection.js';
import type { Cents } from './money.js';

export const BASELINE_MONTHS = [3, 6, 12] as const;
export type BaselineMonths = (typeof BASELINE_MONTHS)[number];

export interface Baseline {
  today: IsoDate;
  monthsRequested: BaselineMonths;
  /** Complete months actually averaged (0 = no history yet: everything is $0). */
  monthsUsed: number;
  /** First and last day of the averaged months (null when monthsUsed = 0). */
  from: IsoDate | null;
  to: IsoDate | null;
  incomeCents: Cents;
  spendingCents: Cents;
  savingsCents: Cents;
  /** Average monthly money put in to investment accounts (raw, may be above savings or negative). */
  recentInvestingCents: Cents;
  /** What the current path moves to investments each month: recent investing capped to [0, savings]. */
  toInvestedCents: Cents;
  /** toInvested / savings as whole cents (null when savings <= 0: nothing is invested). */
  share: { num: Cents; den: Cents } | null;
  /** Average monthly Roth IRA contributions in the same months (part of toInvested, never extra). */
  rothMonthlyCents: Cents;
  /** Today's balances. */
  cashCents: Cents;
  investedCents: Cents;
  /** Liabilities (negative) held flat. */
  fixedCents: Cents;
  /**
   * Same split, per account (for goal dates). flowCents = that account's average monthly net change from money
   * moving in and out in the same months (cash accounts: every money line on the account; investment accounts:
   * money put in), without investment growth.
   */
  accounts: { id: number; name: string; type: AccountType; pool: 'cash' | 'invested' | 'fixed'; balanceCents: Cents; flowCents: Cents }[];
  /** Average monthly spending per expense category in the same months (key = category id, 'none' = uncategorized). */
  spendingByCategory: Record<string, Cents>;
}

const avg = (sum: number, n: number): Cents => (n === 0 ? 0 : Number(divRound(BigInt(sum), BigInt(n))));

/** The complete months used for the baseline (oldest first), honoring the first money line. */
export function baselineMonths(today: IsoDate, n: number, firstDate: IsoDate | null): IsoDate[] {
  if (!firstDate) return [];
  const first = startOfMonth(firstDate);
  const months: IsoDate[] = [];
  for (let i = n; i >= 1; i--) {
    const m = addMonths(startOfMonth(today), -i);
    if (m >= first) months.push(m);
  }
  return months;
}

export function buildBaseline(db: DB, today: IsoDate, n: BaselineMonths): Baseline {
  const months = baselineMonths(today, n, firstLineDate(db));
  const used = months.length;
  const from = used ? months[0]! : null;
  const to = used ? addDays(startOfMonth(today), -1) : null;

  let income = 0;
  let spending = 0;
  const lines = from && to ? loadMoneyLines(db, { from, to }) : [];
  if (from && to) {
    income = avg(sumLines(lines, 'income'), used);
    spending = avg(-sumLines(lines, 'expense'), used);
  }
  const catSums = new Map<string, number>();
  const accountSums = new Map<number, number>();
  for (const l of lines) {
    accountSums.set(l.accountId, (accountSums.get(l.accountId) ?? 0) + l.amountCents);
    if (l.type !== 'expense') continue;
    const k = l.categoryId === null ? 'none' : String(l.categoryId);
    catSums.set(k, (catSums.get(k) ?? 0) - l.amountCents);
  }
  const spendingByCategory: Record<string, Cents> = {};
  for (const [k, v] of catSums) spendingByCategory[k] = avg(v, used);
  const savings = income - spending;

  const accounts = listAccounts(db, { includeArchived: true });
  const investIds = new Set(accounts.filter((a) => ACCOUNT_TYPES[a.type as AccountType]?.isInvestment).map((a) => a.id));
  const rothIds = new Set(accounts.filter((a) => a.type === 'roth_ira').map((a) => a.id));
  const inWindow = loadActivity(db).filter((a) => from && to && a.date >= from && a.date <= to);
  const recentInvesting = avg(inWindow.filter((a) => investIds.has(a.accountId)).reduce((s, a) => s + moneyIn(a), 0), used);
  const roth = avg(
    signedContributions(inWindow.filter((a) => rothIds.has(a.accountId))),
    used,
  );
  const toInvested = savings > 0 ? Math.min(Math.max(recentInvesting, 0), savings) : 0;

  const nw = toNw(db, accounts, listSnapshots(db), today);
  const point = netWorthOn(nw.accounts, nw.snapshots, today, nw.flows);
  let cash = 0;
  let invested = 0;
  let fixed = 0;
  const perAccount: Baseline['accounts'] = [];
  for (const a of accounts) {
    const bal = point.byAccount[a.id] ?? 0;
    const def = ACCOUNT_TYPES[a.type as AccountType];
    const pool = def?.class === 'liability' ? 'fixed' : def?.isInvestment ? 'invested' : 'cash';
    if (pool === 'fixed') fixed += bal;
    else if (pool === 'invested') invested += bal;
    else cash += bal;
    const flowSum =
      pool === 'invested'
        ? inWindow.filter((x) => x.accountId === a.id).reduce((t, x) => t + moneyIn(x), 0)
        : (accountSums.get(a.id) ?? 0);
    perAccount.push({ id: a.id, name: a.name, type: a.type as AccountType, pool, balanceCents: bal, flowCents: avg(flowSum, used) });
  }

  return {
    today,
    monthsRequested: n,
    monthsUsed: used,
    from,
    to,
    incomeCents: income,
    spendingCents: spending,
    savingsCents: savings,
    recentInvestingCents: recentInvesting,
    toInvestedCents: toInvested,
    share: savings > 0 ? { num: toInvested, den: savings } : null,
    rothMonthlyCents: roth,
    cashCents: cash,
    investedCents: invested,
    fixedCents: fixed,
    accounts: perAccount,
    spendingByCategory,
  };
}

/** The current path, month by month, using the same engine and rules as every scenario. */
export function projectCurrentPath(b: Baseline, months: number, yearlyReturnBp: number): SimPoint[] {
  return simulate({
    months,
    yearlyReturnBp,
    startCashCents: b.cashCents,
    startInvestedCents: b.investedCents,
    fixedCents: b.fixedCents,
    money: () => ({ savingsCents: b.savingsCents, toInvestedCents: investedPart(b.savingsCents, b.share) }),
  });
}

export interface PlanningSettings {
  returnRateBp: number;
  birth: BirthMonth | null;
}

export function planningSettings(db: DB): PlanningSettings {
  return { returnRateBp: getSetting(db, 'planning_return_bp'), birth: getSetting(db, 'birth_month') };
}
