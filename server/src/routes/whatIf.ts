/**
 * What if (V2 Phase 3). POST /api/what-if/project: the current path and up to 3 scenarios. READ-ONLY: it never
 * writes (scenarios live only in the page's memory and are never saved, in real or demo mode).
 *   { baselineMonths: 3 | 6 | 12, range: '1y' | '5y' | '10y' | 'to40' | 'to65',
 *     scenarios: [{ name, changes: [
 *       { kind: 'spending', categoryId, direction: 'up' | 'down', amount: TEXT }   // per month
 *       { kind: 'roth', monthly: TEXT }                                            // replaces the recent Roth amount
 *       { kind: 'return', rate: TEXT }                                             // percent after inflation, 0..15
 *     ] }] }
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import { toIsoDate } from '../../../shared/dates.js';
import { MoneyParseError, parseMoneyToCents } from '../lib/money.js';
import { BASELINE_MONTHS, buildBaseline, planningSettings, type BaselineMonths } from '../lib/planning.js';
import { listCategories } from '../lib/transactions.js';
import { MAX_CHANGES, MAX_SCENARIOS, RANGES, whatIf, type Change } from '../lib/whatIf.js';
import { parseReturnRate } from './planning.js';

/** Sanity caps: $100,000 a month of spending change, $10,000 a month into the Roth. */
const MAX_SPENDING_CHANGE = 10_000_000;
const MAX_ROTH_MONTHLY = 1_000_000;

const text = z.string().trim().min(1).max(20);
const change = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('spending'), categoryId: z.number().int().positive(), direction: z.enum(['up', 'down']), amount: text }).strict(),
  z.object({ kind: z.literal('roth'), monthly: text }).strict(),
  z.object({ kind: z.literal('return'), rate: text }).strict(),
]);
const body = z
  .object({
    baselineMonths: z.number().int(),
    range: z.enum(RANGES),
    scenarios: z
      .array(
        z
          .object({
            name: z.string().trim().min(1, 'Give each scenario a name.').max(40, 'Keep scenario names to 40 characters or fewer.'),
            changes: z.array(change).max(MAX_CHANGES, `A scenario can have up to ${MAX_CHANGES} changes.`),
          })
          .strict(),
      )
      .max(MAX_SCENARIOS, `Compare up to ${MAX_SCENARIOS} scenarios at a time.`),
  })
  .strict();

export function registerWhatIfRoutes(app: FastifyInstance, db: DB, now: () => number): void {
  const bad = (reply: FastifyReply, error: string) => reply.code(400).send({ error });

  app.post('/api/what-if/project', async (req, reply) => {
    const b = body.safeParse(req.body);
    if (!b.success) {
      const msg = b.error.issues.find((i) => /scenario|changes|name/i.test(i.message) && !i.message.startsWith('Invalid'))?.message;
      return bad(reply, msg ?? 'Check the scenario: each change needs an amount like 50 or 12.50.');
    }
    if (!BASELINE_MONTHS.includes(b.data.baselineMonths as BaselineMonths)) return bad(reply, 'Average over 3, 6 or 12 months.');
    const expense = new Map(listCategories(db).filter((c) => c.kind === 'expense').map((c) => [c.id, c]));

    const scenarios: { name: string; changes: Change[] }[] = [];
    for (const s of b.data.scenarios) {
      const changes: Change[] = [];
      let roths = 0;
      let rates = 0;
      for (const c of s.changes) {
        if (c.kind === 'return') {
          if (++rates > 1) return bad(reply, 'A scenario can change the return rate once.');
          try {
            changes.push({ kind: 'return', rateBp: parseReturnRate(c.rate) });
          } catch (e) {
            return bad(reply, (e as Error).message);
          }
          continue;
        }
        let cents: number;
        try {
          cents = parseMoneyToCents(c.kind === 'roth' ? c.monthly : c.amount);
        } catch (e) {
          if (e instanceof MoneyParseError) return bad(reply, 'Enter an amount like 50 or 12.50.');
          throw e;
        }
        if (cents < 0) return bad(reply, 'Enter the amount without a minus sign.');
        if (c.kind === 'roth') {
          if (++roths > 1) return bad(reply, 'A scenario can set the Roth amount once.');
          if (cents > MAX_ROTH_MONTHLY) return bad(reply, 'That is more than Arc40 allows for a monthly Roth amount.');
          changes.push({ kind: 'roth', monthlyCents: cents });
        } else {
          if (!expense.has(c.categoryId)) return bad(reply, 'Pick a spending category.');
          if (cents > MAX_SPENDING_CHANGE) return bad(reply, 'That is more than Arc40 allows for a spending change.');
          changes.push({ kind: 'spending', categoryId: c.categoryId, deltaCents: c.direction === 'up' ? cents : -cents });
        }
      }
      scenarios.push({ name: s.name, changes });
    }

    const today = toIsoDate(now());
    const baseline = buildBaseline(db, today, b.data.baselineMonths as BaselineMonths);
    const settings = planningSettings(db);
    const out = whatIf(db, baseline, { range: b.data.range, scenarios, birth: settings.birth, defaultRateBp: settings.returnRateBp });
    if ('error' in out) return bad(reply, out.error!);
    return {
      ...out,
      baseline: {
        monthsRequested: baseline.monthsRequested,
        monthsUsed: baseline.monthsUsed,
        from: baseline.from,
        to: baseline.to,
        incomeCents: baseline.incomeCents,
        spendingCents: baseline.spendingCents,
        savingsCents: baseline.savingsCents,
        toInvestedCents: baseline.toInvestedCents,
        rothMonthlyCents: baseline.rothMonthlyCents,
        cashCents: baseline.cashCents,
        investedCents: baseline.investedCents,
      },
      categories: [...expense.values()].map((c) => ({ id: c.id, name: c.name, color: c.color, avgCents: baseline.spendingByCategory[String(c.id)] ?? 0 })),
    };
  });
}
