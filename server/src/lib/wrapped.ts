/**
 * Arc40 Wrapped (V2 Phase 4): a year in review. READ-ONLY: nothing here writes to the database.
 *
 * Every number comes from the same source the rest of the app uses for the same dates, so Wrapped always
 * agrees with the other screens (consistency.test.ts checks it):
 *   income, spending, gifts, categories, merchants, refereeing   lib/totals.ts money lines (split pieces included)
 *   months, savings rate                                       lib/cashflow.ts (monthlyRows, savingsRateBp)
 *   net worth                                                  toNw + netWorthOn (same as /api/networth)
 *   investments                                                toNw daily values + moneyPutIn (same as /api/investments)
 *   subscriptions                                              itemCharges (the Recurring page's charge matching)
 *   Roth                                                       contributions for the tax year vs ira_limits (Goals)
 *   work cost                                                  shared/workCost.ts with the Settings choice
 *   future you                                                 shared/projection.ts futureYou (the Phase 3 engine)
 * A slide with nothing to show is left out (never an empty slide). The current year is "so far" (Jan 1 to today).
 */
import type { DB } from '../db/database.js';
import { addDays, addMonths, startOfMonth, type IsoDate } from '../../../shared/dates.js';
import { listAccounts, listSnapshots, toNw } from './accounts.js';
import { loadActivity } from './activity.js';
import { monthlyRows, savingsRateBp, spendingByCategory, totals } from './cashflow.js';
import { contributionsForTaxYear, moneyPutIn } from './investments.js';
import type { Cents } from './money.js';
import { changeBasisPoints, netWorthOn, netWorthSeries } from './networth.js';
import { planningSettings } from './planning.js';
import { futureYou } from './projection.js';
import { merchantKey } from './recurring.js';
import { itemCharges } from './recurringItems.js';
import { getSetting } from './settings.js';
import { firstLineDate, loadMoneyLines, type MoneyLine } from './totals.js';
import { categoryByRole, listCategories, type CategoryRole } from './transactions.js';
import { formatWorkCost, workCostState, workTenths } from './workCost.js';

export const MIN_YEAR = 2000;
const EARNED: readonly CategoryRole[] = ['refereeing', 'other_income'];

/** a / b rounded half away from zero, whole numbers only (b > 0). */
export function roundDiv(a: number, b: number): number {
  const q = Math.floor((Math.abs(a) * 2 + b) / (b * 2));
  return a < 0 ? -q : q;
}

/** Share in basis points, rounded half up with whole numbers. 0 when the total is not positive. */
export function shareBp(part: Cents, total: Cents): number {
  if (total <= 0) return 0;
  return Math.floor((part * 20_000 + total) / (total * 2));
}

// ---------- pure helpers (tested directly) ----------

export interface MerchantTotal {
  key: string;
  name: string;
  cents: Cents;
  visits: number;
}

/**
 * Spending per merchant: expense lines grouped by merchantKey (the Recurring page's merchant grouping) of the
 * cleaned description. Split pieces count at their own amounts; refunds lower the merchant's total; a split
 * transaction is one visit. The name shown is the merchant's most frequent description (latest wins a tie).
 */
export function merchantTotals(lines: readonly MoneyLine[]): MerchantTotal[] {
  const groups = new Map<string, { cents: Cents; visits: Set<number>; names: Map<string, { txs: Set<number>; last: string }> }>();
  for (const l of lines) {
    if (l.type !== 'expense') continue;
    const desc = (l.description ?? '').trim() || 'Unknown merchant';
    const key = merchantKey(desc) || desc.toUpperCase();
    const g = groups.get(key) ?? { cents: 0, visits: new Set<number>(), names: new Map() };
    g.cents -= l.amountCents;
    if (l.amountCents < 0) g.visits.add(l.txId);
    const nm = g.names.get(desc) ?? { txs: new Set<number>(), last: '' };
    nm.txs.add(l.txId); // a split transaction counts once
    nm.last = l.date > nm.last ? l.date : nm.last;
    g.names.set(desc, nm);
    groups.set(key, g);
  }
  return [...groups]
    .map(([key, g]) => {
      const name = [...g.names].sort((a, b) => b[1].txs.size - a[1].txs.size || (a[1].last < b[1].last ? 1 : a[1].last > b[1].last ? -1 : 0))[0]![0];
      return { key, name, cents: g.cents, visits: g.visits.size };
    })
    .filter((m) => m.cents > 0)
    .sort((a, b) => b.cents - a.cents || (a.name < b.name ? -1 : 1));
}

/** First day of each month from `from` to the month of `to`. */
export function monthsBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let m = startOfMonth(from); m <= startOfMonth(to); m = addMonths(m, 1)) out.push(m);
  return out;
}

// ---------- slides ----------

export type WrappedSlide =
  | { kind: 'topMerchant'; name: string; cents: Cents; visits: number; shareBp: number; runnersUp: { name: string; cents: Cents }[] }
  | { kind: 'biggestMonth'; month: IsoDate; cents: Cents; averageCents: Cents; months: { month: IsoDate; cents: Cents }[] }
  | {
      kind: 'refereeing';
      totalCents: Cents;
      byPayer: { payer: string; cents: Cents }[];
      busiestMonth: { month: IsoDate; cents: Cents };
      months: { month: IsoDate; cents: Cents }[];
    }
  | { kind: 'netWorth'; startDate: IsoDate; endDate: IsoDate; startCents: Cents; endCents: Cents; changeCents: Cents; changeBp: number | null; firstYear: boolean }
  | { kind: 'savingsRate'; incomeCents: Cents; spendingCents: Cents; keptCents: Cents; rateBp: number }
  | {
      kind: 'investments';
      startDate: IsoDate;
      endDate: IsoDate;
      startValueCents: Cents;
      endValueCents: Cents;
      /** Contributions and transfers in, minus transfers out, during the year. Never counted as growth. */
      putInCents: Cents;
      /** Market gains and losses: end value - start value - money put in. */
      growthCents: Cents;
      estimated: boolean;
      notes: string[];
    }
  | {
      kind: 'subscriptions';
      totalCents: Cents;
      chargeCount: number;
      items: { name: string; cents: Cents; charges: number; status: 'confirmed' | 'cancelled' }[];
      manualNotCounted: number;
    }
  | { kind: 'roth'; taxYear: number; contributedCents: Cents; limitCents: Cents | null; percentBp: number | null; earnedCents: Cents }
  | { kind: 'topCategory'; categoryId: number | null; name: string; color: string; cents: Cents; shareBp: number; spendingCents: Cents; next: { name: string; cents: Cents }[] }
  | { kind: 'workCost'; spendingCents: Cents; tenths: number; text: string; unit: 'game' | 'hour'; title: string | null }
  | { kind: 'futureYou'; investedCents: Cents; age: number; months: number; valueCents: Cents; returnRateBp: number };

export interface Wrapped {
  year: number;
  soFar: boolean;
  from: IsoDate;
  to: IsoDate;
  today: IsoDate;
  slides: WrappedSlide[];
}

/** Years that have any transaction or investment activity, newest first; the current year is "so far". */
export function wrappedYears(db: DB, today: IsoDate): { year: number; soFar: boolean }[] {
  const thisYear = Number(today.slice(0, 4));
  const rows = db
    .prepare(
      `SELECT DISTINCT CAST(substr(date, 1, 4) AS INTEGER) AS y FROM transactions
       UNION SELECT DISTINCT CAST(substr(date, 1, 4) AS INTEGER) FROM investment_activity`,
    )
    .all() as { y: number }[];
  return rows
    .map((r) => r.y)
    .filter((y) => Number.isInteger(y) && y >= MIN_YEAR && y <= thisYear)
    .sort((a, b) => b - a)
    .map((year) => ({ year, soFar: year === thisYear }));
}

export class WrappedError extends Error {}

export function wrappedYear(db: DB, year: number, today: IsoDate): Wrapped {
  const thisYear = Number(today.slice(0, 4));
  if (!wrappedYears(db, today).some((y) => y.year === year)) {
    throw new WrappedError(year > thisYear ? 'That year has not happened yet.' : 'Arc40 has no money for that year.');
  }
  const soFar = year === thisYear;
  const from = `${year}-01-01`;
  const to = soFar ? today : `${year}-12-31`;
  const lines = loadMoneyLines(db, { from, to });
  const cats = listCategories(db);
  const catById = new Map(cats.map((c) => [c.id, c]));
  const t = totals(lines);
  const months = monthsBetween(from, to);
  const rows = monthlyRows(lines, months[0]!, months.at(-1)!);
  const slides: WrappedSlide[] = [];

  // 1. Top merchant
  const merchants = merchantTotals(lines);
  if (merchants.length) {
    const top = merchants[0]!;
    slides.push({
      kind: 'topMerchant',
      name: top.name,
      cents: top.cents,
      visits: top.visits,
      shareBp: shareBp(top.cents, t.spendingCents),
      runnersUp: merchants.slice(1, 3).map((m) => ({ name: m.name, cents: m.cents })),
    });
  }

  // 2. Biggest spending month
  const spentMonths = rows.map((r) => ({ month: r.month, cents: r.spendingCents }));
  const biggest = [...spentMonths].sort((a, b) => b.cents - a.cents || (a.month < b.month ? -1 : 1))[0];
  if (biggest && biggest.cents > 0) {
    // Months before the first transaction in Arc40 are not counted (same rule as the Budget income average).
    const first = firstLineDate(db);
    const n = Math.max(1, spentMonths.filter((m) => first === null || m.month >= startOfMonth(first)).length);
    slides.push({ kind: 'biggestMonth', month: biggest.month, cents: biggest.cents, averageCents: roundDiv(t.spendingCents, n), months: spentMonths });
  }

  // 3. Refereeing season (by money, never by number of games)
  const ref = categoryByRole(cats, 'refereeing');
  if (ref) {
    const refLines = lines.filter((l) => l.type === 'income' && l.categoryId === ref.id);
    const total = refLines.reduce((s, l) => s + l.amountCents, 0);
    if (total > 0) {
      const payers = new Map<string, Cents>();
      const byMonth = new Map<string, Cents>(months.map((m) => [m, 0]));
      for (const l of refLines) {
        const payer = l.payer === '' ? 'Not specified' : l.payer;
        payers.set(payer, (payers.get(payer) ?? 0) + l.amountCents);
        const m = startOfMonth(l.date);
        byMonth.set(m, (byMonth.get(m) ?? 0) + l.amountCents);
      }
      const monthList = [...byMonth].map(([month, cents]) => ({ month, cents }));
      const busiest = [...monthList].sort((a, b) => b.cents - a.cents || (a.month < b.month ? -1 : 1))[0]!;
      slides.push({
        kind: 'refereeing',
        totalCents: total,
        byPayer: [...payers]
          .map(([payer, cents]) => ({ payer, cents }))
          .sort((x, y) => y.cents - x.cents || (x.payer < y.payer ? -1 : x.payer > y.payer ? 1 : 0)),
        busiestMonth: busiest,
        months: monthList,
      });
    }
  }

  // 4. Net worth growth: end of the year (or today) vs the end of the day before the year started.
  const accounts = listAccounts(db, { includeArchived: true });
  const nw = toNw(db, accounts, listSnapshots(db), today);
  const startDate = addDays(from, -1);
  const startNw = netWorthOn(nw.accounts, nw.snapshots, startDate, nw.flows);
  const endNw = netWorthOn(nw.accounts, nw.snapshots, to, nw.flows);
  const firstYear = !nw.changeDates.some((d) => d <= startDate);
  if (startNw.totalCents !== 0 || endNw.totalCents !== 0) {
    slides.push({
      kind: 'netWorth',
      startDate,
      endDate: to,
      startCents: startNw.totalCents,
      endCents: endNw.totalCents,
      changeCents: endNw.totalCents - startNw.totalCents,
      changeBp: changeBasisPoints(startNw.totalCents, endNw.totalCents), // same as /api/networth's change
      firstYear,
    });
  }

  // 5. Savings rate for the year (year-to-date rule: from the year's totals, never an average of months)
  const rate = savingsRateBp(t.incomeCents, t.spendingCents);
  if (rate !== null) slides.push({ kind: 'savingsRate', incomeCents: t.incomeCents, spendingCents: t.spendingCents, keptCents: t.incomeCents - t.spendingCents, rateBp: rate });

  // 6. Investment growth, kept apart from money put in
  const inv = investmentYear(db, nw, accounts, startDate, to);
  if (inv.slide) slides.push(inv.slide);

  // 7. Subscriptions: the charges that year that belong to saved recurring items (Recurring page matching)
  const items = itemCharges(db)
    .map((it) => {
      const inYear = it.charges.filter((c) => c.date >= from && c.date <= to);
      return { name: it.name, status: it.status, source: it.source, cents: inYear.reduce((s, c) => s + c.amountCents, 0), charges: inYear.length };
    })
    .filter((x) => x.source === 'detected');
  const subTotal = items.reduce((s, x) => s + x.cents, 0);
  if (subTotal > 0) {
    slides.push({
      kind: 'subscriptions',
      totalCents: subTotal,
      chargeCount: items.reduce((s, x) => s + x.charges, 0),
      items: items
        .filter((x) => x.cents > 0)
        .sort((a, b) => b.cents - a.cents || (a.name < b.name ? -1 : 1))
        .slice(0, 5)
        .map(({ name, cents, charges, status }) => ({ name, cents, charges, status })),
      manualNotCounted: (db.prepare("SELECT COUNT(*) AS n FROM recurring_items WHERE source = 'manual'").get() as { n: number }).n,
    });
  }

  // 8. Roth progress for that tax year (same numbers as Goals)
  const rothIds = new Set(accounts.filter((a) => a.type === 'roth_ira').map((a) => a.id));
  if (rothIds.size) {
    const acts = loadActivity(db);
    const contributed = contributionsForTaxYear(acts, year, rothIds);
    if (contributed > 0) {
      const limit = getSetting(db, 'ira_limits')[String(year)]?.limitCents ?? null;
      const earnedIds = new Set(cats.filter((c) => c.role !== null && EARNED.includes(c.role)).map((c) => c.id));
      const earned = loadMoneyLines(db, { from, to: `${year}-12-31` })
        .filter((l) => l.type === 'income' && l.categoryId !== null && earnedIds.has(l.categoryId))
        .reduce((s, l) => s + l.amountCents, 0);
      slides.push({ kind: 'roth', taxYear: year, contributedCents: contributed, limitCents: limit, percentBp: limit ? shareBp(contributed, limit) : null, earnedCents: earned });
    }
  }

  // 9. Top spending category
  const byCat = [...spendingByCategory(lines)].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1] || (a[0] ?? -1) - (b[0] ?? -1));
  if (byCat.length) {
    const [id, cents] = byCat[0]!;
    const name = (cid: number | null) => (cid === null ? 'Uncategorized' : (catById.get(cid)?.name ?? 'Unknown category'));
    slides.push({
      kind: 'topCategory',
      categoryId: id,
      name: name(id),
      color: id === null ? 'pewter' : (catById.get(id)?.color ?? 'pewter'),
      cents,
      shareBp: shareBp(cents, t.spendingCents),
      spendingCents: t.spendingCents,
      next: byCat.slice(1, 4).map(([cid, c]) => ({ name: name(cid), cents: c })),
    });
  }

  // 10. The year's spending in games or hours (only when work cost is on)
  const rateNow = workCostState(db).active;
  if (rateNow && t.spendingCents > 0) {
    const tenths = workTenths(t.spendingCents, rateNow);
    slides.push({ kind: 'workCost', spendingCents: t.spendingCents, tenths, text: formatWorkCost(tenths, rateNow), unit: rateNow.unit, title: rateNow.title });
  }

  // 11. Future you: what this year's money put into investments could be at 40 (65 once past 40)
  const settings = planningSettings(db);
  if (settings.birth && inv.putInCents > 0) {
    const fy = futureYou(inv.putInCents, settings.birth, today, settings.returnRateBp);
    if (fy) slides.push({ kind: 'futureYou', investedCents: inv.putInCents, age: fy.age, months: fy.months, valueCents: fy.valueCents, returnRateBp: settings.returnRateBp });
  }

  return { year, soFar, from, to, today, slides };
}

/**
 * Investment accounts over the year: value at both ends (the net worth balance, i.e. the rebuilt daily value),
 * money put in during the year, and growth = end - start - put in. Contributions never count as growth.
 *   - Accounts with Fidelity activity: put in = contributions + transfers in - transfers out (moneyPutIn).
 *   - Accounts without activity: put in = their transfer transactions; their value comes from typed balances,
 *     so the result is labeled estimated.
 *   - A boundary day priced from an estimated or stale price: labeled estimated.
 *   - A boundary day with NO price for a fund that was held: no slide (growth cannot be known), but the money
 *     put in is still returned (the future-you slide only needs that).
 */
function investmentYear(
  db: DB,
  nw: ReturnType<typeof toNw>,
  accounts: ReturnType<typeof listAccounts>,
  startDate: IsoDate,
  endDate: IsoDate,
): { slide: Extract<WrappedSlide, { kind: 'investments' }> | null; putInCents: Cents } {
  const invIds = new Set(accounts.filter((a) => a.isInvestment).map((a) => a.id));
  if (!invIds.size) return { slide: null, putInCents: 0 };
  const acts = loadActivity(db).filter((a) => invIds.has(a.accountId));
  const withActs = new Set(acts.map((a) => a.accountId));
  const pts = netWorthSeries(
    nw.accounts.filter((a) => invIds.has(a.id)),
    nw.snapshots,
    [startDate, endDate],
    nw.flows,
  );
  const sum = (p: (typeof pts)[number]) => Object.values(p.byAccount).reduce((s, c) => s + c, 0);
  const startValue = sum(pts[0]!);
  const endValue = sum(pts[1]!);

  let estimated = false;
  const notes: string[] = [];
  let putIn = moneyPutIn(acts, endDate, withActs) - moneyPutIn(acts, startDate, withActs);
  const others = [...invIds].filter((id) => !withActs.has(id));
  if (others.length) {
    const flowIn = nw.flows.filter((f) => others.includes(f.accountId) && f.date > startDate && f.date <= endDate).reduce((s, f) => s + f.amountCents, 0);
    const otherValue = (p: (typeof pts)[number]) => others.reduce((s, id) => s + (p.byAccount[id] ?? 0), 0);
    if (flowIn !== 0 || otherValue(pts[0]!) !== 0 || otherValue(pts[1]!) !== 0) {
      putIn += flowIn;
      estimated = true;
      notes.push('Accounts without Fidelity history use the balances you typed in.');
    }
  }
  let priceEstimated = false;
  for (const id of withActs) {
    for (const d of [startDate, endDate]) {
      const day = (nw.valuation.get(id) ?? []).find((v) => v.date === d);
      if (!day) continue; // the account had no activity yet on that day
      if (day.state === 'unavailable') return { slide: null, putInCents: putIn };
      if (day.state === 'estimated' || day.state === 'stale') priceEstimated = true;
    }
  }
  if (priceEstimated) {
    estimated = true;
    notes.unshift('Some fund prices on the first or last day were estimated or out of date.');
  }
  if (startValue === 0 && endValue === 0 && putIn === 0) return { slide: null, putInCents: 0 };
  const slide: Extract<WrappedSlide, { kind: 'investments' }> = {
    kind: 'investments',
    startDate,
    endDate,
    startValueCents: startValue,
    endValueCents: endValue,
    putInCents: putIn,
    growthCents: endValue - startValue - putIn,
    estimated,
    notes,
  };
  return { slide, putInCents: putIn };
}
