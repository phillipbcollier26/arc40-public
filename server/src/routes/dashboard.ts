import type { FastifyInstance } from 'fastify';
import type { DB } from '../db/database.js';
import { addDays, addMonths, startOfMonth, toIsoDate } from '../../../shared/dates.js';
import { categoryByRole, listCategories } from '../lib/transactions.js';
import { spendingByCategory } from '../lib/cashflow.js';
import { loadMoneyLines } from '../lib/totals.js';

/**
 * Extra series for the dashboard that no other screen computes. Same money rules as
 * everywhere: spending = -(sum of expense rows, refunds included); transfers and gifts never count.
 * Window: the last 12 months including the current one (same as /api/cashflow?months=12).
 */
export function registerDashboardRoutes(app: FastifyInstance, db: DB, now: () => number): void {
  app.get('/api/dashboard', async () => {
    const today = toIsoDate(now());
    const from = addMonths(startOfMonth(today), -11);
    const cats = listCategories(db);
    const catById = new Map(cats.map((c) => [c.id, c]));

    // All money lines in the window, from the shared totals source (lib/totals.ts).
    // The 365-day calendar can start before the 12-month window, so load from the earlier date.
    const calFrom = addDays(today, -364);
    const allLines = loadMoneyLines(db, { from: calFrom < from ? calFrom : from, to: today });
    const lines = allLines.filter((l) => l.date >= from);
    const catOrder = (id: number | null) => (id === null ? -1 : id); // SQL GROUP BY order: NULL first
    const byCat = [...spendingByCategory(lines)]
      .map(([id, cents]) => ({ id, cents }))
      .sort((x, y) => catOrder(x.id) - catOrder(y.id));
    const spendingByCategoryRows = byCat
      .filter((r) => r.cents > 0)
      .map((r) => {
        const c = r.id === null ? null : catById.get(r.id);
        return { categoryId: r.id, name: c?.name ?? 'Uncategorized', group: c?.group ?? 'Other', color: c?.color ?? 'pewter', cents: r.cents };
      })
      .sort((a, b) => b.cents - a.cents);

    // Daily spending for the calendar heatmap (last 365 days). Days with net refunds show as 0.
    const dailyMap = new Map<string, number>();
    for (const l of allLines) {
      if (l.type !== 'expense' || l.date < calFrom) continue;
      dailyMap.set(l.date, (dailyMap.get(l.date) ?? 0) - l.amountCents);
    }
    const daily = [...dailyMap]
      .sort(([x], [y]) => (x < y ? -1 : 1))
      .map(([date, cents]) => ({ date, cents: Math.max(0, cents) }));

    // Refereeing pay by who paid you, and income by source per month (seasons).
    const ref = categoryByRole(cats, 'refereeing');
    const payerMap = new Map<string, number>();
    if (ref) {
      for (const l of lines) {
        if (l.type !== 'income' || l.categoryId !== ref.id) continue;
        const payer = l.payer === '' ? 'Not specified' : l.payer;
        payerMap.set(payer, (payerMap.get(payer) ?? 0) + l.amountCents);
      }
    }
    const incomeByPayer = [...payerMap]
      .map(([payer, cents]) => ({ payer, cents }))
      .sort((x, y) => y.cents - x.cents || (x.payer < y.payer ? -1 : x.payer > y.payer ? 1 : 0));

    const monthlyMap = new Map<string, { month: string; id: number | null; cents: number }>();
    for (const l of lines) {
      if (l.type !== 'income') continue;
      const month = `${l.date.slice(0, 7)}-01`;
      const k = `${month}|${l.categoryId}`;
      const cur = monthlyMap.get(k) ?? { month, id: l.categoryId, cents: 0 };
      cur.cents += l.amountCents;
      monthlyMap.set(k, cur);
    }
    const monthly = [...monthlyMap.values()].sort((x, y) => (x.month < y.month ? -1 : x.month > y.month ? 1 : catOrder(x.id) - catOrder(y.id)));
    const sources = [...new Set(monthly.map((r) => (r.id === null ? 'Uncategorized' : (catById.get(r.id)?.name ?? 'Other'))))];
    const months: string[] = [];
    for (let m = from; m <= startOfMonth(today); m = addMonths(m, 1)) months.push(m);
    const incomeBySource = {
      months,
      sources: sources.map((name) => ({
        name,
        color: cats.find((c) => c.name === name)?.color ?? 'pewter',
        cents: months.map((m) =>
          monthly
            .filter((r) => r.month === m && (r.id === null ? 'Uncategorized' : (catById.get(r.id)?.name ?? 'Other')) === name)
            .reduce((s, r) => s + r.cents, 0),
        ),
      })),
    };

    return { from, today, spendingByCategory: spendingByCategoryRows, daily, calendarFrom: calFrom, incomeByPayer, incomeBySource };
  });
}
