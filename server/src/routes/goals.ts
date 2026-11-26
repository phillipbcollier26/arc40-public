import { saveGoalMarks } from '../lib/trophies/engine.js';
import { TrophyData } from '../lib/trophies/data.js';
import { rothPace } from '../lib/rothPace.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import { addDays, addMonths, isValidIsoDate, startOfMonth, toIsoDate } from '../../../shared/dates.js';
import { loadMoneyLines, sumLines } from '../lib/totals.js';
import { avgMonthlySpending, EMERGENCY_MONTHS } from '../lib/emergency.js';
import { MoneyParseError, parseMoneyToCents } from '../lib/money.js';
import { getSetting, setSetting } from '../lib/settings.js';
import { listAccounts, listSnapshots, toNw } from '../lib/accounts.js';
import { netWorthOn } from '../lib/networth.js';
import { listCategories, type CategoryRole } from '../lib/transactions.js';
import { contributionsForTaxYear } from '../lib/investments.js';
import { loadActivity } from '../lib/activity.js';

/** Income that counts as EARNED (compensation) for the IRA rule: work income only. */
export const EARNED_INCOME_ROLES: readonly CategoryRole[] = ['refereeing', 'other_income'];

const goalBody = z.object({
  name: z.string().trim().min(1, 'Name the goal.').max(60),
  target: z.string().trim().min(1, 'Enter a target amount.').max(30),
  accountId: z.number().int().positive().nullable().default(null),
  targetDate: z.string().nullable().optional(),
});

const iraBody = z.object({
  year: z.number().int().min(2000).max(2200),
  limit: z.string().trim().min(1).max(30),
  deadline: z.string().nullable().optional(),
});

/**
 * Average monthly spending over the last 6 COMPLETE months (quiet months count as $0,
 * months before the first transaction are not counted). Same rules as the income average.
 */
export function registerGoalRoutes(app: FastifyInstance, db: DB, now: () => number): void {
  const bad = (reply: FastifyReply, error: string) => reply.code(400).send({ error });
  const today = () => toIsoDate(now());
  const money = (text: string): number | string => {
    try {
      return parseMoneyToCents(text);
    } catch (e) {
      return e instanceof MoneyParseError ? 'Enter an amount like 1,000.00.' : 'Invalid amount.';
    }
  };

  app.get('/api/goals', async (req, reply) => {
    const t = today();
    const limits = getSetting(db, 'ira_limits');
    const thisYear = Number(t.slice(0, 4));
    // Last year's contributions are still allowed until its deadline (usually April 15).
    const lastDeadline = limits[String(thisYear - 1)]?.deadline;
    const years = [thisYear, ...(lastDeadline && t <= lastDeadline ? [thisYear - 1] : [])];
    const yq = Number((req.query as { year?: string }).year) || thisYear;
    if (!Number.isInteger(yq) || yq < 2000 || yq > 2200) return bad(reply, 'Pick a year.');

    const accounts = listAccounts(db, { includeArchived: true });
    const rothIds = new Set(accounts.filter((a) => a.type === 'roth_ira').map((a) => a.id));
    const acts = loadActivity(db);
    const contributed = contributionsForTaxYear(acts, yq, rothIds);
    const limit = limits[String(yq)] ?? null;
    const rothContributions = acts
      .filter((a) => a.kind === 'contribution' && a.taxYear === yq && rothIds.has(a.accountId))
      .map((a) => ({ date: a.date, amountCents: a.amountCents })); // real sign: a reversal lowers the pace (audit F-03)

    const cats = listCategories(db).filter((c) => c.role !== null && EARNED_INCOME_ROLES.includes(c.role)).map((c) => c.id);
    const earned = sumLines(loadMoneyLines(db, { from: `${yq}-01-01`, to: `${yq}-12-31` }), 'income', new Set(cats));

    const nw = toNw(db, accounts, listSnapshots(db), t);
    const nowPoint = netWorthOn(nw.accounts, nw.snapshots, t, nw.flows);
    const balance = (id: number | null) => (id === null ? 0 : (nowPoint.byAccount[id] ?? 0));

    const custom = (
      db.prepare('SELECT id, name, target_cents, account_id, target_date FROM goals WHERE archived = 0 ORDER BY id').all() as {
        id: number;
        name: string;
        target_cents: number;
        account_id: number | null;
        target_date: string | null;
      }[]
    ).map((g) => ({
      id: g.id,
      name: g.name,
      targetCents: g.target_cents,
      accountId: g.account_id,
      accountName: accounts.find((a) => a.id === g.account_id)?.name ?? null,
      targetDate: g.target_date,
      currentCents: balance(g.account_id),
    }));

    const spend = avgMonthlySpending(db, startOfMonth(t));
    const essentials = getSetting(db, 'emergency_essentials_cents');
    const savings = accounts.filter((a) => a.type === 'savings' && !a.archived).map((a) => ({ id: a.id, name: a.name, balanceCents: balance(a.id) }));

    return {
      today: t,
      roth: {
        year: yq,
        years,
        hasRothAccount: rothIds.size > 0,
        limitCents: limit?.limitCents ?? null,
        deadline: limit?.deadline ?? null,
        contributedCents: contributed,
        remainingCents: limit ? Math.max(0, limit.limitCents - contributed) : null,
        earnedIncomeCents: earned,
        // Pace planner: only with a saved limit AND deadline (never guessed) and a Roth account.
        pace:
          limit && limit.deadline && rothIds.size > 0
            ? rothPace({ year: yq, limitCents: limit.limitCents, deadline: limit.deadline, today: t, contributions: rothContributions, earnedCents: earned })
            : null,
      },
      custom,
      emergency: {
        avgMonthlySpendingCents: spend.avgCents,
        monthsUsed: spend.monthsUsed,
        essentialsCents: essentials,
        targetCents: spend.avgCents === null && essentials === 0 ? null : EMERGENCY_MONTHS * ((spend.avgCents ?? 0) + essentials),
        savingsCents: savings.reduce((s, a) => s + a.balanceCents, 0),
        savingsAccounts: savings,
      },
    };
  });

  app.put('/api/settings/ira', async (req, reply) => {
    const b = iraBody.safeParse(req.body);
    if (!b.success) return bad(reply, 'Enter the limit for a year.');
    const cents = money(b.data.limit);
    if (typeof cents === 'string') return bad(reply, cents);
    if (cents <= 0) return bad(reply, 'The limit must be above zero.');
    if (b.data.deadline && !isValidIsoDate(b.data.deadline)) return bad(reply, 'Pick a valid deadline date.');
    const limits = { ...getSetting(db, 'ira_limits') };
    limits[String(b.data.year)] = { limitCents: cents, deadline: b.data.deadline ?? limits[String(b.data.year)]?.deadline ?? null };
    setSetting(db, 'ira_limits', limits);
    return { ok: true };
  });

  app.put('/api/settings/emergency', async (req, reply) => {
    const text = String((req.body as { essentials?: unknown } | undefined)?.essentials ?? '').trim();
    const cents = text === '' ? 0 : money(text);
    if (typeof cents === 'string') return bad(reply, cents);
    if (cents < 0) return bad(reply, 'Use zero or more.');
    setSetting(db, 'emergency_essentials_cents', cents);
    return { ok: true };
  });

  app.post('/api/goals', async (req, reply) => {
    const b = goalBody.safeParse(req.body);
    if (!b.success) return bad(reply, b.error.issues[0]?.message ?? 'Check the goal.');
    const cents = money(b.data.target);
    if (typeof cents === 'string') return bad(reply, cents);
    if (cents <= 0) return bad(reply, 'The target must be above zero.');
    if (b.data.accountId && !listAccounts(db, { includeArchived: true }).some((a) => a.id === b.data.accountId)) return bad(reply, 'Pick an account.');
    if (b.data.targetDate && !isValidIsoDate(b.data.targetDate)) return bad(reply, 'Pick a valid date.');
    const id = Number(
      db
        .prepare('INSERT INTO goals (name, target_cents, account_id, target_date, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(b.data.name, cents, b.data.accountId, b.data.targetDate ?? null, now()).lastInsertRowid,
    );
    return reply.code(201).send({ id });
  });

  app.patch('/api/goals/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const cur = db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as { name: string; target_cents: number; account_id: number | null } | undefined;
    if (!cur) return reply.code(404).send({ error: 'Goal not found.' });
    const b = goalBody.partial().safeParse(req.body);
    if (!b.success) return bad(reply, 'Check the goal.');
    let target = cur.target_cents;
    if (b.data.target !== undefined) {
      const c = money(b.data.target);
      if (typeof c === 'string') return bad(reply, c);
      if (c <= 0) return bad(reply, 'The target must be above zero.');
      target = c;
    }
    db.prepare('UPDATE goals SET name = ?, target_cents = ?, account_id = ? WHERE id = ?').run(
      b.data.name ?? cur.name,
      target,
      b.data.accountId !== undefined ? b.data.accountId : cur.account_id,
      id,
    );
    return { ok: true };
  });

  app.delete('/api/goals/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    // Trophies Round 4: remember the goal's set and done days first, so a done goal still counts after it is deleted.
    if (db.prepare('SELECT 1 FROM goals WHERE id = ?').get(id)) saveGoalMarks(db, new TrophyData(db, toIsoDate(now())));
    if (!db.prepare('DELETE FROM goals WHERE id = ?').run(id).changes) return reply.code(404).send({ error: 'Goal not found.' });
    return { ok: true };
  });
}
