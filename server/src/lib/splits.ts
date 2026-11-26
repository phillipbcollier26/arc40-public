/**
 * Split transactions: one income or expense transaction divided into 2 to 50 pieces.
 *
 * Rules (checked here on the server, never only in the browser):
 *  - only income and expense can be split (transfers and gifts stay whole)
 *  - 2 to 50 pieces; each has a category of the SAME kind as the transaction, an amount and an
 *    optional note
 *  - each piece is non-zero and has the transaction's sign
 *  - the pieces add up to the transaction's amount EXACTLY, to the cent
 *
 * Amounts arrive as text without a sign ("12.50"): the piece takes the transaction's direction.
 * A minus sign means the opposite direction and is refused.
 *
 * The transaction row keeps its full amount and its own category; "Remove split" just deletes
 * the pieces, which brings that category back. Totals read pieces through lib/totals.ts.
 */
import type { DB } from '../db/database.js';
import { transaction } from '../db/database.js';
import { formatCents, MoneyParseError, parseMoneyToCents, type Cents } from './money.js';
import type { TxType } from '../../../shared/transactions.js';

export const MIN_PIECES = 2;
export const MAX_PIECES = 50;

export interface PieceInput {
  categoryId: number;
  amount: string;
  note?: string;
}

export interface Piece {
  categoryId: number;
  amountCents: Cents;
  note: string;
}

export interface SavedPiece extends Piece {
  id: number;
  position: number;
}

type Plan = { ok: true; pieces: Piece[] } | { ok: false; error: string };

/** Pure check of a proposed split. `kindOf` gives each category's kind (undefined = no such category). */
export function planSplit(
  tx: { type: TxType; amountCents: Cents },
  pieces: readonly PieceInput[],
  kindOf: (categoryId: number) => 'income' | 'expense' | undefined,
): Plan {
  if (tx.type !== 'income' && tx.type !== 'expense') {
    return { ok: false, error: 'Only income and spending can be split. Transfers and gifts stay whole.' };
  }
  if (pieces.length < MIN_PIECES) return { ok: false, error: 'A split needs at least 2 pieces.' };
  if (pieces.length > MAX_PIECES) return { ok: false, error: `A split can have at most ${MAX_PIECES} pieces.` };
  if (tx.amountCents === 0) return { ok: false, error: 'A $0.00 transaction cannot be split.' };

  const sign = Math.sign(tx.amountCents);
  const direction = sign < 0 ? 'money out' : 'money in';
  const wantKind = tx.type;
  const out: Piece[] = [];
  for (const [i, p] of pieces.entries()) {
    const n = i + 1;
    let cents: number;
    try {
      cents = parseMoneyToCents(p.amount);
    } catch (e) {
      if (e instanceof MoneyParseError) return { ok: false, error: `Piece ${n}: enter an amount like 12.50.` };
      throw e;
    }
    if (cents === 0) return { ok: false, error: `Piece ${n}: each piece needs an amount above $0.00.` };
    if (cents < 0) return { ok: false, error: `Piece ${n} must be ${direction}, like the whole transaction.` };
    const kind = kindOf(p.categoryId);
    if (kind !== wantKind) {
      return { ok: false, error: `Piece ${n}: pick ${wantKind === 'expense' ? 'a spending' : 'an income'} category.` };
    }
    out.push({ categoryId: p.categoryId, amountCents: sign * cents, note: (p.note ?? '').trim().slice(0, 200) });
  }
  const total = out.reduce((s, p) => s + p.amountCents, 0);
  if (total !== tx.amountCents) {
    const left = Math.abs(tx.amountCents) - Math.abs(total);
    return {
      ok: false,
      error:
        left > 0
          ? `The pieces add up to ${formatCents(Math.abs(total))}, ${formatCents(left)} short of ${formatCents(Math.abs(tx.amountCents))}.`
          : `The pieces add up to ${formatCents(Math.abs(total))}, ${formatCents(-left)} more than ${formatCents(Math.abs(tx.amountCents))}.`,
    };
  }
  return { ok: true, pieces: out };
}

export function getSplits(db: DB, transactionId: number): SavedPiece[] {
  return (
    db
      .prepare('SELECT id, position, category_id, amount_cents, note FROM transaction_splits WHERE transaction_id = ? ORDER BY position')
      .all(transactionId) as { id: number; position: number; category_id: number | null; amount_cents: number; note: string }[]
  ).map((r) => ({ id: r.id, position: r.position, categoryId: r.category_id as number, amountCents: r.amount_cents, note: r.note }));
}

export function isSplit(db: DB, transactionId: number): boolean {
  return db.prepare('SELECT 1 FROM transaction_splits WHERE transaction_id = ? LIMIT 1').get(transactionId) !== undefined;
}

/** Replaces a transaction's pieces (all or nothing). Call planSplit first. */
export function saveSplits(db: DB, transactionId: number, pieces: readonly Piece[], now: number): SavedPiece[] {
  return transaction(db, () => {
    db.prepare('DELETE FROM transaction_splits WHERE transaction_id = ?').run(transactionId);
    const ins = db.prepare('INSERT INTO transaction_splits (transaction_id, position, category_id, amount_cents, note) VALUES (?, ?, ?, ?, ?)');
    pieces.forEach((p, i) => ins.run(transactionId, i + 1, p.categoryId, p.amountCents, p.note));
    // Belt and braces: the database must agree that the pieces add up.
    const { s, a } = db
      .prepare(
        `SELECT (SELECT SUM(amount_cents) FROM transaction_splits WHERE transaction_id = ?) AS s,
                (SELECT amount_cents FROM transactions WHERE id = ?) AS a`,
      )
      .get(transactionId, transactionId) as { s: number; a: number };
    if (s !== a) throw new Error('split pieces do not add up');
    db.prepare('UPDATE transactions SET updated_at = ? WHERE id = ?').run(now, transactionId);
    return getSplits(db, transactionId);
  });
}

/** "Remove split": deletes the pieces; the transaction's own category applies again. */
export function removeSplits(db: DB, transactionId: number, now: number): boolean {
  const n = db.prepare('DELETE FROM transaction_splits WHERE transaction_id = ?').run(transactionId).changes;
  if (n > 0) db.prepare('UPDATE transactions SET updated_at = ? WHERE id = ?').run(now, transactionId);
  return n > 0;
}

/** Split transactions an import brought in (shown in the undo warning). */
export function splitCountForBatch(db: DB, batchId: number): number {
  return (
    db
      .prepare(
        `SELECT COUNT(DISTINCT s.transaction_id) AS n FROM transaction_splits s
         JOIN transactions t ON t.id = s.transaction_id WHERE t.import_batch_id = ?`,
      )
      .get(batchId) as { n: number }
  ).n;
}
