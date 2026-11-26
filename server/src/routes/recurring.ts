import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import { isValidIsoDate, startOfMonth, toIsoDate } from '../../../shared/dates.js';
import { MoneyParseError, parseMoneyToCents } from '../lib/money.js';
import { getCategory } from '../lib/transactions.js';
import { SCHEDULES } from '../lib/recurring.js';
import {
  addManual,
  billsCalendar,
  calendarWindow,
  cancelItem,
  confirmSuggestion,
  deleteItem,
  dismissSuggestion,
  dueDateWindow,
  recurringOverview,
  RecurringError,
  restoreItem,
  updateItem,
  upcomingBills,
} from '../lib/recurringItems.js';

const keyBody = z.object({ key: z.string().min(1).max(300) });
const name = z.string().trim().min(1, 'Give it a name.').max(80, 'Keep the name to 80 characters or fewer.');
const amount = z.string().trim().min(1, 'Enter an amount.').max(30);
const manualBody = z.object({
  name,
  amount,
  schedule: z.enum(SCHEDULES),
  nextDue: z.string().max(10),
  categoryId: z.number().int().positive().nullable().default(null),
});
const patchBody = z.object({
  name: name.optional(),
  amount: amount.optional(),
  schedule: z.enum(SCHEDULES).optional(),
  nextDue: z.string().max(10).optional(),
  categoryId: z.number().int().positive().nullable().optional(),
});

/** Recurring charges and subscriptions (lib/recurring.ts + lib/recurringItems.ts). */
export function registerRecurringRoutes(app: FastifyInstance, db: DB, now: () => number): void {
  const bad = (reply: FastifyReply, error: string) => reply.code(400).send({ error });
  const today = () => toIsoDate(now());
  const idOf = (req: { params: unknown }) => {
    const id = Number((req.params as { id: string }).id);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  };
  const run = <T>(reply: FastifyReply, fn: () => T) => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof RecurringError) return bad(reply, e.message);
      throw e;
    }
  };
  /** Money text -> positive cents, or an error message. */
  const cost = (text: string): number | string => {
    try {
      const c = parseMoneyToCents(text);
      return c > 0 ? c : 'Enter an amount above $0.00.';
    } catch (e) {
      if (e instanceof MoneyParseError) return 'Enter an amount like 11.99.';
      throw e;
    }
  };
  const dueProblem = (d: string) => {
    if (!isValidIsoDate(d)) return 'Pick a date.';
    const w = dueDateWindow(today());
    return d < w.from || d > w.to ? 'Pick a date within a year back or three years ahead.' : null;
  };
  const categoryProblem = (id: number | null | undefined) => {
    if (id === null || id === undefined) return null;
    const c = getCategory(db, id);
    return c && c.kind === 'expense' ? null : 'Pick a spending category.';
  };

  app.get('/api/recurring', async () => recurringOverview(db, today()));

  /** Next 30 days of bills (Recurring page list + Dashboard card), with the checking-balance warning. */
  app.get('/api/recurring/upcoming', async () => upcomingBills(db, today()));

  /** One month of the bills calendar: ?month=YYYY-MM-01, this month through 24 months ahead. */
  app.get('/api/recurring/calendar', async (req, reply) => {
    const t = today();
    const m = (req.query as { month?: string }).month ?? startOfMonth(t);
    if (!isValidIsoDate(m) || m !== startOfMonth(m)) return bad(reply, 'Pick a month.');
    const w = calendarWindow(t);
    if (m < w.from || m > w.to) return bad(reply, 'The calendar shows this month through two years ahead.');
    return billsCalendar(db, t, m);
  });

  app.post('/api/recurring', async (req, reply) => {
    const b = manualBody.safeParse(req.body);
    if (!b.success) return bad(reply, b.error.issues[0]?.message ?? 'Check the form.');
    const c = cost(b.data.amount);
    if (typeof c === 'string') return bad(reply, c);
    const p = dueProblem(b.data.nextDue) ?? categoryProblem(b.data.categoryId);
    if (p) return bad(reply, p);
    const item = addManual(db, { ...b.data, amountCents: c }, today(), now());
    return reply.code(201).send({ item });
  });

  app.post('/api/recurring/confirm', async (req, reply) => {
    const b = keyBody.safeParse(req.body);
    if (!b.success) return bad(reply, 'Pick a suggestion.');
    return run(reply, () => ({ item: confirmSuggestion(db, b.data.key, today(), now()) }));
  });

  app.post('/api/recurring/dismiss', async (req, reply) => {
    const b = keyBody.safeParse(req.body);
    if (!b.success) return bad(reply, 'Pick a suggestion.');
    return run(reply, () => {
      dismissSuggestion(db, b.data.key, today(), now());
      return { ok: true };
    });
  });

  app.patch('/api/recurring/:id', async (req, reply) => {
    const id = idOf(req);
    const b = patchBody.safeParse(req.body);
    if (!b.success) return bad(reply, b.error.issues[0]?.message ?? 'Check the form.');
    let amountCents: number | undefined;
    if (b.data.amount !== undefined) {
      const c = cost(b.data.amount);
      if (typeof c === 'string') return bad(reply, c);
      amountCents = c;
    }
    const p = (b.data.nextDue !== undefined ? dueProblem(b.data.nextDue) : null) ?? categoryProblem(b.data.categoryId);
    if (p) return bad(reply, p);
    return run(reply, () => {
      const item = id ? updateItem(db, id, { ...b.data, amountCents }, today(), now()) : null;
      return item ? { item } : reply.code(404).send({ error: 'Not found.' });
    });
  });

  app.post('/api/recurring/:id/cancel', async (req, reply) => {
    const id = idOf(req);
    return run(reply, () => {
      const r = id ? cancelItem(db, id, today(), now()) : null;
      return r ?? reply.code(404).send({ error: 'Not found.' });
    });
  });

  app.post('/api/recurring/:id/restore', async (req, reply) => {
    const id = idOf(req);
    const item = id ? restoreItem(db, id, today(), now()) : null;
    return item ? { item } : reply.code(404).send({ error: 'Not found.' });
  });

  app.delete('/api/recurring/:id', async (req, reply) => {
    const id = idOf(req);
    return id && deleteItem(db, id) ? { ok: true } : reply.code(404).send({ error: 'Not found.' });
  });
}
