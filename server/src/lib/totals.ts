/**
 * THE one source for income and spending totals.
 *
 * Every screen that adds up income, spending or gifts (Budget, Cash flow, Dashboard, Goals,
 * the Transactions sums) reads "money lines" from here and nowhere else.
 *
 *   A money line = one amount, with one type and one category, on one date.
 *   A transaction is one line, unless it is split (V2 Phase 2): then each piece is a line with
 *   the piece's amount and category, and the transaction itself is not a line. Splits are taught
 *   to THIS file only; every screen picks them up from here.
 *
 * The math on top of the lines (income = sum of income lines, spending = -(sum of expense
 * lines), transfers and gifts never income or spending) stays in cashflow.ts as pure functions.
 */
import type { DB } from '../db/database.js';
import type { IsoDate } from '../../../shared/dates.js';
import type { TxType } from '../../../shared/transactions.js';
import type { CashTx } from './cashflow.js';
import type { Cents } from './money.js';

export interface MoneyLine extends CashTx {
  txId: number;
  accountId: number;
  payer: string;
  /** The transaction's cleaned description (a split piece carries its transaction's). Set by loadMoneyLines. */
  description?: string;
}

/**
 * SQL for a `money_lines` common table expression. Columns: tx_id, split_id (NULL for a whole
 * transaction), piece_position, piece_count, account_id, date, type, category_id, amount_cents,
 * payer, description, raw_description, notes, piece_note. Use as `WITH ${MONEY_LINES_CTE} ...`.
 *
 *   - a transaction WITHOUT pieces is one line (its own amount and category);
 *   - a SPLIT transaction is one line per piece (the piece's amount and category, the
 *     transaction's date, type, account, payer and text). The transaction itself is not a line,
 *     so nothing is ever counted twice.
 */
export const MONEY_LINES_CTE = `money_lines AS (
  SELECT t.id AS tx_id, NULL AS split_id, NULL AS piece_position, NULL AS piece_count,
         t.account_id, t.date, t.type, t.category_id, t.amount_cents, t.payer,
         t.description, t.raw_description, t.notes, '' AS piece_note
  FROM transactions t
  WHERE NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)
  UNION ALL
  SELECT t.id, s.id, s.position, (SELECT COUNT(*) FROM transaction_splits c WHERE c.transaction_id = t.id),
         t.account_id, t.date, t.type, s.category_id, s.amount_cents, t.payer,
         t.description, t.raw_description, t.notes, s.note
  FROM transaction_splits s JOIN transactions t ON t.id = s.transaction_id
)`;

interface RawLine {
  tx_id: number;
  account_id: number;
  date: string;
  type: TxType;
  category_id: number | null;
  amount_cents: number;
  payer: string;
  description: string;
}

/** All money lines between two dates (inclusive; either end optional), in date order. */
export function loadMoneyLines(db: DB, range: { from?: IsoDate; to?: IsoDate } = {}): MoneyLine[] {
  const rows = db
    .prepare(
      `WITH ${MONEY_LINES_CTE}
       SELECT tx_id, account_id, date, type, category_id, amount_cents, payer, description FROM money_lines
       WHERE (? IS NULL OR date >= ?) AND (? IS NULL OR date <= ?)
       ORDER BY date, tx_id, piece_position`,
    )
    .all(range.from ?? null, range.from ?? null, range.to ?? null, range.to ?? null) as unknown as RawLine[];
  return rows.map((r) => ({
    txId: r.tx_id,
    accountId: r.account_id,
    date: r.date,
    type: r.type,
    categoryId: r.category_id,
    amountCents: r.amount_cents,
    payer: r.payer,
    description: r.description,
  }));
}

/** Date of the first transaction of any kind (months before it never count in averages). */
export function firstLineDate(db: DB): IsoDate | null {
  return (db.prepare('SELECT MIN(date) AS d FROM transactions').get() as { d: string | null }).d;
}

/** Sum of the lines of one type, optionally limited to some categories and a date range. */
export function sumLines(lines: readonly MoneyLine[], type: TxType, categoryIds?: ReadonlySet<number>): Cents {
  let s = 0;
  for (const l of lines) {
    if (l.type !== type) continue;
    if (categoryIds && (l.categoryId === null || !categoryIds.has(l.categoryId))) continue;
    s += l.amountCents;
  }
  return s;
}

/** One side of a transfer (transfers are never split, so a leg is a whole transaction). */
export interface TransferLeg {
  txId: number;
  accountId: number;
  date: IsoDate;
  amountCents: Cents;
  transferGroupId: number | null;
  /** The account of the other linked side, or null when not linked (or the other side is gone). */
  partnerAccountId: number | null;
  text: string;
}

/**
 * Transfer transactions between two dates (inclusive). Read-only. Used by the money river to tell
 * where moved money went. Transfers are never income or spending, so this never feeds a total.
 */
export function loadTransferLegs(db: DB, range: { from: IsoDate; to: IsoDate }): TransferLeg[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.account_id, t.date, t.amount_cents, t.transfer_group_id, t.description, t.raw_description,
              (SELECT p.account_id FROM transactions p
                WHERE p.transfer_group_id = t.transfer_group_id AND p.id <> t.id ORDER BY p.id LIMIT 1) AS partner
       FROM transactions t
       WHERE t.type = 'transfer' AND t.date >= ? AND t.date <= ?
       ORDER BY t.date, t.id`,
    )
    .all(range.from, range.to) as {
    id: number;
    account_id: number;
    date: string;
    amount_cents: number;
    transfer_group_id: number | null;
    description: string;
    raw_description: string;
    partner: number | null;
  }[];
  return rows.map((r) => ({
    txId: r.id,
    accountId: r.account_id,
    date: r.date,
    amountCents: r.amount_cents,
    transferGroupId: r.transfer_group_id,
    partnerAccountId: r.transfer_group_id === null ? null : r.partner,
    text: `${r.description} ${r.raw_description}`,
  }));
}
