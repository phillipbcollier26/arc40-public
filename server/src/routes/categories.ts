import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import { CATEGORY_COLORS, TX_TYPES } from '../../../shared/transactions.js';
import { applyRulesToUncategorized, getCategory, listCategories, listRules } from '../lib/transactions.js';
import { ruleMatches } from '../lib/rules.js';

const name = z.string().trim().min(1, 'Give it a name.').max(40, 'Keep the name under 40 characters.');

const catCreate = z.object({
  name,
  group: z.string().trim().min(1).max(40).default('Other'),
  kind: z.enum(['expense', 'income']),
  color: z.enum(CATEGORY_COLORS).default('silver'),
});
const catPatch = z.object({
  name: name.optional(),
  group: z.string().trim().min(1).max(40).optional(),
  color: z.enum(CATEGORY_COLORS).optional(),
  archived: z.boolean().optional(),
});

const ruleBody = z
  .object({
    matchType: z.enum(['contains', 'starts_with', 'equals']).default('contains'),
    pattern: z.string().trim().min(2, 'Use at least 2 characters to match.').max(100),
    accountId: z.number().int().positive().nullable().default(null),
    direction: z.enum(['any', 'in', 'out']).default('any'),
    setType: z.enum(TX_TYPES).nullable().default(null),
    setCategoryId: z.number().int().positive().nullable().default(null),
    setGiftFrom: z.string().trim().max(60).default(''),
    applyNow: z.boolean().default(true),
  })
  .refine((r) => r.setType !== null || r.setCategoryId !== null, 'Pick a category or a type for this rule.');

export function registerCategoryRoutes(app: FastifyInstance, db: DB, now: () => number): void {
  const bad = (reply: FastifyReply, error: string) => reply.code(400).send({ error });
  const isUniqueError = (e: unknown) => String((e as Error).message).includes('UNIQUE');

  // ---------- categories ----------

  app.get('/api/categories', async () => {
    const counts = new Map(
      (db.prepare('SELECT category_id AS id, COUNT(*) AS n FROM transactions WHERE category_id IS NOT NULL GROUP BY category_id').all() as {
        id: number;
        n: number;
      }[]).map((r) => [r.id, r.n]),
    );
    return { categories: listCategories(db).map((c) => ({ ...c, transactionCount: counts.get(c.id) ?? 0 })) };
  });

  app.post('/api/categories', async (req, reply) => {
    const b = catCreate.safeParse(req.body);
    if (!b.success) return bad(reply, b.error.issues[0]?.message ?? 'Check the form.');
    const order = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM categories').get() as { n: number }).n;
    try {
      const id = Number(
        db
          .prepare('INSERT INTO categories (name, group_name, kind, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(b.data.name, b.data.group, b.data.kind, b.data.color, order, now()).lastInsertRowid,
      );
      return reply.code(201).send({ category: getCategory(db, id) });
    } catch (e) {
      if (isUniqueError(e)) return bad(reply, 'A category with that name already exists.');
      throw e;
    }
  });

  app.patch('/api/categories/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const cur = getCategory(db, id);
    if (!cur) return reply.code(404).send({ error: 'Category not found.' });
    const b = catPatch.safeParse(req.body);
    if (!b.success) return bad(reply, b.error.issues[0]?.message ?? 'Check the form.');
    try {
      db.prepare('UPDATE categories SET name = ?, group_name = ?, color = ?, archived = ? WHERE id = ?').run(
        b.data.name ?? cur.name,
        b.data.group ?? cur.group,
        b.data.color ?? cur.color,
        (b.data.archived ?? cur.archived) ? 1 : 0,
        id,
      );
    } catch (e) {
      if (isUniqueError(e)) return bad(reply, 'A category with that name already exists.');
      throw e;
    }
    return { category: getCategory(db, id) };
  });

  /** Deleting a category makes its transactions uncategorized and removes rules that used it. */
  app.delete('/api/categories/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!db.prepare('DELETE FROM categories WHERE id = ?').run(id).changes) return reply.code(404).send({ error: 'Category not found.' });
    return { ok: true };
  });

  // ---------- rules ----------

  app.get('/api/rules', async () => ({ rules: listRules(db) }));

  app.post('/api/rules', async (req, reply) => {
    const b = ruleBody.safeParse(req.body);
    if (!b.success) return bad(reply, b.error.issues[0]?.message ?? 'Check the rule.');
    const r = b.data;
    if (r.setCategoryId !== null) {
      const cat = getCategory(db, r.setCategoryId);
      if (!cat) return bad(reply, 'That category no longer exists.');
      if (r.setType && r.setType !== cat.kind) return bad(reply, `"${cat.name}" is an ${cat.kind} category, so the type must be ${cat.kind}.`);
    }
    if ((r.setType === 'transfer' || r.setType === 'gift') && r.setCategoryId !== null) {
      return bad(reply, 'Transfers and gifts do not use categories.');
    }
    const id = Number(
      db
        .prepare(
          `INSERT INTO category_rules (match_type, pattern, account_id, direction, set_type, set_category_id, set_gift_from, priority, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        )
        .run(r.matchType, r.pattern, r.accountId, r.direction, r.setType, r.setCategoryId, r.setGiftFrom, now()).lastInsertRowid,
    );
    const applied = r.applyNow ? applyRulesToUncategorized(db, now()) : 0;
    return reply.code(201).send({ rule: listRules(db).find((x) => x.id === id), applied });
  });

  app.delete('/api/rules/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!db.prepare('DELETE FROM category_rules WHERE id = ?').run(id).changes) return reply.code(404).send({ error: 'Rule not found.' });
    return { ok: true };
  });

  /** How many existing transactions a rule would match (shown while you type it). */
  app.post('/api/rules/test', async (req) => {
    const b = req.body as { pattern?: string; matchType?: 'contains' | 'starts_with' | 'equals'; direction?: 'any' | 'in' | 'out' };
    const pattern = String(b?.pattern ?? '').slice(0, 100);
    if (pattern.trim().length < 2) return { matches: 0, examples: [] };
    const rule = {
      id: 0,
      matchType: b.matchType ?? 'contains',
      pattern,
      accountId: null,
      direction: b.direction ?? 'any',
      setType: null,
      setCategoryId: null,
      setGiftFrom: '',
      priority: 0,
    } as const;
    const rows = db.prepare('SELECT account_id, amount_cents, description, raw_description FROM transactions').all() as {
      account_id: number;
      amount_cents: number;
      description: string;
      raw_description: string;
    }[];
    const hits = rows.filter((r) =>
      ruleMatches(rule, { accountId: r.account_id, amountCents: r.amount_cents, description: r.description, rawDescription: r.raw_description }),
    );
    return { matches: hits.length, examples: [...new Set(hits.map((h) => h.description))].slice(0, 5) };
  });

  app.post('/api/rules/apply', async () => ({ updated: applyRulesToUncategorized(db, now()) }));
}
