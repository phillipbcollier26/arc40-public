import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import { addMonths, isValidIsoDate, startOfMonth, startOfYear, toIsoDate } from '../../../shared/dates.js';
import { DecimalParseError, parseScaled } from '../../../shared/decimal.js';
import { MoneyParseError, parseMoneyToCents } from '../lib/money.js';
import { getSetting, setSetting } from '../lib/settings.js';
import { categoryByRole, listCategories } from '../lib/transactions.js';
import {
  incomeAverage,
  monthlyRows,
  savingsRateBp,
  setAsideCents,
  spendingByCategory,
  totals,
  type CashTx,
} from '../lib/cashflow.js';
import { loadMoneyLines } from '../lib/totals.js';
import { limitsFor } from '../lib/budgets.js';

/** Income/spending lines from the shared totals source (lib/totals.ts). */
const loadTx = (db: DB, from?: string, to?: string): CashTx[] => loadMoneyLines(db, { from, to });

const putBody = z.object({
  categoryId: z.number().int().positive(),
  /** null = the default for every month; 'YYYY-MM-01' = just that month */
  month: z.string().nullable(),
  /** Text like "150" or "150.00"; null removes the limit (for that scope). */
  limit: z.string().trim().max(30).nullable(),
});

const settingsBody = z.object({
  incomeAvgMonths: z.union([z.literal(3), z.literal(6), z.literal(12)]).optional(),
  /** Percent as text, e.g. "25" or "22.5". "0" or "" turns it off. */
  taxSetAsidePercent: z.string().trim().max(10).optional(),
  taxSetAsideOnNet: z.boolean().optional(),
});

export function registerBudgetRoutes(app: FastifyInstance, db: DB, now: () => number): void {
  const bad = (reply: FastifyReply, error: string) => reply.code(400).send({ error });
  const thisMonth = () => startOfMonth(toIsoDate(now()));

  app.get('/api/budget', async (req, reply) => {
    const q = (req.query as { month?: string }).month;
    const month = q ?? thisMonth();
    if (!isValidIsoDate(month) || month !== startOfMonth(month)) return bad(reply, 'Pick a month.');
    const end = addMonths(month, 1);
    const monthTx = loadTx(db, month).filter((t) => t.date < end);
    const spent = spendingByCategory(monthTx);
    const limits = limitsFor(db, month);
    const t = totals(monthTx);
    const avgMonths = getSetting(db, 'income_avg_months');
    const avg = incomeAverage(loadTx(db), month, avgMonths);

    const categories = listCategories(db)
      .filter((c) => c.kind === 'expense' && (!c.archived || spent.has(c.id) || limits.has(c.id)))
      .map((c) => ({
        id: c.id,
        name: c.name,
        group: c.group,
        color: c.color,
        spentCents: spent.get(c.id) ?? 0,
        limitCents: limits.get(c.id)?.limitCents ?? null,
        isOverride: limits.get(c.id)?.isOverride ?? false,
      }));
    const uncategorizedCents = spent.get(null) ?? 0;
    const uncatIncome = (txs: CashTx[]) => txs.filter((x) => x.type === 'income' && x.categoryId === null).reduce((s, x) => s + x.amountCents, 0);
    const limitTotal = categories.reduce((s, c) => s + (c.limitCents ?? 0), 0);

    return {
      month,
      categories,
      uncategorizedCents,
      /** Money in with no category still counts as income. Shown as a warning so gifts/transfers get fixed. */
      uncategorizedIncomeCents: uncatIncome(monthTx),
      totals: {
        limitCents: limitTotal,
        spentCents: t.spendingCents,
        budgetedSpentCents: categories.filter((c) => c.limitCents !== null).reduce((s, c) => s + c.spentCents, 0),
      },
      income: {
        thisMonthCents: t.incomeCents,
        avgCents: avg.avgCents,
        avgMonths,
        monthsUsed: avg.monthsUsed,
        /** Limits add up to more than you usually earn. */
        overAverage: avg.avgCents !== null && limitTotal > avg.avgCents,
      },
      savingsRateBp: savingsRateBp(t.incomeCents, t.spendingCents),
    };
  });

  app.put('/api/budget', async (req, reply) => {
    const b = putBody.safeParse(req.body);
    if (!b.success) return bad(reply, 'Check the budget amount.');
    const { categoryId, month, limit } = b.data;
    const cat = listCategories(db).find((c) => c.id === categoryId);
    if (!cat || cat.kind !== 'expense') return bad(reply, 'Budgets are for spending categories.');
    if (month !== null && (!isValidIsoDate(month) || month !== startOfMonth(month))) return bad(reply, 'Pick a month.');
    const key = month ?? '*';
    if (limit === null || limit === '') {
      db.prepare('DELETE FROM budgets WHERE category_id = ? AND month = ?').run(categoryId, key);
      return { ok: true };
    }
    let cents: number;
    try {
      cents = parseMoneyToCents(limit);
    } catch (e) {
      if (e instanceof MoneyParseError) return bad(reply, 'Enter an amount like 150.00.');
      throw e;
    }
    if (cents < 0) return bad(reply, 'A limit cannot be negative.');
    db.prepare(
      `INSERT INTO budgets (category_id, month, limit_cents, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (category_id, month) DO UPDATE SET limit_cents = excluded.limit_cents, updated_at = excluded.updated_at`,
    ).run(categoryId, key, cents, now());
    return { ok: true };
  });

  /** Month-by-month income, spending and savings rate, YTD totals, and the gig pay summary. */
  app.get('/api/cashflow', async (req, reply) => {
    const n = Number((req.query as { months?: string }).months ?? 12);
    if (!Number.isInteger(n) || n < 1 || n > 120) return bad(reply, 'Pick 1 to 120 months.');
    const today = toIsoDate(now());
    const last = startOfMonth(today);
    const first = addMonths(last, -(n - 1));
    const all = loadTx(db);
    const months = monthlyRows(all, first, last);

    const yearStart = startOfYear(today);
    const ytdTx = all.filter((t) => t.date >= yearStart && t.date <= today);
    const ytd = totals(ytdTx);

    const cats = listCategories(db);
    const refPay = categoryByRole(cats, 'refereeing')?.id;
    const refCost = categoryByRole(cats, 'ref_costs')?.id;
    const payCents = ytdTx.filter((t) => t.type === 'income' && t.categoryId === refPay).reduce((s, t) => s + t.amountCents, 0);
    const costCents = -ytdTx.filter((t) => t.type === 'expense' && t.categoryId === refCost).reduce((s, t) => s + t.amountCents, 0);
    const bp = getSetting(db, 'tax_set_aside_bp');
    const onNet = getSetting(db, 'tax_set_aside_on_net');

    return {
      months,
      ytd: {
        ...ytd,
        savingsRateBp: savingsRateBp(ytd.incomeCents, ytd.spendingCents),
        year: Number(today.slice(0, 4)),
        uncategorizedIncomeCents: ytdTx.filter((x) => x.type === 'income' && x.categoryId === null).reduce((s, x) => s + x.amountCents, 0),
      },
      gig: {
        payCents,
        costsCents: costCents,
        netCents: payCents - costCents,
        setAsideBp: bp,
        setAsideOnNet: onNet,
        setAsideCents: setAsideCents(payCents, costCents, bp, onNet),
      },
    };
  });

  app.get('/api/settings', async () => ({
    idleTimeoutMinutes: getSetting(db, 'session_idle_minutes'),
    incomeAvgMonths: getSetting(db, 'income_avg_months'),
    taxSetAsideBp: getSetting(db, 'tax_set_aside_bp'),
    taxSetAsideOnNet: getSetting(db, 'tax_set_aside_on_net'),
    iraLimits: getSetting(db, 'ira_limits'),
    emergencyEssentialsCents: getSetting(db, 'emergency_essentials_cents'),
  }));

  app.put('/api/settings/budget', async (req, reply) => {
    const b = settingsBody.safeParse(req.body);
    if (!b.success) return bad(reply, 'Average over 3, 6 or 12 months.');
    if (b.data.incomeAvgMonths !== undefined) setSetting(db, 'income_avg_months', b.data.incomeAvgMonths);
    if (b.data.taxSetAsidePercent !== undefined) {
      let bpVal = 0;
      if (b.data.taxSetAsidePercent !== '') {
        try {
          bpVal = parseScaled(b.data.taxSetAsidePercent.replace(/%$/, ''), 2, 'percent');
        } catch (e) {
          if (e instanceof DecimalParseError) return bad(reply, 'Enter a percent like 20 or 22.5.');
          throw e;
        }
      }
      if (bpVal < 0 || bpVal > 10_000) return bad(reply, 'Pick a percent between 0 and 100.');
      setSetting(db, 'tax_set_aside_bp', bpVal);
    }
    if (b.data.taxSetAsideOnNet !== undefined) setSetting(db, 'tax_set_aside_on_net', b.data.taxSetAsideOnNet);
    return { ok: true };
  });
}
