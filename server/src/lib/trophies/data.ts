/**
 * The numbers trophies read, loaded ONCE per request and only from the sources the screens already use:
 *   net worth per day = netWorthSeries over toNw (the same call /api/networth makes; investment accounts are
 *     valued daily from fund prices), for EVERY day from the first data to today
 *   Roth worth per day = the Roth IRA accounts' balances from that same series (what Accounts shows)
 *   investments per day = every investment account's balance from that same series (Accounts, Dashboard); growth =
 *     value - money put in (moneyIn, as the Investments page) over the accounts WITH Fidelity history only (an
 *     account without history has no record of money put in, so its balance is never called growth)
 * Pure functions take these arrays; nothing here writes.
 */
import type { DB } from '../../db/database.js';
import type { IsoDate } from '../../../../shared/dates.js';
import { listAccounts, listSnapshots, toNw } from '../accounts.js';
import { netWorthSeries } from '../networth.js';
import { loadActivity } from '../activity.js';
import { getSetting } from '../settings.js';
import { loadPrices } from '../prices.js';
import { firstLineDate, loadMoneyLines } from '../totals.js';
import { averageSpending, monthlyNeed } from '../emergency.js';
import type { EmergencyFacts } from './emergencyRules.js';
import type { SpendFacts } from './spendingRules.js';
import { monthlyRows, spendingByCategory } from '../cashflow.js';
import { effectiveLimits, loadBudgetRows } from '../budgets.js';
import { cancelledItems, itemCharges } from '../recurringItems.js';
import { addMonths, endOfMonth, startOfMonth } from '../../../../shared/dates.js';
const endOfMonthIso = (d: IsoDate) => endOfMonth(d);
const addMonthsIso = (d: IsoDate) => addMonths(d, 1);
import { statesByDate } from '../valuation.js';
import { moneyIn, shareDelta } from '../investments.js';
import { ACCOUNT_TYPES } from '../../../../shared/accounts.js';
import type { RothFacts } from './rothRules.js';
import { isMoneyMarket, type InvestFacts } from './investingRules.js';
import type { RefFacts } from './refereeingRules.js';
import { categoryByRole, interestCategoryId, listCategories } from '../transactions.js';
import type { MoneyLine } from '../totals.js';
import { everyDay, type Day } from './hold.js';
import type { TidyFacts, TidyMonth } from './tidyRules.js';
import type { CollectorFacts, LongFacts, PerfectMonth } from './longGameRules.js';
import { underBudget } from './spendingRules.js';
import { monthTotals } from './investingRules.js';
import { firstHold } from './hold.js';
import { isCollector, parseTrophyKey, TROPHIES } from '../../../../shared/trophies.js';
import { loadStates } from './store.js';
import { categoryKinds, listRules } from '../transactions.js';
import { classify } from '../rules.js';
import { activityLogSince, loadActivityLog } from '../activityLog.js';
import { toIsoDate } from '../../../../shared/dates.js';

/**
 * What trophies may read outside the database (Trophies Round 4). `backupFileDates` lists the days of Arc40 backup
 * files already in the backups folder (First backup); it is only given in real mode with backups on, and only read
 * during a check.
 */
export interface TrophyEnv {
  backupFileDates?: () => IsoDate[];
}

/** A goal's set day and first done day; `live` = the goal still exists (else it comes from the saved marks). */
export interface GoalMark {
  id: number;
  createdAt: number;
  setOn: IsoDate;
  doneOn: IsoDate | null;
  live: boolean;
}

/** Rules Arc40 ships with have priority 90 or more; rules the user makes are saved at 0. */
export const BUILT_IN_RULE_PRIORITY = 90;

const MATCH_WORDS = { contains: 'contains', starts_with: 'starts with', equals: 'is' } as const;

export interface DailySeries {
  days: Day[];
  /** Value on a date (null before the data starts or outside the series). */
  on(date: IsoDate): number | null;
}

export function dailySeries(days: Day[]): DailySeries {
  const index = new Map(days.map((d, i) => [d.date, i]));
  return {
    days,
    on: (date) => {
      const i = index.get(date);
      return i === undefined ? null : days[i]!.cents;
    },
  };
}

/** A fund counts as held from 0.001 shares (the precision of Fidelity's files), so a leftover fraction does not. */
export const MIN_FUND_SHARES_MICRO = 1000;

export class TrophyData {
  private nwCache: { nw: DailySeries; roth: DailySeries } | null = null;
  private rothCache: RothFacts | null = null;
  private investCache: InvestFacts | null = null;
  private refCache: RefFacts | null = null;
  private emergencyCache: EmergencyFacts | null = null;
  private spendCache: SpendFacts | null = null;
  private linesCache: MoneyLine[] | null = null;
  private pointsCache: { date: IsoDate; byAccount: Record<number, number> }[] = [];
  private nwRaw: ReturnType<typeof toNw> | null = null;
  private accountsCache: ReturnType<typeof listAccounts> = [];
  private tidyCache: TidyFacts | null = null;
  private longCache: LongFacts | null = null;
  private goalCache: GoalMark[] | null = null;

  constructor(
    readonly db: DB,
    readonly today: IsoDate,
    readonly env: TrophyEnv = {},
  ) {}

  private load() {
    if (this.nwCache) return this.nwCache;
    const accounts = listAccounts(this.db, { includeArchived: true });
    const nw = toNw(this.db, accounts, listSnapshots(this.db), this.today);
    this.accountsCache = accounts;
    this.nwRaw = nw;
    const first = nw.changeDates.reduce<string | null>((m, d) => (m === null || d < m ? d : m), null);
    const rothIds = accounts.filter((a) => a.type === 'roth_ira').map((a) => a.id);
    let nwDays: Day[] = [];
    let rothDays: Day[] = [];
    if (first && first <= this.today) {
      const points = netWorthSeries(nw.accounts, nw.snapshots, everyDay(first, this.today), nw.flows);
      this.pointsCache = points.map((p) => ({ date: p.date, byAccount: p.byAccount }));
      nwDays = points.map((p) => ({ date: p.date, cents: p.totalCents }));
      rothDays = points.map((p) => {
        const vals = rothIds.map((id) => p.byAccount[id]).filter((v): v is number => v !== undefined);
        return { date: p.date, cents: vals.length ? vals.reduce((s, v) => s + v, 0) : null };
      });
    }
    this.nwCache = { nw: dailySeries(nwDays), roth: dailySeries(rothDays) };
    return this.nwCache;
  }

  get netWorth(): DailySeries {
    return this.load().nw;
  }

  get rothWorth(): DailySeries {
    return this.load().roth;
  }

  /** Money lines through today (lib/totals.ts), loaded once. */
  get lines(): MoneyLine[] {
    if (!this.linesCache) this.linesCache = loadMoneyLines(this.db, { to: this.today });
    return this.linesCache;
  }

  /** Everything the Refereeing trophies read (see refereeingRules.ts): categories found by ROLE. */
  get refereeing(): RefFacts {
    if (this.refCache) return this.refCache;
    const cats = listCategories(this.db);
    const pay = categoryByRole(cats, 'refereeing')?.id;
    const cost = categoryByRole(cats, 'ref_costs')?.id;
    const spending = new Map<string, number>();
    for (const l of this.lines) if (l.type === 'expense') spending.set(l.date.slice(0, 7), (spending.get(l.date.slice(0, 7)) ?? 0) - l.amountCents);
    this.refCache = {
      hasCategory: pay !== undefined,
      income: this.lines.filter((l) => l.type === 'income' && pay !== undefined && l.categoryId === pay).map((l) => ({ date: l.date, cents: l.amountCents })),
      costs: this.lines.filter((l) => l.type === 'expense' && cost !== undefined && l.categoryId === cost).map((l) => ({ date: l.date, cents: -l.amountCents })),
      spendingInMonth: (m) => spending.get(m) ?? 0,
      firstDataDate: this.lines[0]?.date ?? null,
    };
    return this.refCache;
  }

  /**
   * Everything the Emergency fund and savings trophies read (see emergencyRules.ts): the Goals card's savings accounts
   * (savings type, not archived) from the same daily series, the Goals card's monthly amount for every month
   * (lib/emergency.ts), and income in the category with the interest mark (migration 017).
   */
  get emergency(): EmergencyFacts {
    if (this.emergencyCache) return this.emergencyCache;
    this.load();
    const ids = this.accountsCache.filter((a) => a.type === 'savings' && !a.archived).map((a) => a.id);
    const savings: Day[] = this.pointsCache.map((p) => {
      const vals = ids.map((id) => p.byAccount[id]).filter((v): v is number => v !== undefined);
      return { date: p.date, cents: vals.length ? vals.reduce((s, v) => s + v, 0) : null };
    });
    const expenseByMonth = new Map<string, number>();
    for (const l of this.lines) if (l.type === 'expense') expenseByMonth.set(l.date.slice(0, 7), (expenseByMonth.get(l.date.slice(0, 7)) ?? 0) + l.amountCents);
    const first = firstLineDate(this.db);
    const essentials = getSetting(this.db, 'emergency_essentials_cents');
    const needByMonth = new Map<string, number | null>();
    const interestId = interestCategoryId(this.db);
    this.emergencyCache = {
      hasSavingsAccount: ids.length > 0,
      savings: dailySeries(savings),
      need: (date) => {
        const m = date.slice(0, 7);
        if (!needByMonth.has(m)) {
          const n = monthlyNeed(averageSpending((x) => expenseByMonth.get(x.slice(0, 7)) ?? 0, first, `${m}-01`).avgCents, essentials);
          needByMonth.set(m, n !== null && n > 0 ? n : null);
        }
        return needByMonth.get(m)!;
      },
      hasInterestCategory: interestId !== null,
      interest: this.lines.filter((l) => l.type === 'income' && interestId !== null && l.categoryId === interestId).map((l) => ({ date: l.date, cents: l.amountCents })),
    };
    return this.emergencyCache;
  }

  /**
   * Everything the Spending habits trophies read (see spendingRules.ts): the Cash flow month rows and the Budget page's
   * spent-per-category from the same money lines, the Budget page's limits, the Recurring page's cancelled items and
   * the charges matched to saved recurring items (as Wrapped).
   */
  get spending(): SpendFacts {
    if (this.spendCache) return this.spendCache;
    const first = firstLineDate(this.db);
    const byMonth = new Map<string, MoneyLine[]>();
    for (const l of this.lines) {
      const m = `${l.date.slice(0, 7)}-01`;
      const arr = byMonth.get(m);
      if (arr) arr.push(l);
      else byMonth.set(m, [l]);
    }
    const catCache = new Map<string, ReadonlyMap<number | null, number>>();
    const budgets = loadBudgetRows(this.db);
    const names = new Map(listCategories(this.db).map((c) => [c.id, c.name]));
    const subs = new Map<string, number>();
    for (const item of itemCharges(this.db))
      for (const c of item.charges) if (c.date <= this.today) subs.set(`${c.date.slice(0, 7)}-01`, (subs.get(`${c.date.slice(0, 7)}-01`) ?? 0) + c.amountCents);
    this.spendCache = {
      firstDataDate: first,
      months: first && first <= this.today ? monthlyRows(this.lines, startOfMonth(first), startOfMonth(this.today)) : [],
      byCategory: (m) => {
        let v = catCache.get(m);
        if (!v) catCache.set(m, (v = spendingByCategory(byMonth.get(m) ?? [])));
        return v;
      },
      limits: (m) => effectiveLimits(budgets, m),
      categoryName: (id) => names.get(id) ?? null,
      cancellations: cancelledItems(this.db),
      subscriptionCharges: (m) => subs.get(m) ?? 0,
    };
    return this.spendCache;
  }

  /** Everything the Investing trophies read (see investingRules.ts). */
  get investing(): InvestFacts {
    if (this.investCache) return this.investCache;
    this.load();
    const accounts = this.accountsCache;
    const points = this.pointsCache;
    const invIds = accounts.filter((a) => a.isInvestment).map((a) => a.id);
    const cashIds = accounts.filter((a) => ACCOUNT_TYPES[a.type].group === 'cash').map((a) => a.id);
    const acts = loadActivity(this.db)
      .filter((a) => invIds.includes(a.accountId) && a.date <= this.today)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const withActs = [...new Set(acts.map((a) => a.accountId))];
    const others = invIds.filter((id) => !withActs.includes(id));

    const sumOf = (p: { byAccount: Record<number, number> }, ids: readonly number[]): number | null => {
      const vals = ids.map((id) => p.byAccount[id]).filter((v): v is number => v !== undefined);
      return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
    };
    // Money put in so far (accounts with history), one sweep over the dated rows.
    let ai = 0;
    let putInSoFar = 0;
    const worth: Day[] = [];
    const cash: Day[] = [];
    const growth: Day[] = [];
    const putIn: Day[] = [];
    for (const p of points) {
      while (ai < acts.length && acts[ai]!.date <= p.date) putInSoFar += moneyIn(acts[ai++]!);
      worth.push({ date: p.date, cents: sumOf(p, invIds) });
      cash.push({ date: p.date, cents: sumOf(p, cashIds) ?? 0 });
      const v = sumOf(p, withActs);
      growth.push({ date: p.date, cents: v === null ? null : v - putInSoFar });
      putIn.push({ date: p.date, cents: v === null ? null : putInSoFar });
    }

    // Net money put in, event by event: Fidelity rows (moneyIn) + transactions of investment accounts without
    // Fidelity history (their transfers, as Wrapped counts them).
    const flows = this.nwRaw?.flows ?? [];
    const moneyInRows = [
      ...acts.filter((a) => moneyIn(a) !== 0).map((a) => ({ date: a.date, cents: moneyIn(a) })),
      ...flows.filter((f) => others.includes(f.accountId) && f.date <= this.today).map((f) => ({ date: f.date, cents: f.amountCents })),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // Funds held at the end of every day (all accounts together), from the first Fidelity row to today.
    const names = new Map(
      (this.db.prepare('SELECT symbol, name FROM securities').all() as { symbol: string; name: string | null }[]).map((r) => [r.symbol, r.name ?? '']),
    );
    const shares = new Map<string, number>();
    const held: { date: IsoDate; symbols: string[]; all: string[] }[] = [];
    if (acts.length) {
      let i = 0;
      for (const d of everyDay(acts[0]!.date, this.today)) {
        while (i < acts.length && acts[i]!.date <= d) {
          const a = acts[i++]!;
          const delta = shareDelta(a);
          if (delta !== 0 && a.symbol) shares.set(a.symbol, (shares.get(a.symbol) ?? 0) + delta);
        }
        const all = [...shares].filter(([, m]) => m > 0).map(([s]) => s).sort();
        const big = [...shares].filter(([s, m]) => m >= MIN_FUND_SHARES_MICRO && !isMoneyMarket(s, names.get(s) ?? '')).map(([s]) => s).sort();
        held.push({ date: d, symbols: big, all });
      }
    }
    const heldIndex = new Map(held.map((h, i) => [h.date, i]));

    const realCloses = new Set(loadPrices(this.db).map((p) => `${p.symbol}|${p.asOf}`));
    const states = statesByDate(this.nwRaw?.valuation ?? new Map(), withActs);

    // Spending per calendar year from the money lines (the Budget / Cash flow / Wrapped number: refunds lower it).
    const spendingByYear = new Map<number, number>();
    for (const l of this.lines) {
      if (l.type !== 'expense') continue;
      const y = Number(l.date.slice(0, 4));
      spendingByYear.set(y, (spendingByYear.get(y) ?? 0) - l.amountCents);
    }

    this.investCache = {
      worth: dailySeries(worth),
      cash: dailySeries(cash),
      growth: dailySeries(growth),
      putIn: dailySeries(putIn),
      moneyIn: moneyInRows,
      funds: held.map((h) => ({ date: h.date, symbols: h.symbols })),
      heldOn: (date) => {
        const i = heldIndex.get(date);
        return i === undefined ? [] : held[i]!.all;
      },
      realClose: (symbol, date) => realCloses.has(`${symbol}|${date}`),
      priceState: (date) => states.get(date)?.state ?? null,
      yearSpending: (year) => spendingByYear.get(year) ?? 0,
    };
    return this.investCache;
  }

  /**
   * Everything the Keeping things tidy trophies read (see tidyRules.ts): the money lines (as the Transactions page
   * lists them), transfer transactions and their links, imports that still exist, the user's own rules and what each
   * sorted, split transactions, and the activity log.
   */
  get tidy(): TidyFacts {
    if (this.tidyCache) return this.tidyCache;
    const db = this.db;
    const first = firstLineDate(db);
    const months = new Map<string, TidyMonth>();
    const monthOf = (d: IsoDate) => {
      const key = `${d.slice(0, 7)}-01`;
      let m = months.get(key);
      if (!m) months.set(key, (m = { month: key, incomeExpense: 0, uncategorized: 0, transfers: 0, unlinked: 0 }));
      return m;
    };
    if (first && first <= this.today) for (let d = startOfMonth(first); d <= this.today; d = addMonthsIso(d)) monthOf(d);
    for (const l of this.lines) {
      if (l.type !== 'income' && l.type !== 'expense') continue;
      const m = monthOf(l.date);
      m.incomeExpense++;
      if (l.categoryId === null) m.uncategorized++;
    }
    const transfers = db
      .prepare("SELECT date, transfer_group_id IS NOT NULL AS linked FROM transactions WHERE type = 'transfer' AND date <= ? ORDER BY date")
      .all(this.today) as { date: string; linked: number }[];
    for (const t of transfers) {
      const m = monthOf(t.date);
      m.transfers++;
      if (!t.linked) m.unlinked++;
    }

    const rules = listRules(db);
    const userRows = db
      .prepare('SELECT id, created_at FROM category_rules WHERE priority < ? ORDER BY created_at, id')
      .all(BUILT_IN_RULE_PRIORITY) as { id: number; created_at: number }[];
    const labelOf = new Map(rules.map((r) => [r.id, `"${MATCH_WORDS[r.matchType]} ${r.pattern}"`]));
    const userIds = new Set(userRows.map((r) => r.id));
    const kinds = categoryKinds(db);
    const sorts = new Map<number, IsoDate[]>();
    const txs = db
      .prepare(
        `SELECT account_id, date, amount_cents, description, raw_description, type, category_id FROM transactions
         WHERE date <= ? AND id NOT IN (SELECT transaction_id FROM transaction_splits) ORDER BY date, id`,
      )
      .all(this.today) as { account_id: number; date: string; amount_cents: number; description: string; raw_description: string; type: string; category_id: number | null }[];
    for (const t of txs) {
      const c = classify({ accountId: t.account_id, amountCents: t.amount_cents, description: t.description, rawDescription: t.raw_description }, rules, kinds);
      if (c.ruleId === null || !userIds.has(c.ruleId)) continue;
      const rule = rules.find((r) => r.id === c.ruleId)!;
      if (t.type !== c.type || (rule.setCategoryId !== null && t.category_id !== c.categoryId)) continue;
      const arr = sorts.get(c.ruleId);
      if (arr) arr.push(t.date);
      else sorts.set(c.ruleId, [t.date]);
    }

    const splits = db
      .prepare(
        `SELECT t.date, t.description, COUNT(s.id) AS pieces FROM transactions t JOIN transaction_splits s ON s.transaction_id = t.id
         GROUP BY t.id ORDER BY t.date, t.id`,
      )
      .all() as { date: string; description: string; pieces: number }[];
    const log = loadActivityLog(db);
    this.tidyCache = {
      firstDataDate: first,
      logSince: activityLogSince(db),
      months: [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
      lineDates: this.lines.map((l) => l.date),
      imports: (db.prepare('SELECT created_at FROM import_batches ORDER BY created_at, id').all() as { created_at: number }[]).map((r) => toIsoDate(r.created_at)),
      userRules: userRows.map((r) => ({ date: toIsoDate(r.created_at), label: labelOf.get(r.id) ?? 'a rule' })),
      ruleSorts: [...sorts].map(([id, dates]) => ({ label: labelOf.get(id) ?? 'a rule', dates })),
      splits,
      backups: log.filter((e) => e.kind === 'backup').map((e) => e.date),
      backupFiles: (this.env.backupFileDates?.() ?? []).filter((d) => d <= this.today).sort(),
      positions: log.filter((e) => e.kind === 'positions').map((e) => ({ date: e.date, allMatched: e.allMatched === true })),
    };
    return this.tidyCache;
  }

  /** The day Arc40 was set up (the password was first made); null before setup. */
  setupDate(): IsoDate | null {
    const r = this.db.prepare('SELECT created_at FROM app_user WHERE id = 1').get() as { created_at: number } | undefined;
    return r ? toIsoDate(r.created_at) : null;
  }

  /** Anniversary banners: from the first anniversary's year through this year (the coming one shows its countdown). */
  anniversaryYears(): number[] {
    const setup = this.setupDate();
    if (!setup) return [];
    const first = Number(setup.slice(0, 4)) + 1;
    const last = Math.max(first, Number(this.today.slice(0, 4)));
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
  }

  /**
   * Every goal with the day it was set and first done (progress = the Goals page's number: the linked account's balance
   * from the same daily series; at or above the target 30 days in a row). Goals that no longer exist come from the saved
   * marks (trophy_goal_marks); a saved done day is never lost.
   */
  goalMarks(): GoalMark[] {
    if (this.goalCache) return this.goalCache;
    this.load();
    const saved = new Map(
      (
        this.db.prepare('SELECT goal_id, created_at, set_on, done_on FROM trophy_goal_marks ORDER BY id').all() as {
          goal_id: number;
          created_at: number;
          set_on: string;
          done_on: string | null;
        }[]
      ).map((r) => [`${r.goal_id}|${r.created_at}`, r]),
    );
    const live = this.db.prepare('SELECT id, target_cents, account_id, created_at FROM goals WHERE archived = 0 ORDER BY id').all() as {
      id: number;
      target_cents: number;
      account_id: number | null;
      created_at: number;
    }[];
    const out: GoalMark[] = [];
    for (const g of live) {
      const days = g.account_id === null ? [] : this.accountDays(g.account_id);
      // The 30 days count from the day the goal was set: a goal already met when it was made is done 30 days later.
      const hold = firstHold(days, (d) => d.cents! >= g.target_cents, { from: toIsoDate(g.created_at) });
      const key = `${g.id}|${g.created_at}`;
      const mark = saved.get(key);
      out.push({ id: g.id, createdAt: g.created_at, setOn: mark?.set_on ?? toIsoDate(g.created_at), doneOn: mark?.done_on ?? hold.earned?.end ?? null, live: true });
      saved.delete(key);
    }
    for (const m of saved.values()) out.push({ id: m.goal_id, createdAt: m.created_at, setOn: m.set_on, doneOn: m.done_on, live: false });
    return (this.goalCache = out);
  }

  /** One account's balance every day from the same daily series (a goal's progress, as the Goals page shows it). */
  accountDays(accountId: number): Day[] {
    this.load();
    return this.pointsCache.map((p) => ({ date: p.date, cents: p.byAccount[accountId] ?? null }));
  }

  /** Everything the long game trophies and The Arc read (see longGameRules.ts). */
  get long(): LongFacts {
    if (this.longCache) return this.longCache;
    const db = this.db;
    const firsts = [
      db.prepare('SELECT MIN(date) AS d FROM transactions').get(),
      db.prepare('SELECT MIN(as_of) AS d FROM balance_snapshots').get(),
      db.prepare('SELECT MIN(date) AS d FROM investment_activity').get(),
    ]
      .map((r) => (r as { d: string | null }).d)
      .filter((d): d is string => d !== null && d <= this.today)
      .sort();
    // A perfect month: the Spending habits month row and budget rule, the Keeping things tidy clean-books rule and the
    // Investing net money put in, each exactly as those trophies count them.
    const sp = this.spending;
    const td = this.tidy;
    const invest = monthTotals(this.investing.moneyIn.filter((r) => r.date <= this.today), null);
    const perfect: PerfectMonth[] = [];
    for (const r of sp.months) {
      if (endOfMonthIso(r.month) >= this.today || !sp.firstDataDate || sp.firstDataDate > r.month) continue;
      const b = underBudget(sp, r.month);
      const t = td.months.find((m) => m.month === r.month);
      perfect.push({
        month: r.month,
        earned: r.incomeCents > 0 && r.incomeCents > r.spendingCents,
        budget: b !== null && b.ok,
        clean: !!t && t.incomeExpense > 0 && t.uncategorized === 0,
        invested: (invest.get(r.month.slice(0, 7))?.total ?? 0) > 0,
      });
    }
    this.longCache = {
      firstDataDate: firsts[0] ?? null,
      setupDate: this.setupDate(),
      goals: this.goalMarks().map(({ id, setOn, doneOn }) => ({ id, setOn, doneOn })),
      perfect,
      wrapped: loadActivityLog(db)
        .filter((e) => e.kind === 'wrapped' && e.year !== null)
        .map((e) => ({ date: e.date, year: e.year! })),
      birth: getSetting(db, 'birth_month'),
      logSince: activityLogSince(db),
    };
    return this.longCache;
  }

  /**
   * Collector: every trophy earned right now (never cached, so a check sees the awards it saved a moment ago), without
   * Collector itself, and every catalog id that counts.
   */
  get collector(): CollectorFacts {
    const earned: CollectorFacts['earned'] = [];
    for (const r of loadStates(this.db).values()) {
      if (r.state !== 'earned' || !r.earnedOn) continue;
      const p = parseTrophyKey(r.key);
      if (!p || isCollector(p.def)) continue;
      earned.push({ id: p.def.id, date: r.earnedOn });
    }
    return { earned, ids: TROPHIES.filter((d) => !isCollector(d)).map((d) => d.id) };
  }

  /** Roth IRA contributions (signed, oldest first), saved limits and the daily Roth balance. */
  get roth(): RothFacts {
    if (this.rothCache) return this.rothCache;
    const rothIds = new Set(listAccounts(this.db, { includeArchived: true }).filter((a) => a.type === 'roth_ira').map((a) => a.id));
    const contributions = loadActivity(this.db)
      .filter((a) => a.kind === 'contribution' && rothIds.has(a.accountId))
      .map((a) => ({ date: a.date, taxYear: a.taxYear, amountCents: a.amountCents }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    this.rothCache = { contributions, limits: getSetting(this.db, 'ira_limits'), worth: this.rothWorth };
    return this.rothCache;
  }

  /**
   * Years that have yearly trophies: from the first year with Roth data (a contribution's tax year or a Roth balance)
   * through this year. With no Roth data at all: this year only.
   */
  trophyYears(): number[] {
    const thisYear = Number(this.today.slice(0, 4));
    const firstWorth = this.rothWorth.days.find((d) => d.cents !== null)?.date;
    const starts = [
      ...this.roth.contributions.map((c) => c.taxYear).filter((y): y is number => y !== null),
      ...(firstWorth ? [Number(firstWorth.slice(0, 4))] : []),
    ];
    const first = Math.max(2000, Math.min(thisYear, ...starts));
    return Array.from({ length: thisYear - first + 1 }, (_, i) => first + i);
  }
}
