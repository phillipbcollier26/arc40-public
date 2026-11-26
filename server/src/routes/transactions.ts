import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import { isValidIsoDate, toIsoDate } from '../../../shared/dates.js';
import { isTxType, TX_TYPES } from '../../../shared/transactions.js';
import { formatCents, MoneyParseError, parseMoneyToCents } from '../lib/money.js';
import { getAccount } from '../lib/accounts.js';
import {
  deleteTransaction,
  getTransaction,
  insertTransaction,
  linkTransfer,
  listTransactions,
  unlinkTransfer,
  updateTransaction,
  type TransactionPatch,
  categoryKinds,
  dismissSuggestion,
  transferSuggestions,
} from '../lib/transactions.js';
import { getSplits, isSplit, MAX_PIECES, MIN_PIECES, planSplit, removeSplits, saveSplits } from '../lib/splits.js';

const TRANSFER_LOCKED = 'This is linked as a transfer. Unlink first to change its amount or direction.';
const SPLIT_LOCKED ='This transaction is split. Remove the split first to change its amount, type or category.';

const splitBody = z.object({
  pieces: z
    .array(
      z.object({
        categoryId: z.number().int().positive(),
        /** Text without a sign, like "12.50": the piece goes the same way as the transaction. */
        amount: z.string().trim().min(1, 'Enter an amount for every piece.').max(30),
        note: z.string().trim().max(200, 'Keep each note to 200 characters or fewer.').default(''),
      }),
    )
    .min(MIN_PIECES, 'A split needs at least 2 pieces.')
    .max(MAX_PIECES, `A split can have at most ${MAX_PIECES} pieces.`),
});

const text = (max: number) => z.string().trim().max(max, `That is too long. Keep it to ${max} characters or fewer.`);

const createBody = z.object({
  accountId: z.number().int().positive(),
  date: z.string(),
  /** Text like "25.00". `direction` says which way the money went. */
  amount: z.string().trim().min(1).max(30),
  direction: z.enum(['in', 'out']),
  description: text(200).min(1, 'Add a short description.'),
  type: z.enum(TX_TYPES),
  categoryId: z.number().int().positive().nullable().default(null),
  giftFrom: text(60).default(''),
  payer: text(60).default(''),
  notes: text(500).default(''),
});

const patchBody = z.object({
  date: z.string().optional(),
  amount: z.string().trim().min(1).max(30).optional(),
  direction: z.enum(['in', 'out']).optional(),
  description: text(200).min(1).optional(),
  type: z.enum(TX_TYPES).optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  giftFrom: text(60).optional(),
  payer: text(60).optional(),
  notes: text(500).optional(),
});

const bulkBody = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
  type: z.enum(TX_TYPES).optional(),
  categoryId: z.number().int().positive().nullable().optional(),
});

/** Whole numbers in the URL ("25"); anything else (like "abc") is a plain 400, never a crash. */
const idParam = (what: string) =>
  z
    .string()
    .regex(/^\d{1,9}$/, `${what} must be a whole number.`)
    .transform(Number)
    .optional();
const listQuery = z.object({
  accountId: idParam('The account'),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  type: z.string().max(20).optional(),
  categoryId: z.union([z.literal('none'), z.string().regex(/^\d{1,9}$/, 'The category must be a whole number.').transform(Number)]).optional(),
  q: z.string().max(500).optional(),
  limit: idParam('The page size'),
  offset: idParam('The page start'),
});

export function registerTransactionRoutes(app: FastifyInstance, db: DB, now: () => number): void {
  const bad = (reply: FastifyReply, error: string) => reply.code(400).send({ error });
  const checkDate = (d: string) => (!isValidIsoDate(d) ? 'Pick a valid date.' : d > toIsoDate(now()) ? 'That date is in the future.' : null);
  const signed = (amount: string, direction: 'in' | 'out'): number | string => {
    try {
      const c = Math.abs(parseMoneyToCents(amount));
      if (c === 0) return 'Enter an amount above zero.';
      return direction === 'in' ? c : -c;
    } catch (e) {
      return e instanceof MoneyParseError ? 'Enter an amount like 25.00.' : 'Invalid amount.';
    }
  };

  app.get('/api/transactions', async (req, reply) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return bad(reply, parsed.error.issues[0]?.message ?? 'Check the filters.');
    const q = parsed.data;
    if (q.type && !isTxType(q.type)) return bad(reply, 'Unknown type.');
    if ((q.from && !isValidIsoDate(q.from)) || (q.to && !isValidIsoDate(q.to))) return bad(reply, 'Invalid date range.');
    return listTransactions(db, {
      accountId: q.accountId,
      from: q.from,
      to: q.to,
      type: q.type as (typeof TX_TYPES)[number] | undefined,
      categoryId: q.categoryId,
      q: q.q?.slice(0, 100),
      limit: q.limit,
      offset: q.offset,
    });
  });

  app.post('/api/transactions', async (req, reply) => {
    const b = createBody.safeParse(req.body);
    if (!b.success) return bad(reply, b.error.issues[0]?.message ?? 'Check the form.');
    if (!getAccount(db, b.data.accountId)) return bad(reply, 'Pick an account.');
    const dateProblem = checkDate(b.data.date);
    if (dateProblem) return bad(reply, dateProblem);
    const cents = signed(b.data.amount, b.data.direction);
    if (typeof cents === 'string') return bad(reply, cents);
    const id = insertTransaction(
      db,
      { ...b.data, amountCents: cents, source: 'manual' },
      now(),
    );
    return reply.code(201).send({ transaction: getTransaction(db, id) });
  });

  app.patch('/api/transactions/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const cur = Number.isSafeInteger(id) ? getTransaction(db, id) : null;
    if (!cur) return reply.code(404).send({ error: 'Transaction not found.' });
    const b = patchBody.safeParse(req.body);
    if (!b.success) return bad(reply, b.error.issues[0]?.message ?? 'Check the form.');
    const { amount, direction, ...rest } = b.data;
    const patch: TransactionPatch = rest;
    if (rest.date !== undefined) {
      const p = checkDate(rest.date);
      if (p) return bad(reply, p);
    }
    if (amount !== undefined || direction !== undefined) {
      const dir = direction ?? (cur.amountCents >= 0 ? 'in' : 'out');
      const cents = signed(amount ?? formatCents(Math.abs(cur.amountCents)), dir);
      if (typeof cents === 'string') return bad(reply, cents);
      patch.amountCents = cents;
    }
    // Audit F-04: the two sides of a linked transfer must keep matching, so neither side's amount or direction
    // can change while linked (the same amount sent back unchanged is fine: the edit window always sends it).
    if (cur.transferGroupId !== null && patch.amountCents !== undefined && patch.amountCents !== cur.amountCents) {
      return bad(reply, TRANSFER_LOCKED);
    }
    // A split's pieces must keep adding up: its amount, type and category stay as they are.
    if (
      isSplit(db, id) &&
      ((patch.amountCents !== undefined && patch.amountCents !== cur.amountCents) ||
        (patch.type !== undefined && patch.type !== cur.type) ||
        (patch.categoryId !== undefined && patch.categoryId !== cur.categoryId))
    ) {
      return bad(reply, SPLIT_LOCKED);
    }
    return { transaction: updateTransaction(db, id, patch, now()) };
  });

  app.post('/api/transactions/bulk', async (req, reply) => {
    const b = bulkBody.safeParse(req.body);
    if (!b.success) return bad(reply, 'Select some transactions first.');
    let updated = 0;
    let skippedSplits = 0;
    db.exec('BEGIN');
    try {
      for (const id of new Set(b.data.ids)) {
        // Split transactions keep their pieces; change those in the edit window.
        if (isSplit(db, id)) {
          skippedSplits++;
          continue;
        }
        if (updateTransaction(db, id, { type: b.data.type, categoryId: b.data.categoryId }, now())) updated++;
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { updated, skippedSplits };
  });

  app.delete('/api/transactions/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isSafeInteger(id) || !deleteTransaction(db, id)) return reply.code(404).send({ error: 'Transaction not found.' });
    return { ok: true };
  });

  app.post('/api/transactions/:id/link', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const other = Number((req.body as { otherId?: unknown } | undefined)?.otherId);
    const problem = linkTransfer(db, id, other, now());
    if (problem) return bad(reply, problem);
    return { ok: true };
  });

  app.post('/api/transactions/:id/unlink', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!getTransaction(db, id)) return reply.code(404).send({ error: 'Transaction not found.' });
    unlinkTransfer(db, id, { restoreTypes: true, block: true, now: now() });
    return { transaction: getTransaction(db, id) };
  });

  /** Possible transfers to review (audit F-02): pairs automatic linking leaves alone because one side has a category. */
  app.get('/api/transfers/suggestions', async () => ({ suggestions: transferSuggestions(db) }));

  /** "Not a pair": never suggest or auto-link these two again. */
  app.post('/api/transfers/suggestions/dismiss', async (req, reply) => {
    const b = z.object({ outId: z.number().int().positive(), inId: z.number().int().positive() }).safeParse(req.body);
    if (!b.success || !dismissSuggestion(db, b.data.outId, b.data.inId, now())) return reply.code(404).send({ error: 'Transaction not found.' });
    return { ok: true };
  });

  /** Possible other halves for a transfer (same size, opposite sign, other account, within 7 days). */
  app.get('/api/transactions/:id/link-candidates', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const t = getTransaction(db, id);
    if (!t) return reply.code(404).send({ error: 'Transaction not found.' });
    const rows = db
      .prepare(
        `SELECT id FROM transactions WHERE account_id <> ? AND amount_cents = ? AND transfer_group_id IS NULL
           AND id NOT IN (SELECT transaction_id FROM transaction_splits)
           AND ABS(julianday(date) - julianday(?)) <= 7 ORDER BY ABS(julianday(date) - julianday(?)) LIMIT 10`,
      )
      .all(t.accountId, -t.amountCents, t.date, t.date) as { id: number }[];
    return { candidates: rows.map((r) => getTransaction(db, r.id)) };
  });

  /** One whole transaction (full amount, its own category) with its split pieces, if any. */
  app.get('/api/transactions/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const t = Number.isSafeInteger(id) ? getTransaction(db, id) : null;
    if (!t) return reply.code(404).send({ error: 'Transaction not found.' });
    return { transaction: t, splits: getSplits(db, id) };
  });

  /** Saves (or replaces) a split. The server checks every rule; see lib/splits.ts. */
  app.put('/api/transactions/:id/split', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const t = Number.isSafeInteger(id) ? getTransaction(db, id) : null;
    if (!t) return reply.code(404).send({ error: 'Transaction not found.' });
    const b = splitBody.safeParse(req.body);
    if (!b.success) return bad(reply, b.error.issues[0]?.message ?? 'Check the pieces.');
    if (t.transferGroupId !== null) return bad(reply, 'A transfer cannot be split.');
    const kinds = new Map(categoryKinds(db).map((c) => [c.id, c.kind]));
    const plan = planSplit(t, b.data.pieces, (cid) => kinds.get(cid));
    if (!plan.ok) return bad(reply, plan.error);
    return { transaction: getTransaction(db, id), splits: saveSplits(db, id, plan.pieces, now()) };
  });

  /** "Remove split": back to one category (the one the transaction had before it was split). */
  app.delete('/api/transactions/:id/split', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const t = Number.isSafeInteger(id) ? getTransaction(db, id) : null;
    if (!t) return reply.code(404).send({ error: 'Transaction not found.' });
    removeSplits(db, id, now());
    return { transaction: getTransaction(db, id), splits: [] };
  });
}
