/**
 * Database access for transactions, categories and rules, plus the rules
 * that keep a transaction consistent:
 *   income/expense -> category of the same kind, or none (uncategorized)
 *   transfer/gift  -> no category
 */
import type { DB } from '../db/database.js';
import type { IsoDate } from '../../../shared/dates.js';
import type { TxType } from '../../../shared/transactions.js';
import type { Cents } from './money.js';
import { classify, type CategoryKind, type Rule } from './rules.js';
import { autoLinkRule, findTransferPairs, pairKey, suggestionRule, type PairRule, type TransferCandidate } from './transfers.js';
import { MONEY_LINES_CTE } from './totals.js';

// ---------- categories ----------

export interface Category {
  id: number;
  name: string;
  group: string;
  kind: 'income' | 'expense';
  color: string;
  sortOrder: number;
  archived: boolean;
  /** Hidden role some totals depend on (migration 007), so renaming the category breaks nothing. */
  role: CategoryRole | null;
}

export type CategoryRole = 'refereeing' | 'other_income' | 'ref_costs';

/** The category that holds a role, if it still exists. */
export function categoryByRole(cats: readonly Category[], role: CategoryRole): Category | undefined {
  return cats.find((c) => c.role === role);
}

type RawCategory = { id: number; name: string; group_name: string; kind: 'income' | 'expense'; color: string; sort_order: number; archived: number; role: CategoryRole | null };
const mapCategory = (r: RawCategory): Category => ({
  id: r.id,
  name: r.name,
  group: r.group_name,
  kind: r.kind,
  color: r.color,
  sortOrder: r.sort_order,
  archived: r.archived === 1,
  role: r.role ?? null,
});

/**
 * The Interest category (Trophies Round 3, migration 017): found by its interest mark, never by name, so renaming it
 * is safe. null when it was deleted (or never existed).
 */
export function interestCategoryId(db: DB): number | null {
  const r = db.prepare('SELECT id FROM categories WHERE interest_role = 1').get() as { id: number } | undefined;
  return r?.id ?? null;
}

export function listCategories(db: DB): Category[] {
  return (db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all() as RawCategory[]).map(mapCategory);
}

export function getCategory(db: DB, id: number): Category | null {
  const r = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as RawCategory | undefined;
  return r ? mapCategory(r) : null;
}

export function categoryKinds(db: DB): CategoryKind[] {
  return db.prepare('SELECT id, kind FROM categories').all() as unknown as CategoryKind[];
}

// ---------- rules ----------

type RawRule = {
  id: number;
  match_type: Rule['matchType'];
  pattern: string;
  account_id: number | null;
  direction: Rule['direction'];
  set_type: TxType | null;
  set_category_id: number | null;
  set_gift_from: string;
  priority: number;
};
const mapRule = (r: RawRule): Rule => ({
  id: r.id,
  matchType: r.match_type,
  pattern: r.pattern,
  accountId: r.account_id,
  direction: r.direction,
  setType: r.set_type,
  setCategoryId: r.set_category_id,
  setGiftFrom: r.set_gift_from,
  priority: r.priority,
});

export function listRules(db: DB): Rule[] {
  return (db.prepare('SELECT * FROM category_rules ORDER BY priority, id DESC').all() as RawRule[]).map(mapRule);
}

// ---------- transactions ----------

export interface Transaction {
  id: number;
  accountId: number;
  date: IsoDate;
  amountCents: Cents;
  description: string;
  rawDescription: string;
  type: TxType;
  categoryId: number | null;
  giftFrom: string;
  payer: string;
  notes: string;
  transferGroupId: number | null;
  source: 'manual' | 'import';
  importBatchId: number | null;
  /**
   * In the transaction LIST a split transaction appears once per piece: amountCents and categoryId
   * are then the piece's, and this says which piece it is. null for a whole transaction (and always
   * null from getTransaction, which returns the whole transaction).
   */
  split: { position: number; count: number; note: string; totalCents: Cents } | null;
}

type RawTx = {
  id: number;
  account_id: number;
  date: string;
  amount_cents: number;
  description: string;
  raw_description: string;
  type: TxType;
  category_id: number | null;
  gift_from: string;
  payer: string;
  notes: string;
  transfer_group_id: number | null;
  source: 'manual' | 'import';
  import_batch_id: number | null;
};
const mapTx = (r: RawTx): Transaction => ({
  id: r.id,
  accountId: r.account_id,
  date: r.date,
  amountCents: r.amount_cents,
  description: r.description,
  rawDescription: r.raw_description,
  type: r.type,
  categoryId: r.category_id,
  giftFrom: r.gift_from,
  payer: r.payer,
  notes: r.notes,
  transferGroupId: r.transfer_group_id,
  source: r.source,
  importBatchId: r.import_batch_id,
  split: null,
});

export function getTransaction(db: DB, id: number): Transaction | null {
  const r = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as RawTx | undefined;
  return r ? mapTx(r) : null;
}

/** Makes type and category agree. Returns the category to store. */
export function reconcileCategory(db: DB, type: TxType, categoryId: number | null): number | null {
  if (type === 'transfer' || type === 'gift' || categoryId === null) return null;
  const cat = getCategory(db, categoryId);
  return cat && cat.kind === type ? cat.id : null;
}

export interface NewTransaction {
  accountId: number;
  date: IsoDate;
  amountCents: Cents;
  description: string;
  rawDescription?: string;
  type: TxType;
  categoryId: number | null;
  giftFrom?: string;
  payer?: string;
  notes?: string;
  source: 'manual' | 'import';
  importBatchId?: number | null;
  dedupeKey?: string | null;
}

export function insertTransaction(db: DB, t: NewTransaction, now: number): number {
  const categoryId = reconcileCategory(db, t.type, t.categoryId);
  const res = db
    .prepare(
      `INSERT INTO transactions (account_id, date, amount_cents, description, raw_description, type, category_id,
         gift_from, payer, notes, source, import_batch_id, dedupe_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      t.accountId,
      t.date,
      t.amountCents,
      t.description,
      t.rawDescription ?? '',
      t.type,
      categoryId,
      t.type === 'gift' ? (t.giftFrom ?? '') : '',
      t.payer ?? '',
      t.notes ?? '',
      t.source,
      t.importBatchId ?? null,
      t.dedupeKey ?? null,
      now,
      now,
    );
  return Number(res.lastInsertRowid);
}

export type TransactionPatch = Partial<{
  date: IsoDate;
  amountCents: Cents;
  description: string;
  type: TxType;
  categoryId: number | null;
  giftFrom: string;
  payer: string;
  notes: string;
}>;

export function updateTransaction(db: DB, id: number, patch: TransactionPatch, now: number): Transaction | null {
  const cur = getTransaction(db, id);
  if (!cur) return null;
  const type = patch.type ?? cur.type;
  // Changing a linked transfer into something else breaks the link (both sides),
  // and remembers it so the next import does not link the same two again.
  if (cur.transferGroupId !== null && type !== 'transfer') unlinkTransfer(db, id, { restoreTypes: false, block: true, now });
  const categoryId = reconcileCategory(db, type, patch.categoryId !== undefined ? patch.categoryId : cur.categoryId);
  db.prepare(
    `UPDATE transactions SET date = ?, amount_cents = ?, description = ?, type = ?, category_id = ?,
       gift_from = ?, payer = ?, notes = ?, updated_at = ? WHERE id = ?`,
  ).run(
    patch.date ?? cur.date,
    patch.amountCents ?? cur.amountCents,
    patch.description ?? cur.description,
    type,
    categoryId,
    type === 'gift' ? (patch.giftFrom ?? cur.giftFrom) : '',
    patch.payer ?? cur.payer,
    patch.notes ?? cur.notes,
    now,
    id,
  );
  return getTransaction(db, id);
}

export function deleteTransaction(db: DB, id: number): boolean {
  const cur = getTransaction(db, id);
  if (!cur) return false;
  if (cur.transferGroupId !== null) unlinkTransfer(db, id, { restoreTypes: true });
  return db.prepare('DELETE FROM transactions WHERE id = ?').run(id).changes > 0;
}

// ---------- transfer links ----------

/** Links two transactions as the two sides of one transfer. */
export function linkTransfer(db: DB, aId: number, bId: number, now: number): string | null {
  const a = getTransaction(db, aId);
  const b = getTransaction(db, bId);
  if (!a || !b) return 'Transaction not found.';
  if (a.accountId === b.accountId) return 'A transfer has to be between two different accounts.';
  if (Math.sign(a.amountCents) === Math.sign(b.amountCents)) return 'One side must be money out and the other money in.';
  if (Math.abs(a.amountCents) !== Math.abs(b.amountCents)) return 'The two amounts must match.';
  if (a.transferGroupId !== null || b.transferGroupId !== null) return 'One of these is already linked to another transfer.';
  const splitCount = db.prepare('SELECT COUNT(*) AS n FROM transaction_splits WHERE transaction_id IN (?, ?)').get(a.id, b.id) as { n: number };
  if (splitCount.n > 0) return 'A split transaction cannot be a transfer. Remove the split first.';
  const group = Math.min(a.id, b.id);
  // Linking by hand overrides an earlier "these are not a pair".
  db.prepare('DELETE FROM transfer_link_blocks WHERE low_id = ? AND high_id = ?').run(group, Math.max(a.id, b.id));
  const stmt = db.prepare(
    `UPDATE transactions SET type_before_link = CASE WHEN type <> 'transfer' THEN type ELSE NULL END,
       category_before_link = CASE WHEN type <> 'transfer' THEN category_id ELSE NULL END,
       type = 'transfer', category_id = NULL, gift_from = '', transfer_group_id = ?, updated_at = ? WHERE id = ?`,
  );
  stmt.run(group, now, a.id);
  stmt.run(group, now, b.id);
  return null;
}

/**
 * Breaks a transfer link. With restoreTypes, sides that were changed by linking get their old type back.
 * With block, the pair is remembered so automatic linking never pairs them again.
 */
export function unlinkTransfer(
  db: DB,
  id: number,
  opts: { restoreTypes: boolean; block?: boolean; now?: number } = { restoreTypes: true },
): void {
  const cur = getTransaction(db, id);
  if (!cur || cur.transferGroupId === null) return;
  if (opts.block) {
    const ids = (
      db.prepare('SELECT id FROM transactions WHERE transfer_group_id = ? ORDER BY id').all(cur.transferGroupId) as { id: number }[]
    ).map((r) => r.id);
    const ins = db.prepare('INSERT OR IGNORE INTO transfer_link_blocks (low_id, high_id, created_at) VALUES (?, ?, ?)');
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) ins.run(ids[i]!, ids[j]!, opts.now ?? 0);
  }
  if (opts.restoreTypes) {
    db.prepare(
      `UPDATE transactions SET type = COALESCE(type_before_link, type),
         category_id = CASE WHEN type_before_link IS NOT NULL THEN category_before_link ELSE category_id END,
         type_before_link = NULL, category_before_link = NULL, transfer_group_id = NULL
       WHERE transfer_group_id = ?`,
    ).run(cur.transferGroupId);
  } else {
    db.prepare('UPDATE transactions SET type_before_link = NULL, category_before_link = NULL, transfer_group_id = NULL WHERE transfer_group_id = ?').run(
      cur.transferGroupId,
    );
  }
}

/** Clears links whose other side no longer exists (after an import is undone). */
export function repairTransferLinks(db: DB): void {
  db.exec(`
    UPDATE transactions
       SET type = COALESCE(type_before_link, type),
           category_id = CASE WHEN type_before_link IS NOT NULL THEN category_before_link ELSE category_id END,
           type_before_link = NULL, category_before_link = NULL, transfer_group_id = NULL
     WHERE transfer_group_id IS NOT NULL
       AND transfer_group_id IN (
         SELECT transfer_group_id FROM transactions WHERE transfer_group_id IS NOT NULL
         GROUP BY transfer_group_id HAVING COUNT(*) < 2)`);
}

/** Open (unlinked, unsplit, non-gift) transactions as pair candidates, and the pairs the user broke apart. */
function pairInputs(db: DB): { candidates: TransferCandidate[]; blocked: Set<string> } {
  const rows = db
    .prepare(
      `SELECT id, account_id, date, amount_cents, type, category_id FROM transactions
       WHERE transfer_group_id IS NULL AND type <> 'gift'
         AND id NOT IN (SELECT transaction_id FROM transaction_splits) -- a split transaction is never a transfer
      `,
    )
    .all() as { id: number; account_id: number; date: string; amount_cents: number; type: TxType; category_id: number | null }[];
  const candidates: TransferCandidate[] = rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    date: r.date,
    amountCents: r.amount_cents,
    type: r.type,
    transferGroupId: null,
    categoryId: r.category_id,
  }));
  const blocked = new Set(
    (db.prepare('SELECT low_id, high_id FROM transfer_link_blocks').all() as { low_id: number; high_id: number }[]).map((r) =>
      pairKey(r.low_id, r.high_id),
    ),
  );
  return { candidates, blocked };
}

function pairsBy(db: DB, rule: PairRule): [number, number][] {
  const { candidates, blocked } = pairInputs(db);
  return findTransferPairs(candidates, 3, blocked, rule);
}

/**
 * Finds and links transfer pairs across all accounts. Returns how many pairs were linked.
 * Audit F-02: only two transfers, or a transfer and an UNcategorized row, are linked automatically.
 * A transfer that matches a categorized purchase or paycheck becomes a suggestion (transferSuggestions).
 */
export function autoLinkTransfers(db: DB, now: number): number {
  const pairs = pairsBy(db, autoLinkRule);
  for (const [o, i] of pairs) linkTransfer(db, o, i, now);
  return pairs.length;
}

/** Possible transfers to review: a transfer and a categorized row of the same size, 3 days apart or less. Read-only. */
export function transferSuggestions(db: DB): { out: Transaction; in: Transaction }[] {
  return pairsBy(db, suggestionRule).map(([o, i]) => ({ out: getTransaction(db, o)!, in: getTransaction(db, i)! }));
}

/** "Not a pair": remembered like an unlink, so this pair is never suggested or linked automatically again. */
export function dismissSuggestion(db: DB, outId: number, inId: number, now: number): boolean {
  if (outId === inId || !getTransaction(db, outId) || !getTransaction(db, inId)) return false;
  db.prepare('INSERT OR IGNORE INTO transfer_link_blocks (low_id, high_id, created_at) VALUES (?, ?, ?)').run(
    Math.min(outId, inId),
    Math.max(outId, inId),
    now,
  );
  return true;
}

// ---------- rules on existing transactions ----------

/** Re-runs rules on uncategorized income/expense (never touches transfers, gifts or your manual choices). */
export function applyRulesToUncategorized(db: DB, now: number): number {
  const rules = listRules(db);
  const kinds = categoryKinds(db);
  const rows = db
    .prepare(
      `SELECT id, account_id, amount_cents, description, raw_description FROM transactions
       WHERE category_id IS NULL AND type IN ('income', 'expense') AND transfer_group_id IS NULL
         AND id NOT IN (SELECT transaction_id FROM transaction_splits) -- split pieces carry their own categories
      `,
    )
    .all() as { id: number; account_id: number; amount_cents: number; description: string; raw_description: string }[];
  let changed = 0;
  for (const r of rows) {
    const c = classify(
      { accountId: r.account_id, amountCents: r.amount_cents, description: r.description, rawDescription: r.raw_description },
      rules,
      kinds,
    );
    if (c.ruleId === null) continue;
    if (c.categoryId === null && c.type === (r.amount_cents > 0 ? 'income' : 'expense')) continue;
    db.prepare('UPDATE transactions SET type = ?, category_id = ?, gift_from = ?, updated_at = ? WHERE id = ?').run(
      c.type,
      c.categoryId,
      c.giftFrom,
      now,
      r.id,
    );
    changed++;
  }
  return changed;
}

// ---------- listing ----------

export interface TxFilter {
  accountId?: number;
  from?: IsoDate;
  to?: IsoDate;
  type?: TxType;
  categoryId?: number | 'none';
  q?: string;
  limit?: number;
  offset?: number;
}

export function listTransactions(db: DB, f: TxFilter): {
  transactions: Transaction[];
  total: number;
  sums: { incomeCents: Cents; spendingCents: Cents; transferCents: Cents; giftCents: Cents };
} {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.accountId) {
    where.push('account_id = ?');
    args.push(f.accountId);
  }
  if (f.from) {
    where.push('date >= ?');
    args.push(f.from);
  }
  if (f.to) {
    where.push('date <= ?');
    args.push(f.to);
  }
  if (f.type) {
    where.push('type = ?');
    args.push(f.type);
  }
  if (f.categoryId === 'none') where.push("category_id IS NULL AND type IN ('income','expense')");
  else if (f.categoryId) {
    where.push('category_id = ?');
    args.push(f.categoryId);
  }
  if (f.q) {
    // LIKE with escaped wildcards: plain substring search, not a pattern language.
    where.push(
      "(description LIKE ? ESCAPE '\\' OR raw_description LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' OR piece_note LIKE ? ESCAPE '\\')",
    );
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    args.push(like, like, like, like);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  const offset = Math.max(f.offset ?? 0, 0);

  // Rows come from the shared money lines (lib/totals.ts): a split transaction is one row per
  // piece, so a category filter shows only the matching pieces, with their own amounts.
  const rows = db
    .prepare(
      `WITH ${MONEY_LINES_CTE},
       picked AS (SELECT * FROM money_lines ${w} ORDER BY date DESC, tx_id DESC, piece_position LIMIT ? OFFSET ?)
       SELECT t.*, p.piece_position, p.piece_count, p.piece_note, p.category_id AS line_category_id,
              p.amount_cents AS line_amount_cents
       FROM picked p JOIN transactions t ON t.id = p.tx_id
       ORDER BY p.date DESC, p.tx_id DESC, p.piece_position`,
    )
    .all(...args, limit, offset) as (RawTx & {
    piece_position: number | null;
    piece_count: number | null;
    piece_note: string;
    line_category_id: number | null;
    line_amount_cents: number;
  })[];
  const agg = db
    .prepare(
      `WITH ${MONEY_LINES_CTE}
       SELECT COUNT(*) AS n,
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount_cents END), 0) AS income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents END), 0) AS expense,
         COALESCE(SUM(CASE WHEN type = 'transfer' AND amount_cents > 0 THEN amount_cents END), 0) AS transfer, -- money arriving by transfer, counted once
         COALESCE(SUM(CASE WHEN type = 'gift' THEN amount_cents END), 0) AS gift
       FROM money_lines ${w}`,
    )
    .get(...args) as { n: number; income: number; expense: number; transfer: number; gift: number };
  const toRow = (r: (typeof rows)[number]): Transaction => {
    const t = mapTx(r);
    if (r.piece_position === null) return t;
    return {
      ...t,
      amountCents: r.line_amount_cents,
      categoryId: r.line_category_id,
      split: { position: r.piece_position, count: r.piece_count ?? 0, note: r.piece_note, totalCents: r.amount_cents },
    };
  };
  return {
    transactions: rows.map(toRow),
    total: agg.n,
    // Spending is shown as a positive number: money out minus refunds.
    sums: { incomeCents: agg.income, spendingCents: -agg.expense, transferCents: agg.transfer, giftCents: agg.gift },
  };
}
